import { Router } from "express";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
export const configRoutes = Router();

// Get configs for a device
configRoutes.get("/device/:deviceId", async (req, res) => {
  try {
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
configRoutes.post("/", async (req, res) => {
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

    const config = await prisma.zoneConfig.create({
      data: {
        deviceId,
        soundtrackAccountId,
        soundtrackAccountName,
        soundtrackZoneId,
        soundtrackZoneName,
        isEnabled: isEnabled ?? false,
        minVolume: minVolume ?? 4,
        maxVolume: maxVolume ?? 12,
        quietThresholdDb: quietThresholdDb ?? -70,
        loudThresholdDb: loudThresholdDb ?? -40,
        smoothingFactor: smoothingFactor ?? 0.2,
        sustainCount: sustainCount ?? 3,
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
configRoutes.put("/:id", async (req, res) => {
  try {
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
        ...(minVolume !== undefined && { minVolume }),
        ...(maxVolume !== undefined && { maxVolume }),
        ...(quietThresholdDb !== undefined && { quietThresholdDb }),
        ...(loudThresholdDb !== undefined && { loudThresholdDb }),
        ...(smoothingFactor !== undefined && { smoothingFactor }),
        ...(sustainCount !== undefined && { sustainCount }),
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
configRoutes.patch("/:id/pause", async (req, res) => {
  try {
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
configRoutes.post("/quick-setup", async (req, res) => {
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
configRoutes.delete("/:id", async (req, res) => {
  try {
    await prisma.zoneConfig.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to delete config" });
  }
});
