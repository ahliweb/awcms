/**
 * Readiness gate for the `news_portal_full_online_r2` module preset
 * (Issue #632, epic `news_portal` #631-#642/#649). Pure — no I/O, no
 * `process.env` reads here (same split as
 * `visitor-analytics/domain/visitor-analytics-config.ts`).
 *
 * ## Naming reconciliation #1 — no new global `DEPLOYMENT_PROFILE` var
 *
 * Issue #632's body illustrates `DEPLOYMENT_PROFILE=full_online` as if it
 * were an existing/needed env var. It is neither: `grep`ing this repo
 * finds zero references outside narrative docs
 * (`docs/awcms-mini/deployment-profiles.md`). This repo's established
 * config pattern is independent, per-feature flags (`R2_ENABLED`,
 * `EMAIL_ENABLED`, `VISITOR_ANALYTICS_ENABLED`, ...) — never one central
 * deployment-mode enum every module has to branch on. Introducing a new
 * global master switch here would be the first of its kind and would
 * duplicate/compete with those flags instead of composing with them.
 *
 * Instead, "full-online" for THIS preset is expressed as two new,
 * narrowly-scoped vars (`NEWS_PORTAL_ENABLED` and `NEWS_PORTAL_PROFILE`,
 * this module's own master switch + profile selector) combined with the
 * already-existing `NEWS_MEDIA_R2_ENABLED` (news-media-r2-config.ts). Three
 * independent flags that all have to agree, not one central enum.
 *
 * ## Naming reconciliation #2 — no new `BLOG_PUBLIC_ROUTE_MODE` var
 *
 * Issue #632's body also lists `BLOG_PUBLIC_ROUTE_MODE=domain_default`.
 * That string is not a new concept — it is the EXISTING
 * `blog_content` module setting `publicRouteMode`
 * (`blog-content/application/public-route-settings.ts`,
 * `PUBLIC_ROUTE_MODES = ["domain_default", "disabled"]`, Issue #564),
 * already defaulting to `"domain_default"` today for every tenant. It is a
 * per-tenant `awcms_module_settings` value (written via
 * `PATCH /api/v1/tenant/modules/blog_content/settings`), not an env var —
 * introducing an env var of the same name would create two competing
 * sources of truth for one concept. This preset recommends (documents,
 * does not enforce via a new mechanism) that a tenant activating
 * `news_portal_full_online_r2` leaves `blog_content`'s `publicRouteMode`
 * at its default `"domain_default"` and sets the relevant
 * `awcms_tenant_domains` row's existing `route_mode` column
 * (`tenant-domain/domain/tenant-domain-validation.ts`,
 * `canonical` | `legacy_blog`, Issue #557) to `"canonical"` via the
 * existing tenant-domain API (#562) — two already-existing, independent
 * mechanisms, not a third new one.
 *
 * `BLOG_PUBLIC_BASE_PATH` in the issue body is, similarly, just
 * `PUBLIC_CANONICAL_BASE_PATH` (Issue #556,
 * `blog-content/application/public-route-settings.ts`), already
 * defaulting to `/news` — no new var needed for it either.
 */
import {
  evaluateManagedMediaReadiness,
  type ManagedMediaReadinessReason
} from "../../media-library/domain/managed-media-readiness";

export const NEWS_PORTAL_PROFILES = ["full_online_r2"] as const;
export type NewsPortalProfile = (typeof NEWS_PORTAL_PROFILES)[number];

export function isKnownNewsPortalProfile(
  value: string | undefined
): value is NewsPortalProfile {
  return (NEWS_PORTAL_PROFILES as readonly string[]).includes(value ?? "");
}

/**
 * The `news_media_r2_*` half is `ManagedMediaReadinessReason` (owned by
 * `media_library`, ADR-0036) rather than three re-declared string literals —
 * this union stays the exact same set of strings it always was, but a change to
 * the media reasons can no longer drift out of sync with this type.
 */
export type NewsPortalPresetReadinessReason =
  | "news_portal_disabled"
  | "profile_not_full_online_r2"
  | ManagedMediaReadinessReason;

export type NewsPortalPresetReadinessResult = {
  ready: boolean;
  reasons: NewsPortalPresetReadinessReason[];
  /** Human-readable evidence, one entry per failing/relevant check — for audit `attributes`/report output. */
  detail: string[];
};

/**
 * The one concrete, checkable signal this preset uses to decide "is this
 * deployment genuinely full-online R2-only" — see reconciliation #1
 * above. All three of `NEWS_PORTAL_ENABLED=true`,
 * `NEWS_PORTAL_PROFILE=full_online_r2`, and `NEWS_MEDIA_R2_ENABLED=true`
 * must hold, AND the R2 config itself must be complete and separated from
 * `sync-storage`'s own R2 bucket/credentials (Keputusan kunci #1).
 *
 * Out of scope by design (see SKILL.md/architecture doc §3.3-3.4): there is
 * no "local upload fallback enabled" flag to check here, because no such
 * flag/code path exists anywhere in this repo — this mode has structurally
 * no local-fallback option to disable. `tests/unit/news-portal-no-local-fallback.test.ts`
 * guards this by asserting no such code path gets introduced later,
 * instead of this function checking a flag that would otherwise have to be
 * invented just to be checked.
 */
export function evaluateNewsPortalFullOnlineR2Readiness(
  env: NodeJS.ProcessEnv = process.env
): NewsPortalPresetReadinessResult {
  const reasons: NewsPortalPresetReadinessReason[] = [];
  const detail: string[] = [];

  if (env.NEWS_PORTAL_ENABLED !== "true") {
    reasons.push("news_portal_disabled");
    detail.push(
      'NEWS_PORTAL_ENABLED is not "true" — the news_portal_full_online_r2 preset requires it explicitly (opt-in, never a default).'
    );
  }

  const profile = env.NEWS_PORTAL_PROFILE;
  if (!isKnownNewsPortalProfile(profile)) {
    reasons.push("profile_not_full_online_r2");
    detail.push(
      `NEWS_PORTAL_PROFILE must be "full_online_r2" for this preset; got ${
        profile ? `"${profile}"` : "unset"
      }.`
    );
  }

  // The media half is `media_library`'s question, not this module's (ADR-0036) —
  // appended AFTER this module's own two reasons so the resulting `reasons` array
  // keeps the exact order it has always had.
  const media = evaluateManagedMediaReadiness(env);
  reasons.push(...media.reasons);
  detail.push(...media.detail);

  return { ready: reasons.length === 0, reasons, detail };
}
