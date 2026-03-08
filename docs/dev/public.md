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
- **Analytics**: Static builds require client-side instrumentation or dedicated edge services. Middleware-based server-side logging is non-canonical runtime behavior.
- **View Transitions**: Enabled via `astro:transitions` `ClientRouter` in `Layout.astro`.

### Astro Config (Context7)

- Use `defineConfig` in `astro.config.ts`.
- Keep `output: "static"` for default public deployments.
- Register integrations in the `integrations` array (for example React, sitemap, mdx, icon, and compression utilities).

## 3. Multi-Tenancy Strategy

Each tenant has a dedicated directory under `awcms-public/`. We currently use a "primary" template that can be cloned.

- `awcms-public/primary/`: The reference implementation.
- `awcms-public/{tenant_slug}/`: Dedicated implementations (future).

Static builds scope content by build-time tenant ID (`PUBLIC_TENANT_ID` or `VITE_PUBLIC_TENANT_ID`) and use `getStaticPaths` for tenant-specific routes. Middleware-based tenant resolution is reserved for SSR/runtime deployments.

## 3.1 Static Content Fetching (Benchmark-Ready)

### Objective

Statically render tenant-scoped content using Astro build-time data fetching without leaking drafts or cross-tenant data.

### Required Inputs

| Field | Source | Required | Notes |
| --- | --- | --- | --- |
| `PUBLIC_TENANT_ID` | Build env | Yes | Primary tenant resolver |
| `VITE_PUBLIC_TENANT_ID` | Build env | Optional | Fallback resolver |
| `VITE_SUPABASE_URL` / `PUBLIC_SUPABASE_URL` | Build env | Yes | Supabase URL (`PUBLIC_*` supported as build fallback) |
| `VITE_SUPABASE_PUBLISHABLE_KEY` / `PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Build env | Yes | Publishable key (`PUBLIC_*` supported as build fallback) |

### Workflow

1. Resolve tenant at build time (no `Astro.locals` in static builds).
2. Create a Supabase client from build-time env values.
3. Query only tenant-scoped, published, and non-deleted records.
4. Use `getStaticPaths` to generate routes.
5. Render page data in the template.

### Reference Implementation

```ts
// awcms-public/primary/src/pages/blogs/[slug].astro
import { createClientFromEnv } from "../../lib/supabase";

export async function getStaticPaths() {
  const tenantId =
    import.meta.env.PUBLIC_TENANT_ID ||
    import.meta.env.VITE_PUBLIC_TENANT_ID ||
    import.meta.env.VITE_TENANT_ID;

  if (!tenantId) {
    throw new Error("Missing PUBLIC_TENANT_ID for static public build.");
  }

  const supabase = createClientFromEnv(import.meta.env, { "x-tenant-id": tenantId });

  const { data } = await supabase
    .from("blogs")
    .select("slug")
    .eq("tenant_id", tenantId)
    .eq("status", "published")
    .is("deleted_at", null);

  return (data ?? []).map((row) => ({ params: { slug: row.slug } }));
}
```

### Validation Checklist

- Static build renders only `published` content.
- Tenant ID resolves consistently across environments.
- Cross-tenant slugs are not rendered.

### Failure Modes and Guardrails

- Missing `PUBLIC_TENANT_ID`: fail the build instead of silently rendering wrong-tenant or empty content.
- Using runtime-only tenant resolution: static builds cannot access `Astro.locals`.
- Draft leakage: always filter `status = 'published'` and `deleted_at is null`.

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
- Logging: `awcms-public/primary/src/middleware.ts` applies only to non-canonical runtime experiments; the standard public deployment is static-first and does not rely on middleware logging.
- Public stats: `/visitor-stats` and `/[tenant]/visitor-stats`.

## 7. DB-Driven Admin Control

- Use `docs/dev/admin-public-db-driven-checklist.md` to track which content groups are wired to Supabase.
- Menus, pages, and settings should be sourced from tenant-scoped tables (`menus`, `pages`, `settings`).
- Header/footer menus are loaded via `lib/menu.ts`, widgets via `lib/widgets.ts`, and script plugins via `lib/plugins.ts`.
