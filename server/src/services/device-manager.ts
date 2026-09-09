import WebSocket from "ws";
import { prisma } from "../db";

interface ConnectedDevice {
  ws: WebSocket;
  deviceId: string;
  lastSeen: Date;
}

// Optional health telemetry a device may include in its "register" message.
export interface RegisterTelemetry {
  resetReason?: string;
  rssi?: number;
  ip?: string;
  uptimeSec?: number;
  freeHeap?: number;
  onUsb?: boolean | null;
  batteryPct?: number | null;
}

// Periodic "status" heartbeat payload (~every 60s).
export interface DeviceStatus {
  rssi?: number;
  freeHeap?: number;
  uptimeSec?: number;
  onUsb?: boolean | null;
  batteryPct?: number | null;
  fw?: string;
}

export class DeviceManager {
  private devices: Map<string, ConnectedDevice> = new Map();

  async registerDevice(
    ws: WebSocket,
    deviceId: string,
    firmware?: string,
    accountId?: string,
    telemetry?: RegisterTelemetry
  ): Promise<void> {
    // Store in memory
    this.devices.set(deviceId, { ws, deviceId, lastSeen: new Date() });

    const now = new Date();
    // Only persist telemetry fields the device actually sent, so an older
    // firmware that omits them never wipes previously stored values.
    const t = telemetry ?? {};
    const telemetryData = {
      ...(t.resetReason !== undefined && { resetReason: t.resetReason }),
      ...(t.rssi !== undefined && { rssi: t.rssi }),
      ...(t.ip !== undefined && { ip: t.ip }),
      ...(t.uptimeSec !== undefined && { uptimeSec: t.uptimeSec }),
      ...(t.freeHeap !== undefined && { freeHeap: t.freeHeap }),
      ...(t.onUsb !== undefined && { onUsb: t.onUsb }),
      ...(t.batteryPct !== undefined && { batteryPct: t.batteryPct }),
      // Register fires on every WS (re)connect, not only on boot — so derive
      // lastBootAt only when the device reports its uptime (new firmware). Older
      // firmware would otherwise stamp a fake "boot" on every reconnect.
      ...(t.uptimeSec !== undefined && { lastBootAt: new Date(now.getTime() - t.uptimeSec * 1000) }),
    };

    // Upsert in database
    await prisma.device.upsert({
      where: { deviceId },
      update: {
        isOnline: true,
        lastSeen: now,
        ...(firmware && { firmware }),
        ...(accountId && { soundtrackAccountId: accountId }),
        ...telemetryData,
      },
      create: {
        deviceId,
        isOnline: true,
        lastSeen: now,
        ...(firmware && { firmware }),
        ...(accountId && { soundtrackAccountId: accountId }),
        ...telemetryData,
      },
    });

    console.log(`Device registered: ${deviceId} (${this.devices.size} total)${accountId ? ` account: ${accountId}` : ''}${t.resetReason ? ` reset: ${t.resetReason}` : ''}`);
  }

  async updateDeviceStatus(deviceId: string, status: DeviceStatus): Promise<void> {
    const now = new Date();
    const device = this.devices.get(deviceId);
    if (device) {
      device.lastSeen = now;
    }

    await prisma.device.update({
      where: { deviceId },
      data: {
        ...(status.rssi !== undefined && { rssi: status.rssi }),
        ...(status.freeHeap !== undefined && { freeHeap: status.freeHeap }),
        ...(status.uptimeSec !== undefined && { uptimeSec: status.uptimeSec }),
        ...(status.onUsb !== undefined && { onUsb: status.onUsb }),
        ...(status.batteryPct !== undefined && { batteryPct: status.batteryPct }),
        ...(status.fw && { firmware: status.fw }),
        lastStatusAt: now,
        lastSeen: now,
        isOnline: true,
      },
    }).catch(() => {}); // Ignore if device doesn't exist
  }

  async disconnectDevice(deviceId: string): Promise<void> {
    this.devices.delete(deviceId);

    await prisma.device.update({
      where: { deviceId },
      data: { isOnline: false },
    }).catch(() => {}); // Ignore if device doesn't exist

    console.log(`Device disconnected: ${deviceId} (${this.devices.size} total)`);
  }

  async updateDeviceLevel(deviceId: string, dbLevel: number): Promise<void> {
    const device = this.devices.get(deviceId);
    if (device) {
      device.lastSeen = new Date();
    }

    await prisma.device.update({
      where: { deviceId },
      data: { lastDbLevel: dbLevel, lastSeen: new Date() },
    }).catch(() => {});
  }

  sendToDevice(deviceId: string, message: object): void {
    const device = this.devices.get(deviceId);
    if (device && device.ws.readyState === WebSocket.OPEN) {
      device.ws.send(JSON.stringify(message));
    }
  }

  getConnectedDevices(): string[] {
    return Array.from(this.devices.keys());
  }

  isDeviceOnline(deviceId: string): boolean {
    return this.devices.has(deviceId);
  }

  findDeviceIdByWs(ws: WebSocket): string | undefined {
    for (const [deviceId, device] of this.devices) {
      if (device.ws === ws) return deviceId;
    }
    return undefined;
  }

  async getDeviceConfigs(deviceId: string) {
    return prisma.zoneConfig.findMany({
      where: { deviceId, isEnabled: true },
    });
  }
}
