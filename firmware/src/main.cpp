#include <Arduino.h>
#include <Wire.h>
#include <WiFi.h>
#include <driver/i2s.h>
#include <WebSocketsClient.h>
#include <ArduinoJson.h>
#include <Adafruit_XCA9554.h>

#include "pins.h"
#include "config.h"
#include "secrets.h"

// --- Globals ---
Adafruit_XCA9554 expander;
WebSocketsClient ws;

static String deviceId;
static float currentDbFS = -60.0;
static bool wsConnected = false;
static bool wifiConnected = false;
static unsigned long lastDbSend = 0;
static unsigned long lastDbCalc = 0;
static unsigned long lastWiFiRetry = 0;

// I2S port
#define I2S_PORT I2S_NUM_0

// --- Forward declarations ---
void initI2C();
void initTCA9554();
void initES8311();
void initI2S();
void initWiFi();
void checkWiFi();
void initWebSocket();
void calculateDb();
void sendSoundLevel();
void webSocketEvent(WStype_t type, uint8_t *payload, size_t length);
const char* wifiStatusStr(wl_status_t status);

// --- ES8311 Register helpers ---
void es8311Write(uint8_t reg, uint8_t val) {
  Wire.beginTransmission(ADDR_ES8311);
  Wire.write(reg);
  Wire.write(val);
  Wire.endTransmission();
}

uint8_t es8311Read(uint8_t reg) {
  Wire.beginTransmission(ADDR_ES8311);
  Wire.write(reg);
  Wire.endTransmission(false);
  Wire.requestFrom((uint8_t)ADDR_ES8311, (uint8_t)1);
  return Wire.read();
}

// --- Setup ---
void setup() {
  Serial.begin(115200);
  delay(1000);
  Serial.println("\n=== Soundtrack Auto-Volume ESP32 ===");

  // Generate device ID from MAC
  uint8_t mac[6];
  WiFi.macAddress(mac);
  char macStr[13];
  snprintf(macStr, sizeof(macStr), "%02x%02x%02x%02x%02x%02x",
           mac[0], mac[1], mac[2], mac[3], mac[4], mac[5]);
  deviceId = String(DEVICE_ID_PREFIX) + macStr;
  Serial.printf("Device ID: %s\n", deviceId.c_str());

  initI2C();
  initTCA9554();
  initES8311();
  initI2S();
  initWiFi();
  // WebSocket will be initialized once WiFi connects (in loop)

  Serial.println("Setup complete!");
}

// --- Main loop ---
void loop() {
  unsigned long now = millis();

  // Check WiFi and reconnect if needed
  if (WiFi.status() != WL_CONNECTED) {
    if (wifiConnected) {
      Serial.println("WiFi lost!");
      wifiConnected = false;
    }
    if (now - lastWiFiRetry >= WIFI_RETRY_DELAY) {
      lastWiFiRetry = now;
      checkWiFi();
    }
    return;  // Don't do anything else until WiFi is up
  }

  if (!wifiConnected) {
    wifiConnected = true;
    Serial.printf("WiFi connected! IP: %s\n", WiFi.localIP().toString().c_str());
    Serial.printf("RSSI: %d dBm\n", WiFi.RSSI());
    initWebSocket();
  }

  ws.loop();

  // Calculate dB periodically
  if (now - lastDbCalc >= DB_CALC_INTERVAL) {
    lastDbCalc = now;
    calculateDb();
  }

  // Send sound level to server periodically
  if (now - lastDbSend >= DB_SEND_INTERVAL && wsConnected) {
    lastDbSend = now;
    sendSoundLevel();
  }
}

// --- I2C Init ---
void initI2C() {
  Serial.println("Init I2C...");
  Wire.begin(PIN_I2C_SDA, PIN_I2C_SCL);
  Wire.setClock(400000);
  Serial.println("I2C OK");
}

// --- TCA9554 IO Expander Init ---
void initTCA9554() {
  Serial.println("Init TCA9554...");
  if (!expander.begin(ADDR_TCA9554, &Wire)) {
    Serial.println("ERROR: TCA9554 not found!");
    return;
  }

  // Configure EXIO pins 0, 1, 2 as outputs
  expander.pinMode(EXIO_PIN0, OUTPUT);
  expander.pinMode(EXIO_DISPLAY_EN, OUTPUT);
  expander.pinMode(EXIO_DISPLAY_RST, OUTPUT);

  // Reset sequence: low -> wait -> high
  expander.digitalWrite(EXIO_PIN0, LOW);
  expander.digitalWrite(EXIO_DISPLAY_EN, LOW);
  expander.digitalWrite(EXIO_DISPLAY_RST, LOW);
  delay(20);
  expander.digitalWrite(EXIO_PIN0, HIGH);
  expander.digitalWrite(EXIO_DISPLAY_EN, HIGH);
  expander.digitalWrite(EXIO_DISPLAY_RST, HIGH);
  delay(100);

  Serial.println("TCA9554 OK");
}

// --- ES8311 Codec Init ---
void initES8311() {
  Serial.println("Init ES8311...");

  // Verify chip presence
  Wire.beginTransmission(ADDR_ES8311);
  if (Wire.endTransmission() != 0) {
    Serial.println("ERROR: ES8311 not found on I2C!");
    return;
  }

  // Read chip ID
  uint8_t id1 = es8311Read(0xFD);
  uint8_t id2 = es8311Read(0xFE);
  Serial.printf("ES8311 Chip ID: 0x%02X 0x%02X\n", id1, id2);

  // Reset
  es8311Write(0x00, 0x1F);
  delay(20);
  es8311Write(0x00, 0x80);  // Normal operation

  // Clock config for 16kHz, MCLK = 256 * 16000 = 4.096MHz
  es8311Write(0x01, 0x3F);  // MCLK from pin, not inverted
  es8311Write(0x02, 0x00);  // Pre-divider = 1
  es8311Write(0x03, 0x10);
  es8311Write(0x04, 0x10);
  es8311Write(0x05, 0x00);
  es8311Write(0x06, 0x03);  // BCLK config
  es8311Write(0x07, 0x00);
  es8311Write(0x08, 0xFF);

  // I2S format: standard, 16-bit
  es8311Write(0x09, 0x0C);  // DAC SDP
  es8311Write(0x0A, 0x0C);  // ADC SDP

  // Power up
  es8311Write(0x0D, 0x01);
  es8311Write(0x0E, 0x02);
  es8311Write(0x12, 0x00);
  es8311Write(0x13, 0x10);
  es8311Write(0x14, 0x1A);

  // ADC (microphone)
  es8311Write(0x1C, 0x6A);
  es8311Write(0x16, 0x24);  // Mic gain ~18dB

  // DAC volume
  es8311Write(0x32, 0xBF);
  es8311Write(0x37, 0x08);

  Serial.println("ES8311 OK");
}

// --- I2S Init (ESP-IDF driver) ---
void initI2S() {
  Serial.println("Init I2S...");

  i2s_config_t i2s_config = {
    .mode = (i2s_mode_t)(I2S_MODE_MASTER | I2S_MODE_RX | I2S_MODE_TX),
    .sample_rate = SAMPLE_RATE,
    .bits_per_sample = I2S_BITS_PER_SAMPLE_16BIT,
    .channel_format = I2S_CHANNEL_FMT_RIGHT_LEFT,
    .communication_format = I2S_COMM_FORMAT_STAND_I2S,
    .intr_alloc_flags = ESP_INTR_FLAG_LEVEL1,
    .dma_buf_count = 4,
    .dma_buf_len = 256,
    .use_apll = false,
    .tx_desc_auto_clear = true,
    .fixed_mclk = 0,
    .mclk_multiple = I2S_MCLK_MULTIPLE_256,
    .bits_per_chan = I2S_BITS_PER_CHAN_16BIT,
  };

  i2s_pin_config_t pin_config = {
    .mck_io_num = PIN_I2S_MCLK,
    .bck_io_num = PIN_I2S_BCLK,
    .ws_io_num = PIN_I2S_LRCK,
    .data_out_num = PIN_I2S_DOUT,
    .data_in_num = PIN_I2S_DIN,
  };

  esp_err_t err = i2s_driver_install(I2S_PORT, &i2s_config, 0, NULL);
  if (err != ESP_OK) {
    Serial.printf("ERROR: I2S driver install failed: %d\n", err);
    return;
  }

  err = i2s_set_pin(I2S_PORT, &pin_config);
  if (err != ESP_OK) {
    Serial.printf("ERROR: I2S set pin failed: %d\n", err);
    return;
  }

  i2s_zero_dma_buffer(I2S_PORT);
  Serial.println("I2S OK");
}

// --- WiFi status to string ---
const char* wifiStatusStr(wl_status_t status) {
  switch (status) {
    case WL_IDLE_STATUS:     return "IDLE";
    case WL_NO_SSID_AVAIL:   return "NO_SSID_AVAIL";
    case WL_SCAN_COMPLETED:  return "SCAN_COMPLETED";
    case WL_CONNECTED:       return "CONNECTED";
    case WL_CONNECT_FAILED:  return "CONNECT_FAILED";
    case WL_CONNECTION_LOST: return "CONNECTION_LOST";
    case WL_DISCONNECTED:    return "DISCONNECTED";
    default:                 return "UNKNOWN";
  }
}

// --- WiFi event callback for diagnostics ---
void onWiFiEvent(WiFiEvent_t event, WiFiEventInfo_t info) {
  switch (event) {
    case ARDUINO_EVENT_WIFI_STA_START:
      Serial.println("[WiFi] STA started");
      break;
    case ARDUINO_EVENT_WIFI_STA_CONNECTED:
      Serial.println("[WiFi] Connected to AP!");
      break;
    case ARDUINO_EVENT_WIFI_STA_DISCONNECTED:
      Serial.printf("[WiFi] Disconnected - reason: %d\n",
                    info.wifi_sta_disconnected.reason);
      // Common reasons: 2=AUTH_EXPIRE, 15=4WAY_HANDSHAKE_TIMEOUT (wrong pwd),
      //   201=NO_AP_FOUND, 202=AUTH_FAIL (wrong pwd)
      break;
    case ARDUINO_EVENT_WIFI_STA_GOT_IP:
      Serial.printf("[WiFi] Got IP: %s\n", WiFi.localIP().toString().c_str());
      break;
    default:
      break;
  }
}

// --- WiFi Init ---
void initWiFi() {
  Serial.printf("Connecting to WiFi: '%s' (pwd len: %d)\n", WIFI_SSID, (int)strlen(WIFI_PASSWORD));

  // Register WiFi event handler for diagnostics
  WiFi.onEvent(onWiFiEvent);

  WiFi.disconnect(true);
  delay(100);
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  delay(100);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  // Wait up to 15 seconds for initial connection
  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 30) {
    delay(500);
    Serial.print(".");
    if (attempts % 10 == 9) {
      Serial.printf(" [%s]\n", wifiStatusStr(WiFi.status()));
    }
    attempts++;
  }

  if (WiFi.status() == WL_CONNECTED) {
    wifiConnected = true;
    Serial.printf("\nWiFi connected! IP: %s\n", WiFi.localIP().toString().c_str());
    Serial.printf("RSSI: %d dBm, Channel: %d\n", WiFi.RSSI(), WiFi.channel());
    initWebSocket();
  } else {
    Serial.printf("\nWiFi not connected yet (status: %s) - will keep retrying\n", wifiStatusStr(WiFi.status()));
  }
}

// --- WiFi reconnect check ---
void checkWiFi() {
  wl_status_t status = WiFi.status();
  Serial.printf("WiFi retry... (status: %s)\n", wifiStatusStr(status));

  WiFi.disconnect(true);
  delay(100);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  // Quick check - don't block the loop for too long
  for (int i = 0; i < 20; i++) {
    delay(500);
    if (WiFi.status() == WL_CONNECTED) {
      Serial.printf("WiFi reconnected! IP: %s\n", WiFi.localIP().toString().c_str());
      return;
    }
  }
  Serial.printf("WiFi retry failed (status: %s)\n", wifiStatusStr(WiFi.status()));
}

// --- WebSocket Init ---
void initWebSocket() {
  Serial.println("Init WebSocket...");

  if (WS_USE_SSL) {
    ws.beginSSL(WS_HOST, WS_PORT, WS_PATH);
  } else {
    ws.begin(WS_HOST, WS_PORT, WS_PATH);
  }

  ws.onEvent(webSocketEvent);
  ws.setReconnectInterval(WS_RETRY_DELAY);
  Serial.println("WebSocket init done");
}

// --- WebSocket Event Handler ---
void webSocketEvent(WStype_t type, uint8_t *payload, size_t length) {
  switch (type) {
    case WStype_DISCONNECTED:
      Serial.println("WS disconnected");
      wsConnected = false;
      break;

    case WStype_CONNECTED:
      Serial.printf("WS connected to %s\n", (char *)payload);
      wsConnected = true;
      {
        JsonDocument doc;
        doc["type"] = "register";
        doc["deviceId"] = deviceId;
        doc["firmware"] = "1.0.0";
        String json;
        serializeJson(doc, json);
        ws.sendTXT(json);
        Serial.println("Sent register message");
      }
      break;

    case WStype_TEXT:
      Serial.printf("WS received: %s\n", (char *)payload);
      break;

    case WStype_ERROR:
      Serial.println("WS error");
      break;

    default:
      break;
  }
}

// --- Calculate dBFS from I2S mic data ---
void calculateDb() {
  static int16_t buf[I2S_READ_BUF_SIZE / 2];
  size_t bytesRead = 0;

  esp_err_t err = i2s_read(I2S_PORT, buf, I2S_READ_BUF_SIZE, &bytesRead, 10);
  if (err != ESP_OK || bytesRead == 0) return;

  // 16-bit stereo: L, R, L, R, ...
  int numFrames = bytesRead / 4;  // 4 bytes per stereo frame
  if (numFrames == 0) return;

  // RMS of left channel
  double sumSquares = 0;
  for (int i = 0; i < numFrames; i++) {
    int16_t sample = buf[i * 2];  // Left channel
    sumSquares += (double)sample * sample;
  }

  double rms = sqrt(sumSquares / numFrames);
  if (rms < 1.0) rms = 1.0;

  float dbFS = 20.0f * log10f((float)(rms / 32767.0));
  currentDbFS = dbFS;
}

// --- Send sound level via WebSocket ---
void sendSoundLevel() {
  JsonDocument doc;
  doc["type"] = "sound_level";
  doc["deviceId"] = deviceId;
  doc["dbFS"] = round(currentDbFS * 10.0) / 10.0;

  String json;
  serializeJson(doc, json);
  ws.sendTXT(json);
}
