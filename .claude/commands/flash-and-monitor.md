Flash the firmware to the connected ESP32-S3 and start serial monitoring:

1. Run `pio run --target upload` to flash
2. If flash fails, check USB connection and suggest fixes
3. Run `pio device monitor --baud 115200` to start monitoring
4. Report the first 20 lines of serial output
