import { Router, Request } from "express";
import { SoundtrackService } from "../services/soundtrack";
import { requireAdmin, requireAuth, canAccessAccount } from "../auth";

export const soundtrackRoutes = Router();
const soundtrack = new SoundtrackService();

// Search accounts by name — ADMIN ONLY (enumerates the 900+ master-token accounts)
soundtrackRoutes.get("/accounts", requireAdmin, async (req, res) => {
  try {
    const query = req.query.q as string;
    if (!query) return res.status(400).json({ error: "Query parameter 'q' required" });

    const accounts = await soundtrack.searchAccounts(query);
    // Map businessName -> name for frontend consistency
    res.json(accounts.map((a: any) => ({ id: a.id, name: a.businessName, businessType: a.businessType })));
  } catch (err) {
    console.error("Failed to search accounts:", err);
    res.status(500).json({ error: "Failed to search Soundtrack accounts" });
  }
});

// List zones for an account — customers may only list their own account's zones
soundtrackRoutes.get("/accounts/:accountId/zones", requireAuth, async (req: Request<{ accountId: string }>, res) => {
  if (!canAccessAccount(req, req.params.accountId)) {
    return res.status(403).json({ error: "Forbidden" });
  }
  try {
    const zones = await soundtrack.getZones(req.params.accountId);
    res.json(zones);
  } catch (err) {
    console.error("Failed to fetch zones:", err);
    res.status(500).json({ error: "Failed to fetch zones" });
  }
});

// Set volume for a zone (manual override, for testing) — ADMIN ONLY
soundtrackRoutes.post("/zones/:zoneId/volume", requireAdmin, async (req: Request<{ zoneId: string }>, res) => {
  try {
    const { volume } = req.body;
    if (volume === undefined || volume < 0 || volume > 16) {
      return res.status(400).json({ error: "Volume must be 0-16" });
    }
    const result = await soundtrack.setVolume(req.params.zoneId, volume);
    res.json(result);
  } catch (err) {
    console.error("Failed to set volume:", err);
    res.status(500).json({ error: "Failed to set volume" });
  }
});
