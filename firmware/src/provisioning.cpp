#include "provisioning.h"
#include "config.h"
#include "pins.h"

#include <WiFi.h>
#include <WiFiManager.h>
#include <Preferences.h>
#include <Wire.h>

static Preferences prefs;
static const char* NVS_NAMESPACE = "autovolume";
// NVS_KEY_ACCOUNT defined in config.h

// Colors (matching main.cpp)
#define COLOR_BG       0x0000
#define COLOR_TEXT     0xFFFF
#define COLOR_DIM      0x7BEF
#define COLOR_GREEN    0x07E0
#define COLOR_YELLOW   0xFFE0
#define COLOR_CYAN     0x07FF
#define COLOR_HEADER   0x2104

// Draw provisioning screen on AMOLED
static void drawProvisioningScreen(Arduino_GFX *gfx, const char* apName) {
  gfx->fillScreen(COLOR_BG);

  // Header
  gfx->fillRect(0, 0, LCD_WIDTH, 40, COLOR_HEADER);
  gfx->setTextColor(COLOR_TEXT);
  gfx->setTextSize(2);
  gfx->setCursor(12, 10);
  gfx->print("Auto-Volume");

  // Setup icon area
  gfx->setTextSize(3);
  gfx->setTextColor(COLOR_CYAN);
  gfx->setCursor(LCD_WIDTH / 2 - 80, 80);
  gfx->print("SETUP");

  gfx->setTextSize(2);
  gfx->setTextColor(COLOR_TEXT);
  gfx->setCursor(12, 140);
  gfx->print("Connect to WiFi:");

  gfx->setTextSize(2);
  gfx->setTextColor(COLOR_GREEN);
  gfx->setCursor(12, 175);
  gfx->print(apName);

  gfx->setTextSize(1);
  gfx->setTextColor(COLOR_DIM);
  gfx->setCursor(12, 220);
  gfx->print("1. Connect your phone to the");
  gfx->setCursor(12, 236);
  gfx->print("   WiFi network shown above");
  gfx->setCursor(12, 260);
  gfx->print("2. A setup page will open");
  gfx->setCursor(12, 276);
  gfx->print("   automatically");
  gfx->setCursor(12, 300);
  gfx->print("3. Select your WiFi network,");
  gfx->setCursor(12, 316);
  gfx->print("   enter password & Account ID");

  gfx->setTextColor(COLOR_YELLOW);
  gfx->setCursor(12, 360);
  gfx->print("Setup times out in 3 minutes");
}

// Draw connecting screen
static void drawConnectingScreen(Arduino_GFX *gfx, const char* ssid, int attempt, int maxAttempts) {
  gfx->fillScreen(COLOR_BG);

  gfx->fillRect(0, 0, LCD_WIDTH, 40, COLOR_HEADER);
  gfx->setTextColor(COLOR_TEXT);
  gfx->setTextSize(2);
  gfx->setCursor(12, 10);
  gfx->print("Auto-Volume");

  gfx->setTextSize(2);
  gfx->setTextColor(COLOR_YELLOW);
  gfx->setCursor(LCD_WIDTH / 2 - 90, 120);
  gfx->print("Connecting...");

  gfx->setTextSize(2);
  gfx->setTextColor(COLOR_TEXT);
  gfx->setCursor(12, 180);
  gfx->print("WiFi: ");
  gfx->setTextColor(COLOR_CYAN);
  gfx->print(ssid);

  if (maxAttempts > 0) {
    gfx->setTextSize(1);
    gfx->setTextColor(COLOR_DIM);
    gfx->setCursor(12, 220);
    char buf[32];
    snprintf(buf, sizeof(buf), "Attempt %d / %d", attempt, maxAttempts);
    gfx->print(buf);
  }
}

// Draw WiFi failed screen
static void drawWiFiFailedScreen(Arduino_GFX *gfx) {
  gfx->fillScreen(COLOR_BG);

  gfx->fillRect(0, 0, LCD_WIDTH, 40, COLOR_HEADER);
  gfx->setTextColor(COLOR_TEXT);
  gfx->setTextSize(2);
  gfx->setCursor(12, 10);
  gfx->print("Auto-Volume");

  gfx->setTextSize(2);
  gfx->setTextColor(0xF800); // Red
  gfx->setCursor(LCD_WIDTH / 2 - 72, 120);
  gfx->print("WiFi Failed");

  gfx->setTextSize(1);
  gfx->setTextColor(COLOR_DIM);
  gfx->setCursor(12, 180);
  gfx->print("Re-entering setup mode...");
}

String getAccountId() {
  prefs.begin(NVS_NAMESPACE, true); // read-only
  String id = prefs.getString(NVS_KEY_ACCOUNT, "");
  prefs.end();
  return id;
}

void resetProvisioning() {
  Serial.println("Factory reset: erasing WiFi + account ID");
  prefs.begin(NVS_NAMESPACE, false);
  prefs.clear();
  prefs.end();

  // Also clear WiFiManager stored creds
  WiFi.disconnect(true, true); // disconnect + erase
  delay(100);
}

bool startCaptivePortal(Arduino_GFX *gfx) {
  // Generate AP name from MAC
  uint8_t mac[6];
  WiFi.macAddress(mac);
  char apName[32];
  snprintf(apName, sizeof(apName), "%s%02X%02X", AP_NAME_PREFIX, mac[4], mac[5]);

  Serial.printf("Starting captive portal: %s\n", apName);

  // Pre-scan networks for iOS captive portal detection
  Serial.println("Pre-scanning WiFi networks...");
  WiFi.mode(WIFI_STA);
  WiFi.scanNetworks(true); // async scan
  delay(3000); // Wait for scan to complete (critical for iOS)
  WiFi.scanDelete();

  // Draw provisioning screen
  if (gfx) {
    drawProvisioningScreen(gfx, apName);
  }

  WiFiManager wm;

  // Custom parameter for Account ID
  WiFiManagerParameter accountParam("account", "Soundtrack Account ID", "", 128);
  wm.addParameter(&accountParam);

  wm.setConfigPortalTimeout(PORTAL_TIMEOUT);
  wm.setConnectTimeout(20);

  // Start portal
  bool connected = wm.autoConnect(apName);

  if (connected) {
    Serial.println("WiFi connected via portal!");

    // Save Account ID to NVS — mandatory field
    String accountId = String(accountParam.getValue());
    accountId.trim();
    if (accountId.length() == 0) {
      Serial.println("Account ID is required but was not provided. Restarting portal...");
      WiFi.disconnect(true);
      delay(500);
      return startCaptivePortal(gfx); // re-enter portal
    }

    prefs.begin(NVS_NAMESPACE, false);
    prefs.putString(NVS_KEY_ACCOUNT, accountId);
    prefs.end();
    Serial.printf("Account ID saved: %s\n", accountId.c_str());

    return true;
  }

  Serial.println("Portal timed out or failed");
  return false;
}

bool provisioningInit(Arduino_GFX *gfx) {
  WiFi.mode(WIFI_STA);
  delay(100);

  // Check if we have stored WiFi credentials
  // WiFiManager stores creds automatically; try connecting first
  String ssid = WiFi.SSID();

  if (ssid.length() > 0) {
    // We have stored credentials, try to connect
    Serial.printf("Found stored WiFi: '%s', connecting...\n", ssid.c_str());

    if (gfx) {
      drawConnectingScreen(gfx, ssid.c_str(), 1, MAX_WIFI_FAILURES);
    }

    WiFi.begin(); // Uses stored credentials
    int attempts = 0;
    while (WiFi.status() != WL_CONNECTED && attempts < 30) {
      delay(500);
      Serial.print(".");
      attempts++;
    }

    if (WiFi.status() == WL_CONNECTED) {
      Serial.printf("\nWiFi connected! IP: %s\n", WiFi.localIP().toString().c_str());
      return true;
    }

    Serial.println("\nStored WiFi failed, starting captive portal...");
    if (gfx) {
      drawWiFiFailedScreen(gfx);
      delay(2000);
    }
  } else {
    Serial.println("No stored WiFi credentials, starting captive portal...");
  }

  // No credentials or failed to connect — start portal
  return startCaptivePortal(gfx);
}

bool checkTouchReset(Arduino_GFX *gfx) {
  // Configure touch interrupt pin
  pinMode(PIN_TOUCH_INT, INPUT_PULLUP);

  // Give touch controller time to initialize after power-up
  delay(300);

  // Set device mode to working/normal mode (register 0x00 = 0x00)
  Wire.beginTransmission(ADDR_FT3168);
  Wire.write(0x00);
  Wire.write(0x00);
  Wire.endTransmission();
  delay(200);

  // Show reset hint on display
  if (gfx) {
    gfx->setTextSize(1);
    gfx->setTextColor(COLOR_DIM);
    gfx->setCursor(12, LCD_HEIGHT - 16);
    gfx->print("Touch screen now to factory reset...");
  }

  // Poll for touch a few times (controller may need time)
  uint8_t touchCount = 0;
  for (int i = 0; i < 10; i++) {
    Wire.beginTransmission(ADDR_FT3168);
    Wire.write(0x02); // Touch count register
    Wire.endTransmission(false);
    Wire.requestFrom((uint8_t)ADDR_FT3168, (uint8_t)1);

    if (Wire.available()) {
      touchCount = Wire.read();
      int intPin = digitalRead(PIN_TOUCH_INT);
      Serial.printf("Touch poll %d: count=%d INT=%d\n", i, touchCount, intPin);
      // FT3168 INT goes LOW on touch
      if (touchCount > 0 || intPin == LOW) {
        touchCount = touchCount > 0 ? touchCount : 1;
        break;
      }
    }
    delay(200);
  }

  // Clear hint text
  if (gfx) {
    gfx->fillRect(0, LCD_HEIGHT - 20, LCD_WIDTH, 20, COLOR_BG);
  }

  if (touchCount > 0) {
      Serial.println("Touch detected at boot - hold for 5s to factory reset...");

      if (gfx) {
        gfx->fillScreen(COLOR_BG);
        gfx->setTextSize(2);
        gfx->setTextColor(COLOR_YELLOW);
        gfx->setCursor(12, 120);
        gfx->print("Hold to reset...");
      }

      unsigned long start = millis();
      bool held = true;

      while (millis() - start < TOUCH_RESET_HOLD_MS) {
        delay(100);

        // Check if still touching
        Wire.beginTransmission(ADDR_FT3168);
        Wire.write(0x02);
        Wire.endTransmission(false);
        Wire.requestFrom((uint8_t)ADDR_FT3168, (uint8_t)1);

        if (Wire.available()) {
          if (Wire.read() == 0) {
            held = false;
            break;
          }
        }

        // Update progress
        if (gfx) {
          int progress = (int)(((millis() - start) * 100) / TOUCH_RESET_HOLD_MS);
          int barW = (int)(progress * (LCD_WIDTH - 24) / 100);
          gfx->fillRect(12, 180, LCD_WIDTH - 24, 20, 0x18E3);
          gfx->fillRect(12, 180, barW, 20, 0xF800);

          gfx->setTextSize(1);
          gfx->setTextColor(COLOR_DIM);
          gfx->fillRect(12, 210, 200, 16, COLOR_BG);
          gfx->setCursor(12, 210);
          char buf[32];
          int remaining = (TOUCH_RESET_HOLD_MS - (millis() - start)) / 1000;
          snprintf(buf, sizeof(buf), "Release in %ds to cancel", remaining);
          gfx->print(buf);
        }
      }

      if (held) {
        Serial.println("Factory reset triggered!");
        if (gfx) {
          gfx->fillScreen(COLOR_BG);
          gfx->setTextSize(2);
          gfx->setTextColor(0xF800);
          gfx->setCursor(12, 120);
          gfx->print("Factory Reset!");
          gfx->setTextSize(1);
          gfx->setTextColor(COLOR_DIM);
          gfx->setCursor(12, 160);
          gfx->print("Restarting...");
        }
        resetProvisioning();
        delay(1500);
        ESP.restart();
        return true; // won't reach here
      }

      Serial.println("Touch released before 5s - continuing normal boot");
  }

  return false;
}
