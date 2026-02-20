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
        minVolume: minVolume ?? 2,
        maxVolume: maxVolume ?? 14,
        quietThresholdDb: quietThresholdDb ?? -70,
        loudThresholdDb: loudThresholdDb ?? -40,
        smoothingFactor: smoothingFactor ?? 0.3,
        sustainCount: sustainCount ?? 2,
      },
    });
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

// Delete zone config
configRoutes.delete("/:id", async (req, res) => {
  try {
    await prisma.zoneConfig.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to delete config" });
  }
});
