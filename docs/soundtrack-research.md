# Soundtrack Your Brand API - Research

## Overview
B2B music streaming platform for businesses. Provides licensed background music with programmatic control.

## API Details
- **Type:** GraphQL (single endpoint)
- **Endpoint:** `POST https://api.soundtrackyourbrand.com/v2`
- **Auth:** OAuth 2.0 Bearer token in Authorization header
- **Content-Type:** `application/json`

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

## Volume Mapping Strategy (Audio dBFS -> 0-16)
1. Read microphone audio via I2S (16-bit, 16kHz)
2. Calculate RMS over ~100ms window
3. Convert to dBFS: `20 * log10(rms / 32768)`
4. Apply exponential moving average for smoothing
5. Map dBFS to 0-16 using logarithmic curve
6. Apply hysteresis (+/- 1 level) to prevent jitter
7. Only call API when volume level actually changes
