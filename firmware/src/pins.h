#pragma once

// I2C Bus (shared: ES8311, TCA9554, AXP2101, FT3168, QMI8658, PCF85063)
#define PIN_I2C_SDA     15
#define PIN_I2C_SCL     14

// I2S Audio (ES8311 codec)
#define PIN_I2S_MCLK    16
#define PIN_I2S_BCLK     9
#define PIN_I2S_LRCK    45
#define PIN_I2S_DIN     10  // Mic data: ES8311 -> ESP32
#define PIN_I2S_DOUT     8  // Speaker data: ESP32 -> ES8311
#define PIN_PA_ENABLE   46  // Speaker power amplifier enable

// QSPI Display (SH8601 AMOLED)
#define PIN_LCD_CS      12
#define PIN_LCD_SCLK    11
#define PIN_LCD_DATA0    4
#define PIN_LCD_DATA1    5
#define PIN_LCD_DATA2    6
#define PIN_LCD_DATA3    7

// Touch (FT3168)
#define PIN_TOUCH_INT   21

// Display dimensions
#define LCD_WIDTH      368
#define LCD_HEIGHT     448

// I2C Addresses
#define ADDR_TCA9554   0x20
#define ADDR_ES8311    0x18
#define ADDR_FT3168    0x38

// TCA9554 EXIO pin assignments
#define EXIO_DISPLAY_RST  2
#define EXIO_DISPLAY_EN   1
#define EXIO_PIN0         0
