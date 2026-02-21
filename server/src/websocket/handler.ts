import http from "http";
import WebSocket, { WebSocketServer } from "ws";
import { DeviceManager } from "../services/device-manager";
import { VolumeMapper } from "../services/volume-mapper";
import { SoundtrackService } from "../services/soundtrack";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const deviceManager = new DeviceManager();
const soundtrack = new SoundtrackService();
const volumeMapper = new VolumeMapper(soundtrack);

interface SoundLevelMessage {
  type: "sound_level";
  deviceId: string;
  rms: number;
  dbFS: number;
}

interface RegisterMessage {
  type: "register";
  deviceId: string;
  firmware?: string;
  accountId?: string;
}

type IncomingMessage = SoundLevelMessage | RegisterMessage;

export function setupWebSocket(server: http.Server): void {
  const wss = new WebSocketServer({ server, path: "/ws" });

  wss.on("connection", (ws: WebSocket) => {
    console.log("New WebSocket connection");

    ws.on("message", async (raw: Buffer) => {
      try {
        const message: IncomingMessage = JSON.parse(raw.toString());

        switch (message.type) {
          case "register":
            await handleRegister(ws, message);
            break;
          case "sound_level":
            await handleSoundLevel(message);
            break;
          default:
            console.warn("Unknown message type:", (message as any).type);
        }
      } catch (err) {
        console.error("WebSocket message error:", err);
      }
    });

    ws.on("close", async () => {
      const deviceId = deviceManager.findDeviceIdByWs(ws);
      if (deviceId) {
        await deviceManager.disconnectDevice(deviceId);
      }
    });

    ws.on("error", (err) => {
      console.error("WebSocket error:", err);
    });
  });

  console.log("WebSocket server initialized");
}

async function handleRegister(ws: WebSocket, msg: RegisterMessage): Promise<void> {
  await deviceManager.registerDevice(ws, msg.deviceId, msg.firmware, msg.accountId);

  // Send back registration confirmation + any existing configs
  const device = await prisma.device.findUnique({
    where: { deviceId: msg.deviceId },
    include: { configs: true },
  });

  ws.send(
    JSON.stringify({
      type: "registered",
      deviceId: msg.deviceId,
      configs: device?.configs || [],
    })
  );

  // Push stored account to device if it didn't send one
  if (device?.soundtrackAccountId && !msg.accountId) {
    ws.send(
      JSON.stringify({
        type: "set_account",
        accountId: device.soundtrackAccountId,
      })
    );
  }
}

async function handleSoundLevel(msg: SoundLevelMessage): Promise<void> {
  // Update device's last reading
  await deviceManager.updateDeviceLevel(msg.deviceId, msg.dbFS);

  // Get device from DB to find its ID
  const device = await prisma.device.findUnique({
    where: { deviceId: msg.deviceId },
  });
  if (!device) return;

  // Skip processing if device is globally paused
  if (device.isPaused) return;

  // Get enabled and not-paused configs for this device
  const configs = await prisma.zoneConfig.findMany({
    where: { deviceId: device.id, isEnabled: true, isPaused: false },
  });

  // Process each zone config
  for (const config of configs) {
    const result = await volumeMapper.processReading(config.soundtrackZoneId, msg.dbFS, {
      isEnabled: config.isEnabled,
      minVolume: config.minVolume,
      maxVolume: config.maxVolume,
      quietThresholdDb: config.quietThresholdDb,
      loudThresholdDb: config.loudThresholdDb,
      smoothingFactor: config.smoothingFactor,
      sustainThreshold: config.sustainCount ?? 2,
    });

    if (result.apiCalled && result.volume != null) {
      // Update stored volume
      await prisma.zoneConfig.update({
        where: { id: config.id },
        data: { currentVolume: result.volume },
      });
    }
  }
}

export { deviceManager, volumeMapper };
