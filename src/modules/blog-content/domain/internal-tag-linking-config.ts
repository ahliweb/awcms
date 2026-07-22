/**
 * `BLOG_AUTO_INTERNAL_TAG_LINKS_*` configuration (Issue #641, epic
 * `news_portal` — the feature itself lives in `blog_content`, see
 * `.claude/skills/awcms-news-portal/SKILL.md` §641). Pure — no
 * `process.env` reads here; callers (`scripts/validate-env.ts`,
 * `internal-tag-link-rendering.ts`) pass in whatever `env` they were
 * given. Same split as `news-media-r2-config.ts`/`visitor-analytics/domain/
 * visitor-analytics-config.ts`.
 *
 * These six variables are DEPLOYMENT-WIDE defaults/limits, resolved once
 * per process — they are NOT per-tenant overridable (unlike `enabled`/
 * `caseInsensitive`/`disabledTagIds`, which live in the dedicated
 * `awcms_blog_internal_tag_link_settings` table, one row per tenant,
 * see `internal-tag-link-settings-directory.ts`). `BLOG_AUTO_INTERNAL_TAG_
 * LINKS_ENABLED` is a hard deployment-level kill switch: when `false`, no
 * tenant can turn the feature on regardless of its own per-tenant
 * `enabled` override (same "env is a ceiling, tenant can only narrow it"
 * pattern `news_portal`'s `NEWS_PORTAL_ENABLED` establishes) — see
 * `resolveEffectiveInternalTagLinkingPolicy` in `internal-tag-link-
 * rendering.ts` for where the two are combined.
 */

export type BlogAutoInternalTagLinksConfig = {
  enabled: boolean;
  maxPerPost: number;
  maxPerTag: number;
  minTermLength: number;
  linkFirstOccurrenceOnly: boolean;
  excludeHeadings: boolean;
};

export const BLOG_AUTO_INTERNAL_TAG_LINKS_DEFAULTS: BlogAutoInternalTagLinksConfig =
  {
    enabled: true,
    maxPerPost: 10,
    maxPerTag: 1,
    minTermLength: 3,
    linkFirstOccurrenceOnly: true,
    excludeHeadings: true
  };

/** Upper bound for `BLOG_AUTO_INTERNAL_TAG_LINKS_MAX_PER_POST` — a much higher value would risk turning normal editorial prose into a link farm and would meaningfully slow down rendering of very long articles. */
export const BLOG_AUTO_INTERNAL_TAG_LINKS_MAX_PER_POST_CEILING = 100;

/** Upper bound for `BLOG_AUTO_INTERNAL_TAG_LINKS_MAX_PER_TAG` — linking the same tag more than a handful of times in one post has no real editorial value and looks like keyword stuffing. */
export const BLOG_AUTO_INTERNAL_TAG_LINKS_MAX_PER_TAG_CEILING = 20;

/** Upper bound for `BLOG_AUTO_INTERNAL_TAG_LINKS_MIN_TERM_LENGTH` — a floor this high would make the feature a no-op for most real tag catalogs. */
export const BLOG_AUTO_INTERNAL_TAG_LINKS_MIN_TERM_LENGTH_CEILING = 100;

function isSet(value: string | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (!isSet(value)) return fallback;
  return value === "true";
}

/** `undefined` when unset/blank/non-positive-integer — never throws, never `NaN` (same contract as `news-media-r2-config.ts`'s `parsePositiveInt`). */
export function parsePositiveInt(
  value: string | undefined
): number | undefined {
  if (!isSet(value)) return undefined;

  const trimmed = (value as string).trim();

  if (!/^\d+$/.test(trimmed)) return undefined;

  const parsed = Number.parseInt(trimmed, 10);

  return parsed > 0 ? parsed : undefined;
}

/**
 * Resolves the full config from `env`, falling back to
 * `BLOG_AUTO_INTERNAL_TAG_LINKS_DEFAULTS` for anything unset/malformed.
 * Never throws — out-of-range values are reported by
 * `findBlogAutoInternalTagLinksConfigIssues` (`scripts/validate-env.ts`),
 * not clamped/rejected here (same "resolve leniently, validate separately"
 * split every other config resolver in this repo follows).
 */
export function resolveBlogAutoInternalTagLinksConfig(
  env: NodeJS.ProcessEnv = process.env
): BlogAutoInternalTagLinksConfig {
  return {
    enabled: parseBoolean(
      env.BLOG_AUTO_INTERNAL_TAG_LINKS_ENABLED,
      BLOG_AUTO_INTERNAL_TAG_LINKS_DEFAULTS.enabled
    ),
    maxPerPost:
      parsePositiveInt(env.BLOG_AUTO_INTERNAL_TAG_LINKS_MAX_PER_POST) ??
      BLOG_AUTO_INTERNAL_TAG_LINKS_DEFAULTS.maxPerPost,
    maxPerTag:
      parsePositiveInt(env.BLOG_AUTO_INTERNAL_TAG_LINKS_MAX_PER_TAG) ??
      BLOG_AUTO_INTERNAL_TAG_LINKS_DEFAULTS.maxPerTag,
    minTermLength:
      parsePositiveInt(env.BLOG_AUTO_INTERNAL_TAG_LINKS_MIN_TERM_LENGTH) ??
      BLOG_AUTO_INTERNAL_TAG_LINKS_DEFAULTS.minTermLength,
    linkFirstOccurrenceOnly: parseBoolean(
      env.BLOG_AUTO_INTERNAL_TAG_LINKS_LINK_FIRST_OCCURRENCE_ONLY,
      BLOG_AUTO_INTERNAL_TAG_LINKS_DEFAULTS.linkFirstOccurrenceOnly
    ),
    excludeHeadings: parseBoolean(
      env.BLOG_AUTO_INTERNAL_TAG_LINKS_EXCLUDE_HEADINGS,
      BLOG_AUTO_INTERNAL_TAG_LINKS_DEFAULTS.excludeHeadings
    )
  };
}

export type BlogAutoInternalTagLinksConfigIssue =
  | "max_per_post_out_of_range"
  | "max_per_tag_out_of_range"
  | "min_term_length_out_of_range";

/** Out-of-range numeric knobs (Issue #641's own reasonable bounds, see the ceiling constants above). Empty when every configured value (or its default) is within range. */
export function findBlogAutoInternalTagLinksConfigIssues(
  env: NodeJS.ProcessEnv = process.env
): BlogAutoInternalTagLinksConfigIssue[] {
  const config = resolveBlogAutoInternalTagLinksConfig(env);
  const issues: BlogAutoInternalTagLinksConfigIssue[] = [];

  if (
    config.maxPerPost < 1 ||
    config.maxPerPost > BLOG_AUTO_INTERNAL_TAG_LINKS_MAX_PER_POST_CEILING
  ) {
    issues.push("max_per_post_out_of_range");
  }

  if (
    config.maxPerTag < 1 ||
    config.maxPerTag > BLOG_AUTO_INTERNAL_TAG_LINKS_MAX_PER_TAG_CEILING
  ) {
    issues.push("max_per_tag_out_of_range");
  }

  if (
    config.minTermLength < 1 ||
    config.minTermLength > BLOG_AUTO_INTERNAL_TAG_LINKS_MIN_TERM_LENGTH_CEILING
  ) {
    issues.push("min_term_length_out_of_range");
  }

  return issues;
}
