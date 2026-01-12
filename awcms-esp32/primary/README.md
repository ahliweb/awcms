# AWCMS ESP32 Firmware

## Purpose
Firmware for ESP32 devices sending telemetry to Supabase.

## Prerequisites
- PlatformIO

## Quick Start

```bash
cd awcms-esp32/primary
cp .env.example .env
source .env && pio run -t uploadfs && pio run -t upload
```

## Environment Variables

```ini
WIFI_SSID=...
WIFI_PASSWORD=...
SUPABASE_URL=...
SUPABASE_ANON_KEY=...
AUTH_PASSWORD=...
```

## Security Notes

- Never hardcode credentials in source.
- Use build-time secrets from `.env`.

## References

- `../../DOCS_INDEX.md`
