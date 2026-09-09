import { Router } from "express";
import { requireAdmin } from "../auth";
import { alerts } from "../services/alerts";

export const alertRoutes = Router();

// Send a test message to verify the Telegram wiring — ADMIN ONLY.
// { configured: false } means the env vars are missing; { sent: false } with
// configured: true means Telegram rejected the call (check server logs).
alertRoutes.post("/test", requireAdmin, async (_req, res) => {
  const configured = alerts.isConfigured();
  const sent = configured ? await alerts.sendTelegram("✅ Auto-Volume alerts are working") : false;
  res.json({ configured, sent });
});
