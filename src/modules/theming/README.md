# theming — tenant-selectable presentation (ADR-0034 Fase 3)

The FIRST website module implemented **directly in the awcms base** — the evidence
for ADR-0034's decision that content/website modules may live in `src/modules/`
here ("template dipakai-langsung"), superseding the old `no-content-website-modules`
restriction. Adapted from awcms-micro's `theming` (Issue #269 / awcms-micro
ADR-0029).

Lets a tenant **select** a trusted theme and **configure** it by DATA (design
tokens, layout slots, media, section order) — with **no uploaded code, no
arbitrary templates, no raw CSS/HTML/JS**.

## The two things this module keeps strictly apart

| Trusted, build-time (code)                                                                                                                       | Tenant-authored (data)                                                                                                                                                                                                     |
| ------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A **theme** = a `ThemeDescriptor` composed by `theme-registry.ts` from the reviewed in-repo base themes. Reviewed source, bundled at build time. | A **`ThemeConfig`** = token overrides, slot selections, media ids, section order, nav placement. Stored in the DB (`awcms_theming_config_versions` + `_tenant_state`, sql/033, RLS FORCE'd), schema-validated and bounded. |
| `PublicThemeLayout.astro` — the ONLY thing that renders.                                                                                         | —                                                                                                                                                                                                                          |

There is no database-stored executable template anywhere. awcms has no
derived-repo theme seam (the derived-application pathway was removed in ADR-0034
Fase 2); new themes live directly in this base registry.

## Security spine — `domain/css-value-validation.ts`

Every design-token VALUE is validated by **REJECTION, never sanitization**:

- `assertSafeCssPrimitive` — charset-limited, length-bounded, control-char-free,
  and rejects `url(` / `expression` / `@import` / `javascript:` / `/*` / `;{}<>` /
  backslash / unbalanced parens. Rejecting (not stripping) sidesteps the
  `js/incomplete-multi-character-sanitization` class entirely.
- `validateColorValue` / `validateDimensionValue` / `validateNumberValue` — strict,
  linear (no-ReDoS) grammars.
- font families are chosen from a per-theme **allow-list**; the emitted CSS stack
  is descriptor-owned, so no font value is ever tenant-authored.
- `serializeThemeTokensCss` is safe by construction (re-validates every value) and
  emits a `:root { --awcms-theme-* }` block served as an **external same-origin
  stylesheet** (`/theming/{tenantCode}/tokens.css`) — so the app's `style-src
'self'` CSP is never weakened (no per-request inline `<style>`).

## Lifecycle — draft → validate → preview → publish → rollback/retire

- **draft** — one mutable working copy per tenant (`PUT /api/v1/theming/draft`).
- **validate** — read-only dry run (`POST /api/v1/theming/validate`), returns the
  token CSS that would be produced.
- **preview** — a short-lived, **non-indexable**, authorized session
  (`POST /api/v1/theming/preview` → `/theming/preview/{token}`): token stored as a
  hash, `X-Robots-Tag: noindex`, `private, no-store`, distinct URL namespace from
  the public stylesheet (cannot poison the public/CDN cache). Every read filters
  `expires_at >= now()`, so a stale session is inert (there is no background purge
  job — the generic data_lifecycle engine is not part of this base).
- **publish** — INSERT a new **immutable** version and make it the live look
  (`POST /api/v1/theming/publish`). Published versions can never be mutated (engine
  INSERT-only + the sql/033 `BEFORE UPDATE/DELETE` trigger).
- **rollback / retire** — move the active pointer only (`POST .../rollback`,
  `POST .../retire`); history stays intact.

All high-risk mutations require an `Idempotency-Key`, are ABAC-gated, and are
audited.

## Files

- `domain/` — `css-value-validation.ts` (spine), `theme-descriptor.ts` (contract +
  `assertValidThemeDescriptor` CSP/a11y gate), `theme-config.ts` (validate +
  serialize), `theme-lifecycle.ts`, `preview-token.ts`, `theme-permissions.ts`.
- `themes/default-theme.ts` — the base `aria` theme. `theme-registry.ts` — the
  reviewed base composition root.
- `application/` — `theme-config-directory.ts`, `theme-preview-directory.ts`,
  `theme-service.ts` (orchestration + injected audit), `theme-render-resolver.ts`,
  `theme-preview-render.ts`.
- composition roots in `src/lib/theming/` (`theme-media.ts` — a documented no-op
  until a media module is ported, `theme-public-css.ts` — the `tenantCode`-resolved
  public stylesheet, `theme-preview.ts`).
- routes: `src/pages/api/v1/theming/*` (admin API),
  `src/pages/theming/[tenantCode]/tokens.css.ts` (public),
  `src/pages/theming/preview/[token].astro` + `preview-tokens/[token].css.ts`.
- `src/layouts/PublicThemeLayout.astro` — the trusted render layout.

## Port adaptations vs awcms-micro (ADR-0034 Fase 3)

- **No derived-repo theme seam** — the derived-application pathway was removed
  (ADR-0034 Fase 2); themes live in `theme-registry.ts` directly.
- **`media_library` dropped** — not part of this base. Asset-URL resolution
  (`src/lib/theming/theme-media.ts`) is a documented no-op returning an empty map;
  assets are omitted from render and the theme degrades safely. Stored asset ids
  remain valid DATA.
- **`data_lifecycle` purge descriptor dropped** — no purge engine/worker role in
  this base; preview retention rides the `expires_at >= now()` read filter.
- **Public tenant resolution is `tenantCode`-based** (ADR-0009), not Host-based —
  the public stylesheet lives at `/theming/{tenantCode}/tokens.css`.

## Documented follow-ups (deferred, API-first)

- **Full admin UI screens** (rich token editor + responsive preview dashboard) —
  the API + a minimal preview surface ship here; `navigation` is undeclared.
- **Domain events** (`awcms.theming.version.published` / `.rolled-back` /
  `.retired`) — publish/rollback/retire are audited synchronous hooks today.
- **Media asset rendering** — lands when a media module is ported into this base.
- **Public-route adoption** — the layout + token stylesheet are ready; wiring the
  public home routes onto `PublicThemeLayout` is a follow-up.
