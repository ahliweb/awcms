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
  input: RegisterPushSubscriptionInput
): Promise<PushSubscriptionSummary> {
  const normalized = normalizePushEndpoint(input.endpoint);
  const endpointHash = hashPushEndpoint(normalized);
  const endpointMasked = maskPushEndpoint(normalized);

  const rows = (await tx`
    INSERT INTO awcms_push_subscriptions
      (tenant_id, tenant_user_id, transport, endpoint, endpoint_hash,
       endpoint_masked, p256dh_key, auth_secret, user_agent_summary)
    VALUES (
      ${tenantId}, ${input.tenantUserId}, ${input.transport}, ${normalized},
      ${endpointHash}, ${endpointMasked}, ${input.p256dhKey ?? null},
      ${input.authSecret ?? null}, ${input.userAgentSummary ?? null}
    )
    ON CONFLICT ON CONSTRAINT awcms_push_subscriptions_endpoint_unique
    DO UPDATE SET
      tenant_user_id = EXCLUDED.tenant_user_id,
      transport = EXCLUDED.transport,
      -- A no-op in every ordinary case: the conflict target is the HASH of this
      -- very column, so EXCLUDED.endpoint is by construction the value already
      -- stored. It is here for the ONE case where it is not —
      -- revokeOwnPushSubscription overwrites the raw endpoint with a tombstone,
      -- and without this line a device that re-subscribed would come back
      -- active while still pointing at the tombstone: reachable in the console,
      -- undeliverable in fact, failing with a provider error that names nothing.
      endpoint = EXCLUDED.endpoint,
      p256dh_key = EXCLUDED.p256dh_key,
      auth_secret = EXCLUDED.auth_secret,
      user_agent_summary = EXCLUDED.user_agent_summary,
      status = 'active',
      disabled_reason = null,
      updated_at = now()
    RETURNING id, tenant_user_id, transport, endpoint_masked, status,
              disabled_reason, last_success_at, created_at
  `) as SubscriptionRow[];

  return toSummary(rows[0]!);
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
  const rows = (await tx`
    SELECT id
    FROM awcms_push_subscriptions
    WHERE tenant_id = ${tenantId}
      AND tenant_user_id = ${tenantUserId}
      AND status = 'active'
    ORDER BY created_at
  `) as { id: string }[];

  return rows.map((row) => row.id);
}

type TargetRow = {
  transport: PushTransport;
  endpoint: string;
  endpoint_masked: string;
  p256dh_key: string | null;
  auth_secret: string | null;
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
  subscriptionId: string
): Promise<PushTarget | null> {
  const rows = (await tx`
    SELECT transport, endpoint, endpoint_masked, p256dh_key, auth_secret
    FROM awcms_push_subscriptions
    WHERE tenant_id = ${tenantId}
      AND id = ${subscriptionId}
      AND status = 'active'
  `) as TargetRow[];

  const row = rows[0];

  if (!row) {
    return null;
  }

  return {
    transport: row.transport,
    endpoint: row.endpoint,
    endpointMasked: row.endpoint_masked,
    ...(row.p256dh_key ? { p256dhKey: row.p256dh_key } : {}),
    ...(row.auth_secret ? { authSecret: row.auth_secret } : {})
  };
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
