# Soundtrack Your Brand API - Research

## Overview
B2B music streaming platform for businesses. Provides licensed background music with programmatic control.

## API Details
- **Type:** GraphQL (single endpoint)
- **Endpoint:** `POST https://api.soundtrackyourbrand.com/v2`
- **Auth:** Basic auth — `Authorization: Basic <Base64(client_id:client_secret)>` (NOT OAuth2)
- **Content-Type:** `application/json`
- **Important:** setVolume uses a custom `Volume` scalar that breaks GraphQL variables — must inline values in query string

## Data Hierarchy
```
Account (business)
  └── Location (physical venue)
       └── Sound Zone (audio zone within location)
            └── Player (hardware device paired to zone)
```

## Volume Control
- **Range:** 0-16 (integer, 17 discrete levels)
- Volume 0 = muted, 16 = maximum
- Cloud-mediated: ~0.5-2 seconds latency from API call to audible change
- Recommend debouncing to max 1 API call per 1-2 seconds

### GraphQL Mutation
```graphql
mutation SetVolume($zoneId: ID!, $vol: Int!) {
  setSoundZoneVolume(soundZoneId: $zoneId, volume: $vol) {
    soundZone { id volume }
  }
}
```

### HTTP Request
```
POST https://api.soundtrackyourbrand.com/v2
Content-Type: application/json
Authorization: Bearer <token>

{
  "query": "mutation($zoneId: ID!, $vol: Int!) { setSoundZoneVolume(soundZoneId: $zoneId, volume: $vol) { soundZone { id volume } } }",
  "variables": { "zoneId": "sz_xxx", "vol": 8 }
}
```

## Available MCP Tools
| Tool | Parameters | Description |
|------|-----------|-------------|
| search_account | name (string) | Find account by name (partial, case-insensitive) |
| list_accounts | - | List ALL accounts (900+ possible) |
| list_locations | account_id | List locations for account |
| list_sound_zones | account_id | List zones organized by location |
| get_now_playing | sound_zone_id | Current track info |
| set_volume | sound_zone_id, volume (0-16) | Set volume |
| skip_track | sound_zone_id | Skip to next |
| play | sound_zone_id | Resume playback |
| pause | sound_zone_id | Pause playback |

## ESP32 Integration Considerations
- Standard HTTPS POST with JSON - fully compatible with ESP32
- TLS 1.2 required (~40-50KB RAM per connection)
- Use ArduinoJson to construct GraphQL payloads
- Cache current volume locally to avoid unnecessary API calls
- Implement WiFi reconnection logic
- Consider connection pooling or keep-alive for efficiency

## Volume Mapping Pipeline (Implemented in volume-mapper.ts)
1. Read microphone audio via I2S (16-bit, 16kHz) — every 100ms
2. Calculate RMS over buffer, convert to dBFS: `20 * log10(rms / 32768)`
3. Send dBFS to server via WebSocket — every 500ms
4. **EMA Smoothing:** `smoothedDb = factor * new + (1-factor) * previous`
5. **Linear mapping in dB domain:** map smoothedDb from [quietDb, loudDb] to [minVol, maxVol]
6. **Hysteresis:** only change if diff >= 1 AND sustained for N+ consecutive readings
7. **Rate limiting:** max 1 Soundtrack API call per 2 seconds per zone
8. Update stored currentVolume in DB on successful API call

### User Controls (1-5 scales)
**Sensitivity** = what sound level triggers a volume change
- Controls: quietThresholdDb + loudThresholdDb (the dB window)
- Low (1): wide window (-75 to -30), needs loud noise to react
- High (5): narrow window (-65 to -52), reacts to quiet talking

**Reactivity** = how fast the volume adjusts once triggered
- Controls: smoothingFactor + sustainCount
- Low (1): factor=0.1, sustain=4 — smooth, gradual changes
- High (5): factor=0.7, sustain=1 — near-instant response

### Calibrated Ranges
- ES8311 mic actual range: -80 (silence) to -20 (very loud) dBFS
- Default thresholds: quietDb=-70, loudDb=-40 (30dB active range)
- Frontend dB bar: -80 to -20 range
- Volume range: 0-16 (Soundtrack scale), default min=2, max=14
