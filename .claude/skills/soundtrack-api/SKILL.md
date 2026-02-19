---
name: soundtrack-api
description: Soundtrack Your Brand GraphQL API integration knowledge
---
# Soundtrack Your Brand API

## Endpoint
`POST https://api.soundtrackyourbrand.com/v2`

## Authentication
Bearer token in Authorization header.

## Volume Control
- Range: 0-16 (integer, 17 discrete levels)
- Volume changes are cloud-mediated: ~0.5-2s latency
- Rate limit: debounce to max 1 change per 1-2 seconds
- Volume 0 = muted, 16 = maximum

## GraphQL Volume Mutation
```graphql
mutation SetVolume($zoneId: ID!, $vol: Int!) {
  setSoundZoneVolume(soundZoneId: $zoneId, volume: $vol) {
    soundZone { id volume }
  }
}
```

## ESP32 HTTP Call Pattern
```cpp
HTTPClient http;
http.begin("https://api.soundtrackyourbrand.com/v2");
http.addHeader("Content-Type", "application/json");
http.addHeader("Authorization", String("Bearer ") + TOKEN);
// POST GraphQL JSON body
int code = http.POST(payload);
http.end(); // ALWAYS close connection
```

## MCP Tools Available
- `search_account(name)` - Find account by name
- `list_locations(account_id)` - List locations
- `list_sound_zones(account_id)` - List zones with player status
- `set_volume(sound_zone_id, volume)` - Set volume 0-16
- `get_now_playing(sound_zone_id)` - Current track info
- `play/pause/skip_track(sound_zone_id)` - Playback control

## Volume Mapping Strategy
Map audio dB levels to 0-16 logarithmically with hysteresis:
- Define quiet/moderate/loud thresholds in dBFS
- Use exponential moving average for smoothing
- Only send API call when mapped volume actually changes
- Add +/-1 level hysteresis band to prevent jitter
