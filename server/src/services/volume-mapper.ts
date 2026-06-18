import { SoundtrackService } from "./soundtrack";

interface ZoneState {
  smoothedDb: number;
  currentVolume: number;
  lastApiCallTime: number;
  lastIncreaseTime: number; // when we last RAISED volume (for runaway-gain guard)
  playerOfflineUntil: number; // backoff: skip setVolume attempts until this time
  sustainCount: number;
  pendingVolume: number | null;
  pendingDirection: number | null; // 1 = up, -1 = down
}

// When Soundtrack reports the zone's player offline, stop hammering setVolume
// every 2s — wait this long before retrying (also detects when it comes back).
const PLAYER_OFFLINE_BACKOFF_MS = 30000;

// Runaway-gain guard: after the controller raises volume, the device's own music
// gets louder and the in-room mic hears it, which would push volume up again — a
// positive-feedback loop that parks a quiet venue at max volume. After any
// increase we suppress further increases for this window (decreases stay allowed),
// so volume can only climb gradually and can always recover downward.
// Future refinement: also model and subtract the commanded-volume contribution
// from the measured level instead of a fixed settle window.
const RUNAWAY_SETTLE_MS = 6000;

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
  ): Promise<{ volume: number; apiCalled: boolean; playerOnline?: boolean }> {
    if (!config.isEnabled) {
      return { volume: -1, apiCalled: false };
    }

    // Noise floor gate: skip readings well below the active range
    if (dbFS < config.quietThresholdDb - 3) {
      const state = this.zoneStates.get(zoneId);
      return { volume: state?.currentVolume ?? config.minVolume, apiCalled: false };
    }

    // Get or create zone state
    let state = this.zoneStates.get(zoneId);
    if (!state) {
      state = {
        smoothedDb: dbFS,
        currentVolume: Math.round((config.minVolume + config.maxVolume) / 2),
        lastApiCallTime: 0,
        lastIncreaseTime: 0,
        playerOfflineUntil: 0,
        sustainCount: 0,
        pendingVolume: null,
        pendingDirection: null,
      };
      this.zoneStates.set(zoneId, state);
    }

    // 1. Apply asymmetric EMA smoothing
    //    Attack (getting louder): faster response (1.5x smoothing factor)
    //    Release (getting quieter): slower response (0.5x smoothing factor)
    const alpha = dbFS > state.smoothedDb
      ? Math.min(config.smoothingFactor * 1.5, 0.9)  // attack: faster
      : config.smoothingFactor * 0.5;                  // release: slower
    state.smoothedDb = alpha * dbFS + (1 - alpha) * state.smoothedDb;

    // 2. Map smoothed dB to volume using logarithmic curve
    const mappedVolume = this.mapDbToVolume(
      state.smoothedDb,
      config.quietThresholdDb,
      config.loudThresholdDb,
      config.minVolume,
      config.maxVolume
    );

    // 3. Apply hysteresis - only change if diff >= 1 and sustained for 2+ readings
    //    Use direction-based tracking instead of exact-match to handle gradual EMA drift
    const volumeDiff = Math.abs(mappedVolume - state.currentVolume);
    if (volumeDiff >= 1) {
      const direction = mappedVolume > state.currentVolume ? 1 : -1;
      if (state.pendingDirection === direction) {
        state.sustainCount++;
        state.pendingVolume = mappedVolume; // always track latest target
      } else {
        state.pendingDirection = direction;
        state.pendingVolume = mappedVolume;
        state.sustainCount = 1;
      }
    } else {
      state.pendingVolume = null;
      state.pendingDirection = null;
      state.sustainCount = 0;
    }

    let apiCalled = false;
    let playerOnline: boolean | undefined;

    // Only apply change after 2+ sustained readings
    if (state.sustainCount >= config.sustainThreshold && state.pendingVolume !== null) {
      const now = Date.now();

      // Player-offline backoff: if Soundtrack recently reported the player offline,
      // don't retry setVolume every 2s — wait out the backoff window.
      if (state.playerOfflineUntil && now < state.playerOfflineUntil) {
        return { volume: state.currentVolume, apiCalled: false, playerOnline: false };
      }

      // Runaway-gain guard: don't raise volume again until the settle window after
      // the last increase has elapsed. Decreases are always allowed so the system
      // can still come back down. Keep the pending target so a genuine, sustained
      // increase still applies once the window passes.
      const wantsIncrease = state.pendingVolume > state.currentVolume;
      if (wantsIncrease && now - state.lastIncreaseTime < RUNAWAY_SETTLE_MS) {
        return { volume: state.currentVolume, apiCalled: false };
      }

      // Clamp to max 2 volume steps per change (prevents jarring jumps)
      const maxStep = 2;
      const diff = state.pendingVolume - state.currentVolume;
      if (Math.abs(diff) > maxStep) {
        state.pendingVolume = state.currentVolume + (diff > 0 ? maxStep : -maxStep);
      }

      // Rate limit: max 1 API call per 2 seconds per zone
      if (now - state.lastApiCallTime >= 2000) {
        // Claim the rate-limit slot BEFORE awaiting the network call so a second
        // concurrent reading for this zone can't also pass the gate and fire a
        // duplicate setVolume. Released back on failure so a retry can happen.
        const previousCallTime = state.lastApiCallTime;
        state.lastApiCallTime = now;
        const isIncrease = state.pendingVolume > state.currentVolume;
        try {
          await this.soundtrack.setVolume(zoneId, state.pendingVolume);
          state.currentVolume = state.pendingVolume;
          if (isIncrease) state.lastIncreaseTime = now;
          state.playerOfflineUntil = 0;
          apiCalled = true;
          playerOnline = true;
        } catch (err: any) {
          state.lastApiCallTime = previousCallTime;
          if (err?.playerOffline) {
            state.playerOfflineUntil = now + PLAYER_OFFLINE_BACKOFF_MS;
            playerOnline = false;
            console.warn(`Zone ${zoneId} player offline — backing off ${PLAYER_OFFLINE_BACKOFF_MS / 1000}s`);
          } else {
            console.error(`Failed to set volume for zone ${zoneId}:`, err);
          }
        }
        state.pendingVolume = null;
        state.pendingDirection = null;
        state.sustainCount = 0;
      }
    }

    return { volume: state.currentVolume, apiCalled, playerOnline };
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
