/**
 * Bounds this module's operator-facing endpoints validate, in one place so a
 * form and its validator cannot drift apart.
 *
 * These were four inline literals across three route files. That is fine while
 * `curl` is the only client — it stops being fine the moment a screen renders
 * `minlength`/`min`/`max` attributes for them, because a hand-typed bound in
 * the markup produces a browser that happily submits what the server then
 * rejects with a 400 the user cannot act on. Same reasoning
 * `data_lifecycle/domain/legal-hold.ts` records for its own exported bounds.
 *
 * Pure constants — no I/O, no imports.
 */

/**
 * A scheduled export may run at most four times an hour. Below this the
 * dispatcher's own 15-minute recommended schedule could not honour the
 * interval anyway (`reporting`'s `bun run reporting:exports:dispatch` job).
 */
export const MIN_EXPORT_INTERVAL_MINUTES = 15;

/** 30 days. */
export const MAX_EXPORT_INTERVAL_MINUTES = 60 * 24 * 30;

/**
 * Reason text accompanying a rebuild trigger or a schedule disable. Required
 * (a zero-length reason is rejected) — both actions are audited, and an audit
 * row whose reason is empty records that something happened without recording
 * why.
 */
export const MIN_REASON_LENGTH = 1;
export const MAX_REASON_LENGTH = 500;
