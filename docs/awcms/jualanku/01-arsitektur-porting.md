🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](01-arsitektur-porting.id.md)

# 01 — Jualanku.info porting architecture

> A plan. See the [README](README.md) for status and
> [ADR-0045](../../adr/0045-jualanku-porting-awcms-system-of-record-astro-bff.md)
> for the decision.

## 1. Layer split

| Layer                   | Owner                                                        | Responsibility                                                                                          | What is **not** its responsibility                        |
| ----------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| Public experience       | `awcms-astro`                                                | Homepage, directory, business profile, public catalogue, articles, SEO, structured data, accessibility. | Business rules, authorization decisions, database access. |
| Seller/affiliate portal | `awcms-astro` (on-demand)                                    | Rendering private pages, the `/_portal-api/*` BFF, view models, private headers, CSRF.                  | Entitlement, ownership, state transitions, the ledger.    |
| Business platform       | `awcms`                                                      | Domain services, policy, validation, workflow, reporting, audit, outbox, API.                           | Public page markup, edge cache, portal page SEO.          |
| Internal admin          | `awcms` (SSR `/admin/*`)                                     | Operations, moderation, verification, finance, risk, support, settings.                                 | Merchant/affiliate access — they have no route in here.   |
| Data                    | PostgreSQL via `awcms`                                       | System of record, RLS, retention, legal hold.                                                           | Being accessed directly by `awcms-astro` (never).         |
| Media                   | `media_library` (R2) via `awcms`                             | Presigned upload, magic-byte MIME verification, SHA-256, lifecycle, managed-media enforcement.          | Accepting arbitrary image URLs from the portal.           |
| Edge/routing            | Cloudflare/Traefik/Coolify + Varnish (`src/lib/edge-cache/`) | TLS, WAF, rate limit, host routing, cache separation.                                                   | Authorization. A cache is not access control.             |

## 2. Topology

```
Internet
  │
Cloudflare (WAF, rate limit, TLS)
  │
Traefik / Coolify
  ├──────────────────────────────┐
  │                              │
jualanku.info                   ops.jualanku.info
awcms-astro                     awcms (Astro SSR, @astrojs/node)
- public: prerender             - /admin/** internal
- /penjual/**  on-demand        - network allowlist / Zero Trust
- /affiliate/** on-demand
- BFF /_portal-api/**
  │
  │ private network / service identity (mTLS or a service token)
  ▼
awcms REST API  ──►  PostgreSQL (RLS FORCE) + audit + outbox + R2
```

Binding notes:

- `awcms` is **not** published as a general-purpose API. The public routes that
  already exist in this repo (`/blog/{tenantCode}/*`, `/robots.txt`, `/sitemap*.xml`,
  feeds, `/search`) may stay open; everything else only accepts traffic from the
  experience layer.
- The admin host is separate from the public host. A single origin serving
  merchant pages and admin pages turns every CSP, cookie, or cache mistake
  into a cross-audience mistake.
- The edge cache only touches public surfaces. `private, no-store` for every
  portal and admin response — run `bun run edge-cache:surfaces:check` before
  adding a new surface.

## 3. Rendering matrix per surface

| Surface                             | Repo          | Rendering                           | Cache                          | Authentication          |
| ----------------------------------- | ------------- | ----------------------------------- | ------------------------------ | ----------------------- |
| `/`, marketing pages, `/harga`      | `awcms-astro` | Prerender                           | Public, revalidate on deploy   | No                      |
| `/artikel/**`, `/bantuan/**`        | `awcms-astro` | Prerender (fetch at build time)     | Public                         | No                      |
| `/kategori/[slug]`, `/usaha/[slug]` | `awcms-astro` | Prerender + rebuild/purge           | Public, tag-based invalidation | No                      |
| `/cari`                             | `awcms-astro` | On-demand or a short-TTL public API | Public, limited TTL            | No                      |
| `/penjual/**`                       | `awcms-astro` | On-demand (`prerender = false`)     | `private, no-store`            | Merchant session        |
| `/affiliate/**` (dashboard)         | `awcms-astro` | On-demand (`prerender = false`)     | `private, no-store`            | Affiliate session       |
| `/affiliate` (landing)              | `awcms-astro` | Prerender                           | Public                         | No                      |
| `/_portal-api/**`                   | `awcms-astro` | Server endpoint (BFF)               | `no-store`                     | Session + CSRF          |
| `/admin/jualanku/**`                | `awcms`       | SSR                                 | `no-store`                     | Internal role + step-up |
| `/api/v1/jualanku/**`               | `awcms`       | API                                 | `no-store`                     | Per namespace           |

The term used: **static-by-default with on-demand routes**. Modern Astro only
has `output: 'static'` or `'server'`; the mixed capability comes from
`export const prerender = false` per route once an adapter is installed — not from
the `output: 'hybrid'` value, which no longer exists.

## 4. Why the BFF is mandatory

Six reasons, each closing one concrete failure:

1. **The tenant must not be decided by the browser.** `awcms` takes the tenant from the
   `x-awcms-tenant-id` header or a cookie. If the public browser sends it, tenant
   selection becomes user input. The BFF derives it server-side from the
   deployment/host configuration.
2. **No tokens in browser storage.** httpOnly cookies are held by the public
   origin; the `awcms` session token never reaches JavaScript.
3. **CSRF, Origin/Referer, and cache policy are applied in one place**, not
   repeated on every page.
4. **The `awcms` envelope is projected into a view model**, so a change to the shape of
   an internal response does not immediately become a change to the public HTML.
5. **Different rate limits per audience** (public search, merchant mutations, affiliate
   payout, admin) without overloading a single configuration.
6. **The `awcms` attack surface stays small**: one trusted client, not the whole
   internet.

**Hard boundary:** the BFF must not decide anything with business consequences.
If a check only exists in the BFF, that check does not exist — a direct call to
`awcms` from the internal network will bypass it. Every rule that matters is
_re-checked_ in `awcms` on every call.

## 5. How the existing website modules are used

Jualanku does **not** rebuild capabilities that already exist in this repo:

| Jualanku need                                 | Module used                                   | Integration notes                                                                                        |
| --------------------------------------------- | --------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Articles, help pages, legal                   | `blog_content`                                | Versioned legal pages with effective dates use the existing post/page lifecycle.                         |
| SEO metadata, sitemap, feed, redirects        | `seo_distribution`                            | Jualanku content modules declare `seo_facts` through the existing seam; the host is derived server-side. |
| Directory search                              | `site_search`                                 | `jualanku_directory`/`jualanku_catalog_growth` declare `searchSources` for published rows.               |
| Business/product/verification-evidence images | `media_library`                               | Presigned upload + MIME verification. The portal never sends arbitrary image URLs.                       |
| Per-tenant theme & design tokens              | `theming`                                     | Jualanku tokens become theme configuration, not loose CSS in components.                                 |
| Domain/host → tenant                          | `tenant_domain`                               | The canonical host source for the BFF and SEO.                                                           |
| Privacy-minimal visit analytics               | `visitor_analytics`                           | Public page metrics. Merchant business metrics stay owned by the Jualanku modules.                       |
| Comments/reviews (if opened up)               | `comments`                                    | Only for already-published resources; declared through `commentableResources`.                           |
| Retention/archive/purge + legal hold          | `data_lifecycle`                              | Every high-volume Jualanku table declares `dataLifecycle`.                                               |
| Email notifications                           | `email`                                       | The existing templates + outbox dispatcher.                                                              |
| Payout/verification approval                  | `workflow_approval` + `identity_access` (SoD) | Maker/checker as a workflow definition + `sodRules`, not an `if` in a service.                           |
| Multi-step onboarding form drafts             | `form_drafts`                                 | A generic JSONB payload; the meaning of the payload belongs to the Jualanku modules.                     |

The only genuinely new things are the five domain modules in
[03-bounded-context-dan-model-data.md](03-bounded-context-dan-model-data.md).
