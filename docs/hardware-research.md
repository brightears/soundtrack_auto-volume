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

**I2C Pins:** SDA = GPIO1, SCL = GPIO2

## I2S Audio (ES8311 Codec)
| Signal | GPIO | Direction |
|--------|------|-----------|
| MCLK | GPIO42 | Output (master clock to codec) |
| BCLK | GPIO9 | Output (bit clock) |
| LRCK/WS | GPIO45 | Output (word select) |
| DIN | GPIO10 | Input (mic data FROM codec) |
| DOUT | GPIO8 | Output (speaker data TO codec) |

**NOTE:** These pins are from ESPHome configurations for similar Waveshare boards. VERIFY against official schematic before use.

## Display (QSPI - SH8601)
| Signal | GPIO |
|--------|------|
| CS | GPIO 9 (TBD - may conflict with I2S BCLK, verify!) |
| SCK | GPIO 10 |
| D0 | GPIO 11 |
| D1 | GPIO 12 |
| D2 | GPIO 13 |
| D3 | GPIO 14 |
| RST | Via TCA9554 P0 |
| TE | GPIO 8 |

**IMPORTANT:** Display and I2S may share some GPIOs depending on board revision. Must verify with schematic.

## TCA9554 IO Expander (I2C: 0x20)
| Pin | Typical Function |
|-----|-----------------|
| P0 | AMOLED Reset |
| P1 | Touch Reset |
| P2 | Audio PA Enable |
| P3 | Sensor power enable |
| P4 | PWR button detect (EXIO4) |
| P5-P7 | Various / SD card (EXIO7) |

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

## Key Libraries (Arduino)
| Library | Version | Purpose |
|---------|---------|---------|
| Arduino_DriveBus | - | Bus abstraction |
| GFX_Library_for_Arduino | v1.4.9 | Display |
| ESP32_IO_Expander | v0.0.3 | TCA9554 |
| LVGL | v8.4.0 | GUI framework |
| SensorLib | v0.2.1 | IMU |
| XPowersLib | v0.2.6 | AXP2101 PMIC |
| ArduinoJson | v7 | JSON parsing |

## Performance
- Arduino LVGL: ~50-60 fps
- ESP-IDF LVGL: 200-300 fps (double buffer + DMA)
- Normal operating temp: ~36C, max ~46C with WiFi + charging
