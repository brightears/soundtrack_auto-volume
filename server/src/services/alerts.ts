import * as Sentry from "@sentry/node";
import { prisma } from "../db";

// Operational alerts via Telegram — DORMANT until BOTH TELEGRAM_BOT_TOKEN and
// TELEGRAM_CHAT_ID are set, so this is safe to ship with no effect until you
// create a bot (@BotFather), add it to a chat, and set the two env vars.
//
// Alerts (each fires once per episode, with a recovery message):
//   - device offline for >= 5 min          🔴 / 🟢
//   - device unplugged, running on battery 🔋 / 🔌
//   - abnormal reboot (crash/watchdog/brownout) ⚠️  (from the register message)
//
// Episode state is in-memory (single-instance server). The first monitor tick
// after boot only SEEDS state from the DB and never sends, so a deploy while a
// device is already offline does not re-alert.

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const CHAT_ID = process.env.TELEGRAM_CHAT_ID || "";

const TICK_MS = 60 * 1000;
const OFFLINE_AFTER_MS = 5 * 60 * 1000;
const ABNORMAL_RESET_REASONS = new Set(["PANIC", "INT_WDT", "TASK_WDT", "WDT", "BROWNOUT"]);

interface DeviceAlertState {
  offlineAlerted: boolean;
  offlineSince: number | null; // ms epoch of lastSeen when the offline episode began
  batteryAlerted: boolean;
}

const state = new Map<string, DeviceAlertState>();
let seeded = false;
let ticking = false;

function isConfigured(): boolean {
  return BOT_TOKEN.length > 0 && CHAT_ID.length > 0;
}

// Never throws. Returns false when not configured or on any failure.
async function sendTelegram(text: string): Promise<boolean> {
  if (!isConfigured()) return false;
  try {
    const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: CHAT_ID, text, disable_web_page_preview: true }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Telegram sendMessage failed: HTTP ${res.status} ${body}`);
    }
    return true;
  } catch (err) {
    console.error("Telegram alert error:", err);
    Sentry.captureException(err);
    return false;
  }
}

function fmtDuration(ms: number): string {
  const min = Math.max(1, Math.round(ms / 60000));
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h < 24) return `${h}h ${m}m`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}

async function tick(): Promise<void> {
  if (ticking) return; // never overlap ticks (slow DB) — would double-alert
  ticking = true;
  try {
    const devices = await prisma.device.findMany({
      select: { deviceId: true, name: true, isOnline: true, lastSeen: true, onUsb: true },
    });
    const now = Date.now();
    const quiet = !seeded; // first run: seed state, send nothing

    const seen = new Set<string>();
    for (const d of devices) {
      seen.add(d.deviceId);
      const label = d.name || d.deviceId;
      const s: DeviceAlertState = state.get(d.deviceId) ?? {
        offlineAlerted: false,
        offlineSince: null,
        batteryAlerted: false,
      };

      // (a) OFFLINE — only once lastSeen is at least 5 min stale
      const lastSeenMs = d.lastSeen ? d.lastSeen.getTime() : null;
      const offline = !d.isOnline && lastSeenMs !== null && now - lastSeenMs >= OFFLINE_AFTER_MS;
      if (offline && !s.offlineAlerted) {
        s.offlineAlerted = true;
        s.offlineSince = lastSeenMs;
        if (!quiet) {
          await sendTelegram(`🔴 ${label} is OFFLINE — last seen ${Math.round((now - lastSeenMs!) / 60000)} min ago`);
        }
      } else if (d.isOnline && s.offlineAlerted) {
        const duration = s.offlineSince !== null ? fmtDuration(now - s.offlineSince) : "unknown";
        s.offlineAlerted = false;
        s.offlineSince = null;
        if (!quiet) await sendTelegram(`🟢 ${label} back online (was offline ~${duration})`);
      }

      // (b) POWER — onUsb false = unplugged; null = unknown (PMU not readable), ignored
      if (d.onUsb === false && !s.batteryAlerted) {
        s.batteryAlerted = true;
        if (!quiet) await sendTelegram(`🔋 ${label} is running on BATTERY — please plug it in`);
      } else if (d.onUsb === true && s.batteryAlerted) {
        s.batteryAlerted = false;
        if (!quiet) await sendTelegram(`🔌 ${label} back on mains power`);
      }

      state.set(d.deviceId, s);
    }

    // Forget devices that were deleted from the DB
    for (const id of state.keys()) {
      if (!seen.has(id)) state.delete(id);
    }

    seeded = true;
  } finally {
    ticking = false;
  }
}

function startAlertMonitor(): void {
  if (!isConfigured()) {
    console.log("Alerts: disabled (set TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID)");
    return;
  }
  console.log("Alerts: Telegram ENABLED");

  const run = () =>
    tick().catch((err) => {
      console.error("Alert monitor error:", err);
      Sentry.captureException(err);
    });
  run(); // seed immediately
  setInterval(run, TICK_MS).unref();
}

// Called on every WS register. Fire-and-forget so registration is never delayed
// by Telegram latency. Only crash/watchdog/brownout reasons alert; POWERON, SW
// (incl. our own reboot/OTA commands) and DEEPSLEEP are normal.
function onDeviceRegistered(info: {
  deviceId: string;
  name?: string | null;
  firmware?: string | null;
  resetReason?: string;
}): void {
  if (!info.resetReason || !ABNORMAL_RESET_REASONS.has(info.resetReason)) return;
  const label = info.name || info.deviceId;
  void sendTelegram(`⚠️ ${label} rebooted unexpectedly (${info.resetReason}) — fw ${info.firmware || "unknown"}`);
}

export const alerts = { sendTelegram, startAlertMonitor, onDeviceRegistered, isConfigured };
