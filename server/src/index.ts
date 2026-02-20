import express from "express";
import cors from "cors";
import http from "http";
import path from "path";
import { PrismaClient } from "@prisma/client";
import { config } from "./config";
import { setupWebSocket } from "./websocket/handler";
import { deviceRoutes } from "./routes/devices";
import { configRoutes } from "./routes/configs";
import { soundtrackRoutes } from "./routes/soundtrack";

const prisma = new PrismaClient();

const app = express();
const server = http.createServer(app);

// Middleware
app.use(cors());
app.use(express.json());

// Serve static frontend files
app.use(express.static(path.join(__dirname, "../public")));

// Health check
app.get("/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// API routes
app.use("/api/devices", deviceRoutes);
app.use("/api/configs", configRoutes);
app.use("/api/soundtrack", soundtrackRoutes);

// SPA fallback - serve index.html for non-API routes
app.get("*", (_req, res) => {
  res.sendFile(path.join(__dirname, "../public/index.html"));
});

// WebSocket server
setupWebSocket(server);

// One-time migration: fix miscalibrated thresholds from old defaults
prisma.zoneConfig.updateMany({
  where: { quietThresholdDb: -40, loudThresholdDb: -10 },
  data: { quietThresholdDb: -70, loudThresholdDb: -40 },
}).then(r => {
  if (r.count > 0) console.log(`Migrated ${r.count} config(s) to calibrated thresholds`);
}).catch(console.error);

// One-time migration: update old too-reactive defaults to recommended values
prisma.zoneConfig.updateMany({
  where: { smoothingFactor: 0.3, sustainCount: 2, minVolume: 2, maxVolume: 14 },
  data: { smoothingFactor: 0.2, sustainCount: 3, minVolume: 4, maxVolume: 12 },
}).then(r => {
  if (r.count > 0) console.log(`Migrated ${r.count} config(s) to recommended defaults`);
}).catch(console.error);

// Start server
server.listen(config.port, () => {
  console.log(`Server running on port ${config.port}`);
  console.log(`Environment: ${config.nodeEnv}`);
  console.log(`WebSocket ready on ws://localhost:${config.port}/ws`);
});
