import { defineModule } from "../_shared/module-contract";
import {
  THEMING_CONFIG_ACTIVITY_CODE,
  THEMING_MODULE_KEY,
  THEMING_PREVIEW_ACTIVITY_CODE,
  THEMING_VERSION_ACTIVITY_CODE
} from "./domain/theme-permissions";

/**
 * `theming` — the FIRST website module implemented DIRECTLY in the awcms base
 * (ADR-0034 Fase 3, "template dipakai-langsung"), adapted from awcms-micro's
 * `theming` (Issue #269 / awcms-micro ADR-0029). ADR-0034 revoked the
 * `no-content-website-modules` restriction (content/website modules may now live
 * in `src/modules/` here), and this module is the evidence for that decision. It
 * bumps the base registry 10 -> 11 modules.
 *
 * ## What this module OWNS
 *
 * Tenant-selectable presentation with NO uploaded server code and NO arbitrary
 * templates. A THEME is trusted, reviewed, BUILD-TIME source (a `ThemeDescriptor`
 * composed by `theme-registry.ts` from the reviewed in-repo base themes); only a
 * tenant's DATA configuration of a theme lives in the database
 * (`awcms_theming_config_versions` + `_tenant_state`, sql/033, RLS FORCE'd).
 *
 * The security spine (`domain/css-value-validation.ts`) validates every design
 * token VALUE by REJECTION (never sanitization) against strict, bounded grammars
 * — colors, dimensions with an allowed-unit list, plain numbers, and font
 * families chosen from a per-theme allow-list (the emitted font stack is
 * descriptor-owned, never tenant-authored). `url(...)`, `expression()`,
 * `@import`, `javascript:`, comment breakouts, `;{}<>` and unbalanced tokens can
 * never reach the emitted CSS. Token values are serialized to a `text/css`
 * custom-property block served as an EXTERNAL same-origin stylesheet
 * (`/theming/{tenantCode}/tokens.css`), so the app's `style-src 'self'` CSP is
 * never weakened (no per-request inline `<style>`). Rendering is only through the
 * trusted build-time `PublicThemeLayout.astro` — there is NO database-stored
 * executable template, no tenant-authored Astro/JS/SQL/eval/raw HTML.
 *
 * Published configuration versions are IMMUTABLE (INSERT-only engine + a sql/033
 * BEFORE UPDATE/DELETE trigger); the active theme pointer lives on the state row,
 * so publish/rollback/retire move a pointer while history stays intact.
 *
 * Preview sessions (`awcms_theming_preview_sessions`, sql/033) are authorized
 * (token stored as a SHA-256 hash), short-lived (`expires_at`, filtered on every
 * read), non-indexable (`X-Robots-Tag: noindex`), and isolated from the public
 * cache (`private, no-store` + a distinct URL namespace).
 *
 * ## Dependencies / capabilities (port adaptations vs awcms-micro)
 *
 * Lifecycle `dependencies` are only the two Core modules (`tenant_admin`,
 * `identity_access`).
 *
 * `media_library` is CONSUMED as a capability, not a lifecycle dependency: the
 * adapter is wired at the composition root `src/lib/theming/theme-media.ts`, and
 * a slot whose media id does not resolve is omitted from render rather than
 * failing, so `theming` still functions with the capability unavailable. That is
 * exactly what `capabilities.consumes` documents — a source-level relationship,
 * not an ordering constraint (see `module-contract.ts`).
 *
 * This was dropped at port time on the grounds that `media_library` did not
 * exist in awcms. It does now (ADR-0036), and leaving the drop in place meant
 * uploaded logos silently never rendered. `data_lifecycle` also exists now
 * (ADR-0037), but preview retention deliberately KEEPS the
 * `expires_at >= now()` read filter rather than registering a purge descriptor:
 * an expired session is already inert on read, so a purge job would reclaim rows
 * without changing behaviour. Registering one is an open option, not a fix.
 *
 * `theming` `provides` no capability and nothing depends on it.
 *
 * ## Admin UI
 *
 * `/admin/theming` (`src/pages/admin/theming.astro`) is the console for this
 * whole surface: theme picker, a descriptor-driven draft editor (one control per
 * declared token/slot/asset slot — nothing invented), Validate, Preview, and the
 * published-version history with publish/rollback/retire. The `navigation` entry
 * below and that page landed together — a declared entry without a page is a
 * permanent 404 in the sidebar (`tests/admin-navigation-registry.test.ts`), and a
 * page no descriptor claims can never appear in it. This supersedes the earlier
 * note here that the token editor was deferred API-first.
 *
 * ## Deliberately NOT here yet (documented follow-ups)
 *
 * The responsive-preview DASHBOARD (side-by-side breakpoint rendering) is still
 * deferred; the console links out to the preview session instead. `events` stays
 * undeclared: publish/rollback/retire are audited synchronous hooks, not yet
 * domain events. `jobs` stays undeclared: no background purge (see the retention
 * note above).
 */
export const themingModule = defineModule({
  key: THEMING_MODULE_KEY,
  name: "Theming",
  version: "1.0.0",
  status: "active",
  type: "domain",
  description:
    "Tenant-selectable presentation via trusted, reviewed, BUILD-TIME theme descriptors (ADR-0034 Fase 3 — the first website module implemented directly in the awcms base). A theme is composed by `src/modules/theming/theme-registry.ts` from the reviewed in-repo base themes — NEVER a database row and NEVER an uploaded artifact (awcms has no derived-repo theme seam; the derived-application pathway was removed in ADR-0034 Fase 2). Only a tenant's DATA configuration of a theme lives in the database (`awcms_theming_config_versions` draft + immutable published versions, and `awcms_theming_tenant_state` active pointer, sql/033, RLS FORCE'd): bounded, schema-validated design-token overrides, slot variant selections, media asset ids (URL resolution is a no-op until a media module is ported), content-section order, and nav placement. The security spine (`domain/css-value-validation.ts`) validates every CSS token value by REJECTION against strict grammars (hex/rgb/hsl colors with numeric components, dimensions with an allowed-unit list, bounded numbers, font families from a per-theme allow-list whose emitted stack is descriptor-owned) — `url(...)`, `expression()`, `@import`, `javascript:`, comment breakouts, `;{}<>` and unbalanced tokens can never reach output. Token values ship as an EXTERNAL same-origin `text/css` stylesheet (`/theming/{tenantCode}/tokens.css`), so the app's `style-src 'self'` CSP is never weakened (no per-request inline style). Rendering is only through the trusted build-time `PublicThemeLayout.astro` (no DB-stored template, no tenant-authored Astro/JS/SQL/eval/raw HTML). Published versions are IMMUTABLE (INSERT-only engine + a sql/033 BEFORE UPDATE/DELETE trigger); lifecycle is draft → validate → preview → publish → rollback/retire, with rollback/retire moving the active pointer while history stays intact. Preview sessions (sql/033) are authorized (token stored hashed), short-lived, non-indexable (X-Robots-Tag: noindex), and isolated from the public cache (private, no-store + distinct URL namespace). Admin API under /api/v1/theming/* (selection, token edit, validate, preview, publish, version history, rollback, retire) is ABAC-gated, idempotency-keyed on high-risk mutations, and audited. A default theme (`aria`) ships in-repo.",
  // `module_management` (Issue #257): the public token-CSS route gates on
  // `fetchTenantModuleEntry`, so a tenant that disables `theming` stops being
  // served its stylesheet. Same genuine lifecycle dependency `seo_distribution`
  // and `site_search` already declare for the same call — it was imported
  // without being declared, and only became visible once the presentation code
  // moved out of `src/lib/theming/`.
  dependencies: ["tenant_admin", "identity_access", "module_management"],
  capabilities: {
    consumes: [{ capability: "media_library", providedBy: "media_library" }]
  },
  api: {
    openApiPath: "openapi/modules/theming.openapi.yaml",
    basePath: "/api/v1/theming",
    // Public token CSS + preview surfaces.
    routes: ["/api/v1/theming", "/theming"]
  },
  navigation: [
    {
      labelKey: "admin.layout.nav_theming",
      path: "/admin/theming",
      order: 34,
      requiredPermission: "theming.config.read"
    }
  ],
  /**
   * ADR-0094 wave 2 (Issue #557) — a theme is the tenant's appearance, and the
   * only people here are the designers who edited it.
   */
  subjectData: [
    {
      key: "theming.theming_config_versions",
      tableName: "awcms_theming_config_versions",
      ownerModuleKey: "theming",
      subjectColumns: [{ column: "created_by", references: "tenant_user" }],
      exportable: false,
      erasure: "severed_with_subject_row",
      rationale:
        "Versioned theme configuration. The config is colours and layout belonging to the tenant; a person appears only as the author of a version."
    },
    {
      key: "theming.theming_tenant_state",
      tableName: "awcms_theming_tenant_state",
      ownerModuleKey: "theming",
      subjectColumns: [
        { column: "created_by", references: "tenant_user" },
        { column: "updated_by", references: "tenant_user" }
      ],
      exportable: false,
      erasure: "severed_with_subject_row",
      rationale:
        "Which theme version is live for the tenant. One row of pointers, stamped with who last changed it."
    },
    {
      key: "theming.theming_preview_sessions",
      tableName: "awcms_theming_preview_sessions",
      ownerModuleKey: "theming",
      subjectColumns: [{ column: "created_by", references: "tenant_user" }],
      exportable: false,
      // A live preview token is a bearer credential for an unpublished theme.
      // It expires on its own, and an erasure should not leave one working in
      // the name of somebody who is gone.
      erasure: "hard_delete",
      rationale:
        "Short-lived tokens letting somebody view an unpublished theme. Not exported because the token is the whole row and it is a credential; deleted on erasure rather than left live under a detached name.",
      redactedColumns: ["token_hash"]
    }
  ],
  permissions: [
    {
      activityCode: THEMING_CONFIG_ACTIVITY_CODE,
      action: "read",
      description:
        "Read this tenant's theme selection, available themes, the draft config, and published version history"
    },
    {
      activityCode: THEMING_CONFIG_ACTIVITY_CODE,
      action: "update",
      description:
        "Edit this tenant's draft theme config (design tokens, slot variants, media assets, section order) — bounded, validated data (high-risk, audited)"
    },
    {
      activityCode: THEMING_VERSION_ACTIVITY_CODE,
      action: "publish",
      description:
        "Publish a validated draft as an immutable theme version and make it the live look (high-risk, idempotency-keyed, audited)"
    },
    {
      activityCode: THEMING_VERSION_ACTIVITY_CODE,
      action: "restore",
      description:
        "Roll the active theme back to an earlier published version (high-risk, idempotency-keyed, audited)"
    },
    {
      activityCode: THEMING_VERSION_ACTIVITY_CODE,
      action: "archive",
      description:
        "Retire the active theme so the site falls back to the default (high-risk, idempotency-keyed, audited)"
    },
    {
      activityCode: THEMING_PREVIEW_ACTIVITY_CODE,
      action: "create",
      description:
        "Create a short-lived, non-indexable preview session for the draft theme config (audited)"
    }
  ]
});
