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
import { countTags, listTagLinkCandidates } from "./blog-taxonomy-directory";
import { fetchInternalTagLinkingSettings } from "./internal-tag-link-settings-directory";

export type InternalTagLinkingDisabledReason =
  "deployment_disabled" | "tenant_disabled" | "post_disabled";

/**
 * How many tags may enter the matching engine at once (Issue #648).
 *
 * A REAL bound, and it lives here rather than being inherited from an admin
 * list: `createInternalTagLinkEngine` compiles one alternation regex from every
 * candidate, so an unbounded vocabulary means a very large regex compiled on a
 * public post render.
 *
 * What it replaces is the accidental bound — `listBlogTerms`' hundred rows,
 * `ORDER BY name ASC`, chosen for a table an administrator scrolls. That made
 * whether a tag was ever linked a function of its FIRST LETTER, on any tenant
 * with more than a hundred tags, with nothing anywhere saying so.
 *
 * 500 rather than 100 because the cost is a longer regex rather than a longer
 * page, and because the tags past the first hundred on a real newsroom are
 * ordinary topics — not a long tail nobody uses. It is deliberately not
 * "unbounded with a warning": a bound that can be exceeded is a bound.
 */
export const MAX_INTERNAL_TAG_LINK_CANDIDATES = 500;

export type InternalTagLinkingContext = {
  /** Final resolved enabled flag — env AND tenant AND (caller-supplied) per-post flag. */
  enabled: boolean;
  disabledReason: InternalTagLinkingDisabledReason | null;
  policy: InternalTagLinkingPolicy;
  candidates: InternalTagLinkCandidate[];
  /**
   * The tenant's whole tag vocabulary, and how much of it the engine saw.
   *
   * Reported rather than inferred from `candidates.length`, because that number
   * has already had the tenant's disabled tags and short names removed from it
   * — a caller comparing it against the cap would call a vocabulary truncated
   * when it was merely filtered.
   */
  vocabulary: {
    /** Non-deleted tags this tenant has. */
    total: number;
    /** The cap that was applied. */
    limit: number;
    /** True when the vocabulary is larger than the cap, so some tags cannot be linked. */
    truncated: boolean;
  };
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

  // Most-used first, bounded HERE rather than by whatever the admin list
  // happens to return — see `MAX_INTERNAL_TAG_LINK_CANDIDATES`.
  const tags = await listTagLinkCandidates(
    tx,
    tenantId,
    MAX_INTERNAL_TAG_LINK_CANDIDATES
  );
  const totalTags = await countTags(tx, tenantId);
  const disabledTagIdSet = new Set(tenantSettings.disabledTagIds);
  const candidates: InternalTagLinkCandidate[] = tags
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

  return {
    enabled,
    disabledReason,
    policy,
    candidates,
    vocabulary: {
      total: totalTags,
      limit: MAX_INTERNAL_TAG_LINK_CANDIDATES,
      truncated: totalTags > MAX_INTERNAL_TAG_LINK_CANDIDATES
    }
  };
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
  /**
   * Carried through so the endpoint can tell an editor that the vocabulary was
   * capped (Issue #648).
   *
   * Without it, the answer to "why was this tag not linked?" is the same empty
   * `matches` list whether the tag is disabled, too short, absent from the
   * body, or simply past the cap — and only the last of those is not the
   * editor's doing.
   */
  vocabulary: InternalTagLinkingContext["vocabulary"];
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
      result: { html, matches: [] },
      vocabulary: context.vocabulary
    };
  }

  const result = await applyInternalTagLinksToHtml(
    html,
    context.candidates,
    context.policy
  );

  return {
    enabled: true,
    disabledReason: null,
    result,
    vocabulary: context.vocabulary
  };
}
