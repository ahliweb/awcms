---
"awcms": minor
---

Theming module (ADR-0034 Fase 3) — the FIRST website module implemented directly
in the awcms base, proving ADR-0034's decision that content/website modules may
now live in `src/modules/` here ("template dipakai-langsung"). Adapted from
awcms-micro's `theming` (Issue #269 / awcms-micro ADR-0029). Bumps the base
registry 10 → 11 modules.

- **Data-only tenant theming, no uploaded code.** A THEME is trusted, reviewed,
  BUILD-TIME source (a `ThemeDescriptor` composed by `theme-registry.ts` from the
  reviewed in-repo base themes — never a database row or an uploaded artifact).
  Only a tenant's DATA configuration of a theme lives in the database
  (`awcms_theming_config_versions` draft + immutable published versions, and
  `awcms_theming_tenant_state` active pointer; sql/033, all three tables
  `ENABLE`+`FORCE ROW LEVEL SECURITY` with the standard `tenant_isolation` policy).
- **Security spine — reject, never sanitize (`domain/css-value-validation.ts`).**
  Every design-token value is validated by REJECTION against strict, bounded,
  linear (no-ReDoS) grammars (hex/rgb/hsl colors, dimensions with an allowed-unit
  list, bounded numbers, font families from a per-theme allow-list whose emitted
  stack is descriptor-owned). `url(...)`, `expression()`, `@import`, `javascript:`,
  comment breakouts, `;{}<>`, backslash, and unbalanced tokens can never reach the
  emitted CSS. Token values ship as an EXTERNAL same-origin `text/css` stylesheet
  (`/theming/{tenantCode}/tokens.css`), so `style-src 'self'` is never weakened.
- **Immutable published versions + audited lifecycle.** draft → validate → preview
  → publish → rollback/retire. Published versions are IMMUTABLE (INSERT-only engine
  + a sql/033 `BEFORE UPDATE/DELETE` trigger); rollback/retire move the active
  pointer while history stays intact. `PUT /api/v1/theming/draft`,
  `POST /api/v1/theming/{validate,preview,publish,rollback,retire}` +
  `GET /api/v1/theming` — ABAC-gated (`theming.config.*`/`theming.version.*`/
  `theming.preview.create`, seeded in sql/034), idempotency-keyed on high-risk
  mutations, and audited. Adds the `archive` action to the `AccessAction`
  union/high-risk set.
- **Non-indexable, hashed, short-lived previews.** `awcms_theming_preview_sessions`
  stores only the SHA-256 hash of the raw preview token; every read filters
  `expires_at >= now()`; the preview surfaces are `X-Robots-Tag: noindex` +
  `private, no-store` on a URL namespace distinct from the public stylesheet.
- **Port adaptations.** No derived-repo theme seam (the derived-application pathway
  was removed in ADR-0034 Fase 2 — themes live in the base registry). `media_library`
  is dropped (not in this base): asset-URL resolution is a documented no-op and
  assets are omitted from render, degrading safely. The `data_lifecycle` purge
  descriptor is dropped (no purge engine/worker role here); preview retention rides
  the `expires_at` read filter. Public tenant resolution is `tenantCode`-based
  (ADR-0009), not Host-based. Revokes the `no-content-website-modules` divergence
  in `awcms-family-compatibility.yaml`.
