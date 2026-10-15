import { createHash } from "node:crypto";

import { keyedRequestHash } from "../../lib/security/idempotency-hmac";

/**
 * Cross-cutting idempotency store helper (doc 10 §Idempotency wrapper rules,
 * doc 16 §Idempotency store, skill `awcms-idempotency`). Backed by the generic
 * `awcms_idempotency_keys` table (migration 009; actor scoping is migration
 * 256), first consumed by the workflow decision endpoint (Issue 11.1) — any
 * future high-risk mutation endpoint in a domain module can reuse the same
 * table with its own `requestScope` string.
 *
 * Flow: same key + same request hash -> replay the stored response; same key
 * + different hash -> `409 IDEMPOTENCY_CONFLICT`; unseen key -> caller runs
 * the mutation and persists the result via `saveIdempotencyRecord`.
 *
 * ## Scoping (ADR-0129 amendment 1, audit F4 of #990, issue #1000)
 *
 * A record is addressed by `(tenant, request_scope, ACTOR, idempotency_key)`.
 * The actor is part of the unique key, so a colleague who learns or guesses a
 * predictable key can neither claim it first (the victim's request used to
 * answer `409`, a denial of service that also confirmed the key was in use) nor
 * read the victim's stored response. Every caller states its actor EXPLICITLY
 * with {@link userIdempotencyActor}, {@link machineIdempotencyActor} or
 * {@link ANONYMOUS_IDEMPOTENCY_ACTOR}; the branded type makes a bare string (for
 * example the idempotency key itself, which sits next to it in every call) a
 * compile error.
 *
 * The request hash is a keyed HMAC (`lib/security/idempotency-hmac.ts`), so the
 * sensitive free text a body can carry is not recoverable from the table.
 */

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sortKeysDeep(item));
  }

  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;

    return Object.keys(record)
      .sort()
      .reduce<Record<string, unknown>>((accumulator, key) => {
        accumulator[key] = sortKeysDeep(record[key]);
        return accumulator;
      }, {});
  }

  return value;
}

/**
 * Keyed (HMAC-SHA-256) hash of a JSON-serializable payload, key order
 * normalized. Same shape as before (64 lowercase hex characters) so callers and
 * the column are unchanged; the difference is that it cannot be recomputed
 * without the server secret. Throws `IdempotencyConfigurationError` in
 * production when `IDEMPOTENCY_HMAC_SECRET` is not a real key (fail closed).
 */
export function computeRequestHash(payload: unknown): string {
  const stable = JSON.stringify(sortKeysDeep(payload));

  return keyedRequestHash(stable);
}

/**
 * UNKEYED SHA-256 of the canonical JSON, for fingerprints that are NOT stored in
 * the idempotency table and must stay comparable across deployments and secret
 * rotations (for example the theming `config_hash`, a display/change-detection
 * fingerprint with values already stored). It is the algorithm
 * `computeRequestHash` used before ADR-0145, so existing stored values stay
 * valid. Never use it for a value that may be derived from sensitive free text:
 * that is what the keyed hash is for.
 */
export function canonicalSha256(payload: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(sortKeysDeep(payload)))
    .digest("hex");
}

declare const idempotencyActorBrand: unique symbol;

/**
 * Who a stored idempotency record belongs to. Opaque on purpose: build it with
 * one of the constructors below, never from a raw string.
 */
export type IdempotencyActor = string & {
  readonly [idempotencyActorBrand]: true;
};

/** Stored on rows written before actor scoping existed; never matches a lookup. */
export const LEGACY_UNSCOPED_IDEMPOTENCY_ACTOR = "legacy:unscoped";

/**
 * Anonymous callers (a public form post). They share ONE namespace per
 * `(tenant, scope)`: there is no identity to separate them by, so a visitor can
 * still collide with another visitor's key. Public routes therefore keep
 * relying on unguessable client-generated keys (UUID) and must not store a
 * response that is private to the first caller.
 */
export const ANONYMOUS_IDEMPOTENCY_ACTOR =
  "anonymous" as unknown as IdempotencyActor;

/** How long after the migration a legacy row still blocks a same-key retry. */
export const LEGACY_STRADDLE_WINDOW_HOURS = 24;

/** Not 64 hex characters, so it can never equal a real request hash. */
export const LEGACY_STRADDLE_REQUEST_HASH = "legacy-unscoped-straddle";

function requireActorId(kind: string, id: string): string {
  if (typeof id !== "string" || id.trim() === "" || id.length > 100) {
    // Fail closed: an empty id would silently put every caller of this
    // constructor in ONE shared namespace, the very bug being fixed.
    throw new TypeError(`Idempotency ${kind} actor requires a non-empty id.`);
  }

  return id;
}

/** A signed-in tenant user (`auth.context.tenantUserId`). */
export function userIdempotencyActor(tenantUserId: string): IdempotencyActor {
  return `user:${requireActorId("user", tenantUserId)}` as IdempotencyActor;
}

/** A machine credential (its credential id, never the token). */
export function machineIdempotencyActor(
  machineCredentialId: string
): IdempotencyActor {
  return `machine:${requireActorId(
    "machine",
    machineCredentialId
  )}` as IdempotencyActor;
}

export type IdempotencyRecord = {
  requestHash: string;
  responseStatus: number;
  responseBody: unknown;
};

/**
 * Thrown by `saveIdempotencyRecord` when a concurrent request already won
 * the race for the same `(tenant_id, request_scope, actor_key,
 * idempotency_key)` under READ COMMITTED — both requests can pass
 * `findIdempotencyRecord` before either commits. Caught centrally by
 * `withTenant` (the one chokepoint every caller already goes through, per that
 * function's own docblock), which rolls back this transaction (so the loser's
 * mutation never persists — required by the "double submit paralel -> tidak
 * dobel" rule in skill `awcms-idempotency`).
 *
 * If the winner's committed request hash matches ours, `replay` carries its
 * stored response so `withTenant` can transparently return it — honoring the
 * pre-existing "key sama + hash sama -> replay" rule even under the race,
 * instead of forcing a hard `409` on what is really a same-payload retry.
 * `replay` is `null` only for a genuine hash mismatch (racing request for the
 * same key with a *different* payload), which still gets a clean
 * `409 IDEMPOTENCY_CONFLICT` instead of a raw unique-violation error.
 */
export class IdempotencyRaceLostError extends Error {
  /** Never the raw key (doc 10 masking discipline) — safe to include in logs. */
  readonly idempotencyKeyHash: string;
  readonly requestScope: string;
  readonly replay: { responseStatus: number; responseBody: unknown } | null;

  constructor(
    requestScope: string,
    idempotencyKey: string,
    replay: { responseStatus: number; responseBody: unknown } | null = null
  ) {
    super(
      replay
        ? `Idempotency key for scope "${requestScope}" was already recorded by a concurrent request with an identical payload.`
        : `Idempotency key for scope "${requestScope}" was already claimed by a concurrent request with a different payload.`
    );
    this.name = "IdempotencyRaceLostError";
    this.requestScope = requestScope;
    this.idempotencyKeyHash = createHash("sha256")
      .update(idempotencyKey)
      .digest("hex");
    this.replay = replay;
  }
}

export async function findIdempotencyRecord(
  tx: Bun.SQL,
  tenantId: string,
  requestScope: string,
  idempotencyKey: string,
  actor: IdempotencyActor
): Promise<IdempotencyRecord | null> {
  const rows = await tx`
    SELECT request_hash, response_status, response_body
    FROM awcms_idempotency_keys
    WHERE tenant_id = ${tenantId} AND request_scope = ${requestScope}
      AND actor_key = ${actor} AND idempotency_key = ${idempotencyKey}
  `;
  const row = rows[0] as
    | { request_hash: string; response_status: number; response_body: unknown }
    | undefined;

  if (!row) {
    // Deploy-straddle guard (ADR-0145 §7, audit M1). A request stored BEFORE
    // migration 256 sits under `legacy:unscoped`, where it can no longer be
    // attributed to an actor. Re-running it would execute a create-type
    // mutation (an adjustment, a tax snapshot) a second time for a client that
    // retried across the deploy, so within the window a client could still be
    // retrying, a legacy row for the same (tenant, scope, key) answers as a
    // CONFLICT instead. Returned as a record whose hash can never match, so
    // every caller's existing `requestHash !== requestHash` branch yields the
    // standard `409 IDEMPOTENCY_CONFLICT` without a signature change. The
    // response body is never exposed.
    const legacy = await tx`
      SELECT 1 AS present
      FROM awcms_idempotency_keys
      WHERE tenant_id = ${tenantId} AND request_scope = ${requestScope}
        AND actor_key = ${LEGACY_UNSCOPED_IDEMPOTENCY_ACTOR}
        AND idempotency_key = ${idempotencyKey}
        AND created_at > now() - make_interval(hours => ${LEGACY_STRADDLE_WINDOW_HOURS})
      LIMIT 1
    `;

    if (legacy.length === 0) {
      return null;
    }

    return {
      requestHash: LEGACY_STRADDLE_REQUEST_HASH,
      responseStatus: 409,
      responseBody: null
    };
  }

  return {
    requestHash: row.request_hash,
    responseStatus: Number(row.response_status),
    responseBody: row.response_body
  };
}

export async function saveIdempotencyRecord(
  tx: Bun.SQL,
  tenantId: string,
  requestScope: string,
  idempotencyKey: string,
  actor: IdempotencyActor,
  requestHash: string,
  responseStatus: number,
  responseBody: unknown
): Promise<void> {
  const rows = await tx`
    INSERT INTO awcms_idempotency_keys
      (tenant_id, request_scope, actor_key, idempotency_key, request_hash, response_status, response_body)
    VALUES (
      ${tenantId}, ${requestScope}, ${actor}, ${idempotencyKey}, ${requestHash},
      ${responseStatus}, ${responseBody}
    )
    ON CONFLICT (tenant_id, request_scope, actor_key, idempotency_key) DO NOTHING
    RETURNING id
  `;

  if (rows.length > 0) {
    return;
  }

  // Lost the race. `ON CONFLICT` only fires against a row from a transaction
  // that has already committed (a still-uncommitted conflicting insert would
  // block us here instead), so the winner is guaranteed visible to this SELECT.
  const winner = await findIdempotencyRecord(
    tx,
    tenantId,
    requestScope,
    idempotencyKey,
    actor
  );

  throw new IdempotencyRaceLostError(
    requestScope,
    idempotencyKey,
    winner && winner.requestHash === requestHash
      ? {
          responseStatus: winner.responseStatus,
          responseBody: winner.responseBody
        }
      : null
  );
}
