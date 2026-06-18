#!/usr/bin/env node
// Publish a built firmware image so devices can self-update over the air.
//
// Usage:
//   node scripts/publish-firmware.mjs <version> ["release notes"]
//
// It copies the latest PlatformIO build into server/public/firmware/firmware.bin,
// computes its md5/size, and writes version.json. Commit server/public/firmware/
// and push — Render serves the new manifest + binary and devices on an older
// version pick it up within their check interval (or immediately via "ota_check").
//
// IMPORTANT: <version> must match the FW_VERSION you compiled into the .bin, and
// must be HIGHER than the version running on the devices you want to update.

import { createHash } from "crypto";
import { readFileSync, writeFileSync, copyFileSync, mkdirSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const serverRoot = join(__dirname, "..");
const BIN_SRC = join(serverRoot, "..", "firmware", ".pio", "build", "esp32s3", "firmware.bin");
const OUT_DIR = join(serverRoot, "public", "firmware");
const HOST = process.env.OTA_HOST || "https://soundtrack-auto-volume.onrender.com";

const version = process.argv[2];
if (!version || !/^\d+\.\d+\.\d+/.test(version)) {
  console.error('Usage: node scripts/publish-firmware.mjs <version> ["notes"]');
  console.error("  <version> must look like 2.6.1 and match the compiled FW_VERSION.");
  process.exit(1);
}
const notes = process.argv.slice(3).join(" ") || `Firmware ${version}`;

if (!existsSync(BIN_SRC)) {
  console.error("Build not found:", BIN_SRC);
  console.error("Build first:  cd firmware && pio run");
  process.exit(1);
}

mkdirSync(OUT_DIR, { recursive: true });
const bin = readFileSync(BIN_SRC);
const md5 = createHash("md5").update(bin).digest("hex");
copyFileSync(BIN_SRC, join(OUT_DIR, "firmware.bin"));

const manifest = {
  version,
  url: `${HOST}/firmware/firmware.bin`,
  md5,
  size: bin.length,
  notes,
  available: true,
};
writeFileSync(join(OUT_DIR, "version.json"), JSON.stringify(manifest, null, 2) + "\n");

console.log(`Published firmware ${version}  (${(bin.length / 1024).toFixed(0)} KB, md5 ${md5})`);
console.log("Next: git add server/public/firmware && git commit && git push  (Render auto-deploys)");
