# AWCMS ESP32 IoT Firmware

ESP32-based IoT firmware with **secure credential storage**.

## Security Features

| Feature | Implementation |
| :------ | :------------- |
| Build-time secrets | `.env` + PlatformIO flags |
| String obfuscation | XOR in `security.h` |
| Authentication | Basic Auth + API key |
| Multi-tenant | Tenant ID isolation |

## Quick Start

1. **Copy environment file:**

   ```bash
   cp .env.example .env
   ```

2. **Edit `.env` with your credentials:**

   ```ini
   WIFI_SSID=YourWiFi
   WIFI_PASSWORD=YourPassword
   SUPABASE_URL=https://xxx.supabase.co
   SUPABASE_ANON_KEY=eyJxxx...
   AUTH_PASSWORD=your-secure-password
   ```

3. **Build and upload:**

   ```bash
   source .env && pio run -t uploadfs && pio run -t upload
   ```

## Project Structure

```text
awcms-esp32/
├── .env              # Secrets (NOT in git)
├── .env.example      # Template
├── include/
│   ├── config.h      # Uses build flags
│   ├── security.h    # Obfuscation
│   ├── auth.h        # Authentication
│   └── ...
└── data/             # Web UI
```

## Tenant Folders

Tenant-specific configuration lives under `/{tenant_code}/`:

```text
awcms-esp32/
  primary/              # Default tenant
    README.md           # Tenant config docs
  src/                  # Shared firmware code
```

See [primary/README.md](./primary/README.md) for tenant-specific setup.

## API Endpoints

| Endpoint | Auth | Description |
| :------- | :--- | :---------- |
| `/` | No | Dashboard |
| `/api/gas` | Yes | Gas sensor |
| `/capture` | Yes | Camera |
| `/api/restart` | Yes | Reboot |

## Anti-Reverse Engineering

- Credentials injected at compile time
- Not hardcoded in source code
- String obfuscation available
- For production: Enable ESP32 Flash Encryption

## License

MIT
