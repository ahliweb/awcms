/**
 * The input format for `bun run blog:legacy:import` (Issue #599), and the pure
 * validation of one line of it.
 *
 * ## Why NDJSON and not a database link
 *
 * The archive being migrated is somebody else's live MySQL, on somebody else's
 * host, behind somebody else's credentials. A job in this repo that connected to
 * it would put a second database driver, a second set of secrets and a second
 * network dependency into a codebase whose whole runtime is two dependencies.
 * One file, one line per article, produced by whatever can already read that
 * database, keeps the migration's messy half outside the thing being migrated
 * INTO.
 *
 * One line per article also means the reader never holds 23,906 articles in
 * memory, and a malformed line costs one row rather than the run.
 *
 * ## Rejection is per-row and reported, never silent
 *
 * FR-DSC of this issue is explicit: the converter must REJECT rather than
 * quietly sanitize. That extends to the record around the body. A line missing a
 * `legacyId` is not importable at all — without it the redirect map cannot be
 * derived, which is the entire point — so it is refused rather than imported
 * under a generated id that would look fine until somebody tried to build the
 * 301s.
 */
import type { BlogContentStatus, BlogContentVisibility } from "./post-status";

/** Statuses a legacy row may claim. Anything else is a rejected line. */
const IMPORTABLE_STATUSES = new Set<BlogContentStatus>([
  "draft",
  "published",
  "archived"
]);

const IMPORTABLE_VISIBILITIES = new Set<BlogContentVisibility>([
  "public",
  "private",
  "unlisted"
]);

export const MAX_LEGACY_ID_LENGTH = 128;
export const MAX_LEGACY_TITLE_LENGTH = 500;
export const MAX_LEGACY_SLUG_LENGTH = 200;

export type LegacyImportRecord = {
  legacyId: string;
  title: string;
  slug: string;
  excerpt: string | null;
  /** Raw legacy HTML — converted by `convertLegacyHtmlToPortableText`, never stored as-is. */
  bodyHtml: string;
  locale: string;
  status: BlogContentStatus;
  visibility: BlogContentVisibility;
  publishedAt: Date | null;
  seoTitle: string | null;
  metaDescription: string | null;
};

export type LegacyImportRecordResult =
  { ok: true; value: LegacyImportRecord } | { ok: false; errors: string[] };

function optionalText(value: unknown, max: number): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed.slice(0, max);
}

/**
 * Validates one parsed NDJSON line.
 *
 * Every error is collected rather than thrown on the first one: an operator
 * fixing an export script wants the whole list of what is wrong with a line, not
 * one problem per run.
 */
export function parseLegacyImportRecord(
  raw: unknown,
  defaults: { locale: string }
): LegacyImportRecordResult {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, errors: ["line is not a JSON object"] };
  }

  const record = raw as Record<string, unknown>;
  const errors: string[] = [];

  const legacyId =
    typeof record.legacyId === "string" ? record.legacyId.trim() : "";
  if (legacyId.length === 0 || legacyId.length > MAX_LEGACY_ID_LENGTH) {
    // Without this the redirect map cannot be derived after the fact, which is
    // the permanent loss this whole issue exists to prevent.
    errors.push(
      `legacyId is required and must be 1-${MAX_LEGACY_ID_LENGTH} characters`
    );
  }

  const title = typeof record.title === "string" ? record.title.trim() : "";
  if (title.length === 0 || title.length > MAX_LEGACY_TITLE_LENGTH) {
    errors.push(
      `title is required and must be 1-${MAX_LEGACY_TITLE_LENGTH} characters`
    );
  }

  const slug = typeof record.slug === "string" ? record.slug.trim() : "";
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    // The slug is half of the legacy URL and half of the new one. A legacy
    // export that carries capitals or underscores must be normalized by whoever
    // wrote the export, where the original is still available to check against.
    errors.push(
      "slug must be lowercase alphanumeric words separated by hyphens"
    );
  } else if (slug.length > MAX_LEGACY_SLUG_LENGTH) {
    errors.push(`slug must be at most ${MAX_LEGACY_SLUG_LENGTH} characters`);
  }

  const bodyHtml = typeof record.bodyHtml === "string" ? record.bodyHtml : "";

  const statusRaw =
    typeof record.status === "string" ? record.status : "published";
  if (!IMPORTABLE_STATUSES.has(statusRaw as BlogContentStatus)) {
    errors.push(
      `status must be one of ${[...IMPORTABLE_STATUSES].join(", ")} (got ${JSON.stringify(statusRaw)})`
    );
  }

  const visibilityRaw =
    typeof record.visibility === "string" ? record.visibility : "public";
  if (!IMPORTABLE_VISIBILITIES.has(visibilityRaw as BlogContentVisibility)) {
    errors.push(
      `visibility must be one of ${[...IMPORTABLE_VISIBILITIES].join(", ")} (got ${JSON.stringify(visibilityRaw)})`
    );
  }

  let publishedAt: Date | null = null;
  if (record.publishedAt !== undefined && record.publishedAt !== null) {
    const parsed = new Date(String(record.publishedAt));
    if (Number.isNaN(parsed.getTime())) {
      errors.push(
        `publishedAt is not a parseable date (got ${JSON.stringify(record.publishedAt)})`
      );
    } else {
      publishedAt = parsed;
    }
  }

  if (statusRaw === "published" && publishedAt === null) {
    // A published article with no date would be re-dated to the cutover
    // afternoon, which is the SEO equity loss this issue is about.
    errors.push("publishedAt is required when status is 'published'");
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    value: {
      legacyId,
      title,
      slug,
      excerpt: optionalText(record.excerpt, 1000),
      bodyHtml,
      locale: optionalText(record.locale, 16)?.toLowerCase() ?? defaults.locale,
      status: statusRaw as BlogContentStatus,
      visibility: visibilityRaw as BlogContentVisibility,
      publishedAt,
      seoTitle: optionalText(record.seoTitle, MAX_LEGACY_TITLE_LENGTH),
      metaDescription: optionalText(record.metaDescription, 1000)
    }
  };
}
