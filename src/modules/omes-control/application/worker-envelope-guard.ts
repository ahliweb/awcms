/**
 * The single chokepoint every session-UNauthenticated worker route
 * (`/worker/poll`, `/worker/result`, `/worker/heartbeat`) calls BEFORE any
 * side-effecting work, ahliweb/omes#199.
 *
 * This exists because of a recorded failure mode in this codebase (ADR-0063,
 * `access:chokepoint:check`): a route that does work in its own
 * `prepare`/setup phase before authorization runs, so a static "does this
 * route call the guard" check reads green while a bad-faith request still
 * reaches the handler. There is no session/RBAC guard to point a route
 * decorator at here (identity is asymmetric-signature-based, not a session),
 * so the discipline has to be "every one of the three routes calls this one
 * function, in this order, before touching `awcms_omes_jobs`/
 * `awcms_omes_worker_results`/`awcms_omes_servers`" — enforced by code
 * review and by `tests/omes-control-worker-guard-order.test.ts` asserting
 * each route file's source calls `verifyWorkerEnvelope` before its first
 * other `application/worker-*` import call.
 *
 * Order, and why:
 *   1. `tenantId` UUID-shape check — cheap, no DB, no leak (malformed input
 *      is symmetric information regardless of whether the tenant exists).
 *   2. Enrollment lookup (`checkWorkerEnrollmentStatus`) — the one
 *      unavoidable pre-signature DB read (the stored public key has to come
 *      from somewhere). Read-only, no side effect, and its result never
 *      distinguishes "worker unknown" from "worker revoked" from "tenant
 *      unknown" in what it returns to the route (all three fold to the same
 *      `ok: false`).
 *   3. Envelope freshness (bounded timestamp window) — pure computation.
 *   4. Ed25519 signature verification over the canonical envelope — the
 *      actual identity proof.
 *   5. Nonce consumption — LAST, and only for an otherwise-valid envelope,
 *      so a captured-and-corrupted (bad signature) request never burns a
 *      nonce slot that the legitimate worker might still need.
 * A failure at any step returns the identical `{ ok: false }` — the route
 * never learns (and cannot leak) which step failed.
 */
import {
  buildCanonicalEnvelope,
  checkEnvelopeFreshness,
  isWellFormedNonce,
  verifyEd25519Signature,
  NONCE_RETENTION_MS,
  type WorkerRoute
} from "../domain/worker-identity";
import { checkWorkerEnrollmentStatus } from "./worker-enrollment-exchange";
import { consumeWorkerNonce } from "./worker-nonce-store";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SCOPE_ID_PATTERN = /^[A-Za-z0-9_.:-]{1,128}$/;

export type VerifyWorkerEnvelopeInput = {
  route: WorkerRoute;
  method: string;
  path: string;
  tenantId: unknown;
  serverId: unknown;
  workerId: unknown;
  timestamp: unknown;
  nonce: unknown;
  rawBody: string;
  signatureHeader: string | null;
};

export type VerifyWorkerEnvelopeResult =
  | { ok: true; tenantId: string; serverId: string; workerId: string }
  | { ok: false };

const FAIL: VerifyWorkerEnvelopeResult = { ok: false };

export async function verifyWorkerEnvelope(
  tx: Bun.SQL,
  input: VerifyWorkerEnvelopeInput,
  now: Date
): Promise<VerifyWorkerEnvelopeResult> {
  const { tenantId, serverId, workerId, timestamp, nonce } = input;

  if (
    typeof tenantId !== "string" ||
    !UUID_PATTERN.test(tenantId) ||
    typeof serverId !== "string" ||
    !SCOPE_ID_PATTERN.test(serverId) ||
    typeof workerId !== "string" ||
    !SCOPE_ID_PATTERN.test(workerId) ||
    typeof timestamp !== "string" ||
    !isWellFormedNonce(nonce) ||
    !input.signatureHeader
  ) {
    return FAIL;
  }

  const enrollment = await checkWorkerEnrollmentStatus(
    tx,
    tenantId,
    serverId,
    workerId
  );

  if (enrollment.status !== "active" || !enrollment.publicKeyPem) {
    return FAIL;
  }

  const freshness = checkEnvelopeFreshness(timestamp, now);

  if (!freshness.fresh) {
    return FAIL;
  }

  const canonical = buildCanonicalEnvelope({
    method: input.method,
    path: input.path,
    tenantId,
    serverId,
    workerId,
    timestamp,
    nonce,
    rawBody: input.rawBody
  });

  const signatureValid = verifyEd25519Signature(
    enrollment.publicKeyPem,
    canonical,
    input.signatureHeader
  );

  if (!signatureValid) {
    return FAIL;
  }

  const nonceOutcome = await consumeWorkerNonce(
    tx,
    tenantId,
    serverId,
    workerId,
    nonce,
    input.route,
    now,
    NONCE_RETENTION_MS
  );

  if (nonceOutcome === "replayed") {
    return FAIL;
  }

  return { ok: true, tenantId, serverId, workerId };
}
