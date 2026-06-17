import { Router, Request } from "express";
import { prisma } from "../db";
import { deviceManager } from "../websocket/handler";
import { requireAuth, requireAdmin, scopedAccountId } from "../auth";

export const deviceRoutes = Router();

// A customer may only act on devices belonging to their own account.
// Admin (or auth disabled) → scope is null → always allowed.
async function deviceAllowed(req: Request, deviceUuid: string): Promise<boolean> {
  const scope = scopedAccountId(req);
  if (scope === null) return true;
  const d = await prisma.device.findUnique({
    where: { id: deviceUuid },
    select: { soundtrackAccountId: true },
  });
  return !!d && d.soundtrackAccountId === scope;
}

// List devices. Customers are forced to their own account; admins may filter.
deviceRoutes.get("/", requireAuth, async (req, res) => {
  try {
    const scope = scopedAccountId(req);
    const accountId = scope ?? (req.query.account as string | undefined);
    const devices = await prisma.device.findMany({
      where: accountId ? { soundtrackAccountId: accountId } : undefined,
      include: { configs: true },
      orderBy: { createdAt: "desc" },
    });
    res.json(devices);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch devices" });
  }
});

// Get single device
deviceRoutes.get("/:id", requireAuth, async (req: Request<{ id: string }>, res) => {
  try {
    if (!(await deviceAllowed(req, req.params.id))) return res.status(403).json({ error: "Forbidden" });
    const device = await prisma.device.findUnique({
      where: { id: req.params.id },
      include: { configs: true },
    });
    if (!device) return res.status(404).json({ error: "Device not found" });
    res.json(device);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch device" });
  }
});

// Delete device and its configs — ADMIN ONLY
deviceRoutes.delete("/:id", requireAdmin, async (req: Request<{ id: string }>, res) => {
  try {
    await prisma.zoneConfig.deleteMany({ where: { deviceId: req.params.id } });
    await prisma.device.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to delete device" });
  }
});

// Rename device
deviceRoutes.patch("/:id/name", requireAuth, async (req: Request<{ id: string }>, res) => {
  try {
    if (!(await deviceAllowed(req, req.params.id))) return res.status(403).json({ error: "Forbidden" });
    const { name } = req.body;
    if (typeof name !== "string") return res.status(400).json({ error: "name required" });

    const device = await prisma.device.update({
      where: { id: req.params.id },
      data: { name },
    });
    res.json(device);
  } catch (err) {
    res.status(500).json({ error: "Failed to rename device" });
  }
});

// Assign Soundtrack account to device — ADMIN ONLY
deviceRoutes.patch("/:id/account", requireAdmin, async (req: Request<{ id: string }>, res) => {
  try {
    const { soundtrackAccountId } = req.body;
    if (typeof soundtrackAccountId !== "string") {
      return res.status(400).json({ error: "soundtrackAccountId (string) required" });
    }

    const device = await prisma.device.update({
      where: { id: req.params.id },
      data: { soundtrackAccountId },
    });

    // Push to device via WebSocket if online
    deviceManager.sendToDevice(device.deviceId, {
      type: "set_account",
      accountId: soundtrackAccountId,
    });

    res.json(device);
  } catch (err) {
    res.status(500).json({ error: "Failed to assign account" });
  }
});

// Pause/resume device
deviceRoutes.patch("/:id/pause", requireAuth, async (req: Request<{ id: string }>, res) => {
  try {
    if (!(await deviceAllowed(req, req.params.id))) return res.status(403).json({ error: "Forbidden" });
    const { isPaused } = req.body;
    if (typeof isPaused !== "boolean") return res.status(400).json({ error: "isPaused (boolean) required" });

    const device = await prisma.device.update({
      where: { id: req.params.id },
      data: { isPaused },
    });
    res.json(device);
  } catch (err) {
    res.status(500).json({ error: "Failed to update device pause state" });
  }
});

// Factory reset device (sends command via WebSocket) — ADMIN ONLY (bricks WiFi)
deviceRoutes.post("/:id/reset", requireAdmin, async (req: Request<{ id: string }>, res) => {
  try {
    const device = await prisma.device.findUnique({ where: { id: req.params.id } });
    if (!device) return res.status(404).json({ error: "Device not found" });

    deviceManager.sendToDevice(device.deviceId, { type: "factory_reset" });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to reset device" });
  }
});

// Register new device via REST — ADMIN ONLY (devices normally register over WS)
deviceRoutes.post("/", requireAdmin, async (req, res) => {
  try {
    const { deviceId, name } = req.body;
    if (!deviceId) return res.status(400).json({ error: "deviceId required" });

    const device = await prisma.device.upsert({
      where: { deviceId },
      update: { name, lastSeen: new Date() },
      create: { deviceId, name },
    });
    res.json(device);
  } catch (err) {
    res.status(500).json({ error: "Failed to register device" });
  }
});
