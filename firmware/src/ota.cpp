#include <Arduino.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <HTTPUpdate.h>
#include <Preferences.h>
#include <ArduinoJson.h>
#include <esp_ota_ops.h>
#include <esp_partition.h>

#include "config.h"
#include "ota.h"

// NVS namespace shared with provisioning (Preferences "autovolume").
static const char *NVS_NS = "autovolume";

static Arduino_GFX *s_gfx = nullptr;
static OtaHook s_before = nullptr;
static OtaHook s_after = nullptr;

static volatile bool s_forceCheck = false;
static unsigned long s_lastCheck = 0;
static unsigned long s_firstConnect = 0;
static bool s_didInitialCheck = false;

void otaInit(Arduino_GFX *gfx, OtaHook beforeUpdate, OtaHook afterFailedUpdate) {
  s_gfx = gfx;
  s_before = beforeUpdate;
  s_after = afterFailedUpdate;
}

void otaRequestCheck() { s_forceCheck = true; }

// --- small full-screen status helper (reuses main.cpp's palette values) ---
static void otaShowScreen(const char *line1, const char *line2, uint16_t color) {
  if (!s_gfx) return;
  s_gfx->fillScreen(0x0000);
  s_gfx->setTextSize(3);
  s_gfx->setTextColor(color);
  s_gfx->setCursor(20, 180);
  s_gfx->print(line1);
  if (line2) {
    s_gfx->setTextSize(2);
    s_gfx->setTextColor(0x7BEF);
    s_gfx->setCursor(20, 230);
    s_gfx->print(line2);
  }
}

// --- semantic version compare ("a.b.c"; ignores any -suffix) ---
static void parseVer(const String &v, int &a, int &b, int &c) {
  a = b = c = 0;
  sscanf(v.c_str(), "%d.%d.%d", &a, &b, &c);
}
static bool otaVersionNewer(const String &remote, const String &local) {
  int ra, rb, rc, la, lb, lc;
  parseVer(remote, ra, rb, rc);
  parseVer(local, la, lb, lc);
  if (ra != la) return ra > la;
  if (rb != lb) return rb > lb;
  return rc > lc;
}

void otaBootCheck() {
  Preferences prefs;
  prefs.begin(NVS_NS, false);
  uint8_t pend = prefs.getUChar("ota_pend", 0);
  if (pend) {
    uint8_t boots = prefs.getUChar("ota_boots", 0) + 1;
    prefs.putUChar("ota_boots", boots);
    Serial.printf("[ota] new image on probation (boot %u/%u)\n", boots, OTA_MAX_PROBATION_BOOTS);
    if (boots >= OTA_MAX_PROBATION_BOOTS) {
      // The new image never reached the server — roll back to the partition we
      // came from. This works WITHOUT a rollback-enabled bootloader because we
      // set the boot partition explicitly from app code.
      String prev = prefs.getString("ota_prev", "");
      prefs.putUChar("ota_pend", 0);
      prefs.putUChar("ota_boots", 0);
      prefs.end();
      Serial.printf("[ota] image failed to validate — reverting to %s\n", prev.c_str());
      if (prev.length() > 0) {
        const esp_partition_t *p = esp_partition_find_first(
            ESP_PARTITION_TYPE_APP, ESP_PARTITION_SUBTYPE_ANY, prev.c_str());
        if (p) esp_ota_set_boot_partition(p);
      }
      delay(200);
      ESP.restart();
      return;
    }
  }
  prefs.end();
}

void otaMarkValidIfPending() {
  Preferences prefs;
  prefs.begin(NVS_NS, false);
  if (prefs.getUChar("ota_pend", 0)) {
    prefs.putUChar("ota_pend", 0);
    prefs.putUChar("ota_boots", 0);
    Serial.println("[ota] new image validated — server reachable");
  }
  prefs.end();

  // If the bootloader supports rollback the image is in PENDING_VERIFY and must
  // be confirmed or it reverts on next boot. No-op on stock bootloaders (state
  // won't be PENDING_VERIFY); guarded so it doesn't log spurious errors.
  const esp_partition_t *running = esp_ota_get_running_partition();
  esp_ota_img_states_t st;
  if (running && esp_ota_get_state_partition(running, &st) == ESP_OK &&
      st == ESP_OTA_IMG_PENDING_VERIFY) {
    esp_ota_mark_app_valid_cancel_rollback();
  }
}

static void performUpdate(const String &binUrl) {
  Serial.printf("[ota] downloading %s\n", binUrl.c_str());
  otaShowScreen("Updating", "Please wait...", 0x07FF);

  if (s_before) s_before(); // drop the websocket so TLS has the heap it needs

  WiFiClientSecure client;
  client.setInsecure(); // TODO: pin Render's CA or enforce manifest md5 for stronger integrity
  httpUpdate.rebootOnUpdate(false);
  httpUpdate.onProgress([](int cur, int total) {
    static int lastPct = -1;
    int pct = total > 0 ? (cur * 100) / total : 0;
    if (pct != lastPct && pct % 5 == 0) {
      lastPct = pct;
      Serial.printf("[ota] %d%%\n", pct);
      if (s_gfx) {
        char buf[8];
        snprintf(buf, sizeof(buf), "%d%%", pct);
        s_gfx->fillRect(20, 230, 220, 40, 0x0000);
        s_gfx->setTextSize(3);
        s_gfx->setTextColor(0xFFFF);
        s_gfx->setCursor(20, 230);
        s_gfx->print(buf);
      }
    }
  });

  t_httpUpdate_return ret = httpUpdate.update(client, binUrl);
  if (ret == HTTP_UPDATE_OK) {
    // Image written and set as boot partition. Mark it on probation: it must
    // reach the server within OTA_MAX_PROBATION_BOOTS reboots or otaBootCheck()
    // reverts to the partition we are running right now.
    const esp_partition_t *running = esp_ota_get_running_partition();
    Preferences prefs;
    prefs.begin(NVS_NS, false);
    prefs.putString("ota_prev", running ? running->label : "");
    prefs.putUChar("ota_pend", 1);
    prefs.putUChar("ota_boots", 0);
    prefs.end();
    Serial.println("[ota] update written — rebooting into new image");
    otaShowScreen("Updated", "Restarting...", 0x07E0);
    delay(800);
    ESP.restart();
  } else {
    Serial.printf("[ota] update failed (%d): %s\n", ret,
                  httpUpdate.getLastErrorString().c_str());
    otaShowScreen("Update failed", "Staying on current", 0xFD20);
    delay(1500);
    if (s_after) s_after(); // bring the websocket back up
  }
}

static void otaCheckNow(const String &host) {
  if (WiFi.status() != WL_CONNECTED || host.length() == 0) return;
  String url = String("https://") + host + OTA_VERSION_PATH;
  Serial.printf("[ota] checking %s\n", url.c_str());

  WiFiClientSecure client;
  client.setInsecure();
  HTTPClient http;
  http.setConnectTimeout(8000);
  http.setTimeout(8000);
  if (!http.begin(client, url)) {
    Serial.println("[ota] http.begin failed");
    return;
  }
  int code = http.GET();
  if (code != HTTP_CODE_OK) {
    Serial.printf("[ota] version check HTTP %d\n", code);
    http.end();
    return;
  }
  String body = http.getString();
  http.end();

  JsonDocument doc;
  if (deserializeJson(doc, body) != DeserializationError::Ok) {
    Serial.println("[ota] bad manifest JSON");
    return;
  }
  const char *remoteVer = doc["version"] | "";
  const char *binUrl = doc["url"] | "";
  bool available = doc["available"] | true;
  if (!available || strlen(remoteVer) == 0 || strlen(binUrl) == 0) {
    Serial.println("[ota] no image published");
    return;
  }
  if (otaVersionNewer(String(remoteVer), String(FW_VERSION))) {
    Serial.printf("[ota] update available: %s -> %s\n", FW_VERSION, remoteVer);
    performUpdate(String(binUrl));
  } else {
    Serial.printf("[ota] up to date (local %s, remote %s)\n", FW_VERSION, remoteVer);
  }
}

void otaLoop(unsigned long now, bool wsConnected, const String &host) {
  if (!wsConnected) {
    s_firstConnect = 0; // restart the settle timer on the next reconnect
    return;
  }
  if (s_firstConnect == 0) s_firstConnect = now;

  // On-demand check (server pushed an "ota_check" message).
  if (s_forceCheck) {
    s_forceCheck = false;
    s_lastCheck = now;
    otaCheckNow(host);
    return;
  }

  // One check ~30s after settling online.
  if (!s_didInitialCheck && now - s_firstConnect >= OTA_INITIAL_DELAY_MS) {
    s_didInitialCheck = true;
    s_lastCheck = now;
    otaCheckNow(host);
    return;
  }

  // Periodic background check (only after the initial one has run).
  if (s_didInitialCheck && now - s_lastCheck >= OTA_CHECK_INTERVAL_MS) {
    s_lastCheck = now;
    otaCheckNow(host);
  }
}
