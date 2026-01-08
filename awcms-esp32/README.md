# AWCMS ESP32 IoT

Multi-tenant ESP32 firmware for AWCMS.

## Tenant Folders

Each tenant has its own folder with complete PlatformIO project:

| Tenant | Path | Description |
| :--- | :--- | :--- |
| primary | [primary/](./primary/) | Default tenant |

## Quick Start

```bash
cd awcms-esp32/primary
pio run -t upload
```

## Documentation

See [primary/README.md](./primary/README.md) for full documentation.
