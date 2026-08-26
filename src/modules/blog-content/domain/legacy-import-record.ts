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
/**
 * A `src` longer than this is refused rather than truncated. Every other
 * optional text field here is `slice`d to its cap, which is right for prose and
 * wrong for a reference: a truncated `src` is a DIFFERENT file, and it would go
 * on to miss the media map silently instead of loudly.
 */
export const MAX_LEGACY_IMAGE_SRC_LENGTH = 2048;

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
  /**
   * Legacy category names, EXACTLY as the old system spelled them. Resolved to
   * this tenant's terms through `--term-map`; never created from a name.
   *
   * Empty is legitimate — an archive may genuinely file nothing — which is why
   * the importer refuses only a name it was given no mapping for, rather than
   * demanding every row carry one.
   */
  categories: readonly string[];
  /**
   * The LEAD photograph's `src`, EXACTLY as the legacy row spells it — for
   * SeputarBorneo that is the `foto_berita` column, and all 25,029 rows have
   * one. Resolved to a managed media object through `--media-map`, the same
   * handoff a body `<img>` goes through and against the same registry check;
   * never fetched, never stored as a URL.
   *
   * It has to be its own field because it is not in the body: `--images` used
   * to scan body HTML only, so the upload set it wrote was the archive's 2
   * inline images and none of its 25,029 lead photographs (ADR-0114, and the
   * ORIGIN ROUND in `docs/PROJECT_STATE.md` §4).
   *
   * NOT trimmed and not normalised, for the reason `legacy-media-map.ts` gives
   * at length: the map is keyed on the literal string, and a wrong match loses
   * the photograph exactly as quietly as a missing one. Absent, `null` and `""`
   * all mean "this row has no lead photograph" — an export writes the empty
   * string for that, and refusing it would refuse the rows that are FINE.
   */
  featuredImageSrc: string | null;
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
    // This slug is the NEW URL's slug and only that. It is NOT "half of the
    // legacy URL" — an earlier comment here said so, and ADR-0114 records why
    // that was false: the SeputarBorneo legacy segment is
    // `rawurlencode(str_replace(' ', '_', title))`, so every one of 25,029 of
    // them carries `_` and most carry capitals, both of which this pattern
    // forbids. The two slugs are disjoint BY CONSTRUCTION, so no export can
    // ever be "normalized" into a slug that also matches the indexed path.
    // Legacy URLs are resolved by their leading id (ADR-0114 §Decision 2), not
    // by matching this value.
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

  // Absent is fine and means "files under nothing". A PRESENT field that is not
  // a list of names is refused rather than coerced: a single string here almost
  // certainly means the export writes one category per row and someone will
  // later add a second, and silently reading it as one name would file every
  // article of that day under a category called `Politik,Daerah`.
  const categories: string[] = [];
  if (record.categories !== undefined && record.categories !== null) {
    if (!Array.isArray(record.categories)) {
      errors.push("categories must be an array of category names");
    } else {
      for (const entry of record.categories) {
        if (typeof entry !== "string" || entry.trim().length === 0) {
          errors.push(
            `categories contains ${JSON.stringify(entry)}, which is not a category name`
          );
          continue;
        }
        categories.push(entry.trim());
      }
    }
  }

  // The lead photograph. Absent/null/blank is legitimate and means the row has
  // none; a PRESENT value that is not a string is refused rather than coerced,
  // for the same reason `categories` refuses a bare string — `String(0)` is
  // `"0"`, and an export that writes `0` for "no photo" would otherwise send
  // every one of those rows looking for a media map entry called `0`.
  let featuredImageSrc: string | null = null;
  if (
    record.featuredImageSrc !== undefined &&
    record.featuredImageSrc !== null
  ) {
    if (typeof record.featuredImageSrc !== "string") {
      errors.push(
        `featuredImageSrc must be the image's src as a string (got ${JSON.stringify(record.featuredImageSrc)})`
      );
    } else if (record.featuredImageSrc.trim().length === 0) {
      featuredImageSrc = null;
    } else if (record.featuredImageSrc.length > MAX_LEGACY_IMAGE_SRC_LENGTH) {
      // Refused, not sliced — see MAX_LEGACY_IMAGE_SRC_LENGTH.
      errors.push(
        `featuredImageSrc must be at most ${MAX_LEGACY_IMAGE_SRC_LENGTH} characters`
      );
    } else {
      featuredImageSrc = record.featuredImageSrc;
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    value: {
      featuredImageSrc,
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
      metaDescription: optionalText(record.metaDescription, 1000),
      // Deduplicated here rather than at assignment time: a legacy row listing
      // the same rubrik twice is one filing, and `syncPostTermAssignments`
      // would otherwise try to insert the pair twice.
      categories: [...new Set(categories)]
    }
  };
}
