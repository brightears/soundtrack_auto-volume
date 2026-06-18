import { Router } from "express";
import fs from "fs";
import path from "path";

// Firmware OTA manifest. Devices poll GET /api/firmware/version (unauthenticated —
// they hold no session cookie) to discover the latest published firmware. The
// binary itself is served statically from /firmware/firmware.bin. Publish a new
// build with scripts/publish-firmware.mjs, then commit + push to deploy.
export const firmwareRoutes = Router();

const VERSION_FILE = path.join(__dirname, "../../public/firmware/version.json");

firmwareRoutes.get("/version", (_req, res) => {
  fs.readFile(VERSION_FILE, "utf8", (err, data) => {
    if (err) {
      // No manifest published yet — tell devices there's nothing to install.
      return res.json({ available: false });
    }
    try {
      res.json(JSON.parse(data));
    } catch {
      res.json({ available: false });
    }
  });
});
