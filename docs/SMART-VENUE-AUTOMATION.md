# Smart Venue Automation — Product & Architecture Blueprint

**BMAsia · Soundtrack Auto-Volume → Smart Venue Platform**
*Lead product strategist + architect synthesis · June 2026*

> The product is **smart hardware + an AI automation layer** that runs a venue's ambience. We do not sell music catalogs or playlists — Soundtrack Your Brand (SYB) supplies the music and the actuators; **we supply the senses, the brain, and the voice.** The devices perceive the room; the cloud/edge reasons and acts. A manager can also just *talk to the venue* and it obeys.

---

## Table of Contents

1. [The Vision](#1-the-vision--a-venue-that-runs-its-own-ambience)
2. [FLAGSHIP: The Staff Voice Copilot](#2-flagship-the-staff-voice-copilot)
3. [Vision & Sensing on Raspberry Pi](#3-vision--sensing-on-raspberry-pi)
4. [The Multimodal Automation Brain](#4-the-multimodal-automation-brain)
5. [Ranked Use-Case Catalog (by buildability)](#5-ranked-use-case-catalog-by-buildability)
6. [Hardware: The Smart Venue Hub](#6-hardware-the-smart-venue-hub)
7. [The Build-Now Experiment Roadmap](#7-the-build-now-experiment-roadmap)
8. [Open Questions & Decisions for the Founder](#8-open-questions--decisions-for-the-founder)

---

## 1. The Vision — A Venue That Runs Its Own Ambience

Every night, a manager performs the same small chores on autopilot: nudging the volume up as the room fills, killing the music for a toast, switching to a livelier playlist when Friday peaks, scrambling for "Happy Birthday" at table 12. These are micro-decisions, dozens per shift, each one a walk to a tablet or a shout across the bar.

**Our product makes the venue do this itself — and lets staff override it in plain language.**

The shape of it:

- **The devices are senses and a voice.** The ESP32-S3 puck we already ship hears the room (ambient dB per zone) and can carry a push-to-talk button. A new Raspberry Pi hub *sees* the room (people, density, dwell, faces at the door) and captures clean far-field voice. Neither device is "smart" on its own — they are organs.
- **The cloud/edge is the brain.** A continuously-running control loop fuses every sense into a live **world model** of the venue, decides what the ambience should be, and acts through SYB's actuators (`setVolume`, `assignSource`, `queueTracks`, `play/pause`). It runs autonomously by default and yields instantly to a spoken command.
- **The wedge is voice; the moat is autonomy + data.** Voice control is the feature that makes an operator lean forward in a 10-second demo *and* still gets used on night 200. The autonomous "read-the-room" loop is the quiet workhorse that justifies a subscription because it works while nobody is watching. The vision/analytics layer reframes the camera from "surveillance" into "business intelligence" — a second, monetizable product line.

### What we are NOT building

We are not pitching SYB's catalog, playlist curation, or music licensing as our product. SYB owns the music. We own the **automation intelligence and the hardware that feeds it.** Everything terminates at the SYB GraphQL actuators we already drive today (`setVolume` works in production).

### The three-layer architecture

```
   SENSES (edge devices)         BRAIN (cloud/edge)              HANDS (SYB API)
 ┌──────────────────────┐    ┌──────────────────────┐    ┌──────────────────────┐
 │ ESP32-S3 puck         │   │ World model (Redis)   │    │ setVolume (0-16)      │
 │  • per-zone dBFS       │──▶│ Perception fusion     │──▶ │ assignSource          │
 │  • push-to-talk button │   │ Rules + LLM decision  │    │ queueTracks (restore) │
 │ Raspberry Pi hub       │   │ Voice agent (Claude)  │    │ play / pause          │
 │  • camera: count/heat  │──▶│ Explainability log    │──▶ │ nowPlaying (read)     │
 │  • mic array: voice    │   │ Learning / leases     │    │ (later) lights/signage│
 └──────────────────────┘    └──────────────────────┘    └──────────────────────┘
        what's happening            what to do                    make it happen
```

### Why now, why us

- We already own the hard-won pieces: a Node/TS backend on Render, working SYB auth + `setVolume`, a per-tenant device/auth model, an ESP32 firmware + WebSocket stack, an OTA story, and a Telegram channel.
- The AI building blocks are commodities in 2026: cloud STT at sub-300 ms (~$0.0077/min), cheap reliable tool-calling LLMs (Claude Haiku 4.5 at $1/$5 per Mtok with prompt caching), and a $70 Hailo accelerator that runs vision on a Pi locally at zero per-inference cost.
- The marginal cost to run the AI is **~$8–12/venue/month**; the hardware is a **one-time ~$200–310/venue**. Against a hardware sale + SaaS fee, that is trivial.

### One practical customer-perception note

For any camera, the honest selling point is: **video never leaves the venue — only tiny JSON metrics (counts, density, an opaque `regular_id`) are sent to the cloud.** A small "smart ambience — on-device" placard at the host stand and an optional physical privacy shutter on the camera are good practice and a genuine feature ("we recognize our regulars"). This is a comfort/buy-in framing, not a blocker, and it makes the metrics-only architecture a selling point.

---

## 2. FLAGSHIP: The Staff Voice Copilot

A manager speaks to the venue — *"give the music more energy,"* *"birthday song now,"* *"turn the patio down"* — and an LLM agent interprets the intent and executes the matching SYB action, confirming by voice. **This is the single highest-value, lowest-risk product** because the actuator already works in production, STT+LLM tool-use is a solved problem, and the worst failure mode (wake-word over a live PA) is eliminated by push-to-talk.

### 2.1 Capture — Push-to-talk wins in a venue

| Mode | Venue verdict |
|---|---|
| Always-listening | **No** — constant streaming, false triggers from music/crowd, staff-comfort optics |
| Wake-word ("Hey Aura") | **Backup only** — degrades badly at 75–90 dB SPL over the venue's own PA; misfires from the music itself |
| **Push-to-talk (PTT)** | **Primary** — ~100% reliable trigger, zero false positives, near-zero idle cost, clear "I'm talking to it" affordance; release = end-of-utterance, so we skip turn-detection latency entirely |

A manager behind a packed Friday bar will not repeat "Hey Aura" four times. A button (or a tap on the existing AMOLED) is deterministic. **PTT is the MVP call; wake-word is a v2 convenience.**

**Roles for the two devices (use both):**
- **ESP32-S3 puck** = the **PTT button + per-zone dB sensor + status screen**. Tap the AMOLED → it signals the backend "PTT pressed, zone=Patio" over the existing WebSocket. Its MEMS mic keeps doing auto-volume sensing. Reuses hardware we already ship.
- **ReSpeaker XVF3800 on the Pi** = the **clean far-field voice capture**. Its on-chip AEC can cancel the venue's own music (feed it the PA reference) so the manager's voice survives. 360°/5 m beamforming, plug-and-play USB.

Flow: tap ESP32 → tells the Pi "start listening" → ReSpeaker captures clean audio → STT → agent.

### 2.2 Speech-to-text — Cloud for the MVP, local as the fallback

- **Default: Deepgram Nova-3 streaming.** WER ~6.8%, sub-300 ms latency, strong noise robustness, **$0.0077/min** — cheapest *and* lowest-latency for voice agents. With PTT, button-release is the end-of-turn, so plain Nova-3 streaming (or a single batch call on the captured clip) is enough — no Flux turn-detection needed for the MVP.
- **Hot fallback: `faster-whisper base.en` on the Pi.** Keeps the copilot working (degraded) when venue internet drops, common in SE-Asia. `$0`, real-time on the Pi.
- Commands are short ("turn the patio down"), so per-utterance STT cost is a fraction of a cent.

### 2.3 The agent — Claude with tool-use over SYB actuators + live venue state

**Model: Claude Haiku 4.5** ($1/M in, $5/M out, ~0.75 s TTFT, best-in-class tool-calling reliability). Prompt-cache the large static system prompt (tool defs + venue config) for up to 90% off. Escalate the rare ambiguous/multi-step command to Sonnet.

> **TS, not Python.** The agent and SYB tools live in the **existing Render backend** — it already holds SYB auth, zone configs, live mic readings, and the device WebSocket. Keep SYB credentials server-side; one agent serves all venues. The Pi runs only audio I/O.

**The agent gets two things every turn:**

**(a) Tool definitions** mapped 1:1 to SYB actuators:

```jsonc
[
  { "name": "set_volume",            "input": { "zone_id", "volume:0-16" } },        // setVolume
  { "name": "nudge_volume",          "input": { "zone_id", "delta:+/-" } },          // read then setVolume, clamp
  { "name": "set_energy",            "input": { "zone_id", "direction:more|less|chill|upbeat" } }, // the one "smart" map
  { "name": "assign_source",         "input": { "zone_id", "source_query" } },       // soundZoneAssignSource
  { "name": "play_special_track",    "input": { "zone_id", "intent:birthday|...", "query" } }, // queueTracks, auto-restore
  { "name": "play_pause",            "input": { "zone_id", "action:play|pause" } },
  { "name": "now_playing",           "input": { "zone_id" } },                       // nowPlaying (read)
  { "name": "list_zones",            "input": {} },
  { "name": "schedule_state",        "input": { "zone_id", "target", "until" } },     // backend timer
  { "name": "revert_last",           "input": { "zone_id|all" } },                    // undo from action log
  { "name": "get_venue_state",       "input": { "zone_id|all" } },
  { "name": "ask_clarification",     "input": { "question", "options[]" } }
]
```

**(b) Live venue state** injected each turn, so fuzzy words resolve to real numbers:

```jsonc
{
  "venue": "Bistro 21", "time": "2026-06-19T20:14", "context": "Friday dinner",
  "zones": [
    { "id":"main", "name":"Main Room", "online":true,
      "volume":11, "source":{"id":"src_dinner_jazz","name":"Dinner Jazz","energy":0.30,"bpm":85},
      "now_playing":"...", "mic_dbfs":-38, "ambient_baseline_dbfs":-52,   // +14 dB = busy
      "people_count":72, "people_baseline":50 }
  ],
  "sources_catalog":[   // venue's SYB sources, pre-tagged with energy 0-1 + BPM
    {"id":"src_dinner_jazz","energy":0.30}, {"id":"src_chill_house","energy":0.45},
    {"id":"src_upbeat_funk","energy":0.70}, {"id":"src_peak_party","energy":0.90}
  ],
  "last_actions":[ {"t":"20:02","zone":"patio","action":"set_volume 9→7","by":"voice"} ]
}
```

**How fuzzy → concrete works:** the system prompt instructs the agent to (1) resolve the target zone from spoken names + DoA hint + the device's bound zone, (2) translate relative/vibe words into deltas against the *current* numeric state, (3) prefer the smallest action that satisfies intent, (4) ask or act-then-announce per the venue's mode. The **`sources_catalog` is pre-tagged with an energy score (0–1) and BPM**, so "more energy / chill / wind down" map to concrete source IDs deterministically — the LLM isn't guessing track BPMs, it's picking the next rung on a ladder *you* defined. `set_energy` is the only "smart" mapping you author: `more_energy` = volume `+2..+3` clamped + assign the next-higher-energy source; `chill` = `-2` + next-lower.

### 2.4 Command taxonomy — 45 utterances → concrete actions

**Absolute & relative volume**
1. "Turn it up." → `nudge_volume(current, +2)`
2. "A bit louder." → `+1`
3. "Way too loud, bring it down." → `-3`
4. "Turn it down a notch." → `-1`
5. "Set the music to about half." → `set_volume(zone, 8)`
6. "Max it out for the toast." → `set_volume(zone, 14)` (capped below 16 to protect ears)
7. "Mute the patio." → `set_volume(patio, 0)` or `play_pause(patio, pause)`
8. "Bring everything down a bit." → `nudge_volume(all, -2)`

**Multi-zone / targeting**
9. "Turn the patio down." → `nudge_volume(patio, -2)`
10. "Make the main room match the patio." → read both, `set_volume(main, patio.volume)`
11. "Music's too loud by the bar." → resolve "bar" → nearest zone via DoA, `-2`
12. "Same vibe everywhere." → `assign_source(all, current.source)`
13. "Kill the music in the private room, they have a speech." → `play_pause(private, pause)`
14. "Only the patio — leave the inside alone." → scope guard, patio only

**Vibe / energy (the headline kind)**
15. "Give it more energy." → `set_energy(zone, more_energy)` (source ladder up + small volume bump)
16. "We're busier than usual, more energy." → see §2.6 worked example
17. "Something chill." → `set_energy(zone, chill)`
18. "Make it more upbeat." → `assign_source(zone, src_upbeat_funk)`
19. "This is putting people to sleep." → energy +1 rung
20. "Wind down for closing." → step energy down over time + `schedule_state` ramp
21. "Dinner vibe now." → `assign_source(zone, src_dinner_jazz)`
22. "Party mode." → `assign_source(zone, src_peak_party)` + volume to upper band
23. "Too aggressive, soften it." → energy −1 rung
24. "Classy background music." → lowest-energy instrumental source

**Events / one-shots**
25. "Birthday song now." → `play_special_track(zone, birthday)` → auto-restore
26. "Play Happy Birthday on the patio." → same, zone=patio
27. "Can you play some Sinatra?" → `play_special_track(zone, custom, "Frank Sinatra")`
28. "Put on the World Cup anthem." → `play_special_track`, auto-restore
29. "Announce last call — drop the music for 10 seconds." → `set_volume(0)`, timer, restore
30. "New table just sat, play something welcoming." → `play_special_track` welcoming track

**Scheduling / temporal**
31. "Keep it mellow till 6." → `schedule_state(zone, low-energy, until=18:00)`
32. "Crank it at 9 when the DJ set starts." → `schedule_state(zone, peak_party @21:00)`
33. "Quiet for the next half hour." → low volume + `schedule_state` restore in 30 min
34. "Back to normal at 10." → `schedule_state(zone, default, at=22:00)`
35. "Every day at 5 switch to happy hour music." → recurring schedule (backend cron)

**Undo / revert / status**
36. "Undo that." → `revert_last(zone)`
37. "Put it back how it was." → `revert_last`
38. "Never mind, cancel." → no-op, confirm cancelled
39. "What's playing on the patio?" → `now_playing(patio)` → spoken answer
40. "How loud is the main room?" → `get_venue_state(main)` → "Main's at 11 of 16."
41. "Is the patio music even on?" → check online/playback → spoken answer

**Ambiguous / disambiguation-triggering**
42. "Turn it down." (3 zones, location unknown) → `ask_clarification("Which zone? Patio, Main, or Bar?")`
43. "Make it better." → `ask_clarification("Louder, quieter, or change the vibe?")`
44. "Play that song from before." → check `last_actions`; if none, ask
45. "Do the usual closing thing." → map to a saved venue macro, else ask

### 2.5 Feedback / confirmation UX

Three channels, used together:
- **Chime (<50 ms):** a "listening" tone on PTT-press, a distinct "done" tone on success. This is the latency hider — staff get acknowledgment before TTS even starts.
- **Spoken TTS reply (the personality):** short, factual confirmations under ~12 words. **Deepgram Aura-2** (sub-150 ms, $0.030/1k chars) for cost, or **Cartesia Sonic** (~40 ms TTFA) for the snappiest feel. Local **Piper TTS** on the Pi is a zero-cost fallback.
- **Screen (ESP32 AMOLED + dashboard):** shows the transcribed command, the action taken, and a big **UNDO** button. Critical in a loud room where TTS may be missed. Disambiguation options ("Patio / Main / Bar") are tappable so the manager doesn't shout over the noise.

**Confirm-vs-autonomous (per-venue setting):**
- **Autonomous (default):** low-risk actions (volume nudges, vibe swaps, queue a song) execute immediately, announced after the fact ("Done — patio's down two.").
- **Confirm-first:** high-impact actions (mute a zone, "party mode" across all zones, schedule changes) ask before committing. Set a **risk threshold**: anything touching `all`, going to volume 0, or scheduling requires confirmation; everything else is autonomous.
- **Always-undoable:** every action is logged; "undo" works for ~10 minutes regardless of mode. This safety net is what lets you default to autonomous.

### 2.6 Worked example — "We're busier than usual, give the music more energy"

The showcase. The naïve version just nudges volume. The real agent runs a **sense → reason → act → confirm** loop:

**1 — Verify "busier" against sensors (fuse evidence, don't trust the human blindly).** `get_venue_state(current_zone)` → manager is in Main Room:
- `mic_dbfs = -38` vs baseline `-52` → **+14 dB over baseline**, strong busy signal.
- `people_count = 72` vs baseline `50` → **+44%** (if camera present).
- Both agree → "busier" **confirmed**. (If mic said quiet and camera said empty, the agent gently pushes back: *"Main actually looks quiet — raise energy anyway?"* — the fusion payoff.)

**2 — Read current energy.** Source = Dinner Jazz, energy 0.30, volume 11. "More energy" in a confirmed-busy room = move **up the energy ladder**, not just louder. Next rung: Upbeat Funk & Soul (0.70).

**3 — Decide. Do BOTH, deliberately:**
- **Source swap (the real "energy" lever):** `assign_source(main, src_upbeat_funk)` — this changes the *feel*.
- **Volume nudge sized to the room:** already loud (-38 dBFS), so only **+1** (`set_volume(main, 12)`). If the room had been quiet, +2–3.
- Does **not** touch other zones (scope = where the manager stands / where it's busy).

**4 — Confirm (spoken).** *"Main's busy — bumped it to Upbeat Funk and nudged volume up one. Want the patio too?"* The trailing question makes multi-zone opt-in.

**5 — Logged for undo.** Both actions in `last_actions` so "undo that" reverts source *and* volume in one shot.

**6 — (with the brain, §4) set an intent lease.** `{intent:"high_energy", ttl:90min, by:mgr}` so the autonomous loop *holds* this energy through the peak and won't quietly revert it when one quiet song plays.

> The answer to "raise volume or switch source?" is **switch source as the primary energy lever, plus a sensor-sized volume nudge** — committed only after the mic (and camera) corroborate "busy." That fusion is what makes it feel intelligent rather than a glorified remote.

### 2.7 Latency budget (PTT, cloud path)

| Stage | Budget |
|---|---|
| PTT release → audio finalized | ~0 ms (release = end-of-turn) |
| STT (Deepgram, short utterance) | 250–400 ms |
| Agent (Haiku 4.5 TTFT + tool decision) | 400–800 ms |
| SYB GraphQL actuator call | 500–2000 ms (SYB-side cloud) |
| TTS first audio (Aura-2/Cartesia) | 40–150 ms |
| **Perceived "I heard you" (chime)** | **<100 ms** |
| **Perceived "it's done" (TTS starts)** | **~1.0–1.5 s** |
| **Music actually changes (SYB-bound)** | **1.5–3.5 s** |

> **Honest framing (per the critiques):** perceived latency of ~1.3–1.5 s is real, but **the music's actual reaction is SYB-cloud-bound at 0.5–2 s+.** The chime + speaking the confirmation *before* SYB confirms hide this for ambience changes. **Tight musical cueing (e.g. drop on a beat) is out of scope** — SYB latency makes it impossible.

### 2.8 Monthly cost per venue (~1,800 commands/month)

| Component | Monthly |
|---|---|
| STT (Deepgram Nova-3) | ~$1.40 |
| Agent (Haiku 4.5, 90% cached) | ~$3.30 |
| TTS (Aura-2) | ~$3.30 |
| **Cloud AI total** | **~$8/month/venue** |

Marginal cloud AI is **~$8–12/venue/month** — trivial against a hardware sale + SaaS fee. Hardware is one-time. Local fallback (`faster-whisper`, Piper) costs $0.

### 2.9 The MVP — exact first build

This needs **zero new hardware to start** — begin on a laptop with the ReSpeaker (or even the built-in mic) while the Pi ships.

1. **Capture + STT:** ReSpeaker (or laptop mic) → Deepgram Nova-3 → transcript on PTT-release (spacebar in the demo).
2. **Agent endpoint on Render:** `POST /copilot/command` takes `{transcript, accountId}`, calls Haiku 4.5 with the tool schema (§2.3), runs the standard tool-use loop, returns the chosen tool call(s).
3. **Wire 5 tools first:** `set_volume`, `nudge_volume`, `now_playing`, `set_energy`, `play_special_track` → existing SYB GraphQL. (`setVolume` already works.)
4. **Inject live state** from existing device/zone/mic data so relative + vibe commands resolve.
5. **Confirm:** chime on press, then speak the agent's confirmation via Aura-2.
6. **Test the 10 highest-value utterances:** 1, 9, 15, 16, 25, 36, 39, 42 — including the §2.6 "busier → more energy" loop.
7. **Then** migrate PTT to the ESP32 AMOLED tap and add the offline `faster-whisper` fallback.

**Critical SYB gotchas (from CLAUDE.md, baked into the tool layer):**
- `setVolume` uses a custom `Volume` scalar — **inline the integer in the query string, never a GraphQL variable.**
- "Not found" = the zone is **offline**, not a permissions error. Keep a known-online zone for demos.
- Test on **BMAsia Unlimited DEMO** (`QWNjb3VudCwsMThjdHE4b2t4czAv`).
- Connection fields require `first: N` / `last: N` pagination.

---

## 3. Vision & Sensing on Raspberry Pi

Everything below is buildable on Pi-class hardware **today**. The CV layer runs 100% on-device (no video leaves the box; only tiny JSON metrics go to the cloud → zero per-frame cloud cost and a clean customer-perception story). **The honest hierarchy of trust: passive person-count/heatmap/dwell is rock-solid; gesture and door-only face recognition are real but constrained; emotion and demographics are weak, aggregate, advisory-only signals that must never gate an automated music change alone.**

### 3.1 The hardware tiers

| Tier | Parts | Cost | Runs | When |
|---|---|---|---|---|
| **A — Workhorse** | Pi 5 8GB + **AI HAT+ 13 TOPS (Hailo-8L, $70)** + Camera Module 3 Wide NoIR ($35) + ReSpeaker ($50) | **~$270** | Detection + tracking + heatmaps + **light** pose/face — but **one model class at a time at full FPS** | 90% of venues |
| **B — Brains** | Pi 5 + **AI HAT+ 26 TOPS (Hailo-8, $110)** + same camera + mic | **~$310** | Concurrent detector + tracker + door-face recognition without crippling time-slicing | VIP recognition + headroom |
| **C — Heavy** | **Jetson Orin Nano Super ($249, 67 TOPS)** + cameras | **~$400+** | 3–6 streams, demographics + emotion + pose at once, on-device VLM | Large/multi-zone venues |

> **Throughput reality (the #1 thing the critiques flagged).** Single-model marketing FPS is misleading. The Hailo-8L (13 TOPS) runs YOLOv8n person-detect at ~60 FPS *alone* — but **when you stack detection + pose + face-detect + ArcFace + demographics, a 13-TOPS part time-slices and aggregate FPS collapses.** For occupancy you only need 8–15 FPS, so Tier A is perfect for **counting/heatmap/dwell**. The moment you want **face recognition concurrent with room detection**, step to the **26-TOPS Hailo-8 (Tier B)** or Jetson. Inconsistent FPS numbers in the wild (60/136/430 for "the same model") are the 8L vs the 26-TOPS 8 vs batched — budget conservatively.

**Camera:** **Camera Module 3 Wide NoIR ($35, IMX708, 120° FoV, back-illuminated, HDR)** is the default — NoIR + back-illuminated is what makes a *dim bar* workable (add a cheap 850 nm IR illuminator for near-darkness). **Global Shutter Camera ($50)** only on a dancefloor where you want motion-energy without smear. **Mount high, angled down ~30–45°** — the single biggest accuracy lever; it minimizes the occlusion that destroys head-count in a packed room.

**Software stack (one stack for all of it):** HailoRT + `hailo-all` apt package + `hailo-rpi5-examples` (GStreamer pipelines: detection/pose/seg), built on TAPPAS Core. ByteTrack/`supervision` for tracking on CPU. DeGirum PySDK for multi-model orchestration if needed. Mature, documented, and what every retail-analytics Pi project ships on.

### 3.2 Spatial intelligence — heatmaps, counting, dwell, queues, density

**The lowest-risk, highest-credibility first vision bet.** No faces, no controversy, immediately useful, the natural evolution of the existing auto-volume device.

- **Detector:** YOLOv8n/YOLO11n, person class only, compiled to `.hef`. Downsample to 8–15 FPS; spend the rest elsewhere.
- **Tracker:** **ByteTrack** on CPU (no NPU load, no appearance model — best in crowded scenes because it recovers low-confidence boxes). DeepSORT only when you need appearance re-ID across occlusion.
- **Heatmap:** accumulate tracked foot-positions (bottom-center, homography-projected to a floor plan) into a time-decayed 2D histogram — pure numpy.

**What you get & accuracy reality:**
- **People counting / occupancy:** ±5–10% at moderate density with a good overhead angle; degrades wall-to-wall (heads merge). Mitigation: count *heads*, fuse with entrance tripwires for a robust cumulative count.
- **Dwell time:** per-track lifetime → "how long do people linger at the bar vs leave fast."
- **Queue length:** polygon at the bar/register; count tracks inside + dwell → live queue depth.
- **Table/seat occupancy:** seat polygons; person-box overlapping a seat >N s = occupied → "table just turned over."
- **Crowd density & movement energy:** density = people/cell; **energy** = mean optical-flow magnitude (Farnebäck, CPU) or mean centroid velocity per region.

**→ Automations:**
- **Hot zone on the heatmap** (crowd shifting to the patio) → `setVolume` up on the patio, optional `assignSource` to higher energy. *The room follows the crowd.*
- **Bar queue > threshold** → energy/volume up at the bar + a **staff Telegram alert** ("bar queue building, 6 waiting"). The alert is the stronger value.
- **Venue filling up** → gradual energy ramp across the evening, correlated to headcount instead of a fixed schedule. **The killer demo: music gets busier as the room does, with zero staff input.**
- **Venue emptying late** → wind-down: lower volume, `assignSource` to a chill closing playlist.

Runs on **Tier A**.

### 3.3 Face — detection, recognition, demographics, mood

**Detection (everywhere):** **SCRFD** (`scrfd_10g`) or RetinaFace — Hailo `.hef` builds exist; SCRFD is the faster modern default. Face *detection* (count faces, find gaze direction) needs no gallery and no controversy.

**Recognition / gallery match (the VIP feature):** SCRFD → align → **ArcFace/MobileFaceNet** → **512-d embedding** → cosine-match against a local enrolled gallery (embeddings only, ~2 KB each; thousands of identities is nothing). Seeed ships a working Hailo `face-recognition-api`; InsightFace is the reference.

> **Honest verdict (both critiques agree):** recognition is **door-only, high-precision/low-recall.** Frontal, well-lit faces near the entrance → strong matches. Side-profile, motion-blurred, backlit, sub-50 px faces mid-crowd → many misses, **by physics.** Design for *confident matches only*. Put recognition at the **entrance** (frontal faces, controllable light, people pause), never the dancefloor. Recognition + a room detector concurrently → **Tier B** (26 TOPS). **Ship it as a discreet staff Telegram nudge ("possible regular at the door — human confirms"), NOT as an automated room-wide music change** — one misfire greeting the wrong person is worse than silence.

**Demographics:** **FairFace** (~97% gender, ~73% age-bucket; balanced across demographics — matters for SE-Asian venues). **Mood/expression:** lightweight FER CNN on aligned crops.

> **Honest verdict:** single-frame emotion from a small dim face is **noisy and weak.** Treat mood only as an **aggregate room signal** (% smiling over a minute) and **never close the loop on it autonomously.** Demographics in a packed dim venue at real angles is **low-confidence**; biasing music on it is a brand-risk feature with shallow operator want. **Both are advisory dashboard signals at most. The trustworthy "mood" proxy is motion-energy (§3.4), not faces.**

**→ Automations (with the honesty caveats above):**
- **VIP/regular recognized at the door** → **staff Telegram nudge** (human-in-the-loop); *optionally* (flagship venues, opt-in) `queueTracks` a known favorite or `assignSource` their vibe.
- **Staff recognized** → suppress from customer counts; gate gesture/voice control to known staff.
- **Aggregate mood / demographic skew** → **dashboard line only** for now; if ever actuated, tiny damped advisory bias behind the autopilot, A/B'd against managers for weeks.

### 3.4 Pose & gesture — gesture control + dancefloor energy

- **YOLOv8-pose / YOLO11-pose** on Hailo: ~27–30 FPS multi-person 17-keypoint skeletons (vs ~0.5 FPS CPU — NPU mandatory). **MediaPipe Hands** (CPU) for a deliberate single-operator gesture at a staff station.
- **Gesture control:** small **staff gesture zone** behind the bar; palm-up = volume up, swipe = skip, fist = pause. **Gate to recognized staff faces** so customers can't hijack it. A no-voice fallback when the room is too loud for the mic.
- **Dancefloor energy:** aggregate pose **keypoint velocity** across all skeletons → a single **"movement energy" scalar.** No identity tracking needed. Optical flow is a cheaper proxy.

> **Honest verdict:** gesture is a **demo party trick** that usually loses to a button or a voice command; ship at most a tiny 3-gesture fallback, gated to staff, in a lit zone, with a wake-gesture + confirm to avoid incidental false-fires. **Movement energy, by contrast, is a genuinely trustworthy signal** — it's the real "is the floor alive" sense, unlike facial affect.

**→ Automations:**
- **Floor filling + movement energy rising** → ramp `setVolume`/`assignSource` to peak source. **Energy collapsing** → ease off or re-energize. The closed loop a DJ does by feel.
- **Staff gesture** → immediate volume/skip/pause without a phone.
- **Sudden chaotic high-energy pattern** (fall/surge — documented Pi+Hailo builds) → **staff alert** (assistive only, never autonomous; tune for precision, require multi-sensor agreement).

### 3.5 The Tier-B reference node (concrete pipeline)

```
Pi 5 + AI HAT+ 26 TOPS (Hailo-8) ─ Camera Module 3 Wide NoIR ─ libcamera ─ GStreamer (TAPPAS)
  ┌─ ENTRANCE branch ───────────────┐   ┌─ ROOM/FLOOR branch ──────────────────────────┐
  │ SCRFD → ArcFace(512d)            │   │ YOLO11n person → ByteTrack (CPU)             │
  │  → cosine match vs local gallery │   │   ├─ foot-point homography → heatmap (numpy) │
  │  → FairFace age/gender           │   │   ├─ zone polygons → queue/seat/occupancy    │
  │  (high-precision, low-recall)    │   │   └─ optical-flow / YOLO-pose → movement      │
  └──────────┬───────────────────────┘   └──────────────────┬───────────────────────────┘
   events: {vip_arrival, demo_mix}        metrics(1Hz): {occupancy, density, dwell, queue, energy, mood%}
             └───────────────┬─────────────────────────────┘
   ReSpeaker XVF3800 (AEC/beamforming/DoA) → VAD/PTT → STT
                             ▼
   INTENT/POLICY: cloud Deepgram Nova-3 + Claude Haiku 4.5 tool-calling; offline on-HAT 1.5B LLM fallback
                             ▼
   WebSocket → existing Render backend → SYB GraphQL (setVolume · assignSource · queueTracks · play/pause)
                                                       (+ future: Hue/WLED · signage · Telegram)
```

**Why this split:** CV runs 100% on-device (privacy-clean *and* zero per-frame cloud cost — only tiny JSON metrics leave). Voice STT/LLM go to cloud for quality, with a local LLM for resilience. Everything terminates at the **existing Render backend + SYB actuators** — the node is purely an *event source* feeding the control plane we already built.

### 3.6 Recommended vision build order

1. **Week 1–2 (Tier A):** YOLO11n + ByteTrack → **heatmap + occupancy + dwell**; wire occupancy → `setVolume` ramp. Sellable analytics + proves the camera→SYB loop. No faces.
2. **Week 3–4:** YOLO-pose → movement-energy → dancefloor ramp; MediaPipe gesture zone → staff control.
3. **Week 5–6 (upgrade to Tier B):** SCRFD + ArcFace **door** recognition + Telegram VIP nudge; FairFace demographics + aggregate mood as **advisory dashboard** soft inputs.
4. **If you saturate the Hailo / go multi-cam:** Jetson Orin Nano Super.

---

## 4. The Multimodal Automation Brain

A multimodal agent that runs ambience **autonomously by default** and obeys **staff voice on demand** — both feeding one world model and acting through one tool layer. Voice isn't a separate codepath; it's a high-priority event injected into the same brain.

### 4.1 The core loop: Perception → World-State → Decision → Action

A continuously-running control loop (the autonomous "heartbeat") with an **interrupt line** (staff voice) that can preempt or steer it.

```
            ┌────────── PER-VENUE WORLD MODEL (Redis hot + Postgres journal) ──────────┐
            │ occupancy_band, headcount, heatmap, room_energy_dbfs, energy_trend,        │
            │ now_playing{source,bpm,energy}, current_volume, daypart, regulars_present,  │
            │ recent_commands, policy, last_action, cooldowns, leases, learned_deltas     │
            └──────▲────────────────────────────────────────────────────────▲────────────┘
   writes every 2–5s │                                                       │ writes
   ┌─────────────────┴───────┐                              ┌────────────────┴──────────────┐
   │ PERCEPTION (edge)        │   compact JSON state, 1/s    │ DECISION (cloud)               │
   │ • audio: dBFS, band-energy│ ───────────────────────────▶│ A. Autonomous tick (20–60s or  │
   │ • vision: count, heat, dwell│                           │    on threshold breach): cheap │
   │ • faces → opaque regular_id│ ◀─── tool results, TTS ──── │    rules engine; LLM only on   │
   │ • voice: PTT/wake → STT    │                            │    ambiguity                   │
   └────────────────┬──────────┘                             │ B. Voice turn: LLM + tools     │
                    │                                         └────────────────┬───────────────┘
                    └──────── ACTION (Render backend) ────────────────────────┘
                         setVolume · assignSource · queueTracks · play/pause (+ future tools)
```

**Two cadences, one brain, one world model:**
- **(A) Autonomous tick — cheap, deterministic-first.** A lightweight rules engine runs every 20–60 s (or fires on a threshold breach). **95% of ticks resolve with no LLM call** — it's the existing EMA/hysteresis volume logic generalized to more inputs. The LLM is invoked *only* on an ambiguous escalation. Keeps cost near-zero per venue-hour.
- **(B) Voice turn — LLM always.** PTT/wake → STT → the LLM gets the current world-state snapshot + policy + tool schemas, reasons, emits tool-calls. The world-state is what lets it **confirm or correct** the human (the §2.6 fusion).

### 4.2 The per-venue world model (the memory)

A single JSON document per venue, hot in Redis, journaled to Postgres. Two tiers:
- **Working memory (Redis, ~5 s refresh):** the live snapshot — every perception write updates it, every decision reads it.
- **Episodic/long-term (Postgres + small vector store):** every action with its world-state context and outcome; the face-embedding → `regular_id` table; learned per-venue preference deltas. This powers explainability, the dashboard timeline, and learning.

**Regulars without a cloud face lookup:** the Pi computes embeddings locally, matches against the venue's *own* enrolled set, and only ever emits an opaque `regular_id` + label upward. The cloud brain never sees a face — just "VIP r_2231 is here."

### 4.3 The LLM agent: reasoning over state + policy via tool-calls

**Claude Haiku 4.5** for voice turns and rare autonomous escalations — fast, cheap, **zero tool-calling failures + best-in-class BFCL** in 2025 head-to-heads (tool reliability matters more than raw smarts because the actions are real). Sonnet for hard multi-step.

Every invocation gets: (1) a system prompt encoding the **venue policy** + the agent's role, (2) the current world-state JSON, (3) the tool schemas. It returns either `noop` (with a one-line logged reason) or one-to-N tool-calls.

**The tool layer is the only thing that talks GraphQL** — the LLM only sees clean named tools. That boundary is also where guardrails live, so a hallucinated `volume: 25` gets clamped before it reaches SYB. The `setVolume` custom-scalar inlining (CLAUDE.md gotcha) is handled there too.

### 4.4 Blending autonomous action with voice overrides + learning

A simple arbitration state machine (not magic):
1. **Manager voice = highest priority; sets *intent*, not just a one-shot.** "Turn the patio down" executes *and* writes a short-lived **intent lease** `{intent:"patio_quieter", ttl:90min, by:mgr}`. The autonomous loop reads active leases and won't fight them — it won't crank the patio back up 4 minutes later. Leases expire gracefully.
2. **Hard manual override.** "Stop touching the music for an hour" → `autonomy:paused until=...`. The loop goes read-only (still perceives, still answers questions, takes no actions) until expiry.
3. **Autonomous baseline** runs whenever no lease/override contradicts it.

**Learning (cheap, transparent, no model training):** every override is a labeled signal in plain data. When a manager repeatedly nudges *up* from the autonomous choice at `dinner_peak`, bump a stored per-daypart preference delta (`learned.dinner_peak.target_energy += ε`). Bandit-style adjustment of the *targets the rules engine aims for* — fully inspectable, instantly reversible, per-venue. After ~2 weeks the baseline converges to "what the manager keeps asking for," and overrides drop off.

> **Honest note:** anchor learning on the **override signal** (managers correcting the autopilot), *not* on face-recurrence — same payoff, none of the recognition baggage, and benefit appears in days not weeks.

### 4.5 Explainability — free by construction

**Every action carries a `reason` arg the LLM must fill; every world-state write is timestamped.** So you can always render a causal sentence from the data that existed at decision time:

> "20:14 — Nudged main volume 9→11 because headcount rose 30→48 (band: busy) and room energy fell to −52 dBFS over 6 min; music was only ~40% audible over the crowd. Cooldown 44 s."

Three surfaces: **voice readback** (the manager hears the *why*), **dashboard "Activity" timeline** (debugging tool *and* sales demo), **Telegram digest** (end-of-shift summary). This is the **trust-builder that converts skeptics** — an owner won't hand over their music to an autopilot they can't interrogate.

### 4.6 Where each piece runs

- **Tier 1 — ESP32-S3 satellites (own):** cheap per-zone acoustic sensors (dBFS + band-energy over the existing WS) + PTT puck. *Not* the far-field voice interface. The distributed "ears."
- **Tier 2 — Raspberry Pi 5 hub (one per venue):** vision, far-field voice capture, local face-matching, STT-or-relay, and the **local fail-safe** — if the WAN drops, the Pi keeps the autonomous rules loop running on the last-known policy and queues voice intents. *Music never goes silent because Render hiccuped.*
- **Tier 3 — Cloud brain (existing Render service, extended):** add **Redis** (working memory) alongside **Postgres** (episodic/learned); the agent runtime (tick scheduler, voice-turn handler, tool-call orchestrator, SYB tool implementations); Claude Haiku 4.5 via API. All on the existing service `srv-d6bim8d6ubrc73cl2890` (scope rule).

### 4.7 Fleet management across hundreds of venues

This is where it becomes a *product*, not a demo:
- **One control plane, N edge nodes.** Each Pi + its ESP32 satellites = one venue node, identified like the existing `esp32-<mac>` scheme. **Reuse the existing per-account auth + provisioning** — the Pi enrolls exactly like an ESP32, scoped to a SYB account.
- **Policy as data, pushed down.** Venue policy + learned deltas live in Postgres, versioned, pushed to each Pi (cached for offline autonomy). Changing "dinner runs hot" is a DB write, not a redeploy.
- **OTA for the Pi fleet** mirrors the firmware OTA already being built (manifest + probation/auto-revert; canary on a spare node, staged rollout, auto-revert on crashloop; "pin a venue to a known-good version" carries straight over from the D'ARK pattern).
- **Telemetry + health:** each node heartbeats world-model summaries; one fleet dashboard shows occupancy/energy/actions. Extends the existing WS heartbeat + online-reconcile.
- **Cost at scale:** the cloud bill scales with *conversation*, not *time* — a busy venue does ~30–60 LLM calls/day at pennies. Hundreds of venues stay cheap.

### 4.8 Guardrails (in the tool layer, below the LLM — they hold even if the model misbehaves)

- **Hard-clamped bounds:** volume to per-venue `vol_bounds` (e.g. 4–13); source switches to a venue allow-list; no blocked sources; quiet-hours ceiling.
- **Cooldowns / rate limits:** the existing "max 1 setVolume / 2 s / zone" generalizes — `assignSource` gets a longer cooldown (5–10 min) so the agent can't whiplash the playlist.
- **Runaway-gain guard** (already built for volume) extended to "no more than X source-switches per hour."
- **Manager override is absolute** (§4.4). A `manager_pin_required` list can gate sensitive tools behind a PIN.
- **Confirm-before-disruptive** (§2.5).
- **Every action reversible + logged** with reason + snapshot.

---

## 5. Ranked Use-Case Catalog (by buildability)

Each entry carries a one-liner, the SYB actuator, the **wow/want** read, and a **verdict synthesizing both critiques** (embedded/ML buildability + operator desire). Tiers are by buildability; within each, ordered by combined value.

### TIER 1 — NOW, on the existing stack (ESP32 + Render + SYB; little/no new hardware)

| # | Use case | Actuator | Verdict (synthesis) |
|---|---|---|---|
| 1 | **Speak-to-the-Venue voice command bar** ⭐ FLAGSHIP | all SYB mutations | **SOLID, build first.** Actuator exists; STT+LLM tool-use mature; PTT kills wake-word-over-PA. Only feature that "whoas" in a demo *and* survives night 200. ~4–5 days of software. |
| 2 | **Instant moment-maker (birthday song now)** ⭐ | `queueTracks` (auto-restore) | **SOLID, highest wow-per-effort.** One intent → one mutation → auto-restore. Near-zero failure surface. The sentence that closes restaurants. Bundle with #1 as the demo one-two. Pre-cache the track ID; verify auto-restore is flawless. |
| 3 | **Busier-than-usual energy nudge** ("we're slammed, push it") | `set_energy` + lease | **SOLID.** Makes the agent feel like a manager, not a remote. Maps to how owners *talk*. Needs the stateful lease/world-model layer (§4) — build that first; conservative deltas + visible auto-revert. |
| 4 | **Conversation/speech-density sensing** (sit music just under chatter) | `setVolume` | **SOLID.** Acoustic-scene classification (chatter vs silence vs one loud blender) is a direct, in-domain upgrade to the dBFS algorithm already shipping. Audio-only → no camera baggage. Ship as a transparent upgrade, not a SKU. Needs AEC (run on the Pi/ReSpeaker). |
| 5 | **Voice Q&A about venue state** ("what's playing in the lounge?", "why is the patio loud?") | `nowPlaying` + logs (read) | **SOLID, trust-builder.** Read-only retrieval over own telemetry, answered in plain language. Cheap, low-risk, converts skeptics. Requires action+reason logging (§4.5). |
| 6 | **Multi-language voice** (Thai/Burmese/Khmer/English) | same as #1 | **SOLID, adoption unlock for SE-Asia.** If only the English manager can use voice, floor staff won't — and they're the heaviest users. Cloud multilingual STT/LLM handle it; confirm in the detected language. |
| 7 | **Voice-driven multi-action scenes** ("set up for the dinner crowd") | batched mutations | **SOLID (music-only).** Named intent → batched plan (source + per-zone volumes). Real daily time-saver. Ship music-only with templates (open/dinner/close); lights/signage later. |
| 8 | **Staff vs guest disambiguation** (pass-phrase or PTT-on-staff-device) | gates #1 | **PROMISING — necessary plumbing, not a headline.** Makes voice safe in public rooms. The simplest gate (PTT on a staff-held device) sidesteps vision entirely. Bundle invisibly; never a line item. |

### TIER 2 — NOW, on the Pi (vision/voice hub; ~$270–310 hardware)

| # | Use case | Actuator | Verdict (synthesis) |
|---|---|---|---|
| 9 | **Read-the-room autopilot (occupancy + dBFS fusion)** ⭐ | `setVolume` + `assignSource` | **SOLID, the retention engine.** Existing EMA/hysteresis + headcount; YOLOv8n at 8–15 FPS fits the 8L. Works unattended → justifies the subscription. Fuse with dBFS so a vision miss degrades gracefully. Default conservative; respect voice leases. |
| 10 | **Dwell-time & flow analytics dashboard** ⭐ | dashboard (no SYB) | **SOLID, the monetizable 2nd product line.** ByteTrack on CPU → counts/dwell/flow per zone. Most mature, lowest-risk CV deliverable, zero recurring cloud cost. Operators already pay 3rd parties for footfall — rides an existing budget; reframes the camera as BI. |
| 11 | **Occupancy heatmap → per-zone ambience** | per-zone `setVolume`/`assignSource` | **PROMISING.** "Music follows the crowd to the patio" is a great multi-zone demo. Homography/zone setup is the real cost. Single-zone venues get nothing. Sell heatmap as analytics first; per-zone auto-ambience as an opt-in toggle gated on dwell+density. |
| 12 | **Queue-rush detector → upbeat + staff alert** | `assignSource` + Telegram | **PROMISING.** The *staff-alert* half ("open a second till") is the real operational win; the energy bump is secondary. Tune on dwell-in-zone (not raw count) to avoid alert fatigue. Ship the alert half first. |
| 13 | **Daypart + predictive auto-scheduling (calendar + weather)** | scheduled `assignSource` | **PROMISING.** Standard lightweight time-series. Catch: needs weeks of data + a POS integration to beat a hand-set schedule. Ship deterministic schedules first; live sensing primary, prediction a hint; calendar/weather before POS. |
| 14 | **Gesture control (busy-hands fallback)** | `setVolume`/skip/pause | **RISKY — footnote feature.** Loses to a button or voice every time. Ship at most a 3-gesture, staff-gated, lit-zone, wake-gesture+confirm fallback for when the room is too loud for the mic. Never lead a demo with it. |
| 15 | **Offline-resilient on-device brain** | local STT/LLM + autopilot | **PROMISING — invisible insurance.** Guarantee the **deterministic autopilot fully local** first (music never depends on cloud); scope offline *voice* to a few intents. Real felt value in SE-Asia, but it's a reliability promise, not a headline. |
| 16 | **Regular-preference auto-tuning over time** | `setVolume`/`assignSource` | **PROMISING — patient value.** Bandit setpoint adjustment from **manager overrides** (not faces) is cheap, transparent, no training. Slow to materialize, hard to demo. Surface learned deltas on the dashboard (visible + reversible). |
| 17 | **Anomaly/incident sensing (glass-break, fall, surge)** | duck/pause + Telegram | **RISKY → assistive only.** A credible premium upsell for nightlife (touches liability), but false-positive cost is high. **Strictly assistive: duck + alert + snapshot, human always in the loop.** Tune for precision; require multi-sensor agreement. Start with a sustained loud-spike duck. |
| 18 | **VIP / regular recognition trigger** | Telegram nudge (+ opt. `queueTracks`) | **RISKY headline, PROMISING as a staff nudge.** The most seductive demo, the most fragile reality: door-only, low-recall, one misfire burns trust. **Ship as a discreet staff Telegram nudge — human confirms; the system never auto-acts on identity.** Opt-in enrollment, on-device embeddings, flagship venues only. Needs Tier B for concurrency. |

### TIER 3 — NEEDS MORE (compute or signal maturity)

| # | Use case | Verdict (synthesis) |
|---|---|---|
| 19 | **Cross-device orchestration (music + lighting + signage)** | **PROMISING, platform play.** Tool layer generalizes cleanly (WLED/Hue are easy first actuators). But gated on venues *having* the hardware (most don't yet), and DMX/signage are real installs. Start with WLED on a spare ESP32, then Hue; each actuator an independent guarded tool. The expansion path that makes the subscription stickier, not the entry feature. |
| 20 | **Demographic-aware ambience** | **RISKY → likely cut.** Actuator trivial; the *sense* collapses in dim crowds at real angles, and Jetson fixes compute not signal. Marginal lift over the behavior-based autopilot (which reacts to what the room *does*, which matters more than who's in it) + a real brand-risk on race optics. If pursued at all: coarse aggregate "crowd vibe," soft damped bias behind the autopilot, never per-person, never a headline. |

### TIER 4 — MOONSHOT (north-star narrative, not a single buildable artifact)

| # | Use case | Verdict (synthesis) |
|---|---|---|
| 21 | **Crowd mood / expression closed-loop** | **FANTASY as a driver.** Single-frame emotion from dim small backlit faces is barely above chance; aggregation reduces variance not bias; no validated smile-%→music-action map. The **trustworthy signal is motion-energy, not facial affect.** Surface as a passive, unactioned "room mood trend" dashboard line at most; never close the loop autonomously. |
| 22 | **Full venue digital twin + autonomous ambience agent** | **FANTASY as a product; the roadmap thesis.** Not one buildable thing — it's the *composition* of every use case, including the least reliable (mood, demographics), into an always-on planner. Compute is easy; **stacking weak biased senses to autonomously drive everything is the unsolved part, and one bad autonomous move across many devices is memorable for the wrong reasons.** Build incrementally over **only the trustworthy senses** (occupancy, dBFS, motion-energy, voice); keep mood/demographics out of the loop; earn it venue-by-venue after each loop logs months of trustworthy behavior. Use it to frame the vision and sequence the roadmap — never sell it day one. |

**Strategic read of the catalog (both critiques converge):** *Lead with voice (#1, #2, #3) → prove value with the autopilot (#9) → monetize with analytics (#10) → treat faces/mood/demographics (#18, #20, #21) as opt-in, advisory, human-in-the-loop theater for flagship accounts only. Over-indexing on the "magic" camera features is the single biggest strategic risk — they dazzle in a boardroom and get switched off in a venue.*

---

## 6. Hardware: The Smart Venue Hub

### 6.1 The "Smart Venue Hub" BOM (the recommended build)

**Pi 5 8GB + Hailo-8L AI HAT+ (13 TOPS) + Camera Module 3 Wide + ReSpeaker XVF3800.** Vision runs locally on the Hailo (counting/heatmap/pose, with huge headroom for one model class); voice is hybrid (local wake/VAD/TTS, cloud STT/LLM). The ESP32-S3 we already ship becomes a push-to-talk puck + per-zone dB satellite.

| Component | Part | Price (USD, Jun 2026) | Role |
|---|---|---|---|
| Compute | **Raspberry Pi 5, 8GB** | ~$80 | Hub brain |
| AI accelerator | **Raspberry Pi AI HAT+, 13 TOPS (Hailo-8L)** | $70 | All local vision inference |
| Camera | **Camera Module 3 Wide (120°, IMX708)** — NoIR for dim bars | $35 | Heatmaps, counting, pose, door-face |
| Far-field mic | **Seeed ReSpeaker XVF3800 USB 4-Mic Array** (AEC/beamforming/DoA) | ~$50 | Voice capture, 5 m, cancels the PA |
| Speaker | USB / 3.5 mm powered speaker | ~$15 | TTS confirmations, "birthday song" cue |
| Storage | 256 GB A2 microSD | ~$22 | OS + models + event clips |
| Cooling | Official Active Cooler | ~$5 | Hailo + camera run hot (non-negotiable) |
| Power | Official 27 W USB-C PD PSU | ~$12 | Pi 5 needs 5 A PD for full peripherals |
| Enclosure | Vented case w/ camera mount + HAT clearance | ~$20 | Wall/ceiling mount |
| **Hub subtotal** | | **~$309** | |

**Decisive hardware calls:**
- **Hailo, not Coral:** Coral is a dead-end (PyCoral pinned to Python 3.9 vs Pi OS 3.11+; model zoo frozen on EfficientDet/MobileNet — no clean YOLOv8/pose). Hailo is faster, first-party, mature toolchain.
- **8GB Pi, NOT 16GB:** a 2026 DRAM shortage pushed the **16GB to ~$305** (was ~$120). The Hailo holds the vision models and the LLM is in the cloud, so 16GB buys almost nothing for this workload. **Buy the 8GB at ~$80.**
- **ReSpeaker USB variant ($50), not the XIAO-ESP32S3 variant:** the on-board ESP32 is redundant since the Pi is the host. The **hardware AEC is the unlock** for voice-over-music.
- **Step to the 26-TOPS Hailo-8 ($110)** only when you need **concurrent** door-face recognition + room detection, or a 2nd camera stream.

### 6.2 The ESP32 as cheap satellite / voice puck

Two roles, building on the firmware + WebSocket stack we already own:
1. **Push-to-talk voice puck.** The Waveshare ESP32-S3-Touch-AMOLED already has a mic, touch AMOLED, and WiFi. A "hold-to-talk" mode → records, streams over the existing WebSocket to the backend, shows the transcribed command + "Done ✓". The **cheap, reliable voice entry point** at the bar/host stand — sidesteps far-field/wake-word entirely.
2. **Cheap satellite sensor.** Per-zone ambient dB (the auto-volume we ship today), optionally + an **HLK-LD2450 mmWave** ($10–15) for presence/occupancy where a camera is awkward or dark.

**Topology:** one Pi hub per venue (camera + far-field voice) + N ESP32 satellites (per-zone dB, presence, PTT), all feeding the Render backend that holds the SYB actuators.

### 6.3 The "order this week" starter kit

Everything to stand up the hub and kick off **both** voice and vision. Reuses the spare ESP32-S3 as the PTT puck ($0).

| Item | Price |
|---|---|
| Raspberry Pi 5, **8GB** | ~$80 |
| Raspberry Pi AI HAT+ **13 TOPS (Hailo-8L)** | $70 |
| Camera Module 3 **Wide** | $35 |
| ReSpeaker **XVF3800 USB 4-Mic Array** (get the with-case variant for the demo) | ~$50 |
| Small powered speaker (USB/3.5 mm) | ~$15 |
| 256 GB A2 microSD | ~$22 |
| Official Active Cooler | ~$5 |
| Official 27 W USB-C PSU | ~$12 |
| Camera-mount vented case | ~$20 |
| **Hardware total** | **≈ $309** |
| + Cloud (pay-as-you-go): Deepgram ~$0.0077/min; LLM pennies/command | ~$5–20/mo at dev volume |

> **Net new spend ≈ $310 + ~$10/mo cloud.** And note: **Track 1 (voice) needs $0 to start** — begin on a laptop with the ReSpeaker (or built-in mic) the day you order, while the Pi ships.

### 6.4 Optional add-ons (order later, with the fuller config)

| Add-on | Part | Price | Unlocks |
|---|---|---|---|
| mmWave radar | HLK-LD2450 24 GHz | ~$10–15 | Occupancy in the dark / where a camera is awkward; "filling up → raise energy" without a camera; clean "we don't film faces" public-area story |
| Lighting (easy) | Philips Hue Bridge + bulbs | ~$50 + bulbs | "Dim the patio," scene changes — venue-ready |
| Lighting (DIY) | WLED on a spare ESP32 + addressable LEDs | ~$10–40 | Fastest lighting experiment (HTTP/UDP; we already speak ESP32) |
| Offline-brain rig | Jetson Orin Nano Super (67 TOPS) | $249 | Standing experiment: fully-local Whisper + Llama-3.x-3B/VLM, A/B vs cloud-hybrid |

---

## 7. The Build-Now Experiment Roadmap

Two independent, demoable prototypes in ~2 weeks, then converge. **Track 1 (Voice Copilot) is the headline and the higher-value bet — prioritize it.** Track 2 (Vision Heatmap) runs in parallel on hardware ordered day 1, ready when Track 1 lands.

### ORDER FIRST (day 1)

- **Track 2 vision kit (~$300):** the starter kit in §6.3 (longest lead time — order immediately).
- **Track 1 voice kit (~$50):** the ReSpeaker XVF3800 (often in-stock; order same day). **Track 1 needs no new hardware to begin** — start on a laptop while everything ships.

### TRACK 1 — Voice Copilot MVP

**Demo target (end of week 1):** hold a USB mic, say *"we're getting busy, give the music more energy"* → 2–3 s later the zone's volume bumps and the source swaps to upbeat. Say *"birthday song now"* → a birthday track injects and auto-restores. Say *"turn the patio down"* → volume drops. Each action spoken back ("Done — patio's livelier now.").

**Stack:** TypeScript/Node (reuse the Render backend, Prisma, the SYB GraphQL client) · Deepgram Nova-3 streaming (`@deepgram/sdk`) · **PTT** (spacebar in the demo, ESP32 AMOLED tap later) · **Anthropic SDK tool-use loop with Claude Haiku 4.5** (prompt-cache the system prompt) · Deepgram Aura-2 TTS.

**Step-by-step:**
1. **(0.5 day)** Deepgram + `@deepgram/sdk`: capture ReSpeaker mic → stream to Nova-3 → log final transcripts on PTT. Confirm <1 s transcripts in a noisy room.
2. **(1 day)** New backend route `POST /copilot/command`. Wire `@anthropic-ai/sdk` tool-use loop with the §2.3 tools (stub executors that just log). Test with **typed text first** — no audio.
3. **(1 day)** Implement real executors against SYB on the **BMAsia Unlimited DEMO** account. Verify `set_volume`, `nudge_volume`, `now_playing` end-to-end. (Keep a known-online zone — "Not found" = offline.)
4. **(0.5 day)** `set_energy` + a mood→source map seeded from the demo account's playlists; `play_special_track` birthday track resolved + queued.
5. **(0.5 day)** Glue STT → route → spoken confirmation (chime on press + Aura-2).
6. **(0.5 day, optional)** ESP32 PTT puck: on-screen "Hold to talk" → WS `ptt_start/stop` → backend.

**Total: ~4–5 focused days to a live demo.**

**The system prompt (cache it):** the `set_energy` mapping rules, the zone list injected each turn, "act immediately, don't over-confirm, reply in one short spoken sentence," and the disambiguation rule (ask ONE short question only when genuinely ambiguous). Run the standard loop: send message + tools → if `stop_reason === "tool_use"`, execute each tool, append `tool_result` blocks, loop until a final text reply → speak it.

### TRACK 2 — Vision Heatmap MVP

**Demo target (end of week 2):** Pi 5 + camera watching a room (or a test video), a live web view showing a person-occupancy **heatmap** that accumulates where people stand, plus a single **room-energy number (0–1)** from headcount + movement. That number POSTs to the backend and **nudges music energy** (reusing Track 1's `set_energy`) — closing the loop: a busier room automatically gets livelier music.

**Stack:** Raspberry Pi OS Bookworm 64-bit · HailoRT + `hailo-all` + `hailo-rpi5-examples` · **YOLOv8s** `.hef` (person class, ~30 FPS on the 8L) · **ByteTrack** / `supervision` · NumPy + OpenCV heatmap · Flask/FastAPI serving an MJPEG `/stream` + JSON `/energy`.

**Room-energy signal (start simple):**
```
energy = w1·norm(headcount) + w2·norm(avg_speed) + w3·norm(spatial_spread)
# 30–60 s EMA smoothing (reuse the existing pattern), then map to a set_energy direction
# Reuse the EXACT hysteresis/rate-limit logic from the volume algorithm so it never oscillates.
```

**Step-by-step:**
1. **(0.5 day)** Flash Bookworm, attach AI HAT+ + Camera 3, `sudo apt install hailo-all`, reboot, `hailortcli fw-control identify` to confirm the Hailo is alive.
2. **(0.5 day)** Clone `hailo-rpi5-examples`, run `detection.py` on a USB-cam / test MP4 → confirm person boxes. (Real FPS is a bit under marketing — fine for occupancy.)
3. **(1 day)** Replace the example callback: filter `person`, feed boxes to `supervision` ByteTrack, get tracked centers.
4. **(1 day)** Heatmap accumulator (decaying grid) + JET overlay + MJPEG Flask endpoint — the visual money-shot.
5. **(0.5 day)** Compute `energy` (headcount + speed + spread, EMA-smoothed) → `/energy` JSON.
6. **(0.5 day)** Loop POSTs `/energy` to backend → maps to `set_energy` with the hysteresis. Watch music auto-respond to people walking in/out.

**Total: ~4 focused days** (on hardware that arrives during week 1).

### Milestones (calendar)

- **Day 1:** Place both orders. Start Track 1 on laptop + ReSpeaker.
- **End wk 1:** Track 1 voice demo working on the DEMO account (volume + energy + birthday). Pi arrived.
- **Mid wk 2:** Track 2 detection + heatmap rendering live.
- **End wk 2:** Track 2 energy signal nudging music. Both demos recorded.
- **Wk 3:** Convergence.

### Convergence → the multimodal copilot

The convergence point is the backend `/copilot` brain, which already owns the SYB tools. Both tracks become *inputs* to one agent:
1. **Vision becomes a tool/context for the voice agent.** Add a `read_room_state` tool returning `{zone, headcount, energy, heatmap_summary}`. Now *"how busy is the patio?"* is answerable from the camera, and *"match the music to the crowd"* reads room-energy and acts. Vision is just another sense the agent can query.
2. **Autonomous + voice override.** Track 2's energy loop runs continuously (autopilot); Track 1 lets staff override in natural language ("ignore the camera, keep it chill — it's a wake"). Explicit human command wins and pins for a TTL (the lease, §4.4).
3. **Shared zone/identity model.** Both need the same `zone → SYB soundZone id` map (and later camera zone polygons). Unify in Postgres now so face events ("a VIP walked into the lounge") can later trigger the same actuators.
4. **One device story.** The Pi 5 is the venue hub (vision + far-field voice); the ESP32-S3 is the cheap satellite (dB/PTT/status) in rooms that don't need a camera.

> Net: **build the actuator/tool layer once (Track 1), feed it more senses over time (Track 2 → faces → lighting/signage).** The voice copilot is the product surface; the vision/sensor stack are senses plugged into the same agent.

---

## 8. Open Questions & Decisions for the Founder

**Strategic**
1. **Pricing model.** Hardware sale + recurring SaaS? Is the autopilot the subscription anchor and analytics a paid add-on, or is voice itself the premium tier? (Both critiques say the autopilot is the retention engine and analytics rides an existing budget line.)
2. **Lead feature for go-to-market.** Voice copilot as the wedge (highest wow + daily use) vs the autopilot as the durable value vs analytics as the easiest B2B sale. Recommendation: **demo with voice + birthday, sell on the autopilot, upsell analytics.**
3. **Which venues first?** Multi-zone venues (rooftops, restaurants with bar+dining+patio) get the most from per-zone heatmap automation; single-zone venues get voice + autopilot but not #11. Pick the beta cohort accordingly.
4. **How far to lean into camera features.** The biggest strategic risk is over-indexing on magic camera features that demo beautifully and die in a dim packed bar. Decision: **faces/mood/demographics as opt-in, advisory, human-in-the-loop only — never default-on, never autonomous.**

**Product / scope**
5. **Confirm-vs-autonomous default.** Ship autonomous-by-default with undo, or confirm-first until trust is earned? (Recommend autonomous + always-undoable, with a per-venue risk threshold.)
6. **Where does the VIP-recognition value land?** As a discreet staff Telegram nudge only (recommended), or ever as an automated room change for flagship accounts?
7. **Energy ladder ownership.** Who tags each SYB source with an energy score (0–1) + BPM per account — us at onboarding, or a self-serve dashboard the manager fills? This is the deterministic backbone of every "more energy" command.
8. **Multi-language priority.** Which languages for v1 (Thai + English minimum for the SE-Asia market)?

**Technical**
9. **Speech-to-speech vs the pipeline.** Ship Deepgram→Haiku→TTS first (recommended — tool-call reliability + cost), then A/B a Gemini-Live or gpt-realtime speech-to-speech path once the actuator layer is rock-solid?
10. **Redis on Render now or later?** The world model (§4.2) wants a hot store. Add Redis to the existing service early, or start with Postgres-only and add Redis when the autonomous tick goes live?
11. **Pi fleet provisioning.** Reuse the `esp32-<mac>` enrollment + per-account auth verbatim, or design a distinct Pi-node identity? (Recommend reuse.)
12. **OTA for Pi nodes.** Mirror the firmware OTA (manifest + probation/auto-revert) for the Pi fleet from day one, or defer until >1 venue is live?

**Buy**
13. **Order the §6.3 starter kit this week (~$310)?** And **add a Jetson Orin Nano Super ($249)** as the standing offline-brain experiment, or defer until the cloud-hybrid path proves the product?

---

*Build the actuator layer once. Feed it more senses over time. Lead with possibility; ship what's buildable now.*
