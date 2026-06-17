# Soundtrack Auto-Volume — Full System Audit

_Date: 2026-06-17 · Auditor: Claude (Opus 4.8) · Method: 9-agent parallel audit (6 code dimensions + 3 research streams), every P0/P1 finding adversarially re-verified against the actual code (57 agents total)._

Scope: firmware (`/firmware`), server (`/server/src`), frontend (`/server/public/index.html`), Prisma schema, deployment config. Target: **a client beta in ~48 hours.**

---

## Verdict

The system is **functionally complete and structurally sound** — the server compiles clean (`tsc --noEmit` passes, 0 errors), secrets are handled correctly, the algorithm is a reasonable first cut, and the dashboard is genuinely polished. It will demo on a happy path.

But it is **not yet safe or robust enough to hand to a paying client unattended.** There are a small number of issues that can (a) expose control of *all 900+ Soundtrack accounts* to anyone with the URL, (b) leave a device looking *dead* at the venue with no recovery for non-technical staff, and (c) make the music *creep to maximum volume and stay there* — the classic failure mode of this entire product category. These are fixable inside the 48-hour window.

**Severity tally** (after adversarial verification; finder counts were higher before downgrades):
- **5 true P0** (must fix before the client connects)
- **~12 high-value P1** (fix before or right around the beta)
- **~30 P2** (polish / post-beta hardening)

The verification pass *downgraded* several finder-flagged "P0s" (e.g. the divide-by-zero NaN, the single-outage reprovision trap) — they're documented below as **debunked** so you don't waste time on them.

---

## What's already good (don't touch)

- **Server builds cleanly** — `npm install` + `prisma generate` + `tsc --noEmit` all pass, zero type errors.
- **Secrets are handled right** — `.env` is gitignored, no token in git history, the SYB token is never logged, and the master credential correctly lives only on the backend (never shipped to the ESP32).
- **The `setVolume` GraphQL inlining is correct, not a hack** — SYB's custom `Volume` scalar genuinely does not round-trip through GraphQL variables; inlining is required. (Research-confirmed against SYB's API.)
- **Single-instance, in-memory design is fine for the beta** — most "distributed systems" worries don't apply as long as it stays one Render instance.
- **The sensitivity/reactivity round-trip mappings and the dB-bar scale are mathematically correct** — the right preset button highlights after save; this was checked and is a non-issue.
- **Asymmetric EMA + direction-hysteresis + sustain + 2-step clamp + 2s rate-limit** is a sensible control skeleton. The rate-limit/sustain interaction does **not** runaway (traced).

---

## P0 — Must fix before the client connects

### P0-1 · Anyone can control the volume of all 900+ Soundtrack accounts (no auth)
`server/src/routes/soundtrack.ts:34-46` · `server/src/index.ts` (no auth middleware)

`POST /api/soundtrack/zones/:zoneId/volume` and `GET /api/soundtrack/accounts?q=` are completely unauthenticated. The server holds a **master SYB token that reaches 900+ live client accounts**, so anyone who can reach the public Render URL can enumerate every account, list its zones, and set the music volume of *any* zone in *any* of those 900+ businesses. This is the single most likely thing to embarrass (or worse) the beta.

**Fix (48h-minimal):** Put an auth gate in front of `/api/*`. For a closed beta the cheapest credible option is a **shared admin secret** (header/cookie token in an env var) for admin actions + **signed (HMAC) customer links** so `?account=ID` can't be forged or swapped. Bind each volume/zone write to the device that owns it. Full fix: real per-tenant auth.

### P0-2 · The admin dashboard has no login — the bare URL is full control
`server/public/index.html:872-873` (`isCustomerMode = !!urlParams.get('account')`) · server enforces nothing

Customer-vs-admin is decided **entirely in client-side JavaScript**. Visiting `https://soundtrack-auto-volume.onrender.com` with no query string yields the full admin UI: list/rename/delete every device, reassign accounts, change every config, factory-reset any unit. The server does zero authorization, so even hitting the API directly works. Same root cause as P0-1; same fix (the admin secret gate covers both).

### P0-3 · Changing WiFi wipes the working credentials *before* the new ones succeed
`firmware/src/provisioning.cpp:141-182` (`startCaptivePortal` → `WiFi.disconnect(true,true)` + `wm.resetSettings()` *before* the portal runs)

Every entry into the captive portal **erases the stored WiFi credentials first**, then waits up to 3 minutes for new ones. This is exactly your "connecting to a new WiFi was tricky" pain. It is the documented WiFiManager anti-pattern.

### P0-4 · A portal timeout strands the device in an endless no-credentials loop (looks dead)
`firmware/src/main.cpp:154-182` + `provisioning.cpp:169` (`PORTAL_TIMEOUT 180`)

Consequence of P0-3: if the 3-minute portal times out (nobody was standing there with a phone), the device now has **no credentials and no working network**, and re-enters the same credential-wiping portal forever. To a venue, the box is simply dead, and non-technical staff cannot recover it without on-site reconfiguration.

**Fix for P0-3 + P0-4 (firmware):** Stop calling `wm.resetSettings()` in the provisioning path. Keep the known-good credentials and only overwrite them when a **new** network actually associates (`setSaveConfigCallback` / validate-before-commit). Run the portal **non-blocking** (`setConfigPortalBlocking(false)` + `wm.process()` in `loop()`) so the device keeps working and the screen stays live during setup. Add a deliberate on-device **"Change WiFi"** affordance (see P1) so switching networks never requires a destructive reset.

### P0-5 · Dead devices show "Online" forever and auto-volume silently stops
`server/src/websocket/handler.ts:29-67` (device removed only on the `close` event; server never pings)

The server marks a device offline **only** when it receives a clean WebSocket `close`. If the venue router reboots, the ISP blips, or the device crashes, the TCP socket dies silently: the server keeps the device in its in-memory map **and** `isOnline=true` in the DB **forever**, the dashboard shows a green dot, and auto-volume just stops with no signal to anyone.

**Fix:** Server-side heartbeat — `ws.isAlive=true` on connect, reset on `pong`, a ~30s `setInterval` that `ws.ping()`s and `ws.terminate()`s any socket that didn't pong, then reconciles `isOnline` in the DB. (Render imposes no idle WS timeout but explicitly recommends app-level ping/pong.) Pair with a device-side keepalive (P1 FW).

---

## Product-critical (rated P1, but treat as a headline): runaway gain / acoustic feedback
`server/src/services/volume-mapper.ts:61-147` + `firmware/src/main.cpp:630-664`

This is the one I most want you to internalize before the beta. **The microphone hears the music it is controlling.** The algorithm reacts to *total* SPL with no concept of "music floor" vs "crowd noise." In a quiet venue, loud music reads as a loud room → the system raises volume → which the mic hears as an even louder room → it raises volume again → it parks at or climbs toward `maxVolume` and stays there. The asymmetric EMA (deliberately *slow* to come back down) makes the stuck-high state worse, not better.

The research stream confirmed this is **the dominant, well-known failure mode of the entire adaptive-volume product category** (AtlasIED Atmosphere, HARMAN/BSS, Biamp Vocia, Q-SYS). The professionals solve it *structurally* — they isolate the sense mic from the program audio, or only measure ambient in the music's quiet gaps. A single in-room ESP32 mic **cannot** isolate the music, so this product **must** defend against runaway gain in software. Today it does not.

**Why it's "only" P1:** it's a design risk, not a guaranteed crash — with conservative `maxVolume` and the right room it may behave. But it's the thing most likely to make the client say "it just got loud and stayed loud." **Mitigations** (pick 1-2 for the beta): a hard `maxVolume` ceiling the customer can't exceed (already partially present); model-and-subtract the known *commanded* volume contribution (the server already knows the 0-16 it set); freeze the ambient estimate for a settle window right after it raises volume; or react only to level *changes above* the current music floor rather than absolute SPL. A per-zone **kill switch** + a "stuck at max for >X min → auto-disable + alert" circuit breaker is cheap insurance for the beta.

---

## P1 — High value (fix before or right around the beta)

**Server / correctness**
- **P1 · Rate-limit race → duplicate `setVolume` calls + corrupted smoothing state.** `volume-mapper.ts:108-122`: `lastApiCallTime` is written *after* the awaited GraphQL call, so a second reading for the same zone (every 500ms) can pass the 2s gate during the await and fire a duplicate call, and clobber the hysteresis state mid-flight. Minimal fix: set `lastApiCallTime = now` *before* the `await`; robust fix: per-zone async serialization.
- **P1 · Five `PrismaClient` instances** (`index.ts`, `handler.ts`, `device-manager.ts`, `routes/devices.ts`, `routes/configs.ts`), each opening its own pool against the small Render Postgres. Collapse to **one shared singleton** module and cap `?connection_limit=` in the URL.
- **P1 · In-memory volume + rate-limit state is lost on every deploy/restart** — every zone re-initializes to its midpoint mid-session. Seed `smoothedDb`/`currentVolume` from the DB `currentVolume` on first reading.
- **P1 · Destructive boot "migration"** (`index.ts:51-56`) overwrites *any* user-customized config that happens to match the old default tuple. Remove the inline boot migrations; use a real migration.

**Security (beyond the P0 gate)**
- **P1 · GraphQL injection via string-interpolated `zoneId`** in `setVolume()` (`soundtrack.ts:155-168`). `zoneId` flows from request input straight into the mutation string. Validate/escape it (allowlist to zones the caller owns).
- **P1 · `?account=ID` is an unsigned bearer credential in the URL** — leaks via history, referer, logs, sharing. Sign customer links (HMAC).
- **P1 · WebSocket has no origin check / auth / device-identity verification** — a client can register as any `deviceId` and spoof another customer's readings. Add a device token.
- **P1 · No rate limiting anywhere** → SYB token cost/abuse amplification + DB hammering. Add `express-rate-limit`.

**Firmware**
- **P1 · No deliberate "Change WiFi" affordance** — switching networks forces a factory reset that *also* erases the Account ID. Add a touch-driven "Change WiFi" that launches the non-blocking portal without wiping the account.
- **P1 · No WebSocket app-level keepalive on the device** — half-open TCP / silent server deploys can leave the device "connected" but mute. Add a device ping + reconnect-on-silence.
- **P1 · Single blocking `loop()` (no FreeRTOS tasks)** despite `CLAUDE.md` mandating them — full QSPI display redraws every 200ms + `i2s_read` can throttle WebSocket servicing and audio. Split into pinned audio / network / display tasks (or at least dirty-rect the display).
- **P1 · Boot-time touch-reset poll is false-positive prone** (`provisioning.cpp:226-345`) — could silently factory-reset a healthy unit. Require a longer, more deliberate gesture and confirm on-screen.

**Algorithm**
- **P1 · Reacts to an instantaneous ~16ms RMS snapshot** of non-A-weighted dBFS sampled every 500ms — a door slam, dropped tray, or shout is a first-class input. Replace with a short rolling **Leq / percentile** (e.g. 1s Leq, or L90 as the "background floor").
- **P1 · Presets are mislabeled** — "Slow" tracks a real change in ~24-32s; "Fast" still can't beat the 2s rate-limit per 2-step move. Re-tune so the speed dial means what it says.
- **P1 · Cold-start divergence** — first reading sets `currentVolume` to a fake midpoint without calling SYB, so the server's belief diverges from the zone's actual volume and the first move can be the wrong way/size. Read or set a known volume on registration.
- **P1 · No numeric validation on config inputs** (`routes/configs.ts`) — inverted thresholds / `min>max` / equal thresholds are accepted and produce inverted or step-function volume. Validate ranges at the edge (zod).

**Frontend / UX**
- **P1 · The 2-second poll clobbers in-progress customer interactions.** `loadDevices()` reassigns `this.devices` wholesale every 2s, snapping a dragged Volume slider back to the saved value and tearing down open menus / in-flight edits. Merge-in-place by id, and/or pause polling while the user is interacting.
- **P1 · The customer has a one-click "Reset Device"** that wipes WiFi and bricks the unit until physical re-provisioning. Remove it from the customer view (or hard-confirm + make it admin-only).
- **P1 · Failed polls fire an error toast every 2 seconds** during any server hiccup. Debounce / show a single banner.
- **P1 · Optimistic updates have no rollback** — on save failure the UI silently lies. Revert local state on error.
- **P1 · Blank page if the Tailwind / Alpine / Google-Fonts CDNs are blocked** at the venue. Self-host the three assets (also removes a 3rd-party dependency from the client's network).

**Ops**
- **P1 · No observability** — only `console.log`; a remote failure is invisible until the client complains. Add Sentry (free tier) + a simple uptime ping.
- **P1 · `/health` returns static `ok`** even if the DB or SYB token is broken. Make it a real readiness probe (ping DB + check token).
- **P1 · No `render.yaml` / deploy config in the repo** — build/start/env live only in the dashboard. Commit `render.yaml`.
- **P1 · Confirm Postgres backups** — losing the DB loses every device + zone config. Verify Render's backup policy / enable it.

---

## P2 — Polish & post-beta hardening (condensed)

Server: no graceful SIGTERM shutdown (deploys hard-kill in-flight writes); write amplification (2-4 DB writes per 500ms reading — throttle `lastDbLevel`); `zoneStates` map never pruned; SPA catch-all returns HTML for unknown `/api/*` (should 404 JSON); error-swallowing `.catch(()=>{})` in device-manager; duplicate-WS-per-device leaks the old socket; `config.ts` volume defaults are dead/inconsistent code; no `unhandledRejection` guard.
Firmware: deprecated `driver/i2s.h` (works on v3.x, but legacy); dBFS uses only the left channel with no DC-offset/clipping handling; `PIN_PA_ENABLE` defined but never driven; provisioning screen lacks a manual fallback URL/IP; `getAccountId()` never re-reads NVS at runtime and the account write isn't verified.
Frontend: dual-range thumbs overlap/become unusable at `min==max`; accessibility gaps (range inputs unlabeled, low-contrast glass text); two-sources-of-truth drift (`devices[].configs` vs `deviceConfigs`); large block of **dead code** (`toggleEditConfig`, `saveConfigSettings`, `editConfig`, `sensitivityLabel`, `reactivityLabel`); customer-added zones mis-highlight Reactivity as "Fast".
Ops: no tests/CI/typecheck gate before deploy; master SYB token has no rotation/scoping story; single Singapore region — confirm latency to the venue; perceptually-linear assumption of SYB 0-16 mapping is likely wrong.

---

## Recommended 48-hour pre-beta plan (sequenced)

**Day 1 — stop the bleeding (P0s)**
1. **Auth gate** in front of `/api/*` + admin secret + signed customer links (kills P0-1 and P0-2). _Biggest risk, do first._
2. **Firmware provisioning rewrite** (P0-3/P0-4): no `resetSettings()` in the path, non-blocking portal, validate-before-commit, on-device "Change WiFi". _Flash + test on the bench device you have here._
3. **WS heartbeat + DB reconcile** (P0-5) so "Online" means online.
4. **Runaway-gain guard** (product-critical): enforce a hard `maxVolume` ceiling + freeze-after-raise settle window + per-zone kill switch.

**Day 2 — make it solid & honest (high-value P1s)**
5. Single Prisma client + connection limit; seed volume state from DB; remove destructive boot migration.
6. Rate-limit race fix; GraphQL `zoneId` validation; input validation (zod) on config writes; `express-rate-limit`.
7. Frontend: merge-in-place polling (stop slider clobber), remove customer factory-reset, debounce error toasts, self-host CDNs.
8. Algorithm: switch to short rolling Leq + fix preset labels + cold-start volume seed.
9. Ops: Sentry + real `/health` readiness + `render.yaml` + confirm DB backups.

**Then test end-to-end** on the bench device → deploy to Render → dry-run the customer onboarding flow before the client touches it.

---

## Improvement & feature ideas (from the research streams)

- **Feedback-aware control loop** (the differentiator): model the commanded volume's contribution and subtract it, or measure ambient in music gaps ("gap sensing"). This is what separates a toy from AtlasIED-grade behavior.
- **Proper loudness measurement**: 1s Leq + L90 background floor, DC-blocker, A-weighting via biquads, and per-unit dB-SPL calibration stored in NVS.
- **Professional control model**: a *ratio* (dB-room → dB-music) above an ambient threshold, asymmetric attack/release, admin-locked min/max — and optionally **learn a per-space curve** from staff overrides (AtlasIED's headline feature).
- **Onboarding**: BLE / Improv-Wi-Fi provisioning as the primary path for non-technical buyers, SoftAP portal as fallback; **HTTPS OTA** (dual-partition + auto-rollback) so you can patch the fleet — critical once devices are sold.
- **Staff UX**: never expose raw dB/thresholds to floor staff — presets, locked bounds, **dayparting** (different targets by time of day), and a manual-override-with-timeout.
- **Per-zone + global kill switch** and a beta dashboard of measured-dB vs commanded-volume over time, so you can *see* pumping/runaway as it happens.
- **Treat SYB volume as write-only** — the API has no way to read back a manager's manual knob change; maintain optimistic local state and accept that divergence (relevant for the "SYB manual changes not synced" note already in `CLAUDE.md`).

---

## Debunked / non-issues (don't spend time here)

- **`mapDbToVolume` divide-by-zero / NaN** — shielded by the `<= quietDb` / `>= loudDb` guard clauses; NaN does not reach the API. (Input validation is still worth adding for *inverted* configs, but no NaN crash.)
- **"A single router reboot triggers reprovisioning"** — false. `consecutiveWiFiFailures` increments only once per connected→disconnected transition and resets on reconnect; it takes 5 separate drop cycles, and a restored outage never reprovisions. The real provisioning danger is P0-3/P0-4 (the portal itself), not transient outages.
- **Sensitivity/Reactivity mapping round-trip & dB-bar scale** — verified correct.
- **Secrets handling** — verified sound.

---

_Full structured findings (72 total, with evidence, line numbers, and per-finding verification verdicts) are preserved in the workflow result. This document is the prioritized synthesis._
