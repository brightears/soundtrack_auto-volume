import { Router } from "express";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
export const deviceRoutes = Router();

// List all devices
deviceRoutes.get("/", async (_req, res) => {
  try {
    const devices = await prisma.device.findMany({
      include: { configs: true },
      orderBy: { createdAt: "desc" },
    });
    res.json(devices);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch devices" });
  }
});

// Get single device
deviceRoutes.get("/:id", async (req, res) => {
  try {
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

// Delete device and its configs
deviceRoutes.delete("/:id", async (req, res) => {
  try {
    await prisma.zoneConfig.deleteMany({ where: { deviceId: req.params.id } });
    await prisma.device.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to delete device" });
  }
});

// Rename device
deviceRoutes.patch("/:id/name", async (req, res) => {
  try {
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

// Pause/resume device
deviceRoutes.patch("/:id/pause", async (req, res) => {
  try {
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

// Register new device (also used by ESP32 via WebSocket, but available via REST too)
deviceRoutes.post("/", async (req, res) => {
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
