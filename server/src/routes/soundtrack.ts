import { Router } from "express";
import { SoundtrackService } from "../services/soundtrack";

export const soundtrackRoutes = Router();
const soundtrack = new SoundtrackService();

// Search accounts by name
soundtrackRoutes.get("/accounts", async (req, res) => {
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

// List zones for an account
soundtrackRoutes.get("/accounts/:accountId/zones", async (req, res) => {
  try {
    const zones = await soundtrack.getZones(req.params.accountId);
    res.json(zones);
  } catch (err) {
    console.error("Failed to fetch zones:", err);
    res.status(500).json({ error: "Failed to fetch zones" });
  }
});

// Set volume for a zone (manual override, for testing)
soundtrackRoutes.post("/zones/:zoneId/volume", async (req, res) => {
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
