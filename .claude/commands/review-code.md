Use a subagent to review the code for embedded systems best practices.

Review the following for ESP32 embedded systems issues:
$(find src/ -name "*.cpp" -o -name "*.h" 2>/dev/null | head -20)

Focus on:
- Memory safety and buffer management
- I2C/I2S correctness
- WiFi connection handling
- FreeRTOS task safety
- Resource cleanup
