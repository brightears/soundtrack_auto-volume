import { Router, Request } from "express";
import { prisma } from "../db";
import { requireAuth, scopedAccountId, canAccessAccount } from "../auth";

export const configRoutes = Router();

// Ownership helpers. scope === null means admin (or auth disabled) → allowed.
async function deviceAllowed(req: Request, deviceUuid: string): Promise<boolean> {
  const scope = scopedAccountId(req);
  if (scope === null) return true;
  const d = await prisma.device.findUnique({
    where: { id: deviceUuid },
    select: { soundtrackAccountId: true },
  });
  return !!d && d.soundtrackAccountId === scope;
}

async function configAllowed(req: Request, configId: string): Promise<boolean> {
  const scope = scopedAccountId(req);
  if (scope === null) return true;
  const cfg = await prisma.zoneConfig.findUnique({
    where: { id: configId },
    select: { soundtrackAccountId: true },
  });
  return !!cfg && cfg.soundtrackAccountId === scope;
}

// A device controls only ONE Soundtrack account's zones. Returns an error if the
// requested zone's account conflicts with the device's assigned account; if the
// device has no account yet, the first zone assigns it. Prevents cross-wiring one
// customer's zone onto another customer's device.
async function assertZoneAccountMatchesDevice(
  deviceUuid: string,
  accountId: string
): Promise<{ status: number; error: string } | null> {
  const dev = await prisma.device.findUnique({
    where: { id: deviceUuid },
    select: { soundtrackAccountId: true },
  });
  if (!dev) return { status: 404, error: "Device not found" };
  if (dev.soundtrackAccountId && dev.soundtrackAccountId !== accountId) {
    return {
      status: 400,
      error: "This device is assigned to a different customer account. A device can only control zones from its own account.",
    };
  }
  if (!dev.soundtrackAccountId) {
    await prisma.device.update({ where: { id: deviceUuid }, data: { soundtrackAccountId: accountId } });
  }
  return null;
}

// --- Input sanitisation -----------------------------------------------------
// Clamp config numerics to safe ranges so degenerate settings (inverted
// thresholds, min>max, out-of-range volumes, bad smoothing) can never reach and
// destabilise the volume algorithm. The UI already sends valid presets, so this
// is invisible to normal use and only guards against bad/abusive direct calls.
const isNum = (v: any): v is number => typeof v === "number" && Number.isFinite(v);
const clampInt = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(v)));
const clampNum = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

function sanitizeFull(b: any) {
  const minVolume = clampInt(isNum(b.minVolume) ? b.minVolume : 4, 0, 16);
  let maxVolume = clampInt(isNum(b.maxVolume) ? b.maxVolume : 12, 0, 16);
  if (maxVolume < minVolume) maxVolume = minVolume;
  const quietThresholdDb = clampNum(isNum(b.quietThresholdDb) ? b.quietThresholdDb : -74, -100, 0);
  let loudThresholdDb = clampNum(isNum(b.loudThresholdDb) ? b.loudThresholdDb : -45, -100, 0);
  if (loudThresholdDb <= quietThresholdDb) loudThresholdDb = Math.min(0, quietThresholdDb + 5);
  const smoothingFactor = clampNum(isNum(b.smoothingFactor) ? b.smoothingFactor : 0.2, 0.05, 0.95);
  const sustainCount = clampInt(isNum(b.sustainCount) ? b.sustainCount : 3, 1, 60);
  return { minVolume, maxVolume, quietThresholdDb, loudThresholdDb, smoothingFactor, sustainCount };
}

function sanitizePartial(b: any): Record<string, number> {
  const out: Record<string, number> = {};
  if (isNum(b.minVolume)) out.minVolume = clampInt(b.minVolume, 0, 16);
  if (isNum(b.maxVolume)) out.maxVolume = clampInt(b.maxVolume, 0, 16);
  if (isNum(b.quietThresholdDb)) out.quietThresholdDb = clampNum(b.quietThresholdDb, -100, 0);
  if (isNum(b.loudThresholdDb)) out.loudThresholdDb = clampNum(b.loudThresholdDb, -100, 0);
  if (isNum(b.smoothingFactor)) out.smoothingFactor = clampNum(b.smoothingFactor, 0.05, 0.95);
  if (isNum(b.sustainCount)) out.sustainCount = clampInt(b.sustainCount, 1, 60);
  return out;
}

// Get configs for a device
configRoutes.get("/device/:deviceId", requireAuth, async (req: Request<{ deviceId: string }>, res) => {
  try {
    if (!(await deviceAllowed(req, req.params.deviceId))) return res.status(403).json({ error: "Forbidden" });
    const configs = await prisma.zoneConfig.findMany({
      where: { deviceId: req.params.deviceId },
      orderBy: { createdAt: "desc" },
    });
    res.json(configs);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch configs" });
  }
});

// Create zone config
configRoutes.post("/", requireAuth, async (req, res) => {
  try {
    const {
      deviceId,
      soundtrackAccountId,
      soundtrackAccountName,
      soundtrackZoneId,
      soundtrackZoneName,
      isEnabled,
      minVolume,
      maxVolume,
      quietThresholdDb,
      loudThresholdDb,
      smoothingFactor,
      sustainCount,
    } = req.body;

    if (!deviceId || !soundtrackAccountId || !soundtrackZoneId) {
      return res.status(400).json({ error: "deviceId, soundtrackAccountId, and soundtrackZoneId required" });
    }

    // Customers may only configure their own account's devices.
    if (!canAccessAccount(req, soundtrackAccountId) || !(await deviceAllowed(req, deviceId))) {
      return res.status(403).json({ error: "Forbidden" });
    }

    // A device controls only ONE account's zones (its own). Refuse to attach a
    // zone from a different account — that would leak it to the device's owner
    // and let their mic drive another venue's music. First zone sets the account.
    const matchErr = await assertZoneAccountMatchesDevice(deviceId, soundtrackAccountId);
    if (matchErr) return res.status(matchErr.status).json({ error: matchErr.error });

    const config = await prisma.zoneConfig.create({
      data: {
        deviceId,
        soundtrackAccountId,
        soundtrackAccountName,
        soundtrackZoneId,
        soundtrackZoneName,
        isEnabled: isEnabled ?? false,
        ...sanitizeFull({ minVolume, maxVolume, quietThresholdDb, loudThresholdDb, smoothingFactor, sustainCount }),
      },
    });

    // Auto-name device to zone name if device has no name yet
    if (soundtrackZoneName) {
      await prisma.device.updateMany({
        where: { id: deviceId, name: null },
        data: { name: soundtrackZoneName },
      });
    }

    res.json(config);
  } catch (err: any) {
    if (err.code === "P2002") {
      return res.status(409).json({ error: "This device is already configured for this zone" });
    }
    res.status(500).json({ error: "Failed to create config" });
  }
});

// Update zone config
configRoutes.put("/:id", requireAuth, async (req: Request<{ id: string }>, res) => {
  try {
    if (!(await configAllowed(req, req.params.id))) return res.status(403).json({ error: "Forbidden" });
    const {
      isEnabled,
      minVolume,
      maxVolume,
      quietThresholdDb,
      loudThresholdDb,
      smoothingFactor,
      sustainCount,
      soundtrackAccountId,
      soundtrackAccountName,
      soundtrackZoneId,
      soundtrackZoneName,
    } = req.body;

    const config = await prisma.zoneConfig.update({
      where: { id: req.params.id },
      data: {
        ...(isEnabled !== undefined && { isEnabled }),
        ...sanitizePartial({ minVolume, maxVolume, quietThresholdDb, loudThresholdDb, smoothingFactor, sustainCount }),
        ...(soundtrackAccountId !== undefined && { soundtrackAccountId }),
        ...(soundtrackAccountName !== undefined && { soundtrackAccountName }),
        ...(soundtrackZoneId !== undefined && { soundtrackZoneId }),
        ...(soundtrackZoneName !== undefined && { soundtrackZoneName }),
      },
    });
    res.json(config);
  } catch (err) {
    res.status(500).json({ error: "Failed to update config" });
  }
});

// Pause/resume zone config
configRoutes.patch("/:id/pause", requireAuth, async (req: Request<{ id: string }>, res) => {
  try {
    if (!(await configAllowed(req, req.params.id))) return res.status(403).json({ error: "Forbidden" });
    const { isPaused } = req.body;
    if (typeof isPaused !== "boolean") return res.status(400).json({ error: "isPaused (boolean) required" });

    const config = await prisma.zoneConfig.update({
      where: { id: req.params.id },
      data: { isPaused },
    });
    res.json(config);
  } catch (err) {
    res.status(500).json({ error: "Failed to update zone pause state" });
  }
});

// Quick setup — creates enabled config and auto-names device
configRoutes.post("/quick-setup", requireAuth, async (req, res) => {
  try {
    const {
      deviceId,
      soundtrackAccountId,
      soundtrackAccountName,
      soundtrackZoneId,
      soundtrackZoneName,
    } = req.body;

    if (!deviceId || !soundtrackAccountId || !soundtrackZoneId) {
      return res.status(400).json({ error: "deviceId, soundtrackAccountId, and soundtrackZoneId required" });
    }

    if (!canAccessAccount(req, soundtrackAccountId) || !(await deviceAllowed(req, deviceId))) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const matchErr = await assertZoneAccountMatchesDevice(deviceId, soundtrackAccountId);
    if (matchErr) return res.status(matchErr.status).json({ error: matchErr.error });

    const config = await prisma.zoneConfig.create({
      data: {
        deviceId,
        soundtrackAccountId,
        soundtrackAccountName,
        soundtrackZoneId,
        soundtrackZoneName,
        isEnabled: true,
      },
    });

    // Auto-name device to zone name if no name set
    if (soundtrackZoneName) {
      await prisma.device.updateMany({
        where: { id: deviceId, name: null },
        data: { name: soundtrackZoneName },
      });
    }

    const device = await prisma.device.findUnique({
      where: { id: deviceId },
      include: { configs: true },
    });

    res.json({ config, device });
  } catch (err: any) {
    if (err.code === "P2002") {
      return res.status(409).json({ error: "This device is already configured for this zone" });
    }
    res.status(500).json({ error: "Failed to quick-setup config" });
  }
});

// Delete zone config
configRoutes.delete("/:id", requireAuth, async (req: Request<{ id: string }>, res) => {
  try {
    if (!(await configAllowed(req, req.params.id))) return res.status(403).json({ error: "Forbidden" });
    await prisma.zoneConfig.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to delete config" });
  }
});
