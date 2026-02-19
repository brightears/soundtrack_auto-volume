import express from "express";
import cors from "cors";
import http from "http";
import path from "path";
import { config } from "./config";
import { setupWebSocket } from "./websocket/handler";
import { deviceRoutes } from "./routes/devices";
import { configRoutes } from "./routes/configs";
import { soundtrackRoutes } from "./routes/soundtrack";

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

// Start server
server.listen(config.port, () => {
  console.log(`Server running on port ${config.port}`);
  console.log(`Environment: ${config.nodeEnv}`);
  console.log(`WebSocket ready on ws://localhost:${config.port}/ws`);
});
