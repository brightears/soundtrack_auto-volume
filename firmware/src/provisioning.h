#pragma once

#include <Arduino.h>
#include <Arduino_GFX_Library.h>

// Display states
enum DisplayState {
  DISPLAY_PROVISIONING,
  DISPLAY_CONNECTING,
  DISPLAY_NORMAL,
  DISPLAY_WIFI_FAILED,
};

// Initialize WiFi provisioning — replaces initWiFi()
// Returns true if WiFi connected, false if portal is running
bool provisioningInit(Arduino_GFX *gfx);

// Start captive portal for WiFi setup
bool startCaptivePortal(Arduino_GFX *gfx);

// Get the server URL from NVS (fallback to DEFAULT_WS_HOST)
String getServerUrl();

// Erase stored WiFi + server URL (factory reset)
void resetProvisioning();

// Check if touch is held for factory reset (call during setup)
bool checkTouchReset(Arduino_GFX *gfx);
