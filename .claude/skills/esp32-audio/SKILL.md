---
name: esp32-audio
description: ES8311 audio codec and I2S microphone expertise for Waveshare ESP32-S3-Touch-AMOLED-1.8
---
# ESP32 Audio with ES8311 Codec

## Architecture
```
MEMS Mic -> ES8311 ADC (I2C control + I2S data) -> ESP32-S3
ESP32-S3 -> ES8311 DAC (I2S data) -> Speaker PA (TCA9554 controlled)
```

## ES8311 Configuration
- I2C Address: 0x18
- Must init I2C bus FIRST (Wire.begin(SDA=1, SCL=2, 400000))
- Must enable PA via TCA9554 (I2C: 0x20) before speaker output works
- Key registers: 0x00 (reset), 0x0D (ADC volume), 0x0E (ADC ctrl), 0x14 (mic gain)
- Mic gain range: 0dB to 42dB (ES8311_MIC_GAIN_42DB for max sensitivity)

## I2S Pin Assignments (VERIFY with schematic)
- MCLK: GPIO42
- BCLK: GPIO9
- LRCK (WS): GPIO45
- DIN (mic data in): GPIO10
- DOUT (speaker data out): GPIO8

## Audio Level Calculation
```cpp
// RMS calculation from I2S samples
int64_t sum_sq = 0;
for (int i = 0; i < num_samples; i++) {
    sum_sq += (int64_t)samples[i] * samples[i];
}
float rms = sqrt((float)sum_sq / num_samples);
float db = 20.0 * log10(rms / 32768.0); // dBFS
```

## Recommended Settings for Voice/Ambient Detection
- Sample rate: 16000 Hz
- Bits per sample: 16-bit
- Channel: Mono (I2S_CHANNEL_FMT_ONLY_LEFT)
- DMA buffers: 4 x 1024 samples
- Use APLL for accurate clocking
