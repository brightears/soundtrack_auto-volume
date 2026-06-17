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

// Get the account ID from NVS (empty string if not set)
String getAccountId();

// Erase stored WiFi + account ID (factory reset)
void resetProvisioning();

// Boot touch action (call during setup): short tap requests a WiFi change
// (preserves the Account ID), a long 5s hold performs a factory reset and
// restarts. Returns true if the user requested a WiFi change.
bool checkTouchAction(Arduino_GFX *gfx);
