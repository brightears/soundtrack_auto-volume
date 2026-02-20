#include <Arduino.h>
#include <Wire.h>
#include <WiFi.h>
#include <driver/i2s.h>
#include <WebSocketsClient.h>
#include <ArduinoJson.h>
#include <Adafruit_XCA9554.h>
#include <Arduino_GFX_Library.h>

#include "pins.h"
#include "config.h"
#include "provisioning.h"

// --- Display (QSPI SH8601 AMOLED) ---
Arduino_DataBus *qspi_bus = new Arduino_ESP32QSPI(
    PIN_LCD_CS, PIN_LCD_SCLK,
    PIN_LCD_DATA0, PIN_LCD_DATA1, PIN_LCD_DATA2, PIN_LCD_DATA3
);
Arduino_SH8601 *amoled = new Arduino_SH8601(qspi_bus, -1, 0, LCD_WIDTH, LCD_HEIGHT);
Arduino_GFX *gfx = amoled;

// --- Globals ---
Adafruit_XCA9554 expander;
WebSocketsClient ws;

static String deviceId;
static String wsHost;
static float currentDbFS = -60.0;
static bool wsConnected = false;
static bool wifiConnected = false;
static bool displayReady = false;
static unsigned long lastDbSend = 0;
static unsigned long lastDbCalc = 0;
static unsigned long lastDisplayUpdate = 0;
static unsigned long lastWiFiRetry = 0;
static int consecutiveWiFiFailures = 0;

#define I2S_PORT I2S_NUM_0
#define DISPLAY_UPDATE_INTERVAL 200  // ms between display redraws

// Colors
#define COLOR_BG       0x0000  // Black
#define COLOR_HEADER   0x2104  // Dark gray
#define COLOR_TEXT     0xFFFF  // White
#define COLOR_DIM      0x7BEF  // Gray
#define COLOR_GREEN    0x07E0
#define COLOR_RED      0xF800
#define COLOR_YELLOW   0xFFE0
#define COLOR_CYAN     0x07FF
#define COLOR_ORANGE   0xFD20
#define COLOR_BAR_BG   0x18E3  // Very dark gray

// --- Forward declarations ---
void initI2C();
void initTCA9554();
void initES8311();
void initI2S();
void initDisplay();
void initWebSocket();
void calculateDb();
void sendSoundLevel();
void updateDisplay();
void drawStaticUI();
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
  Serial.printf("Firmware: %s\n", FW_VERSION);

  initI2C();
  initTCA9554();
  initDisplay();

  // Generate device ID from MAC
  WiFi.mode(WIFI_STA);
  delay(100);
  uint8_t mac[6];
  WiFi.macAddress(mac);
  char macStr[13];
  snprintf(macStr, sizeof(macStr), "%02x%02x%02x%02x%02x%02x",
           mac[0], mac[1], mac[2], mac[3], mac[4], mac[5]);
  deviceId = String(DEVICE_ID_PREFIX) + macStr;
  Serial.printf("Device ID: %s\n", deviceId.c_str());

  // Check for factory reset (touch held at boot)
  checkTouchReset(gfx);

  initES8311();
  initI2S();

  // WiFi provisioning (replaces hardcoded initWiFi)
  bool connected = provisioningInit(gfx);
  if (connected) {
    wifiConnected = true;
    consecutiveWiFiFailures = 0;
    Serial.printf("WiFi connected! IP: %s\n", WiFi.localIP().toString().c_str());

    // Get server URL from NVS
    wsHost = getServerUrl();
    Serial.printf("Server: %s\n", wsHost.c_str());

    initWebSocket();

    // Draw normal UI
    if (displayReady) {
      gfx->fillScreen(COLOR_BG);
      drawStaticUI();
    }
  } else {
    Serial.println("WiFi not connected - will retry in loop");
  }

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
      consecutiveWiFiFailures++;
    }

    // After too many failures, re-enter provisioning
    if (consecutiveWiFiFailures >= MAX_WIFI_FAILURES) {
      Serial.println("Too many WiFi failures, re-entering setup...");
      consecutiveWiFiFailures = 0;
      bool connected = startCaptivePortal(gfx);
      if (connected) {
        wifiConnected = true;
        wsHost = getServerUrl();
        initWebSocket();
        if (displayReady) {
          gfx->fillScreen(COLOR_BG);
          drawStaticUI();
        }
      }
      return;
    }

    if (now - lastWiFiRetry >= WIFI_RETRY_DELAY) {
      lastWiFiRetry = now;
      Serial.printf("WiFi retry... (failures: %d/%d)\n", consecutiveWiFiFailures, MAX_WIFI_FAILURES);
      WiFi.reconnect();
    }

    // Still update display while waiting for WiFi
    if (displayReady && now - lastDisplayUpdate >= DISPLAY_UPDATE_INTERVAL) {
      lastDisplayUpdate = now;
      updateDisplay();
    }
    return;
  }

  if (!wifiConnected) {
    wifiConnected = true;
    consecutiveWiFiFailures = 0;
    Serial.printf("WiFi connected! IP: %s\n", WiFi.localIP().toString().c_str());
    Serial.printf("RSSI: %d dBm\n", WiFi.RSSI());

    wsHost = getServerUrl();
    initWebSocket();

    if (displayReady) {
      gfx->fillScreen(COLOR_BG);
      drawStaticUI();
    }
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

  // Update display
  if (displayReady && now - lastDisplayUpdate >= DISPLAY_UPDATE_INTERVAL) {
    lastDisplayUpdate = now;
    updateDisplay();
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

  expander.pinMode(EXIO_PIN0, OUTPUT);
  expander.pinMode(EXIO_DISPLAY_EN, OUTPUT);
  expander.pinMode(EXIO_DISPLAY_RST, OUTPUT);

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

// --- AMOLED Display Init ---
void initDisplay() {
  Serial.println("Init AMOLED display...");

  if (!gfx->begin()) {
    Serial.println("ERROR: Display init failed!");
    return;
  }

  amoled->setBrightness(255);
  gfx->fillScreen(COLOR_BG);
  displayReady = true;

  Serial.println("AMOLED display OK");
}

// --- Draw static parts of the UI (called once after WiFi connects) ---
void drawStaticUI() {
  // Header bar
  gfx->fillRect(0, 0, LCD_WIDTH, 40, COLOR_HEADER);
  gfx->setTextColor(COLOR_TEXT);
  gfx->setTextSize(2);
  gfx->setCursor(12, 10);
  gfx->print("Auto-Volume");

  // Divider
  gfx->drawFastHLine(0, 40, LCD_WIDTH, COLOR_DIM);

  // Section: Sound Level
  gfx->setTextColor(COLOR_DIM);
  gfx->setTextSize(1);
  gfx->setCursor(12, 54);
  gfx->print("SOUND LEVEL");

  // Section: Status
  gfx->setCursor(12, 258);
  gfx->print("STATUS");
  gfx->drawFastHLine(12, 270, LCD_WIDTH - 24, COLOR_HEADER);

  // Section: Device
  gfx->setCursor(12, 360);
  gfx->print("DEVICE");
  gfx->drawFastHLine(12, 372, LCD_WIDTH - 24, COLOR_HEADER);

  // Device ID (static)
  gfx->setTextColor(COLOR_DIM);
  gfx->setTextSize(1);
  gfx->setCursor(12, 382);
  gfx->print("ID: ");
  gfx->setTextColor(COLOR_TEXT);
  gfx->print(deviceId.c_str());
}

// --- Update dynamic parts of the display ---
void updateDisplay() {
  // --- dB value (large) ---
  gfx->fillRect(12, 72, 344, 60, COLOR_BG);
  gfx->setTextSize(5);

  uint16_t dbColor;
  if (currentDbFS > -15) {
    dbColor = COLOR_RED;
  } else if (currentDbFS > -30) {
    dbColor = COLOR_ORANGE;
  } else if (currentDbFS > -50) {
    dbColor = COLOR_GREEN;
  } else {
    dbColor = COLOR_DIM;
  }

  gfx->setTextColor(dbColor);
  gfx->setCursor(12, 74);
  char dbStr[16];
  snprintf(dbStr, sizeof(dbStr), "%.1f", currentDbFS);
  gfx->print(dbStr);

  // Unit label
  gfx->setTextSize(2);
  gfx->setTextColor(COLOR_DIM);
  gfx->setCursor(280, 90);
  gfx->print("dBFS");

  // --- Level bar ---
  int barX = 12;
  int barY = 145;
  int barW = LCD_WIDTH - 24;
  int barH = 30;

  float normalized = (currentDbFS + 90.0f) / 90.0f;
  if (normalized < 0) normalized = 0;
  if (normalized > 1) normalized = 1;
  int fillW = (int)(normalized * barW);

  gfx->fillRect(barX, barY, barW, barH, COLOR_BAR_BG);

  if (fillW > 0) {
    uint16_t barColor;
    if (normalized > 0.83f) barColor = COLOR_RED;
    else if (normalized > 0.67f) barColor = COLOR_ORANGE;
    else if (normalized > 0.44f) barColor = COLOR_YELLOW;
    else barColor = COLOR_GREEN;
    gfx->fillRect(barX, barY, fillW, barH, barColor);
  }

  // Scale markers
  gfx->setTextSize(1);
  gfx->setTextColor(COLOR_DIM);
  gfx->setCursor(barX, barY + barH + 4);
  gfx->print("-90");
  gfx->setCursor(barX + barW / 2 - 12, barY + barH + 4);
  gfx->print("-45");
  gfx->setCursor(barX + barW - 8, barY + barH + 4);
  gfx->print("0");

  // --- Peak indicator ---
  gfx->fillRect(12, 200, 344, 40, COLOR_BG);
  gfx->setTextSize(2);
  gfx->setTextColor(COLOR_DIM);
  gfx->setCursor(12, 210);
  gfx->print("Level: ");
  gfx->setTextColor(dbColor);
  if (currentDbFS > -15) gfx->print("LOUD");
  else if (currentDbFS > -30) gfx->print("MODERATE");
  else if (currentDbFS > -50) gfx->print("QUIET");
  else gfx->print("SILENT");

  // --- Status section ---
  gfx->fillRect(12, 278, 344, 70, COLOR_BG);
  gfx->setTextSize(2);

  // WiFi status
  gfx->setCursor(12, 280);
  gfx->setTextColor(COLOR_DIM);
  gfx->print("WiFi ");
  if (wifiConnected) {
    gfx->setTextColor(COLOR_GREEN);
    gfx->print("Connected");
    gfx->setTextSize(1);
    gfx->setTextColor(COLOR_DIM);
    gfx->setCursor(12, 300);
    gfx->printf("%s  %d dBm", WiFi.localIP().toString().c_str(), WiFi.RSSI());
  } else {
    gfx->setTextColor(COLOR_RED);
    gfx->print("Disconnected");
  }

  // WebSocket status
  gfx->setTextSize(2);
  gfx->setCursor(12, 320);
  gfx->setTextColor(COLOR_DIM);
  gfx->print("Server ");
  if (wsConnected) {
    gfx->setTextColor(COLOR_GREEN);
    gfx->print("Online");
  } else {
    gfx->setTextColor(COLOR_YELLOW);
    gfx->print("Offline");
  }

  // --- Uptime ---
  gfx->fillRect(12, 398, 344, 40, COLOR_BG);
  gfx->setTextSize(1);
  gfx->setTextColor(COLOR_DIM);
  gfx->setCursor(12, 400);
  unsigned long uptimeSec = millis() / 1000;
  unsigned long h = uptimeSec / 3600;
  unsigned long m = (uptimeSec % 3600) / 60;
  unsigned long s = uptimeSec % 60;
  gfx->printf("Uptime: %02lu:%02lu:%02lu", h, m, s);

  // FW version
  gfx->setCursor(12, 416);
  gfx->printf("FW: %s", FW_VERSION);
  gfx->setCursor(200, 416);
  gfx->printf("RSSI: %d", WiFi.RSSI());
}

// --- ES8311 Codec Init ---
void initES8311() {
  Serial.println("Init ES8311...");

  Wire.beginTransmission(ADDR_ES8311);
  if (Wire.endTransmission() != 0) {
    Serial.println("ERROR: ES8311 not found on I2C!");
    return;
  }

  uint8_t id1 = es8311Read(0xFD);
  uint8_t id2 = es8311Read(0xFE);
  Serial.printf("ES8311 Chip ID: 0x%02X 0x%02X\n", id1, id2);

  es8311Write(0x00, 0x1F);
  delay(20);
  es8311Write(0x00, 0x80);

  es8311Write(0x01, 0x3F);
  es8311Write(0x02, 0x00);
  es8311Write(0x03, 0x10);
  es8311Write(0x04, 0x10);
  es8311Write(0x05, 0x00);
  es8311Write(0x06, 0x03);
  es8311Write(0x07, 0x00);
  es8311Write(0x08, 0xFF);

  es8311Write(0x09, 0x0C);
  es8311Write(0x0A, 0x0C);

  es8311Write(0x0D, 0x01);
  es8311Write(0x0E, 0x02);
  es8311Write(0x12, 0x00);
  es8311Write(0x13, 0x10);
  es8311Write(0x14, 0x1A);

  // ADC (mic) registers - CRITICAL for microphone to work
  es8311Write(0x15, 0x40);  // ADC ramp rate
  es8311Write(0x16, 0x04);  // Mic PGA gain: 4 = 24dB (range: 0=0dB to 7=42dB)
  es8311Write(0x17, 0xBF);  // ADC enable + config (WITHOUT this, ADC stays off!)
  es8311Write(0x1C, 0x6A);  // ADC HPF config

  // DAC registers
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

// --- WebSocket Init ---
void initWebSocket() {
  Serial.printf("Init WebSocket to %s...\n", wsHost.c_str());

  if (WS_USE_SSL) {
    ws.beginSSL(wsHost.c_str(), WS_PORT, WS_PATH);
  } else {
    ws.begin(wsHost.c_str(), WS_PORT, WS_PATH);
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
        doc["firmware"] = FW_VERSION;
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

  int numFrames = bytesRead / 4;
  if (numFrames == 0) return;

  double sumSquares = 0;
  for (int i = 0; i < numFrames; i++) {
    int16_t sample = buf[i * 2];
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
