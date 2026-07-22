/**
 * Application-layer orchestration for automatic internal tag linking
 * (Issue #641) — the single place that combines deployment config
 * (`internal-tag-linking-config.ts`), tenant policy
 * (`internal-tag-link-settings-directory.ts`), the tenant's tag catalog
 * (`blog-taxonomy-directory.ts`), and a per-post override flag into one
 * resolved `InternalTagLinkingPolicy` + candidate list, then calls the
 * pure rendering engine (`internal-tag-linking.ts`). Both public post
 * routes (`/news/{slug}`, `/blog/{tenantCode}/{slug}`) and the admin
 * preview endpoint (`GET /api/v1/blog/posts/{id}/internal-links/preview`)
 * call through here so the "which tags are eligible, what's the effective
 * policy" logic can never drift between render time and preview time.
 */
import {
  resolveBlogAutoInternalTagLinksConfig,
  type BlogAutoInternalTagLinksConfig
} from "../domain/internal-tag-linking-config";
import {
  applyInternalTagLinksToHtml,
  type InternalTagLinkCandidate,
  type InternalTagLinkingPolicy,
  type InternalTagLinkingResult
} from "../domain/internal-tag-linking";
import { listBlogTerms } from "./blog-taxonomy-directory";
import { fetchInternalTagLinkingSettings } from "./internal-tag-link-settings-directory";

export type InternalTagLinkingDisabledReason =
  "deployment_disabled" | "tenant_disabled" | "post_disabled";

export type InternalTagLinkingContext = {
  /** Final resolved enabled flag — env AND tenant AND (caller-supplied) per-post flag. */
  enabled: boolean;
  disabledReason: InternalTagLinkingDisabledReason | null;
  policy: InternalTagLinkingPolicy;
  candidates: InternalTagLinkCandidate[];
};

function buildTagArchiveUrl(basePath: string, slug: string): string {
  return `${basePath}/tag/${slug}`;
}

/**
 * Resolves the full linking context for one tenant/post. `postAuto
 * InternalTagLinksDisabled` is the caller-supplied per-post override
 * (`awcms_blog_posts.auto_internal_tag_links_disabled`) — this
 * function does not fetch the post itself (callers already have it).
 *
 * When disabled at ANY level, `candidates` is still populated for callers
 * that want to show it (currently none do) but `enabled: false` and
 * `disabledReason` tells the caller not to bother rendering/linking at
 * all — `applyInternalTagLinksToHtml` itself also independently no-ops on
 * `policy.enabled === false`, so this is defense-in-depth, not the only
 * gate.
 */
export async function resolveInternalTagLinkingContext(
  tx: Bun.SQL,
  tenantId: string,
  basePath: string,
  postAutoInternalTagLinksDisabled: boolean,
  env: NodeJS.ProcessEnv = process.env
): Promise<InternalTagLinkingContext> {
  const deploymentConfig: BlogAutoInternalTagLinksConfig =
    resolveBlogAutoInternalTagLinksConfig(env);
  const tenantSettings = await fetchInternalTagLinkingSettings(tx, tenantId);

  let disabledReason: InternalTagLinkingDisabledReason | null = null;
  if (!deploymentConfig.enabled) {
    disabledReason = "deployment_disabled";
  } else if (!tenantSettings.enabled) {
    disabledReason = "tenant_disabled";
  } else if (postAutoInternalTagLinksDisabled) {
    disabledReason = "post_disabled";
  }

  const enabled = disabledReason === null;

  const allTags = await listBlogTerms(tx, tenantId, { taxonomyType: "tag" });
  const disabledTagIdSet = new Set(tenantSettings.disabledTagIds);
  const candidates: InternalTagLinkCandidate[] = allTags
    .filter((term) => !disabledTagIdSet.has(term.id))
    .map((term) => ({
      tagId: term.id,
      name: term.name,
      url: buildTagArchiveUrl(basePath, term.slug)
    }));

  const policy: InternalTagLinkingPolicy = {
    enabled,
    maxPerPost: deploymentConfig.maxPerPost,
    maxPerTag: deploymentConfig.maxPerTag,
    minTermLength: deploymentConfig.minTermLength,
    linkFirstOccurrenceOnly: deploymentConfig.linkFirstOccurrenceOnly,
    excludeHeadings: deploymentConfig.excludeHeadings,
    caseInsensitive: tenantSettings.caseInsensitive
  };

  return { enabled, disabledReason, policy, candidates };
}

/**
 * Convenience wrapper for the public post-detail routes — resolves the
 * context and applies linking in one call, discarding match details (the
 * routes only need the final HTML). Never throws on a missing/misconfigured
 * tenant policy row (`fetchInternalTagLinkingSettings` already falls back
 * to defaults) — a rendering failure here would take down the whole public
 * page, so this function's contract is "always returns renderable HTML."
 */
export async function renderContentHtmlWithInternalTagLinks(
  tx: Bun.SQL,
  tenantId: string,
  html: string,
  postAutoInternalTagLinksDisabled: boolean,
  basePath: string,
  env: NodeJS.ProcessEnv = process.env
): Promise<string> {
  const context = await resolveInternalTagLinkingContext(
    tx,
    tenantId,
    basePath,
    postAutoInternalTagLinksDisabled,
    env
  );

  if (!context.enabled) {
    return html;
  }

  const result = await applyInternalTagLinksToHtml(
    html,
    context.candidates,
    context.policy
  );

  return result.html;
}

export type InternalTagLinkingPreview = {
  enabled: boolean;
  disabledReason: InternalTagLinkingDisabledReason | null;
  result: InternalTagLinkingResult;
};

/**
 * Used by the preview endpoint — same resolution as the render path above,
 * but returns the full `matches` list (and reports `disabledReason`
 * instead of silently no-op'ing) so an editor can see WHY nothing would be
 * linked, not just that nothing was.
 */
export async function previewInternalTagLinksForContent(
  tx: Bun.SQL,
  tenantId: string,
  html: string,
  postAutoInternalTagLinksDisabled: boolean,
  basePath: string,
  env: NodeJS.ProcessEnv = process.env
): Promise<InternalTagLinkingPreview> {
  const context = await resolveInternalTagLinkingContext(
    tx,
    tenantId,
    basePath,
    postAutoInternalTagLinksDisabled,
    env
  );

  if (!context.enabled) {
    return {
      enabled: false,
      disabledReason: context.disabledReason,
      result: { html, matches: [] }
    };
  }

  const result = await applyInternalTagLinksToHtml(
    html,
    context.candidates,
    context.policy
  );

  return { enabled: true, disabledReason: null, result };
}
