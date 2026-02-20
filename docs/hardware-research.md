# Waveshare ESP32-S3-Touch-AMOLED-1.8 - Hardware Research

## Official Resources
- Wiki: https://www.waveshare.com/wiki/ESP32-S3-Touch-AMOLED-1.8
- Product page: https://www.waveshare.com/esp32-s3-touch-amoled-1.8.htm
- Schematic PDF: https://files.waveshare.com/wiki/ESP32-S3-Touch-AMOLED-1.8/ESP32-S3-Touch-AMOLED-1.8.pdf
- GitHub examples: https://github.com/waveshareteam/ESP32-S3-Touch-AMOLED-1.8

## Core Processor
| Spec | Detail |
|------|--------|
| MCU | ESP32-S3R8 (Xtensa LX7 dual-core) |
| Frequency | Up to 240 MHz |
| SRAM | 512KB |
| ROM | 384KB |
| PSRAM | 8MB (onboard, Octal SPI) |
| Flash | 16MB (external NOR) |
| WiFi | 802.11 b/g/n, 2.4GHz |
| Bluetooth | BLE 5.0 |
| USB | Native USB-OTG (Type-C) |

## I2C Bus (Shared - All Devices)
| Device | I2C Address | Function |
|--------|-------------|----------|
| ES8311 | 0x18 | Audio codec |
| TCA9554 | 0x20 | IO expander |
| AXP2101 | 0x34 | Power management |
| FT3168 | 0x38 | Touch controller |
| PCF85063 | 0x51 | RTC |
| QMI8658 | 0x6A | 6-axis IMU |

**I2C Pins:** SDA = GPIO15, SCL = GPIO14 (verified working)

## I2S Audio (ES8311 Codec) - VERIFIED
| Signal | GPIO | Direction |
|--------|------|-----------|
| MCLK | GPIO16 | Output (master clock to codec) |
| BCLK | GPIO9 | Output (bit clock) |
| LRCK/WS | GPIO45 | Output (word select) |
| DIN | GPIO10 | Input (mic data FROM codec) |
| DOUT | GPIO8 | Output (speaker data TO codec) |
| PA_EN | GPIO46 | Speaker power amplifier enable |

**ES8311 Critical Notes:**
- Register 0x17 = 0xBF MUST be written to enable ADC (without it, mic returns near-zero)
- Register 0x16 = PGA gain (0=0dB to 7=42dB, currently using 4=24dB)
- Ambient reads ~-77 to -80 dBFS, talking ~-50, loud ~-30

## Display (QSPI - SH8601 AMOLED) - VERIFIED
| Signal | GPIO |
|--------|------|
| CS | GPIO12 |
| SCLK | GPIO11 |
| D0 | GPIO4 |
| D1 | GPIO5 |
| D2 | GPIO6 |
| D3 | GPIO7 |
| RST | Via TCA9554 P2 |
| EN | Via TCA9554 P1 |

**Resolution:** 368 x 448 pixels
**Constructor:** `Arduino_SH8601(bus, -1, 0, 368, 448)` — 4th/5th args are width/height, NOT bool!
**Brightness:** `amoled->setBrightness(255)` on typed `Arduino_SH8601*` pointer

## TCA9554 IO Expander (I2C: 0x20) - VERIFIED
| Pin | Function |
|-----|----------|
| P0 | General (set HIGH at boot) |
| P1 | Display Enable |
| P2 | Display Reset |
| P3-P7 | Various / SD card |

**Init sequence:** Set P0/P1/P2 LOW → delay 20ms → Set HIGH → delay 100ms

## SD Card (SPI Mode)
| Signal | Pin |
|--------|-----|
| CS | EXIO7 (via TCA9554) |
| MOSI | GPIO1 |
| MISO | GPIO3 |
| SCLK | GPIO2 |

## Battery & Power
- Connector: MX1.25 2P (3.7V LiPo)
- Recommended: 3.85x24x28mm, 400mAh
- Charging via AXP2101 + USB-C
- Runtime: ~1hr full brightness, ~6hrs low-power

## Datasheets
- [ES8311](https://files.waveshare.com/wiki/common/ES8311.DS.pdf)
- [SH8601](https://files.waveshare.com/wiki/common/SH8601A0_DataSheet_Preliminary_V0.0_UCS_191107_1_.pdf)
- [FT3168](https://files.waveshare.com/wiki/common/FT3168.pdf)
- [QMI8658](https://files.waveshare.com/wiki/common/QMI8658C.pdf)
- [PCF85063](https://files.waveshare.com/wiki/common/PCF85063A.pdf)
- [AXP2101](https://files.waveshare.com/wiki/common/X-power-AXP2101_SWcharge_V1.0.pdf)

## Key Libraries (Arduino) - Currently Used
| Library | Version | Purpose |
|---------|---------|---------|
| ArduinoJson | ^7 | JSON parsing |
| WebSockets | ^2.4 | WebSocket client |
| Adafruit XCA9554 | ^1.0.0 | IO expander |
| GFX Library for Arduino | ^1.6.1 | Display (SH8601 QSPI AMOLED) |
| WiFiManager (tzapu) | 2.0.17 | Captive portal WiFi provisioning |
| Preferences | built-in | NVS storage for server URL |

**Platform:** pioarduino v54.03.21-2 (Arduino-ESP32 v3.x, ESP-IDF v5.4)

## Performance
- Arduino LVGL: ~50-60 fps
- ESP-IDF LVGL: 200-300 fps (double buffer + DMA)
- Normal operating temp: ~36C, max ~46C with WiFi + charging
