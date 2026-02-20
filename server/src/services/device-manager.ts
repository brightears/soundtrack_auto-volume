import WebSocket from "ws";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

interface ConnectedDevice {
  ws: WebSocket;
  deviceId: string;
  lastSeen: Date;
}

export class DeviceManager {
  private devices: Map<string, ConnectedDevice> = new Map();

  async registerDevice(ws: WebSocket, deviceId: string, firmware?: string): Promise<void> {
    // Store in memory
    this.devices.set(deviceId, { ws, deviceId, lastSeen: new Date() });

    // Upsert in database
    await prisma.device.upsert({
      where: { deviceId },
      update: { isOnline: true, lastSeen: new Date(), ...(firmware && { firmware }) },
      create: { deviceId, isOnline: true, lastSeen: new Date(), ...(firmware && { firmware }) },
    });

    console.log(`Device registered: ${deviceId} (${this.devices.size} total)`);
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
