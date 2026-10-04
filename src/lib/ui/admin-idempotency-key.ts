/**
 * One `Idempotency-Key` per ATTEMPT-AT-THE-SAME-REQUEST, for the admin screens
 * that send a high-risk mutation (inventory adjustment/transfer/policy, tax
 * rule-version create/publish).
 *
 * ## Why not a fresh `crypto.randomUUID()` per click
 *
 * The point of the key is that a retry of the SAME request replays instead of
 * repeating. A fresh key per click turns "the network dropped my response, I
 * pressed the button again" into two postings.
 *
 * ## Why not one key per page load
 *
 * The server hashes the request body against the key and refuses the same key
 * with a DIFFERENT body (that is the whole replay guard). An operator who
 * presses Save, gets a validation error, corrects the quantity and presses Save
 * again has sent a different request, and that needs a different key.
 *
 * So: the key is derived from the request's content. The same serialised body
 * returns the key it had last time; any other body draws a new one. The page
 * reloads on success, which discards the memory, so the next genuine request
 * never inherits the key of a finished one.
 *
 * ## Known limitations (deliberate: the memory is per page load, not persisted)
 *
 * 1. Only the LAST body is remembered. Alternating A -> B -> A draws a fresh key
 *    for the second A, so A's first key is forgotten; if A's first request had
 *    in fact succeeded server-side, the second A is a new request to the server.
 * 2. A lost success response followed by a MANUAL page reload discards the
 *    memory, so the re-submit draws a fresh key. For inventory adjustments and
 *    transfers the key doubles as the source id, so that re-submit can post
 *    twice. Pressing the button again WITHOUT reloading is the safe retry.
 *
 * Closing (2) would need a server-visible pending marker or a key persisted
 * across reloads; neither exists yet (Issue #900 follow-up, not built here).
 */
export type IdempotencyKeySource = (payload: unknown) => string;

export function createIdempotencyKeySource(): IdempotencyKeySource {
  let lastBody: string | null = null;
  let lastKey: string | null = null;

  return (payload) => {
    const body = JSON.stringify(payload ?? null);

    if (lastKey === null || body !== lastBody) {
      lastKey = crypto.randomUUID();
      lastBody = body;
    }

    return lastKey;
  };
}
