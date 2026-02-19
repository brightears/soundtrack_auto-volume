#pragma once

// Audio settings
#define SAMPLE_RATE        16000
#define SAMPLE_BITS        16
#define I2S_READ_BUF_SIZE  1024    // Bytes per I2S read
#define DB_CALC_INTERVAL   100     // ms between dB calculations
#define DB_SEND_INTERVAL   500     // ms between WebSocket sends

// WebSocket server
#define WS_HOST    "soundtrack-auto-volume.onrender.com"
#define WS_PORT    443
#define WS_PATH    "/ws"
#define WS_USE_SSL true

// WiFi reconnect
#define WIFI_RETRY_DELAY   5000    // ms between reconnect attempts
#define WS_RETRY_DELAY     3000    // ms between WS reconnect attempts

// Device ID prefix
#define DEVICE_ID_PREFIX   "esp32-"
