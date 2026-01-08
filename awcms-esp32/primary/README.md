# Primary Tenant Configuration

This folder contains tenant-specific configuration for the **primary** tenant.

## Environment

Create `config.h` with tenant-specific settings:

```cpp
#define TENANT_CODE "primary"
#define TENANT_DOMAIN "primaryesp32.ahliweb.com"
#define API_BASE_URL "https://imveukxxtdwjgwsafwfl.supabase.co"
```

## Build

```bash
# Using PlatformIO
pio run -e primary

# Upload to device
pio run -e primary -t upload
```

## API Configuration

The ESP32 device uses the `tenant_channels` table for domain resolution:

- Channel: `esp32`
- Domain: `primaryesp32.ahliweb.com`
- Base Path: `/awcms-esp32/primary/`

## Device Registration

Each ESP32 device must be registered with:

1. Device UUID
2. Tenant ID (`primary`)
3. API credentials
