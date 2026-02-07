> **Documentation Authority**: [SYSTEM_MODEL.md](../../SYSTEM_MODEL.md) Section 1 (Tech Stack)

# ESP32 Firmware Development

## 1. Overview

The IoT component (`awcms-esp32/`) provides firmware for ESP32 devices interacting with AWCMS.

## 2. Toolchain

- [SYSTEM_MODEL.md](../../SYSTEM_MODEL.md) - **Primary authority** for IoT/ESP32 tech stack
- [AGENTS.md](../../AGENTS.md) - Implementation patterns and Context7 references
- **Platform**: PlatformIO (VS Code Extension).
- **Framework**: Arduino / ESP-IDF.

## 3. Connectivity

- **WiFi**: Connects to local network.
- **MQTT/HTTP**: Communicates with Supabase Edge Functions or directly via REST (if using restricted service key, though recommended to go through Edge Function proxy for security).

## 4. Secrets

Never hardcode WiFi credentials or API keys. Use `include/secrets.h` or `.env` injection provided by PlatformIO build scripts.

## 5. Build & Flash

1. Open `awcms-esp32/primary` in VS Code.
2. PlatformIO > Project Tasks > Build.
3. PlatformIO > Project Tasks > Upload.
