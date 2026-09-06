import { log } from "../../../lib/logging/logger";
import { isSupportedLocale } from "../../../lib/i18n/locales";
import { withPublicLocalePrefix } from "../../../lib/i18n/public-locale-path";
import { resolveModuleEnabled } from "../../identity-access/application/auth-context";
import { recordAuditEvent } from "../../logging/application/audit-log";
import { captureUrlChangeRedirect } from "../../seo-distribution/application/url-change-capture";
import { fetchRedirectSettings } from "../../seo-distribution/application/redirect-settings-directory";
import { resolveTenantAllowedHosts } from "../../seo-distribution/application/tenant-allowed-hosts";

/**
 * Issue #784 — the seam `POST /api/v1/seo/redirects/capture-url-change`
 * (ADR-0039) documents as "the seam a content module ... drives when a URL
 * changes", now actually driven by one: `PATCH /api/v1/blog/posts/{id}` calls
 * this when `input.slug` differs from the post's stored slug. Before this, a
 * slug edit made the OLD slug unrecoverable — not on the post row, not in
 * `awcms_blog_revisions` (no `slug` column, see `revision-policy.ts`) — so
 * every previously-shared link 404ed with nothing to notice it, let alone fix
 * it.
 *
 * ## Why a direct application-layer import, not a capability port
 *
 * `media_library`/`social_publishing` go through `_shared/ports/*` because
 * this repo may run without a real implementation of them (a no-op adapter is
 * injected instead) and `blog_content` must degrade safely either way.
 * `seo_distribution` is not that kind of dependency: this function only
 * calls a plain application function with no swappable implementation, the
 * same shape `seo_distribution/application/redirect-resolution-service.ts`
 * already uses to import `blog_content`'s `fetchEffectivePublicRouteSettings`
 * directly, in the opposite direction. Declaring `seo_distribution` in
 * `blog_content.module.ts`'s `dependencies` instead would make it a hard
 * tenant-enablement gate (`tenant-module-lifecycle.ts`'s
 * `MODULE_DEPENDENCY_DISABLED`) — a tenant that already runs `blog_content`
 * without `seo_distribution` enabled would be silently stuck the moment that
 * edge shipped, with no gate warning it (the module matrix only computes a
 * dependency warning for a currently-DISABLED module, on the documented
 * assumption "an enabled module's dependencies are satisfied by
 * construction"). Checking `resolveModuleEnabled` at the call site instead —
 * same helper the route already calls for `blog_content` itself — keeps this
 * additive: a tenant that has not enabled `seo_distribution` keeps editing
 * posts exactly as before, just without a redirect being proposed.
 *
 * ## Why a rejection/failure never fails the post update
 *
 * `checkRedirectSafety` (loop/conflict/chain-length) can refuse to persist a
 * rule; a server-derived path pair can, in principle, fail
 * `validateRedirectInput`. Neither is a reason to block an editor from fixing
 * a headline's slug — the redirect is additive tooling around the edit, not a
 * precondition for it (same reasoning the ADR-0039 route docblock states:
 * "wiring this in is additive — it cannot itself create an unsafe redirect").
 * A non-`created`/`proposed` outcome is logged as a warning and reported back
 * to the caller in the response's `redirectCapture` field so an operator can
 * follow up, but it never throws and never rolls back the post update.
 */
export type SlugChangeRedirectOutcome =
  | { outcome: "module_disabled" }
  | { outcome: "skipped" }
  | { outcome: "created" | "proposed"; redirectId: string }
  | { outcome: "invalid" }
  | {
      outcome: "rejected";
      code: "SOURCE_CONFLICT" | "REDIRECT_LOOP" | "REDIRECT_CHAIN_TOO_LONG";
      message: string;
    };

export type SlugChangeRedirectInput = {
  postId: string;
  oldSlug: string;
  newSlug: string;
  /** The post's locale BEFORE this update — decides the old path's prefix. */
  oldLocale: string;
  /** The post's locale AFTER this update — decides the new path's prefix. */
  newLocale: string;
};

type TenantCodeRow = { tenant_code: string };

/**
 * `/blog/{tenantCode}/{slug}` (ADR-0009), locale-prefixed when the locale is
 * one this deployment serves (ADR-0098) — the same construction
 * `listLegacyRedirectMappings` (`blog-post-directory.ts`) and the
 * internal-links preview route already use, so the source/target this writes
 * are the literal public paths a reader would hit, not a guess at them.
 */
function buildBlogPostPublicPath(
  tenantCode: string,
  slug: string,
  locale: string
): string {
  const barePath = `/blog/${tenantCode}/${slug}`;
  return isSupportedLocale(locale)
    ? withPublicLocalePrefix(barePath, locale)
    : barePath;
}

/**
 * Capture a blog post's slug change as a redirect (ADR-0039 `slug_change`
 * origin), gated by the tenant's own `url_change_auto_policy` — never
 * overridden here, so a tenant that wants review keeps getting a proposed
 * (inactive) rule rather than one this hook activates on its behalf. Runs
 * inside the caller's tenant transaction (same one the post update itself
 * runs in), so a proposal/rule and the slug change land together or not at
 * all.
 */
export async function captureBlogPostSlugChangeRedirect(
  tx: Bun.SQL,
  tenantId: string,
  actorTenantUserId: string,
  input: SlugChangeRedirectInput,
  correlationId: string | undefined,
  now: Date = new Date()
): Promise<SlugChangeRedirectOutcome> {
  const seoDistributionEnabled = await resolveModuleEnabled(
    tx,
    tenantId,
    "seo_distribution"
  );

  if (!seoDistributionEnabled) {
    return { outcome: "module_disabled" };
  }

  const tenantRows = (await tx`
    SELECT tenant_code FROM awcms_tenants WHERE id = ${tenantId}
  `) as TenantCodeRow[];
  const tenantCode = tenantRows[0]?.tenant_code ?? "";

  const oldPath = buildBlogPostPublicPath(
    tenantCode,
    input.oldSlug,
    input.oldLocale
  );
  const newPath = buildBlogPostPublicPath(
    tenantCode,
    input.newSlug,
    input.newLocale
  );

  // Sequential, not concurrent: two queries on one transaction connection in
  // parallel leak it (same rule `GET /api/v1/blog/posts/{id}` documents).
  const allowedHosts = await resolveTenantAllowedHosts(tx, tenantId);
  const settings = await fetchRedirectSettings(tx, tenantId);

  const result = await captureUrlChangeRedirect(
    tx,
    tenantId,
    actorTenantUserId,
    {
      oldPath,
      newPath,
      changeType: "slug_change",
      reason: "Slug changed on blog post update (Issue #784)."
    },
    allowedHosts,
    settings.urlChangeAutoPolicy,
    async (auditTx, detail) => {
      await recordAuditEvent(auditTx, {
        tenantId,
        actorTenantUserId,
        moduleKey: "blog_content",
        action: "blog.post.slug_changed.redirect_captured",
        resourceType: "seo_redirect",
        resourceId: detail.redirect.id,
        severity: "info",
        message: `Slug change captured as redirect: ${detail.redirect.normalizedSourcePath} -> ${detail.redirect.target} [${detail.action}].`,
        attributes: {
          postId: input.postId,
          action: detail.action,
          state: detail.redirect.state
        },
        correlationId
      });
    },
    now
  );

  if (result.outcome === "created" || result.outcome === "proposed") {
    return { outcome: result.outcome, redirectId: result.redirect.id };
  }

  if (result.outcome === "rejected") {
    log("warning", "blog-content.post.slug-change-redirect.rejected", {
      correlationId,
      tenantId,
      postId: input.postId,
      oldPath,
      newPath,
      code: result.code,
      message: result.message
    });
    return { outcome: "rejected", code: result.code, message: result.message };
  }

  if (result.outcome === "invalid") {
    log("warning", "blog-content.post.slug-change-redirect.invalid", {
      correlationId,
      tenantId,
      postId: input.postId,
      oldPath,
      newPath,
      errors: result.errors
    });
    return { outcome: "invalid" };
  }

  return { outcome: "skipped" };
}
