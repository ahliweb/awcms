/**
 * Subscription storage for `push_delivery` (Issue #465).
 *
 * Every function here takes an ALREADY-OPEN transaction (`tx`) rather than the
 * pool, so a caller can register a subscription in the same transaction that
 * authorized the request — the shape `loadAdminScreen` and `defineTenantRoute`
 * both rely on, and the reason R3 (#450) moved every admin screen to decide and
 * read atomically. The HTTP surface that will use it lands in its own issue;
 * the dispatcher and the purge job are its callers today.
 *
 * The raw `endpoint` column is selected in exactly ONE place —
 * `fetchDeliveryTarget`, which the dispatcher calls immediately before handing
 * it to a provider. Every other read here projects `endpoint_masked`. That is a
 * rule this file can actually keep, because it is the only file that mentions
 * the column.
 */
import { log } from "../../../lib/logging/logger";
import { recordAuditEvent } from "../../logging/application/audit-log";
import {
  FieldEncryptionError,
  type KeyRing
} from "../../../lib/security/field-encryption";
import {
  decryptPushAuthSecret,
  encryptPushAuthSecret,
  PushAuthSecretError
} from "../domain/push-auth-secret";
import {
  hashPushEndpoint,
  maskPushEndpoint,
  normalizePushEndpoint
} from "../domain/push-endpoint";
import type {
  PushTarget,
  PushTransport
} from "../domain/push-provider-contract";

const MODULE_KEY = "push_delivery";

export type RegisterPushSubscriptionInput = {
  tenantUserId: string;
  transport: PushTransport;
  endpoint: string;
  /** Required for `web_push`, rejected for `fcm` — mirrored by the DB CHECK. */
  p256dhKey?: string;
  authSecret?: string;
  userAgentSummary?: string;
};

export type PushSubscriptionSummary = {
  id: string;
  tenantUserId: string;
  transport: PushTransport;
  endpointMasked: string;
  status: "active" | "disabled";
  disabledReason: string | null;
  lastSuccessAt: Date | null;
  createdAt: Date;
};

type SubscriptionRow = {
  id: string;
  tenant_user_id: string;
  transport: PushTransport;
  endpoint_masked: string;
  status: "active" | "disabled";
  disabled_reason: string | null;
  last_success_at: Date | null;
  created_at: Date;
};

function toSummary(row: SubscriptionRow): PushSubscriptionSummary {
  return {
    id: row.id,
    tenantUserId: row.tenant_user_id,
    transport: row.transport,
    endpointMasked: row.endpoint_masked,
    status: row.status,
    disabledReason: row.disabled_reason,
    lastSuccessAt: row.last_success_at,
    createdAt: row.created_at
  };
}

/**
 * Registers a device, or re-activates the row that already represents it.
 *
 * `ON CONFLICT (tenant_id, endpoint_hash)` is what makes re-registration safe.
 * Browsers re-issue `PushManager.subscribe()` on every page load once
 * permission is granted, so an INSERT-only path would grow one row per visit,
 * and the fan-out would then send one identical notification per row. The
 * conflict target is the HASH, never the raw endpoint.
 *
 * A conflicting row is also flipped back to `active` with its
 * `disabled_reason` cleared: if a subscription was disabled because the push
 * service reported it gone, and the same endpoint later re-registers, the
 * device is demonstrably alive again. Leaving it disabled would make the user
 * silently unreachable with no surface telling them why.
 */
export async function registerPushSubscription(
  tx: Bun.TransactionSQL,
  tenantId: string,
  input: RegisterPushSubscriptionInput,
  /**
   * The auth-secret key ring (Issue #1089). Required whenever `authSecret` is
   * present: there is NO plaintext fallback. A missing ring is a caller bug
   * (the route answers 503 before reaching here), so this throws rather than
   * quietly storing the secret in the clear.
   */
  authSecretRing?: KeyRing
): Promise<PushSubscriptionSummary> {
  const normalized = normalizePushEndpoint(input.endpoint);
  const endpointHash = hashPushEndpoint(normalized);
  const endpointMasked = maskPushEndpoint(normalized);

  if (input.authSecret !== undefined && !authSecretRing) {
    throw new PushAuthSecretError(
      "Push auth-secret key ring is required to register a subscription.",
      true
    );
  }

  const authSecretCiphertext =
    input.authSecret !== undefined && authSecretRing
      ? encryptPushAuthSecret(
          input.authSecret,
          tenantId,
          endpointHash,
          authSecretRing
        )
      : null;

  // Insert first; the conflicting case is handled below with the previous owner
  // LOCKED, so "did the owner change" is decided on a row nobody can move under
  // us (Issue #1098). A single `ON CONFLICT DO UPDATE` cannot report the value it
  // overwrote, and a SELECT before the INSERT would race a concurrent transfer.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const inserted = (await tx`
      INSERT INTO awcms_push_subscriptions
        (tenant_id, tenant_user_id, transport, endpoint, endpoint_hash,
         endpoint_masked, p256dh_key, auth_secret_ciphertext, user_agent_summary)
      VALUES (
        ${tenantId}, ${input.tenantUserId}, ${input.transport}, ${normalized},
        ${endpointHash}, ${endpointMasked}, ${input.p256dhKey ?? null},
        ${authSecretCiphertext}, ${input.userAgentSummary ?? null}
      )
      ON CONFLICT ON CONSTRAINT awcms_push_subscriptions_endpoint_unique
      DO NOTHING
      RETURNING id, tenant_user_id, transport, endpoint_masked, status,
                disabled_reason, last_success_at, created_at
    `) as SubscriptionRow[];

    if (inserted.length > 0) return toSummary(inserted[0]!);

    const existing = (await tx`
      SELECT id, tenant_user_id, status
      FROM awcms_push_subscriptions
      WHERE tenant_id = ${tenantId} AND endpoint_hash = ${endpointHash}
      FOR UPDATE
    `) as { id: string; tenant_user_id: string; status: string }[];

    // Purged between the conflict and the lock: insert again.
    if (existing.length === 0) continue;

    const previous = existing[0]!;
    const rows = (await tx`
      UPDATE awcms_push_subscriptions
      SET tenant_user_id = ${input.tenantUserId},
          transport = ${input.transport},
          -- A no-op in every ordinary case: the lookup key is the HASH of this
          -- very column, so the incoming endpoint is by construction the value
          -- already stored. It is here for the ONE case where it is not:
          -- revokeOwnPushSubscription overwrites the raw endpoint with a
          -- tombstone, and without this line a device that re-subscribed would
          -- come back active while still pointing at the tombstone: reachable
          -- in the console, undeliverable in fact, failing with a provider
          -- error that names nothing.
          endpoint = ${normalized},
          p256dh_key = ${input.p256dhKey ?? null},
          -- Re-registering a legacy row migrates it: the fresh secret goes in
          -- as ciphertext and the old plaintext is cleared in the same
          -- statement (the CHECK requires exactly one of the two).
          auth_secret = NULL,
          auth_secret_ciphertext = ${authSecretCiphertext},
          user_agent_summary = ${input.userAgentSummary ?? null},
          status = 'active',
          disabled_reason = null,
          updated_at = now()
      WHERE tenant_id = ${tenantId} AND id = ${previous.id}
      RETURNING id, tenant_user_id, transport, endpoint_masked, status,
                disabled_reason, last_success_at, created_at
    `) as SubscriptionRow[];

    // ANY owner change is a transfer, whatever the previous status: a revoked
    // or disabled row is reactivated for the new user just the same, and that
    // is exactly the path the first version of this check missed.
    if (previous.tenant_user_id !== input.tenantUserId) {
      await recordSubscriptionTransfer(
        tx,
        tenantId,
        previous.id,
        previous.tenant_user_id,
        input.tenantUserId,
        previous.status
      );
    }

    return toSummary(rows[0]!);
  }

  throw new Error("Push subscription registration did not converge.");
}

/**
 * Cancels what is still waiting for a device whose owner or liveness just
 * changed (Issue #1098). A queued message is addressed to the user who owned the
 * device when it was enqueued; once the device is revoked, disabled or moved,
 * delivering it later would reach whoever registers next. `sending` rows are
 * not touched here (they are in flight); the dispatcher's recipient check
 * refuses those. Fixed `last_error` codes only: nothing user-controlled.
 */
async function cancelPendingMessages(
  tx: Bun.TransactionSQL,
  tenantId: string,
  subscriptionId: string,
  reasonCode: string
): Promise<void> {
  await tx`
    UPDATE awcms_push_messages
    SET status = 'cancelled', last_error = ${reasonCode}, updated_at = now()
    WHERE tenant_id = ${tenantId} AND subscription_id = ${subscriptionId}
      AND status IN ('queued', 'retry_wait')
  `;
}

/**
 * A device (endpoint) that is registered by a DIFFERENT tenant user than the one
 * who holds it now moves to the new user (Issue #1098, decision: KEEP).
 *
 * The endpoint belongs to the browser profile, not to the person: on a shared
 * browser the second user to sign in legitimately re-subscribes the same
 * endpoint, and refusing would leave that user without notifications and
 * without any way to learn why. The cost of keeping it is that someone who
 * knows another user's raw endpoint (a capability URL, masked everywhere) can
 * take the device over; the secret is not disclosed. So the move is made
 * EXPLICIT instead of silent:
 *
 * - the prior user's still-queued notifications for the device are cancelled, so
 *   nothing addressed to them is delivered to the new owner's screen;
 * - an audit event records subscription id plus previous and new tenant user id
 *   (ids only: never the endpoint, the keys or the secret), in the SAME
 *   transaction. If the audit write fails the whole registration fails (fail
 *   closed): an unrecorded takeover must not commit.
 */
async function recordSubscriptionTransfer(
  tx: Bun.TransactionSQL,
  tenantId: string,
  subscriptionId: string,
  previousTenantUserId: string,
  newTenantUserId: string,
  previousStatus: string
): Promise<void> {
  await cancelPendingMessages(
    tx,
    tenantId,
    subscriptionId,
    "subscription_transferred"
  );

  await recordAuditEvent(tx, {
    tenantId,
    actorTenantUserId: newTenantUserId,
    moduleKey: MODULE_KEY,
    action: "subscription.transfer",
    resourceType: "push_subscription",
    resourceId: subscriptionId,
    severity: "warning",
    message:
      "A push subscription moved to another tenant user because the same device endpoint was registered again.",
    attributes: {
      subscriptionId,
      previousTenantUserId,
      newTenantUserId,
      previousStatus
    }
  });

  log("info", "push.subscription.transferred", {
    tenantId,
    moduleKey: MODULE_KEY,
    subscriptionId,
    previousTenantUserId,
    newTenantUserId
  });
}

/** Diagnostics/list projection — never selects the raw endpoint. */
export async function listPushSubscriptions(
  tx: Bun.TransactionSQL,
  tenantId: string,
  options: { tenantUserId?: string; limit?: number } = {}
): Promise<PushSubscriptionSummary[]> {
  const limit = options.limit ?? 100;
  const rows = options.tenantUserId
    ? ((await tx`
        SELECT id, tenant_user_id, transport, endpoint_masked, status,
               disabled_reason, last_success_at, created_at
        FROM awcms_push_subscriptions
        WHERE tenant_id = ${tenantId}
          AND tenant_user_id = ${options.tenantUserId}
        ORDER BY created_at DESC
        LIMIT ${limit}
      `) as SubscriptionRow[])
    : ((await tx`
        SELECT id, tenant_user_id, transport, endpoint_masked, status,
               disabled_reason, last_success_at, created_at
        FROM awcms_push_subscriptions
        WHERE tenant_id = ${tenantId}
        ORDER BY created_at DESC
        LIMIT ${limit}
      `) as SubscriptionRow[]);

  return rows.map(toSummary);
}

/** Active subscription ids for one recipient — what a fan-out enqueue iterates. */
export async function fetchActiveSubscriptionIds(
  tx: Bun.TransactionSQL,
  tenantId: string,
  tenantUserId: string
): Promise<string[]> {
  const byUser = await fetchActiveSubscriptionIdsForUsers(tx, tenantId, [
    tenantUserId
  ]);

  return byUser.get(tenantUserId) ?? [];
}

/**
 * The same question for many users in ONE round trip.
 *
 * `enqueuePushToRecipients` asked it per recipient, so fanning a notification
 * out to R recipients cost R queries before a single row was written. The
 * single-user form above is now a batch of one, so the two cannot drift: a
 * predicate fixed in one and not the other is the way a batch path quietly
 * stops matching the path everything was tested against.
 *
 * Users with no active subscription are ABSENT from the map rather than present
 * with an empty array — the caller distinguishes "skipped" from "queued" by
 * exactly that, and materialising empty entries would make the two look alike.
 */
export async function fetchActiveSubscriptionIdsForUsers(
  tx: Bun.TransactionSQL,
  tenantId: string,
  tenantUserIds: readonly string[]
): Promise<Map<string, string[]>> {
  const byUser = new Map<string, string[]>();

  if (tenantUserIds.length === 0) return byUser;

  const rows = (await tx`
    SELECT tenant_user_id, id
    FROM awcms_push_subscriptions
    WHERE tenant_id = ${tenantId}
      AND tenant_user_id = ANY(${tx.array([...new Set(tenantUserIds)], "uuid")})
      AND status = 'active'
    ORDER BY tenant_user_id, created_at
  `) as { tenant_user_id: string; id: string }[];

  for (const row of rows) {
    const existing = byUser.get(row.tenant_user_id);

    if (existing) {
      existing.push(row.id);
      continue;
    }

    byUser.set(row.tenant_user_id, [row.id]);
  }

  return byUser;
}

type TargetRow = {
  transport: PushTransport;
  endpoint: string;
  endpoint_hash: string;
  endpoint_masked: string;
  p256dh_key: string | null;
  auth_secret: string | null;
  auth_secret_ciphertext: string | null;
  /** Whether the subscription is still owned by the message's recipient (Issue #1098). */
  recipient_matches?: boolean;
};

/**
 * The ONE place the raw endpoint leaves the database, called by the dispatcher
 * immediately before the provider call. Returns `null` for a subscription that
 * has since been disabled or deleted, which the dispatcher treats as a
 * non-retryable failure rather than an error: the row was legitimately enqueued
 * and the target legitimately went away between then and now.
 */
export async function fetchDeliveryTarget(
  tx: Bun.TransactionSQL,
  tenantId: string,
  subscriptionId: string,
  /** The auth-secret key ring, or `null` when it is not configured (Issue #1089). */
  authSecretRing: KeyRing | null = null
): Promise<PushTarget | null> {
  const row = await fetchDeliveryTargetRow(tx, tenantId, subscriptionId);

  return row ? buildDeliveryTarget(row, tenantId, authSecretRing) : null;
}

/** The raw row, for a caller that decrypts OUTSIDE the transaction (Issue #1089, L1). */
export type DeliveryTargetRow = TargetRow;

export async function fetchDeliveryTargetRow(
  tx: Bun.TransactionSQL,
  tenantId: string,
  subscriptionId: string,
  /** The tenant user the MESSAGE was addressed to. When given, delivery requires the subscription to still belong to them. */
  recipientTenantUserId?: string | null
): Promise<DeliveryTargetRow | null> {
  const checkRecipient = recipientTenantUserId !== undefined;
  const rows = (await tx`
    SELECT transport, endpoint, endpoint_hash, endpoint_masked, p256dh_key,
           auth_secret, auth_secret_ciphertext,
           coalesce(
             ${checkRecipient} = false
               OR tenant_user_id = ${recipientTenantUserId ?? null}::uuid,
             false
           ) AS recipient_matches
    FROM awcms_push_subscriptions
    WHERE tenant_id = ${tenantId}
      AND id = ${subscriptionId}
      AND status = 'active'
  `) as TargetRow[];

  return rows[0] ?? null;
}

/**
 * Pure: turns a fetched row into a provider target. Two refusals, both
 * `PushAuthSecretError` with fixed messages (no secret, endpoint or key
 * material):
 *
 * - `endpoint` must hash to `endpoint_hash`. The hash is the row's identity and
 *   the AAD of the ciphertext; a row whose endpoint was re-pointed (or inserted
 *   with a forged one) would otherwise be delivered to the attacker's endpoint
 *   with the victim's decrypted secret. Non-retryable.
 * - the auth secret must be producible (see `resolveAuthSecret`).
 *
 * Runs outside any transaction, so a refusal is never counted as a database
 * failure by the circuit breaker.
 */
export function buildDeliveryTarget(
  row: DeliveryTargetRow,
  tenantId: string,
  authSecretRing: KeyRing | null
): PushTarget {
  // Issue #1098: the message was addressed to a user who no longer owns this
  // device. Fixed message, no ids or content; non-retryable (a retry could
  // never succeed and must not reach the new owner).
  if (row.recipient_matches === false) {
    throw new PushAuthSecretError(
      "Push message recipient no longer owns the subscription; delivery refused.",
      false
    );
  }

  if (hashPushEndpoint(row.endpoint) !== row.endpoint_hash) {
    throw new PushAuthSecretError(
      "Push subscription endpoint does not match its recorded identity; delivery refused.",
      false
    );
  }

  const authSecret = resolveAuthSecret(row, tenantId, authSecretRing);

  return {
    transport: row.transport,
    endpoint: row.endpoint,
    endpointMasked: row.endpoint_masked,
    ...(row.p256dh_key ? { p256dhKey: row.p256dh_key } : {}),
    ...(authSecret ? { authSecret } : {})
  };
}

/**
 * Ciphertext wins; legacy plaintext is read ONLY while the row has no
 * ciphertext (the transition window of Issue #1089, ended by the backfill and
 * the later column drop). A row with ciphertext is never "repaired" by falling
 * back to plaintext: that would let a stale plaintext shadow a failed
 * decryption. Failures throw `PushAuthSecretError` WITHOUT the secret, the
 * ciphertext or key material in the message.
 */
function resolveAuthSecret(
  row: TargetRow,
  tenantId: string,
  ring: KeyRing | null
): string | null {
  if (row.auth_secret_ciphertext === null) {
    return row.auth_secret;
  }

  if (!ring) {
    throw new PushAuthSecretError(
      "Push auth-secret key ring is not configured; cannot decrypt the subscription secret.",
      true
    );
  }

  try {
    return decryptPushAuthSecret(
      row.auth_secret_ciphertext,
      tenantId,
      row.endpoint_hash,
      ring
    );
  } catch (error) {
    const unknownKey =
      error instanceof FieldEncryptionError &&
      (error.code === "UNKNOWN_KEY_ID" ||
        error.code === "KEY_RING_UNAVAILABLE");

    throw new PushAuthSecretError(
      unknownKey
        ? "Push auth-secret key ring lacks the key this subscription was encrypted under."
        : "Push subscription secret failed authentication.",
      unknownKey
    );
  }
}

/**
 * Marks a subscription dead because the push service said so (`404`/`410`, or
 * FCM `UNREGISTERED`).
 *
 * Disabled rather than deleted, for the reason `sql/088` gives about redeemed
 * handoff codes: a deleted row and one that never existed are indistinguishable,
 * and the difference is exactly what an operator asking "why did this user stop
 * getting notifications" needs. Retention removes it later, by policy, with the
 * evidence having outlived the incident.
 */
export async function disablePushSubscription(
  tx: Bun.TransactionSQL,
  tenantId: string,
  subscriptionId: string,
  reason: string
): Promise<void> {
  await tx`
    UPDATE awcms_push_subscriptions
    SET status = 'disabled', disabled_reason = ${reason}, updated_at = now()
    WHERE tenant_id = ${tenantId} AND id = ${subscriptionId}
  `;

  await cancelPendingMessages(
    tx,
    tenantId,
    subscriptionId,
    "subscription_disabled"
  );

  log("info", "push.subscription.disabled", {
    tenantId,
    moduleKey: MODULE_KEY,
    subscriptionId,
    reason
  });
}

/**
 * The value a revoked row's `endpoint` column is overwritten with.
 *
 * The column is `NOT NULL`, so "forget it" has to be spelled as something. This
 * string is deliberately not a plausible endpoint: it fails `new URL`, so any
 * code that ever handed it to a provider would fail loudly rather than deliver
 * somewhere unexpected.
 */
export const REVOKED_ENDPOINT_TOMBSTONE = "revoked-by-user";

/** The `disabled_reason` a user-initiated revocation writes. */
export const REVOKED_BY_USER_REASON = "revoked_by_user";

/**
 * A user retiring one of their OWN devices (Issue #466).
 *
 * ## Why this is not `disablePushSubscription`
 *
 * That one records what the PUSH SERVICE said. This one records what the PERSON
 * said, and the two differ in what may be kept. A subscription disabled because
 * the endpoint is gone keeps its endpoint: the value is dead, and it is the
 * evidence for "why did this device stop". A subscription the user revoked is
 * one where the endpoint may still be perfectly usable — so continuing to store
 * it means holding a live push credential for a device whose owner asked us to
 * stop. The row survives (an operator still needs to see that the device was
 * revoked and when); the credential does not.
 *
 * ## Why the RFC 8291 key material is left in place
 *
 * The obvious next line — null `p256dh_key` and `auth_secret` too — would
 * violate `awcms_push_subscriptions_keys_match_transport_check`, which requires
 * a `web_push` row to carry both. More to the point it would buy nothing: both
 * values are inputs to encrypting a payload for an endpoint, and the endpoint
 * is what was just destroyed. They cannot address anything on their own. The
 * constraint is therefore left alone rather than weakened to permit a delete
 * that has no effect.
 *
 * ## Ownership is in the WHERE clause
 *
 * `tenant_user_id` is matched, not checked afterwards, so a caller cannot
 * revoke somebody else's device by guessing an id — and the caller cannot learn
 * whether the id exists, because "not yours" and "not there" both return
 * `{ revoked: false }` and the route answers both with the same 404.
 */
export async function revokeOwnPushSubscription(
  tx: Bun.TransactionSQL,
  tenantId: string,
  tenantUserId: string,
  subscriptionId: string
): Promise<{ revoked: boolean }> {
  const rows = (await tx`
    UPDATE awcms_push_subscriptions
    SET status = 'disabled',
        disabled_reason = ${REVOKED_BY_USER_REASON},
        endpoint = ${REVOKED_ENDPOINT_TOMBSTONE},
        updated_at = now()
    WHERE tenant_id = ${tenantId}
      AND id = ${subscriptionId}
      AND tenant_user_id = ${tenantUserId}
      AND status = 'active'
    RETURNING id
  `) as { id: string }[];

  if (rows.length === 0) return { revoked: false };

  await cancelPendingMessages(
    tx,
    tenantId,
    subscriptionId,
    "subscription_revoked"
  );

  log("info", "push.subscription.revoked", {
    tenantId,
    moduleKey: MODULE_KEY,
    subscriptionId,
    tenantUserId
  });

  return { revoked: true };
}

export async function markSubscriptionDelivered(
  tx: Bun.TransactionSQL,
  tenantId: string,
  subscriptionId: string,
  now: Date
): Promise<void> {
  await tx`
    UPDATE awcms_push_subscriptions
    SET last_success_at = ${now}, updated_at = now()
    WHERE tenant_id = ${tenantId} AND id = ${subscriptionId}
  `;
}
