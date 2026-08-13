/**
 * Permission KEY CONSTANTS for the subject-rights surface — ADR-0094 gelombang
 * 2, Issue #557. Single source of truth reused verbatim by `module.ts`'s
 * `permissions` array, the seed migration (`sql/126`), the SoD rule, the admin
 * screen, and every route handler's `authorizeInTransaction` guard.
 *
 * ## Four keys, and each split answers a different question
 *
 * Issue #557 asked for two: export and erasure are not one authority. That is
 * the first split, and it is about the KIND of harm — one discloses a person,
 * the other destroys the link to them, and holding the power to read is no
 * argument for holding the power to erase.
 *
 * The second split is inside erasure, because ADR-0094 Decision 3 makes it
 * maker/checker. A maker and a checker who share one key are not a maker and a
 * checker; they are one person doing both halves. So `create` requests and
 * `approve` executes, exactly as `legal_hold.create`/`.release` already do —
 * and `SUBJECT_ERASURE_MAKER_CHECKER_RULE` makes holding both a `critical`
 * conflict rather than a convenience.
 *
 * `subject_request.read` exists so the inbox can be watched by somebody holding
 * neither of the dangerous keys. A data-protection officer whose job is to see
 * that requests are being answered should not have to hold the export
 * authority to do it.
 */
export const SUBJECT_REQUEST_PERMISSIONS = {
  /** Read the request log and the pending-erasure inbox. Discloses no subject data. */
  read: "data_lifecycle.subject_request.read",
  /** Perform a subject-access export. A DISCLOSURE, audited as one. */
  export: "data_lifecycle.subject_request.export",
  /** Request an erasure — the maker half. Never executes anything. */
  erasureCreate: "data_lifecycle.subject_erasure.create",
  /** Approve (and thereby execute) or reject a pending erasure — the checker half. */
  erasureApprove: "data_lifecycle.subject_erasure.approve"
} as const;

export type SubjectRequestPermissionKey =
  keyof typeof SUBJECT_REQUEST_PERMISSIONS;

/**
 * The SoD rule key, exported so the rule descriptor in `module.ts` and any test
 * asserting the conflict name the same string.
 */
export const SUBJECT_ERASURE_MAKER_CHECKER_RULE =
  "data_lifecycle.subject_erasure_maker_checker";
