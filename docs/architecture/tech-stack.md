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
| Build tool | Vite | `^8.0.1` | SPA build and dev server |
| Language | JavaScript | ES2022+ | Functional components |
| Styling | TailwindCSS | `^4.2.2` | Utility-first CSS |
| Visual editor | @puckeditor/core | 0.21.0 | Visual builder |
| Rich text | TipTap | `^3.20.4` | WYSIWYG editor (distributed as `@tiptap/react`, `@tiptap/starter-kit`, and extension packages — no single `@tiptap/core` import) |
| Animations | Framer Motion | `^12.38.0` | UI motion |
| Routing | React Router DOM | 7.10.1 | Client routing |
| Supabase JS | @supabase/supabase-js | `^2.99.3` | API client |
| Maps | Leaflet + react-leaflet | 1.9.4 | Geolocation maps |
| File upload | react-dropzone | 15.0.0 | Drag-and-drop file uploads |
| Sanitization | DOMPurify | 3.3.3 | XSS sanitization |
| 2FA | otpauth | 9.4.1 | TOTP authentication |
| QR Codes | qrcode | 1.5.4 | QR code generation |

Admin styling uses TailwindCSS 4 with CSS-based configuration.

### Public Portal (awcms-public/primary)

| Category | Technology | Version | Purpose |
| --- | --- | --- | --- |
| Meta-framework | Astro | `6.0.8` | Static output + islands |
| UI library | React | 19.2.4 | Island rendering |
| Language | TypeScript | `^5.8.3` (primary), `^5.9.3` (smandapbun) | Typed components |
| Styling | TailwindCSS | `^4.2.2` | Utility-first CSS |
| Supabase JS | @supabase/supabase-js | `^2.99.3` | Public API client |
| Node.js | Node.js | >=22.22.2 | Runtime baseline for AWCMS and OpenClaw |

Public styling uses TailwindCSS 4 via `@tailwindcss/vite`.

`awcms-public/smandapbun` now aligns on Astro `6.0.8`, Tailwind `^4.2.2`, and `@supabase/supabase-js` `^2.99.3`.

### Backend and Edge

| Category | Technology | Version | Purpose |
| --- | --- | --- | --- |
| Database | PostgreSQL | 17 | Primary data store |
| Backend Platform | Supabase | 2.x | Auth, PostgREST, RLS, ABAC, realtime |
| Edge runtime | Cloudflare Workers | Current | Primary edge HTTP orchestration |
| Edge CLI | Wrangler | `^4.77.0` | Cloudflare Worker dev server and deploy tool (`awcms-edge/`) |

### Mobile (awcms-mobile/primary)

| Category | Technology | Version | Purpose |
| --- | --- | --- | --- |
| Framework | Flutter | 3.38.5 | Mobile app |
| State | flutter_riverpod | `^2.6.1` | State management |
| Supabase | supabase_flutter | `^2.8.0` | Auth and data |
| Local DB | drift + drift_flutter | `^2.32.0` / `^0.3.0` | Offline cache |
| Routing | go_router | `^17.1.0` | Navigation |

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
| Runtime | Node.js | >=22.22.2 | Standardized AWCMS/OpenClaw runtime |
| Config | openclaw.json | — | Per-tenant agent isolation |
| Auth | Token + Rate Limit | — | 10 attempts/60s, 5min lockout |
