#pragma once

#include <Arduino.h>
#include <Arduino_GFX_Library.h>

// Hook type used to tear down / restore the websocket around an update so the
// TLS download has the heap it needs. (Plain function pointers — no captures.)
typedef void (*OtaHook)();

// Wire up the display and the before/after-failure hooks. Call once in setup().
void otaInit(Arduino_GFX *gfx, OtaHook beforeUpdate, OtaHook afterFailedUpdate);

// Call FIRST in setup() (right after the banner). If a freshly-flashed image has
// failed to reach the server across OTA_MAX_PROBATION_BOOTS reboots, this reverts
// the boot partition to the previous (known-good) image and restarts. Safe no-op
// when no update is on probation.
void otaBootCheck();

// Call when the server connection succeeds — clears probation so a healthy new
// image is kept (and confirms it if the bootloader supports rollback).
void otaMarkValidIfPending();

// Call every loop() with the current time, websocket state, and server host.
// Performs a check ~30s after coming online, then every OTA_CHECK_INTERVAL_MS,
// or immediately when otaRequestCheck() was called. Blocks during a download.
void otaLoop(unsigned long now, bool wsConnected, const String &host);

// Request an immediate update check (e.g. from a server "ota_check" message).
// Honored on the next otaLoop() so the check never runs inside a WS callback.
void otaRequestCheck();
