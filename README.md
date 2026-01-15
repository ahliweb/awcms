# AWCMS Monorepo

Welcome to the AWCMS monorepo. AWCMS is a multi-tenant CMS platform with admin, public, mobile, and IoT clients backed by Supabase.

## Project Structure

| Directory | Description | Tech Stack |
| --- | --- | --- |
| `awcms/` | Admin Panel | React 19.2.3, Vite 7, Supabase |
| `awcms-public/primary/` | Public Portal | Astro 5, React 19.2.3 |
| `awcms-mobile/primary/` | Mobile App | Flutter |
| `awcms-esp32/primary/` | IoT Firmware | ESP32, PlatformIO |
| `awcms-ext/` | External Extensions | JavaScript modules |
| `supabase/` | Migrations and Edge Functions | Supabase CLI |

## Quick Start

See the **[Developer Setup Guide](docs/dev/setup.md)** for detailed instructions.

- **Admin Panel**: [Guide](docs/dev/admin.md)
- **Public Portal**: [Guide](docs/dev/public.md)
- **Mobile App**: [Guide](docs/dev/mobile.md)
- **IoT Firmware**: [Guide](docs/dev/esp32.md)

## Documentation

- **[DOCS_INDEX.md](DOCS_INDEX.md)**: The central navigation for all documentation.
- **[AGENTS.md](AGENTS.md)**: Rules for AI agents.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

See `LICENSE`.
