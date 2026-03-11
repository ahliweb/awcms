# Tech Stack and Dependencies

> **Source of Truth**: [SYSTEM_MODEL.md](../../SYSTEM_MODEL.md) Section 1 - Technology Stack Mandates

## Purpose

Provide authoritative versions and technology choices for all AWCMS packages.

## Audience

- Developers validating compatibility
- Operators planning deployments

## Prerequisites

- [SYSTEM_MODEL.md](../../SYSTEM_MODEL.md) - Primary authority for tech stack
- [docs/architecture/standards.md](./standards.md) - Coding standards

## Reference

### Admin Panel (awcms)

| Category | Technology | Version | Purpose |
| --- | --- | --- | --- |
| Framework | React | 19.2.4 | UI framework |
| Build tool | Vite | 7.2.7 | SPA build and dev server |
| Language | JavaScript | ES2022+ | Functional components |
| Styling | TailwindCSS | 4.1.18 | Utility-first CSS |
| Visual editor | @puckeditor/core | 0.21.0 | Visual builder |
| Rich text | TipTap | 3.13.0 | WYSIWYG editor |
| Animations | Framer Motion | 12.23.26 | UI motion |
| Routing | React Router DOM | 7.10.1 | Client routing |
| Supabase JS | @supabase/supabase-js | 2.93.3 | API client |
| Maps | Leaflet + react-leaflet | 1.9.4 | Geolocation maps |
| File upload | react-dropzone | 14.3.8 | Drag-and-drop file uploads |
| Sanitization | DOMPurify | 3.3.1 | XSS sanitization |
| 2FA | otpauth | 9.4.1 | TOTP authentication |
| QR Codes | qrcode | 1.5.4 | QR code generation |

Admin styling uses TailwindCSS 4 with CSS-based configuration.

### Public Portal (awcms-public/primary)

| Category | Technology | Version | Purpose |
| --- | --- | --- | --- |
| Meta-framework | Astro | 5.17.1 | Static output + islands |
| UI library | React | 19.2.4 | Island rendering |
| Language | TypeScript | 5.8.3 (primary), 5.9.3 (smandapbun) | Typed components |
| Styling | TailwindCSS | 4.1.18 | Utility-first CSS |
| Supabase JS | @supabase/supabase-js | 2.93.3 | Public API client |
| Node.js | Node.js | >=22.12.0 | Runtime (OpenClaw requires v22+) |

Public styling uses TailwindCSS 4 via `@tailwindcss/vite`.

Tenant-specific public portals may pin different TypeScript minor versions (for example `awcms-public/smandapbun` uses 5.9.3).

### Backend and Edge

| Category | Technology | Version | Purpose |
| --- | --- | --- | --- |
| Database | PostgreSQL | 17 | Primary data store |
| Backend Platform | Supabase | 2.x | Auth, PostgREST, RLS, ABAC, realtime |
| Edge runtime | Cloudflare Workers | Current | Primary edge HTTP orchestration |

### Mobile (awcms-mobile/primary)

| Category | Technology | Version | Purpose |
| --- | --- | --- | --- |
| Framework | Flutter | 3.38.5 | Mobile app |
| State | Riverpod | 3.1.0 | State management |
| Supabase | supabase_flutter | 2.8.0 | Auth and data |
| Local DB | Drift | 2.30.0 | Offline cache |
| Routing | GoRouter | 17.0.1 | Navigation |

### IoT (awcms-esp32/primary)

| Category | Technology | Version | Purpose |
| --- | --- | --- | --- |
| Firmware | ESP32 | - | IoT device |
| Build | PlatformIO | - | Build and upload |

## Security and Compliance Notes

- React 19.2.4 is required for consistent behavior.
- Public portal uses PuckRenderer only; no editor runtime.

## References

- `docs/architecture/standards.md`
- `docs/modules/VERSIONING.md`

### AI Gateway (OpenClaw)

| Category | Technology | Version | Purpose |
| --- | --- | --- | --- |
| CLI | OpenClaw | 2026.2.21-2 | AI gateway and multi-agent routing |
| Runtime | Node.js | >=22.12.0 | OpenClaw requirement |
| Config | openclaw.json | — | Per-tenant agent isolation |
| Auth | Token + Rate Limit | — | 10 attempts/60s, 5min lockout |
