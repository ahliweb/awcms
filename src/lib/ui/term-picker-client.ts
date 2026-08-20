/**
 * The term picker's data half (Issue #595).
 *
 * `POST`/`PATCH /api/v1/blog/posts` have accepted `termIds` since Issue #539,
 * and no screen has ever sent one — so every article published with no
 * category, no channel and no topic, and `sql/131` split those into real
 * vocabularies that nothing could assign.
 *
 * ## Why this needs no new gate on `/admin/blog`
 *
 * The page header used to state the blocker like this: "a picker needs the
 * taxonomy catalogue, and reading it under this screen's `posts.*` gates would
 * be a read with no permission of its own".
 *
 * That is true of a SERVER-side read, and it is why the header pinned the
 * screen to eleven keys. It is not true of a browser fetch against
 * `GET /api/v1/blog/terms`, which enforces `blog_content.taxonomies.read`
 * itself — the same resolution the media picker reached in the same issue.
 * Authority stays with the endpoint, the eleven-key contract is untouched, and
 * an editor without `taxonomies.read` is told so rather than shown an empty
 * vocabulary.
 *
 * ## Grouped by vocabulary, because they are four different questions
 *
 * `sql/131` made `category`, `tag`, `channel` and `topic` distinct types
 * precisely so "which channel" and "which topic" stop being one string. A flat
 * list of every term would hand that distinction straight back — an editor
 * would pick two channels and no topic without the form ever suggesting
 * otherwise.
 */
import {
  TAXONOMY_TYPES,
  type TaxonomyType
} from "../../modules/blog-content/domain/taxonomy-policy";

export type PickableTerm = {
  id: string;
  name: string;
  slug: string;
  taxonomyType: TaxonomyType;
};

export type TermPickerResult =
  | { ok: true; groups: TermGroup[] }
  | { ok: false; reason: "forbidden" | "unavailable" };

export type TermGroup = {
  taxonomyType: TaxonomyType;
  terms: PickableTerm[];
};

/** The one query this picker issues. Exported so a test can pin it. */
export const TERM_LIST_URL = "/api/v1/blog/terms";

export async function fetchPickableTerms(
  fetchImpl: typeof fetch = fetch
): Promise<TermPickerResult> {
  let response: Response;

  try {
    response = await fetchImpl(TERM_LIST_URL, { credentials: "same-origin" });
  } catch {
    return { ok: false, reason: "unavailable" };
  }

  if (response.status === 403) return { ok: false, reason: "forbidden" };
  if (!response.ok) return { ok: false, reason: "unavailable" };

  const payload = (await response.json().catch(() => null)) as {
    success?: boolean;
    data?: { terms?: unknown };
  } | null;

  if (payload?.success !== true || !Array.isArray(payload.data?.terms)) {
    return { ok: false, reason: "unavailable" };
  }

  return { ok: true, groups: groupTerms(payload.data.terms.map(toTerm)) };
}

function toTerm(raw: unknown): PickableTerm | null {
  const record = (raw ?? {}) as Record<string, unknown>;
  const taxonomyType = record.taxonomyType;

  // An unknown vocabulary is DROPPED rather than shown under a heading this
  // build does not know about. `TAXONOMY_TYPES` is the runtime constant the
  // validator shares, so a server that grows a fifth type does not silently
  // render as an unlabelled group here.
  if (
    typeof record.id !== "string" ||
    record.id === "" ||
    typeof record.name !== "string" ||
    typeof record.slug !== "string" ||
    typeof taxonomyType !== "string" ||
    !(TAXONOMY_TYPES as readonly string[]).includes(taxonomyType)
  ) {
    return null;
  }

  return {
    id: record.id,
    name: record.name,
    slug: record.slug,
    taxonomyType: taxonomyType as TaxonomyType
  };
}

/**
 * Groups in `TAXONOMY_TYPES` order, and keeps a vocabulary with no terms.
 *
 * An empty group renders as "no channels defined yet", which is a different
 * message from the channel picker being absent — and the second is what an
 * editor would otherwise conclude.
 */
export function groupTerms(terms: Array<PickableTerm | null>): TermGroup[] {
  const usable = terms.filter((term): term is PickableTerm => term !== null);

  return TAXONOMY_TYPES.map((taxonomyType) => ({
    taxonomyType,
    terms: usable
      .filter((term) => term.taxonomyType === taxonomyType)
      .sort((a, b) => a.name.localeCompare(b.name))
  }));
}
