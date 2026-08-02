/**
 * The reason-text bound every operator action in this module validates
 * against, in one place.
 *
 * `const MAX_REASON_LENGTH = 500` was written out five separate times — once
 * privately in `workflow-delegation.ts` and once in each of four route files.
 * Five copies of a number agree until one of them is edited. That was survivable
 * while `curl` was the only client; it stops being survivable the moment a
 * screen renders `maxlength` from it, because a form built against a stale copy
 * accepts text the server then rejects with a 400 the operator cannot act on.
 *
 * Every one of these actions is audited, and a decision recorded without a
 * reason records that something happened without recording why — which is why
 * the minimum is 1 and not 0 for the mandatory-reason paths.
 *
 * Pure constants — no I/O, no imports.
 */
export const MIN_REASON_LENGTH = 1;
export const MAX_REASON_LENGTH = 500;
