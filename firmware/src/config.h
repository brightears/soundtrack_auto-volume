#pragma once

// Audio settings
#define SAMPLE_RATE        16000
#define SAMPLE_BITS        16
#define I2S_READ_BUF_SIZE  1024    // Bytes per I2S read
#define DB_CALC_INTERVAL   100     // ms between dB calculations
#define DB_SEND_INTERVAL   500     // ms between WebSocket sends
// Energy-domain smoothing (short Leq) so the level tracks sustained loudness
// instead of jumping on each transient/quiet sample. ~tau = DB_CALC_INTERVAL/alpha
// = 100ms/0.2 = ~0.5s.
#define AUDIO_ENERGY_ALPHA 0.2

// WebSocket server (default, can be overridden via captive portal)
#define DEFAULT_WS_HOST    "soundtrack-auto-volume.onrender.com"
#define WS_PORT            443
#define WS_PATH            "/ws"
#define WS_USE_SSL         true

// WiFi reconnect
#define WIFI_RETRY_DELAY   5000    // ms between reconnect attempts
#define WS_RETRY_DELAY     3000    // ms between WS reconnect attempts
// Re-open the (non-destructive) setup portal after sustained inability to connect.
// Fewer retries when we have no known-good network yet (first-time / bad creds) so
// setup is re-offered promptly; many more once creds were good, so a transient
// outage recovers via STA reconnect instead of popping the portal.
#define WIFI_RETRIES_FRESH      3   // x WIFI_RETRY_DELAY ~15s before portal (never connected)
#define WIFI_RETRIES_CONNECTED  60  // x WIFI_RETRY_DELAY ~5min before portal (known-good creds)

// Device ID prefix
#define DEVICE_ID_PREFIX   "esp32-"

// Firmware version
#define FW_VERSION         "2.6.0"

// OTA (over-the-air firmware update). The device polls a manifest on the server
// and self-updates when a newer version is published. D'ARK's beta unit ships on
// 2.5.0 (no OTA client); OTA is exercised on the spare/dev unit first.
#define OTA_VERSION_PATH        "/api/firmware/version"  // GET {version,url,md5,available}
#define OTA_INITIAL_DELAY_MS    30000UL     // wait 30s after coming online before first check
#define OTA_CHECK_INTERVAL_MS   21600000UL  // re-check every 6 hours
#define OTA_MAX_PROBATION_BOOTS 3           // reboots a new image gets to reach the server before revert

// NVS keys
#define NVS_KEY_ACCOUNT    "account_id"

// Provisioning
#define AP_NAME_PREFIX     "AutoVolume-"
#define PORTAL_TIMEOUT     180     // seconds before portal times out
#define MAX_WIFI_FAILURES  5       // consecutive failures before re-provisioning
#define TOUCH_RESET_HOLD_MS 5000   // ms to hold touch for factory reset
