# Soundtrack Auto-Volume

## Project Overview
Multi-component system: ESP32-S3 reads ambient sound levels via microphone, sends data to a backend server, which automatically adjusts music volume on Soundtrack Your Brand sound zones. Clients get a web frontend to configure which zones are auto-controlled.

**Phase 1:** ESP32 mic -> Backend server -> Soundtrack API volume control + Client frontend
**Phase 2:** Language detection and other audio intelligence features

## System Architecture
```
┌─────────────────────┐     ┌──────────────────────┐     ┌─────────────────────┐
│  ESP32-S3 Device    │     │  Backend (Render)     │     │  Soundtrack API     │
│  - Reads mic level  │────>│  - Receives levels    │────>│  - Sets volume      │
│  - Sends to server  │     │  - Maps to volume     │     │  - Per sound zone   │
│  - Shows UI on      │     │  - Stores config      │     │                     │
│    AMOLED display    │     │  - Serves frontend    │     │  GraphQL endpoint   │
└─────────────────────┘     │  - PostgreSQL DB      │     └─────────────────────┘
                            └──────────────────────┘
                                      │
                            ┌──────────────────────┐
                            │  Frontend (Web UI)    │
                            │  - Pick client acct   │
                            │  - Select sound zone  │
                            │  - Turn on/off        │
                            │  - Configure thresholds│
                            └──────────────────────┘
```

## Components

### 1. ESP32 Firmware (`/firmware`)
- **Hardware:** Waveshare ESP32-S3-Touch-AMOLED-1.8
- **MCU:** ESP32-S3R8, dual-core LX7 @ 240MHz, 16MB Flash, 8MB PSRAM
- **Audio:** ES8311 codec (I2C: 0x18) + MEMS mic, I2S interface
- **Display:** 1.8" AMOLED 368x448 (SH8601, QSPI), touch: FT3168 (I2C: 0x38)
- **I2C Bus:** SDA=GPIO1, SCL=GPIO2 (shared by ES8311, TCA9554, AXP2101, FT3168, QMI8658, PCF85063)
- **I2S Audio:** MCLK=GPIO42, BCLK=GPIO9, LRCK=GPIO45, DIN=GPIO10, DOUT=GPIO8
- **Framework:** Arduino via PlatformIO
- IMPORTANT: Pin numbers from research - VERIFY against official schematic before flashing

### 2. Backend Server (`/server`)
- **Runtime:** Node.js or Python (TBD in plan)
- **Hosting:** Render (web service)
- **Database:** PostgreSQL on Render
- **Responsibilities:** Receive ESP32 sound levels, apply volume logic, call Soundtrack API, serve frontend, manage client configs
- **Soundtrack API:** GraphQL at `https://api.soundtrackyourbrand.com/v2`, volume 0-16

### 3. Frontend (`/frontend`)
- **Type:** Web app (React or similar, TBD in plan)
- **Hosting:** Render static site or served by backend
- **Features:** Client account picker, zone selector, on/off toggle, threshold config

## Credentials & Secrets
- ALL credentials in `.env` (GITIGNORED)
- Soundtrack API: OAuth 2.0 Bearer token (client_id + client_secret in .env)
- Render API key in .env
- ESP32 WiFi creds in firmware `secrets.h` (GITIGNORED)
- NEVER commit .env or secrets.h

## Repository
- **GitHub:** https://github.com/brightears/soundtrack_auto-volume.git
- **Deployment:** Render (backend + DB + frontend)
- We have MCP tools for both Soundtrack and Render

## Build Commands
```bash
# ESP32 Firmware
cd firmware && pio run                    # Build
cd firmware && pio run --target upload    # Flash
cd firmware && pio device monitor         # Serial monitor

# Server (TBD based on framework choice)
# Frontend (TBD based on framework choice)
```

## Coding Conventions
- ESP32 firmware: C++ with `#define` pin defs in `pins.h`, I2C addrs in `config.h`
- Server: TBD (Node.js/Python conventions)
- Frontend: TBD (React/Vue conventions)
- Error handling: always check return values, handle WiFi/API failures gracefully
- Use FreeRTOS tasks on ESP32 for concurrent audio sampling + server communication

## Verification
- ESP32: `pio run` must compile cleanly after changes
- Server: run tests after changes
- Frontend: build must succeed
- Integration: test end-to-end with real ESP32 + Soundtrack zone

## Important Notes
- Soundtrack volume is 0-16 (coarse, 17 steps) with ~0.5-2s cloud latency
- Map audio levels logarithmically (human perception is logarithmic)
- Debounce volume changes to max 1 per 1-2 seconds
- TCA9554 IO expander MUST init before audio on ESP32
- Master Soundtrack API account connects to multiple client accounts
- Each client picks their own account + sound zone to control
