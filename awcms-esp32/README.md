# AWCMS ESP32

## Purpose

ESP32 firmware for IoT telemetry in AWCMS.

## Prerequisites

- PlatformIO Core 6.1+

## Quick Start

```bash
cd awcms-esp32/primary
cp .env.example .env
source .env && pio run -t uploadfs && pio run -t upload
```

## Notes

- The maintained firmware lives in `awcms-esp32/primary`.
- Device builds use publishable credentials and per-device auth material only; never ship `SUPABASE_SECRET_KEY` to hardware.

## References

- `primary/README.md`
- `../DOCS_INDEX.md`
- `../docs/dev/esp32.md`
