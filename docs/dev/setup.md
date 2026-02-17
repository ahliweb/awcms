> **Documentation Authority**: [SYSTEM_MODEL.md](../../SYSTEM_MODEL.md) Section 1 (Tech Stack)

# Developer Setup Guide

## 1. Prerequisites

- [SYSTEM_MODEL.md](../../SYSTEM_MODEL.md) - **Primary authority** for technology stack and version requirements
- [AGENTS.md](../../AGENTS.md) - Implementation patterns and Context7 references
- **Node.js**: v20.0.0 or higher (LTS recommended)
- **npm**: v10+
- **Flutter**: v3.38.5+ (if working on mobile)
- **PlatformIO**: Core 6.1+ (if working on IoT)
- **Supabase CLI**: v2.70+ (install globally or use `npx supabase`)

## 2. Quick Start (Monorepo)

### 2.1 Clone the Repository

```bash
git clone <repository_url>
cd <repo-root>
```

### 2.2 Setup Environment Variables

Refer to `.env.example` in each directory. Public portal static builds require `PUBLIC_TENANT_ID` (or `VITE_PUBLIC_TENANT_ID`).

When pulling schema changes from Supabase, prefer:

```sh
npx supabase db pull --schema public,extensions
```

This avoids storage-managed objects that can churn migrations in local shadow databases.

For local schema changes, prefer:

```sh
npx supabase db push --local
```

If using Context7 tools via `awcms-mcp`, set `CONTEXT7_API_KEY` in `awcms/.env`.

### 2.3 Install Dependencies

We typically use `npm` for web projects and `flutter pub` for mobile.

```bash
# Admin Panel
cd awcms
npm install

# Public Portal (Primary Tenant)
cd ../awcms-public/primary
npm install
```

## 3. Running Locally

| Service | Command | Directory | Port |
| --- | --- | --- | --- |
| Admin Panel | `npm run dev` | `awcms/` | `3000` |
| Public Portal | `npm run dev` | `awcms-public/primary/` | `4321` |
| Mobile App | `flutter run` | `awcms-mobile/primary/` | Device/Emu |
| IoT Firmware | `pio run -t upload` | `awcms-esp32/primary/` | Serial |

### 3.1 Local Supabase Bootstrap (Admin)

Local admin development expects a tenant to resolve on `localhost`. The default dev slug is `primary` via `VITE_DEV_TENANT_SLUG`, so make sure the tenant exists before signing in.

```bash
# Start local Supabase
npx supabase start

# Seed the primary tenant (required for localhost)
node awcms/src/scripts/seed-primary-tenant.js

# Create or reset the default admin user
node awcms/src/scripts/create-admin-user.js

# Optional: grant owner role and seed menus/modules
node awcms/src/scripts/assign-owner-role.js
node awcms/src/scripts/seed-sidebar.js
```

`seed-sidebar.js` requires `VITE_SUPABASE_URL` and `SUPABASE_SECRET_KEY` in `awcms/.env.local`. Never expose the secret key in client code.

## 4. Linting & Formatting

We check code quality in CI. Run these before pushing:

```bash
# Admin
cd awcms
npm run lint

# Public
cd ../awcms-public/primary
npm run check
```
