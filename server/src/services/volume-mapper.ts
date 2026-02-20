import { SoundtrackService } from "./soundtrack";

interface ZoneState {
  smoothedDb: number;
  currentVolume: number;
  lastApiCallTime: number;
  sustainCount: number;
  pendingVolume: number | null;
}

export class VolumeMapper {
  private soundtrack: SoundtrackService;
  private zoneStates: Map<string, ZoneState> = new Map();

  constructor(soundtrack: SoundtrackService) {
    this.soundtrack = soundtrack;
  }

  /**
   * Process a new dB reading for a zone config.
   * Returns the mapped volume (0-16) and whether an API call was made.
   */
  async processReading(
    zoneId: string,
    dbFS: number,
    config: {
      isEnabled: boolean;
      minVolume: number;
      maxVolume: number;
      quietThresholdDb: number;
      loudThresholdDb: number;
      smoothingFactor: number;
      sustainThreshold: number;
    }
  ): Promise<{ volume: number; apiCalled: boolean }> {
    if (!config.isEnabled) {
      return { volume: -1, apiCalled: false };
    }

    // Get or create zone state
    let state = this.zoneStates.get(zoneId);
    if (!state) {
      state = {
        smoothedDb: dbFS,
        currentVolume: Math.round((config.minVolume + config.maxVolume) / 2),
        lastApiCallTime: 0,
        sustainCount: 0,
        pendingVolume: null,
      };
      this.zoneStates.set(zoneId, state);
    }

    // 1. Apply EMA smoothing
    state.smoothedDb =
      config.smoothingFactor * dbFS + (1 - config.smoothingFactor) * state.smoothedDb;

    // 2. Map smoothed dB to volume using logarithmic curve
    const mappedVolume = this.mapDbToVolume(
      state.smoothedDb,
      config.quietThresholdDb,
      config.loudThresholdDb,
      config.minVolume,
      config.maxVolume
    );

    // 3. Apply hysteresis - only change if diff >= 1 and sustained for 2+ readings
    const volumeDiff = Math.abs(mappedVolume - state.currentVolume);
    if (volumeDiff >= 1) {
      if (state.pendingVolume === mappedVolume) {
        state.sustainCount++;
      } else {
        state.pendingVolume = mappedVolume;
        state.sustainCount = 1;
      }
    } else {
      state.pendingVolume = null;
      state.sustainCount = 0;
    }

    let apiCalled = false;

    // Only apply change after 2+ sustained readings
    if (state.sustainCount >= config.sustainThreshold && state.pendingVolume !== null) {
      const now = Date.now();
      // Rate limit: max 1 API call per 2 seconds per zone
      if (now - state.lastApiCallTime >= 2000) {
        try {
          await this.soundtrack.setVolume(zoneId, state.pendingVolume);
          state.currentVolume = state.pendingVolume;
          state.lastApiCallTime = now;
          apiCalled = true;
        } catch (err) {
          console.error(`Failed to set volume for zone ${zoneId}:`, err);
        }
        state.pendingVolume = null;
        state.sustainCount = 0;
      }
    }

    return { volume: state.currentVolume, apiCalled };
  }

  /**
   * Map dBFS to volume (0-16) using a logarithmic curve.
   * Human loudness perception is logarithmic, so we use a linear mapping
   * in the dB domain (which is already logarithmic).
   */
  private mapDbToVolume(
    dbFS: number,
    quietDb: number,
    loudDb: number,
    minVol: number,
    maxVol: number
  ): number {
    if (dbFS <= quietDb) return minVol;
    if (dbFS >= loudDb) return maxVol;

    // Linear interpolation in dB domain (logarithmic in amplitude)
    const ratio = (dbFS - quietDb) / (loudDb - quietDb);
    const volume = minVol + ratio * (maxVol - minVol);
    return Math.round(volume);
  }

  getZoneState(zoneId: string): ZoneState | undefined {
    return this.zoneStates.get(zoneId);
  }
}
