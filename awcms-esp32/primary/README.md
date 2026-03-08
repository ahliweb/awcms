# AWCMS ESP32 Firmware

## Purpose

Firmware for ESP32 devices sending telemetry and configuration updates through AWCMS edge endpoints.

## Prerequisites

- PlatformIO Core 6.1+

## Quick Start

```bash
cd awcms-esp32/primary
cp .env.example .env
source .env && pio run -t uploadfs && pio run -t upload
```

## Common Commands

- `pio run -e dev` - compile the development environment
- `pio run -e dev -t upload` - flash firmware to the connected device
- `pio device monitor` - open the serial monitor

## Environment Variables

```ini
WIFI_SSID=...
WIFI_PASSWORD=...
SUPABASE_URL=...
SUPABASE_PUBLISHABLE_KEY=...
DEVICE_ID=...
DEVICE_NAME=...
TENANT_ID=...
AUTH_USERNAME=...
AUTH_PASSWORD=...
```

## Security Notes

- Never hardcode credentials in source.
- Use build-time secrets from `.env`.
- Keep `.env`, generated firmware credentials, and any `secrets.h`-style files out of Git.
- Device builds must never include `SUPABASE_SECRET_KEY`.

## References

- `../../DOCS_INDEX.md`
- `../../docs/dev/esp32.md`
