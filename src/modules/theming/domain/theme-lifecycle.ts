/**
 * Theme configuration lifecycle (Issue #269, ADR-0029 §4). Pure state-machine
 * helpers — the persistence layer (`application/theme-config-directory.ts`) and
 * the DB trigger (sql/033) are the real enforcers; these functions make the
 * allowed transitions explicit + unit-testable.
 *
 * Lifecycle: **draft → validate → preview → publish → rollback/retire.**
 *
 * `validate` and `preview` are READ-ONLY actions (they inspect a draft, writing
 * no new state), so a persisted config version has only two statuses:
 *
 *  - `draft`     — the single, mutable work-in-progress config for a tenant.
 *  - `published` — an IMMUTABLE, numbered version. A change never mutates a
 *                  published row; it produces a NEW published version.
 *
 * "rollback" and "retire" are transitions of the tenant's ACTIVE POINTER
 * (`awcms_theming_tenant_state.active_version_id`), not of any version
 * row — so published versions stay immutable and history is preserved.
 */

export type ThemeVersionStatus = "draft" | "published";

export type ThemeConfigAction =
  "save_draft" | "validate" | "preview" | "publish" | "rollback" | "retire";

/** A published version may become the active pointer via publish or rollback; a draft never can. */
export function canActivateVersion(status: ThemeVersionStatus): boolean {
  return status === "published";
}

/** Only a draft may be published; publishing a non-draft is a programming error. */
export function canPublishFromStatus(status: ThemeVersionStatus): boolean {
  return status === "draft";
}

/**
 * Whether a version row may be mutated in place. ONLY drafts. A published row is
 * immutable (this mirrors the sql/033 trigger that raises on UPDATE/DELETE of a
 * `status='published'` row — the pure twin of the DB enforcement).
 */
export function isVersionMutable(status: ThemeVersionStatus): boolean {
  return status === "draft";
}

/**
 * Validate a requested rollback target: it must be a real published version id
 * belonging to this tenant (the caller resolves the set of the tenant's own
 * published version ids and passes it here). Returns `true` when the target is
 * a valid rollback destination.
 */
export function isValidRollbackTarget(
  targetVersionId: string,
  tenantPublishedVersionIds: readonly string[]
): boolean {
  return tenantPublishedVersionIds.includes(targetVersionId);
}
