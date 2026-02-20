# Soundtrack Auto-Volume

## Project Overview
Multi-component system: ESP32-S3 reads ambient sound levels via microphone, sends data to a backend server, which automatically adjusts music volume on Soundtrack Your Brand sound zones. Clients get a web frontend to configure which zones are auto-controlled.

**Phase 1:** ESP32 mic -> Backend server -> Soundtrack API volume control + Client frontend
**Phase 2:** Language detection and other audio intelligence features

## System Architecture
```
ESP32 Device          Backend (Render)           Soundtrack API
┌──────────┐    WS    ┌──────────────┐  GraphQL  ┌────────────┐
│ Mic/I2S  │───────>  │ Express + WS │────────>  │ set_volume │
│ AMOLED UI│  <───────│ Volume logic │           │ 0-16 range │
│ WiFi     │  config  │ PostgreSQL   │           └────────────┘
└──────────┘          │ Static frontend│
                      └──────────────┘
```

## Live Deployment
- **Server:** https://soundtrack-auto-volume.onrender.com
- **WebSocket:** wss://soundtrack-auto-volume.onrender.com/ws
- **API:** /api/devices, /api/configs, /api/soundtrack/accounts
- **Render service:** srv-d6bim8d6ubrc73cl2890 (starter, Singapore)
- **Render DB:** dpg-d6bim795pdvs73f7e68g-a (basic_256mb, Singapore)

## Components

### 1. Backend Server (`/server`) - COMPLETE
- **Stack:** Node.js + TypeScript + Express + ws + Prisma
- **Build:** `cd server && npm install --include=dev && npx prisma generate && npm run build`
- **Start:** `cd server && npx prisma db push && npm run start`
- **Dev:** `cd server && npm run dev`
- **Verify:** `cd server && npx tsc --noEmit`

### 2. Frontend (`/server/public/`) - COMPLETE
- Single-page Alpine.js + Tailwind CSS (CDN, no build step)
- Tabs: Devices, Configure, Monitor
- Served as static files by Express

### 3. ESP32 Firmware (`/firmware`) - COMPILES & FLASHES
- **Hardware:** Waveshare ESP32-S3-Touch-AMOLED-1.8
- **MCU:** ESP32-S3R8, dual-core LX7 @ 240MHz, 16MB Flash, 8MB PSRAM
- **Audio:** ES8311 codec (I2C: 0x18, chip ID: 0x83 0x11) + MEMS mic
  - ADC MUST be enabled via reg 0x17=0xBF (without it mic returns silence)
  - Mic PGA gain at reg 0x16: 0=0dB to 7=42dB (currently 4=24dB)
- **Display:** 1.8" AMOLED 368x448 (SH8601, QSPI), touch: FT3168 (I2C: 0x38)
- **I2C Bus (VERIFIED):** SDA=GPIO15, SCL=GPIO14
- **I2S Audio (VERIFIED):** MCLK=GPIO16, BCLK=GPIO9, LRCK=GPIO45, DIN=GPIO10, DOUT=GPIO8
- **Speaker PA:** GPIO46
- **Framework:** Arduino via PlatformIO (Arduino-ESP32 v3.x via pioarduino platform v54.03.21-2)
- **Display Library:** Arduino_GFX (`GFX Library for Arduino` by moononournation v1.6.5)
  - Driver: `Arduino_SH8601` + `Arduino_ESP32QSPI` bus
  - Constructor: `Arduino_SH8601(bus, rst, rotation, width, height)` — NO `bool ips` param
  - MUST pass LCD_WIDTH=368, LCD_HEIGHT=448 (default 480x480 is wrong for this board)
  - TCA9554 EXIO pins: pin0=general, pin1=display enable, pin2=display reset
- **Device ID:** esp32-ccba9711a79c (MAC: cc:ba:97:11:a7:9c)
- IMPORTANT: ESP32-S3 only supports 2.4GHz WiFi (NOT 5GHz!)

## Soundtrack API - IMPORTANT
- **Auth:** Basic auth (`Authorization: Basic <token>`), NOT OAuth2 token exchange
- The SOUNDTRACK_API_TOKEN is Base64-encoded client_id:client_secret
- **Endpoint:** `https://api.soundtrackyourbrand.com/v2` (GraphQL)
- **Accounts query:** `me { ... on PublicAPIClient { accounts(first:N) { ... } } }`
- Account field is `businessName` (not `name`)
- Connection fields REQUIRE `first: N` or `last: N` pagination param
- Volume: 0-16 integer (17 steps), ~0.5-2s cloud latency
- Master account connects to 900+ client accounts
- **setVolume mutation:** `setVolume(input: { soundZone: "id", volume: N })`
  - Uses custom `Volume` scalar type — MUST inline values in query string, NOT GraphQL variables
  - `$volume: Int!` and `$volume: Volume!` both FAIL — only inline works
  - Returns "Not found" if the player/zone is **offline** (not a permissions issue)
- **Test account:** BMAsia Unlimited DEMO (`QWNjb3VudCwsMThjdHE4b2t4czAv`)

## Credentials & Secrets
- ALL in `.env` (GITIGNORED) - NEVER commit
- ESP32 WiFi creds in firmware `secrets.h` (GITIGNORED)
- GitHub: https://github.com/brightears/soundtrack_auto-volume.git

## Build Commands
```bash
# ESP32 Firmware (PlatformIO)
cd firmware && ~/.platformio/penv/bin/pio run                    # Build
cd firmware && ~/.platformio/penv/bin/pio run --target upload    # Flash
cd firmware && ~/.platformio/penv/bin/pio device monitor         # Serial monitor (115200)
# Serial via Python (when pio monitor fails in pipes):
~/.platformio/penv/bin/python3 -c "import serial,time; s=serial.Serial('/dev/cu.usbmodem2101',115200,timeout=1); [print(s.readline().decode('utf-8',errors='replace').strip()) for _ in range(50) if time.sleep(0.1) is None]; s.close()"

# Server
cd server && npm run dev                  # Development (tsx watch)
cd server && npm run build                # Production build
cd server && npx tsc --noEmit             # Type check only
```

## Coding Conventions
- ESP32: C++ with `#define` pin defs in `pins.h`, I2C addrs in `config.h`
- Server: TypeScript strict mode, Express Router pattern, Prisma for DB
- Frontend: Alpine.js + Tailwind (CDN), no build step
- Error handling: always check return values, handle WiFi/API failures gracefully
- Use FreeRTOS tasks on ESP32 for concurrent audio + network

## Key Gotchas
- TCA9554 IO expander MUST init before ES8311 audio on ESP32
- Render `npm install` skips devDeps → build command uses `--include=dev`
- tsconfig needs `"types": ["node"]` for Node.js globals
- Soundtrack GraphQL `locations(first:50)` - pagination is required, not optional
- Arduino-ESP32 v3.x: `WiFi.macAddress()` returns zeros BEFORE `WiFi.mode()` — read MAC after
- pioarduino v54.03.21-2 is the working PlatformIO platform (v51=ESP-IDF too old, v53=postinstall bug)
- `driver/i2s.h` is deprecated in v3.x but still compiles (warning only)
- Arduino_SH8601 constructor has NO `bool ips` param — 4th arg is width, 5th is height
- Upload port: `/dev/cu.usbmodem2101`
