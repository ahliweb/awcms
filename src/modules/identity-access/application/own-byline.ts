/**
 * The caller's OWN public byline (ADR-0109, Issue #597 item 4).
 *
 * A separate file from `user-admin.ts` on purpose: everything in there takes a
 * `tenantUserId` from the request and is gated by an ABAC guard, because it acts
 * on somebody else. This one accepts no id at all — the row it writes is the one
 * behind the calling session — which is the same shape, and the same reasoning,
 * as `updateOwnDisplayName` in `profile_identity`.
 *
 * ## Why there is no administrative sibling
 *
 * Deliberate, and it is the whole posture of the feature. A byline is the name a
 * writer is published under; an editor who could set somebody else's byline
 * could publish an article under a colleague's name. The one operation an
 * administrator has is the one that already exists — deactivating the account —
 * and the one an erasure has is `anonymizedColumns` (ADR-0108).
 *
 * ## Why no audit event
 *
 * The same reasoning `updateOwnDisplayName` records: `awcms_audit_events` is
 * about what somebody did to somebody ELSE. A person changing the name they
 * write under has no actor/subject split, and the value is visible on every
 * article they have published — which is a louder record than an audit row
 * nobody queries.
 */

/**
 * The published ceiling, matching `sql/146`'s CHECK.
 *
 * `awcms_comments_comments.author_display_name` uses the same 120 for the same
 * kind of value. An internal display name is allowed 200; a byline is rendered
 * inline in a page's chrome and carried into JSON-LD, so it is the shorter one.
 */
export const MAX_PUBLIC_BYLINE_LENGTH = 120;

export type PublicBylineValidation =
  { valid: true; value: string | null } | { valid: false; message: string };

/**
 * Validate and normalise a submitted byline.
 *
 * `null` is a legitimate value and means "no byline" — the article falls back to
 * the organisation-level attribution ADR-0102 already ships. An empty or
 * whitespace-only string normalises to `null` rather than being refused: a
 * person clearing the field in a form sends `""`, and answering that with a
 * validation error would make "I do not want a byline" the one intention the
 * screen cannot express.
 *
 * Control characters are refused rather than stripped. The value is rendered
 * inline and carried into structured data, so a newline inside it is a defect in
 * both — and silently rewriting what somebody typed as their own NAME is worse
 * than telling them.
 */
export function validatePublicBylineName(raw: unknown): PublicBylineValidation {
  if (raw === null) {
    return { valid: true, value: null };
  }

  if (typeof raw !== "string") {
    return {
      valid: false,
      message: "publicBylineName must be a string or null."
    };
  }

  const trimmed = raw.trim();

  if (trimmed.length === 0) {
    return { valid: true, value: null };
  }

  if (trimmed.length > MAX_PUBLIC_BYLINE_LENGTH) {
    return {
      valid: false,
      message: `publicBylineName must be at most ${MAX_PUBLIC_BYLINE_LENGTH} characters.`
    };
  }

  // Written as escapes, never as literal characters: a literal control
  // character in source is invisible in a diff and in a review.
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(trimmed)) {
    return {
      valid: false,
      message: "publicBylineName must not contain control characters."
    };
  }

  return { valid: true, value: trimmed };
}

/**
 * Write the calling session's own byline. Returns `null` when the session's
 * identity has no membership row in this tenant — an invariant violation the
 * caller answers as an authentication failure, not a 404.
 *
 * Keyed through `identity_id`, never through a supplied `tenantUserId`: that is
 * what makes it structurally impossible to point at somebody else. The
 * `tenant_id` predicate is belt-and-braces over FORCE RLS, as everywhere else in
 * this repo.
 */
export async function updateOwnPublicBylineName(
  tx: Bun.SQL,
  tenantId: string,
  identityId: string,
  publicBylineName: string | null
): Promise<{ tenantUserId: string; publicBylineName: string | null } | null> {
  const rows = (await tx`
    UPDATE awcms_tenant_users
    SET public_byline_name = ${publicBylineName},
        updated_at = now()
    WHERE tenant_id = ${tenantId}
      AND identity_id = ${identityId}
    RETURNING id, public_byline_name
  `) as Array<{ id: string; public_byline_name: string | null }>;

  const row = rows[0];

  return row
    ? { tenantUserId: row.id, publicBylineName: row.public_byline_name }
    : null;
}

/**
 * The calling session's own byline, unchanged.
 *
 * Exists so a PATCH that did not mention the byline can still return it. A
 * response that omitted the field because this particular request did not touch
 * it would be read by the screen re-rendering from it as "it was cleared" — the
 * defect #649 hit when `PATCH /api/v1/blog/posts/{id}` accepted `institutionIds`
 * and answered without them.
 */
export async function readOwnPublicByline(
  tx: Bun.SQL,
  tenantId: string,
  identityId: string
): Promise<string | null> {
  const rows = (await tx`
    SELECT public_byline_name
    FROM awcms_tenant_users
    WHERE tenant_id = ${tenantId} AND identity_id = ${identityId}
  `) as Array<{ public_byline_name: string | null }>;

  return rows[0]?.public_byline_name ?? null;
}

/**
 * Resolve bylines for a page of authors — ONE query for the whole page.
 *
 * The shape #649 argued for when the feed did not carry an article's categories:
 * "taking it per post means one extra query per post" is true and the conclusion
 * does not follow, because a page of fifty posts needs one query holding fifty
 * ids. A `Map` rather than an array so the caller joins by id without a scan.
 *
 * An author with no byline is simply absent from the map — the caller reads that
 * as `null`, which is the organisation-level attribution.
 */
export async function fetchPublicBylinesForAuthors(
  tx: Bun.SQL,
  tenantId: string,
  tenantUserIds: readonly string[]
): Promise<Map<string, string>> {
  const byAuthor = new Map<string, string>();
  const unique = [...new Set(tenantUserIds)];

  if (unique.length === 0) {
    return byAuthor;
  }

  // `= ANY(sql.array(...))`, never a bare interpolated array: Bun.SQL sends a
  // plain JS array as a comma-joined STRING, which arrives as a 22P02 at
  // runtime and is invisible in review.
  const rows = (await tx`
    SELECT id, public_byline_name
    FROM awcms_tenant_users
    WHERE tenant_id = ${tenantId}
      AND id = ANY(${tx.array(unique, "uuid")})
      AND public_byline_name IS NOT NULL
  `) as Array<{ id: string; public_byline_name: string }>;

  for (const row of rows) {
    byAuthor.set(row.id, row.public_byline_name);
  }

  return byAuthor;
}
