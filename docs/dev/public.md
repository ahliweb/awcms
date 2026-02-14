> **Documentation Authority**: [SYSTEM_MODEL.md](../../SYSTEM_MODEL.md) Section 1 (Tech Stack)

# Public Portal Development

## 1. Overview

The Public Portal (`awcms-public/`) handles the visitor-facing websites for each tenant. The default configuration builds static output with React islands.

## 2. Architecture

- [SYSTEM_MODEL.md](../../SYSTEM_MODEL.md) - **Primary authority** for Public Portal tech stack (Astro 5.17.1, React 19.2.4, static output)
- [AGENTS.md](../../AGENTS.md) - Implementation patterns and Context7 references
- **Framework**: Astro 5.17.1
- **Rendering**: Static output (`output: "static"`) with React islands. SSR is optional if explicitly enabled.
- **Styling**: Tailwind CSS 4.
- **Data Source**: Supabase (via direct client).
- **Analytics**: Server-side logging is available only when middleware runs (SSR/runtime). Static builds require client-side instrumentation or edge functions.
- **View Transitions**: Enabled via `astro:transitions` `ClientRouter` in `Layout.astro`.

## 3. Multi-Tenancy Strategy

Each tenant has a dedicated directory under `awcms-public/`. We currently use a "primary" template that can be cloned.

- `awcms-public/primary/`: The reference implementation.
- `awcms-public/{tenant_slug}/`: Dedicated implementations (future).

Static builds scope content by build-time tenant ID (`PUBLIC_TENANT_ID` or `VITE_PUBLIC_TENANT_ID`) and use `getStaticPaths` for tenant-specific routes. Middleware-based tenant resolution is reserved for SSR/runtime deployments.

### Smandapbun Portal

- `awcms-public/smandapbun` is a single-tenant Astro site.
- Uses `src/lib/api.ts` + JSON fallbacks (see `docs/tenancy/smandapbun.md`).
- Tenant resolution is fixed at build time.
- All public portals standardize on React islands with Vite-based tooling.

## 4. Environment Variables

Public portals require:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`
- `PUBLIC_SUPABASE_URL` / `PUBLIC_SUPABASE_PUBLISHABLE_KEY` (CI/build fallback)
- `PUBLIC_TENANT_ID` (recommended for static builds)
- `VITE_PUBLIC_TENANT_ID` or `VITE_TENANT_ID` (fallbacks)

`createClientFromEnv` uses `import.meta.env` for static builds (supports `VITE_*` and `PUBLIC_*` keys); `runtime.env` is only used in SSR/runtime deployments.

## 5. Development Workflow

1. Navigate to `awcms-public/primary`.
2. `npm run dev` to start the local server.
3. Content changes require a rebuild for production static output; in dev, refresh reflects latest Supabase data.

## 5.1 Key Routes

- `/` (home): Loads `pages` with `page_type = home` or `slug = home`.
- `/p/[slug]`: Dynamic pages from `pages` table.
- `/blogs` + `/blogs/[slug]`: Dynamic blogs from `blogs` table.
- `/visitor-stats`: Public analytics rollup view.
- `/en` and `/id`: Locale-prefixed home routes.
- `homes/*` and `landing/*`: Static AstroWind marketing routes.

## 6. Visitor Analytics + Consent

- Consent banner: `awcms-public/primary/src/components/common/ConsentNotice.astro`.
- Logging: `awcms-public/primary/src/middleware.ts` logs page views only when running with SSR/runtime middleware.
- Public stats: `/visitor-stats` and `/[tenant]/visitor-stats`.

## 7. DB-Driven Admin Control

- Use `docs/dev/admin-public-db-driven-checklist.md` to track which content groups are wired to Supabase.
- Menus, pages, and settings should be sourced from tenant-scoped tables (`menus`, `pages`, `settings`).
- Header/footer menus are loaded via `lib/menu.ts`, widgets via `lib/widgets.ts`, and script plugins via `lib/plugins.ts`.
