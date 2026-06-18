import "./instrument"; // MUST be first — initializes Sentry before anything else
import * as Sentry from "@sentry/node";
import express from "express";
import cors from "cors";
import http from "http";
import path from "path";
import { prisma } from "./db";
import { config } from "./config";
import { setupWebSocket } from "./websocket/handler";
import { deviceRoutes } from "./routes/devices";
import { configRoutes } from "./routes/configs";
import { soundtrackRoutes } from "./routes/soundtrack";
import { authRoutes } from "./routes/auth";
import { customerRoutes } from "./routes/customers";
import { firmwareRoutes } from "./routes/firmware";
import { attachAuth, logAuthStatus } from "./auth";

const app = express();
const server = http.createServer(app);

// Middleware
// Same-origin app: cross-origin is disabled by default (most secure, and required
// for cookie auth — wildcard CORS can't carry credentials). Add comma-separated
// origins via CORS_ORIGINS only if you ever need genuine cross-origin access.
const corsOrigins = (process.env.CORS_ORIGINS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
app.use(cors({ origin: corsOrigins.length ? corsOrigins : false, credentials: true }));
app.use(express.json());
app.use(attachAuth); // resolve req.auth from the session cookie (never blocks)

// Serve static frontend files
app.use(express.static(path.join(__dirname, "../public")));

// Health check
app.get("/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// API routes
app.use("/api/auth", authRoutes);
app.use("/api/customers", customerRoutes);
app.use("/api/devices", deviceRoutes);
app.use("/api/configs", configRoutes);
app.use("/api/soundtrack", soundtrackRoutes);
app.use("/api/firmware", firmwareRoutes);

// SPA fallback - serve index.html for non-API routes
app.get("*", (_req, res) => {
  res.sendFile(path.join(__dirname, "../public/index.html"));
});

// Sentry Express error handler (no-op unless SENTRY_DSN is configured)
Sentry.setupExpressErrorHandler(app);

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

// One-time migration: recalibrate sensitivity thresholds to match actual ES8311 mic range
prisma.zoneConfig.updateMany({
  where: { quietThresholdDb: -70, loudThresholdDb: -40 },
  data: { quietThresholdDb: -74, loudThresholdDb: -45 },
}).then(r => {
  if (r.count > 0) console.log(`Migrated ${r.count} config(s) to recalibrated thresholds`);
}).catch(console.error);

// Start server
server.listen(config.port, () => {
  console.log(`Server running on port ${config.port}`);
  console.log(`Environment: ${config.nodeEnv}`);
  console.log(`WebSocket ready on ws://localhost:${config.port}/ws`);
  logAuthStatus();
});

// Graceful shutdown: Render sends SIGTERM on every deploy. Stop accepting new
// connections, let in-flight work finish, disconnect Prisma, then exit — instead
// of hard-killing sockets and DB writes mid-flight.
let shuttingDown = false;
function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`${signal} received — shutting down gracefully...`);
  server.close(() => {
    prisma.$disconnect().finally(() => process.exit(0));
  });
  // Failsafe: don't hang the platform's shutdown window.
  setTimeout(() => process.exit(0), 10000).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

// Guard against unhandled promise rejections (Node crashes on these by default).
// Uncaught *exceptions* are intentionally NOT swallowed — let the process crash
// and let Render restart it clean rather than limp in a corrupted state.
process.on("unhandledRejection", (reason) => console.error("Unhandled promise rejection:", reason));
