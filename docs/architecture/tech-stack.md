# Tech Stack and Dependencies

## Purpose

Provide authoritative versions and technology choices for all AWCMS packages.

## Audience

- Developers validating compatibility
- Operators planning deployments

## Prerequisites

- `docs/architecture/standards.md`

## Reference

### Admin Panel (awcms)

| Category | Technology | Version | Purpose |
| --- | --- | --- | --- |
| Framework | React | 19.2.4 | UI framework |
| Build tool | Vite | 7.2.7 | SPA build and dev server |
| Language | JavaScript | ES2022+ | Functional components |
| Styling | TailwindCSS | 4.1.18 | Utility-first CSS |
| Visual editor | @puckeditor/puck | 0.21.0 | Visual builder |
| Rich text | TipTap | 3.13.0 | WYSIWYG editor |
| Animations | Framer Motion | 12.23.26 | UI motion |
| Routing | React Router DOM | 7.10.1 | Client routing |
| Supabase JS | @supabase/supabase-js | 2.87.1 | API client |

Admin styling uses TailwindCSS 4 with CSS-based configuration.

### Public Portal (awcms-public/primary)

| Category | Technology | Version | Purpose |
| --- | --- | --- | --- |
| Meta-framework | Astro | 5.12.9 | SSR/Islands |
| UI library | React | 19.2.4 | Island rendering |
| Language | TypeScript | 5.8.3 | Typed components |
| Styling | TailwindCSS | 4.1.18 | Utility-first CSS |
| Supabase JS | @supabase/supabase-js | 2.93.3 | Public API client |

Public styling uses TailwindCSS 4 via `@tailwindcss/vite`.

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
