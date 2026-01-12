# Folder Structure

## Purpose
Describe the monorepo layout and the key directories for each package.

## Audience
- Contributors navigating the codebase
- Operators locating deployment artifacts

## Prerequisites
- `awcms/docs/00-core/CORE_STANDARDS.md`

## Reference

### Monorepo Root

```text
awcms-dev/
├── awcms/                      # Admin panel (React + Vite)
├── awcms-public/               # Public portal (Astro)
│   └── primary/                # Astro project
├── awcms-mobile/               # Flutter app
│   └── primary/
├── awcms-esp32/                # ESP32 firmware
│   └── primary/
├── awcms-ext/                  # External extensions
├── supabase/                   # Migrations and edge functions
├── DOCS_INDEX.md               # Monorepo docs index
├── AGENTS.md                   # AI agent rules (SSOT)
└── schema_dump.sql             # Database reference snapshot
```

### Admin Panel (`awcms/`)

```text
awcms/
├── src/
│   ├── components/             # UI and module components
│   ├── contexts/               # Auth, permissions, tenant, theme
│   ├── hooks/                  # Data and feature hooks
│   ├── lib/                    # Supabase clients and utilities
│   ├── pages/                  # Route components
│   ├── plugins/                # Core plugins
│   └── templates/              # Admin templates
├── docs/                       # Admin documentation tree
├── supabase/                   # Legacy supabase artifacts (see SUPABASE_INTEGRATION)
├── package.json
└── vite.config.js
```

### Public Portal (`awcms-public/primary`)

```text
awcms-public/primary/
├── src/
│   ├── components/             # React components
│   ├── layouts/                # Astro layouts
│   ├── lib/                    # Supabase and URL helpers
│   ├── middleware.ts           # Tenant resolution
│   ├── pages/                  # Astro routes
│   └── templates/              # Theme templates
├── astro.config.mjs
└── tailwind.config.mjs
```

### Mobile (`awcms-mobile/primary`)

```text
awcms-mobile/primary/
├── lib/                        # Flutter source
├── android/                    # Android project
├── ios/                        # iOS project
└── pubspec.yaml
```

### ESP32 (`awcms-esp32/primary`)

```text
awcms-esp32/primary/
├── src/                        # Firmware
├── include/                    # Headers
├── data/                       # Web UI assets
└── platformio.ini
```

## Security and Compliance Notes

- Tenant isolation applies across all packages.
- Supabase is the only backend; no custom servers.

## References

- `../../../DOCS_INDEX.md`
- `../00-core/ARCHITECTURE.md`
