/**
 * The find / run / save idempotency sequence every mutating tax route shares
 * (skill `awcms-idempotency`, doc 10 §Idempotency wrapper rules).
 *
 * Written once because four routes need it and the failure mode of getting it
 * slightly different in one of them is a double-posted tax document. The shape:
 *
 * - same key + same request hash  -> replay the stored response;
 * - same key + different hash     -> `409 IDEMPOTENCY_CONFLICT`;
 * - unseen key                    -> run, and persist ONLY a success.
 *
 * A `Response` returned by `run` is a refusal (4xx) and is deliberately NOT
 * stored: a caller who fixes the request and retries with the same key must get
 * the new answer, not the old error. Everything runs in the caller's tenant
 * transaction, so the idempotency row commits atomically with the mutation it
 * guards — and a lost race surfaces as `IdempotencyRaceLostError`, which
 * `withTenant` already knows how to turn into a replay or a 409.
 */
import { fail, jsonResponse } from "../../_shared/api-response";
import {
  findIdempotencyRecord,
  saveIdempotencyRecord
} from "../../_shared/idempotency";

export type IdempotentOutcome =
  Response | { status: 200 | 201; body: { success: true; data: unknown } };

export async function runIdempotent(
  tx: Bun.SQL,
  tenantId: string,
  scope: string,
  idempotencyKey: string,
  requestHash: string,
  run: () => Promise<IdempotentOutcome>
): Promise<Response> {
  const existing = await findIdempotencyRecord(
    tx,
    tenantId,
    scope,
    idempotencyKey
  );

  if (existing) {
    if (existing.requestHash !== requestHash) {
      return fail(
        409,
        "IDEMPOTENCY_CONFLICT",
        "Idempotency-Key was already used with a different request."
      );
    }

    return jsonResponse(existing.responseBody, {
      status: existing.responseStatus
    });
  }

  const outcome = await run();

  if (outcome instanceof Response) return outcome;

  await saveIdempotencyRecord(
    tx,
    tenantId,
    scope,
    idempotencyKey,
    requestHash,
    outcome.status,
    outcome.body
  );

  return jsonResponse(outcome.body, { status: outcome.status });
}
