/**
 * Pure model of the submission REVEAL control (Issue #1477, ADR-0155 section 5).
 *
 * The page script is the only code that touches the DOM; what it decides is
 * here so it can be proved without a browser:
 *
 *  - which sentence an error code maps to. A refusal for lack of permission and
 *    a refusal because the submission does not exist (or is another tenant's)
 *    are ONE sentence, so the control is no existence oracle; the API itself
 *    answers them differently only to a caller that is already authorized.
 *  - which fields of the response are shown. Only the six known contact fields,
 *    only when they are non-empty strings; anything else in a response is
 *    dropped and never reaches the DOM.
 */

/** The only fields a reveal shows, in display order. */
export const REVEAL_FIELDS = [
  "name",
  "email",
  "phone",
  "company",
  "subject",
  "message"
] as const;
export type RevealField = (typeof REVEAL_FIELDS)[number];

export type RevealRow = { field: RevealField; value: string };

/** The keys of the per-sentence `data-*` attributes the page carries. */
export type RevealMessageKey =
  "unavailable" | "withdrawn" | "nothing" | "rateLimited" | "failed";

/**
 * `ACCESS_DENIED` (no permission) and `RESOURCE_NOT_FOUND` (no such submission
 * here) are deliberately the same sentence. An unknown code is the generic
 * failure, never the raw code.
 */
export function revealMessageKey(code: string | null): RevealMessageKey {
  switch (code) {
    case "ACCESS_DENIED":
    case "RESOURCE_NOT_FOUND":
    case "INTERACTIVE_SESSION_REQUIRED":
      return "unavailable";
    case "SUBMISSION_WITHDRAWN":
      return "withdrawn";
    case "NOTHING_TO_REVEAL":
      return "nothing";
    case "RATE_LIMITED":
      return "rateLimited";
    default:
      return "failed";
  }
}

/**
 * The rows to show, or `null` when the response is not a reveal at all (a shape
 * mismatch is a failure, not an empty reveal).
 */
export function revealRows(data: unknown): RevealRow[] | null {
  if (typeof data !== "object" || data === null) return null;

  const contact = (data as { contact?: unknown }).contact;

  if (typeof contact !== "object" || contact === null) return null;

  const rows: RevealRow[] = [];

  for (const field of REVEAL_FIELDS) {
    const value = (contact as Record<string, unknown>)[field];

    if (typeof value === "string" && value.trim().length > 0) {
      rows.push({ field, value });
    }
  }

  return rows;
}

/** How long a revealed value stays on screen before the page drops it. */
export const REVEAL_VISIBLE_MS = 60_000;
