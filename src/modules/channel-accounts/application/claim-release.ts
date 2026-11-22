/**
 * The platform release action for a contested external-account claim (Issue
 * #1215, ADR-0170 option C): the dispute path for a provider whose id nothing in
 * this repository can verify, and for a verification the other party won.
 *
 * ## Why this is platform-scoped and cross-tenant
 *
 * The holder of a claim is ANOTHER tenant's row, and `awcms_channel_accounts`
 * is FORCE RLS, so a platform request cannot even see it. Two things make the
 * action possible without a bypass of any role:
 *
 *   1. the locator, `awcms_find_channel_account_claim_holder` (sql/416): a
 *      narrow SECURITY DEFINER READ that answers which tenant and account hold
 *      a claim for an exact `(provider, external id)`. It never writes;
 *   2. the release itself runs in the HOLDER tenant's own RLS context, set for
 *      the duration of {@link releaseHeldAccount} and restored to the platform
 *      tenant before this function returns (the shape ADR-0091 gave the tenant
 *      birth record), with the existing delete steps, so the credential
 *      ciphertext and webhook secrets are erased exactly as a tenant's own
 *      delete erases them.
 *
 * The authority is the PLATFORM-scoped permission
 * `channel_accounts.account_claims.revoke`: the chokepoint refuses it unless the
 * acting tenant is the platform tenant, and it is never in the catalogue seeded
 * to tenant roles. The route adds a step-up for a person with an MFA factor, an
 * `Idempotency-Key`, and a mandatory reason.
 *
 * ## What it does NOT do
 *
 * It does not decide who is right. The operator is expected to have verified
 * the claimant out of band (the DNS, the page, the bot, the number); this action
 * only ends the holder account so that the real owner can register and verify.
 */
import { recordAuditEvent } from "../../logging/application/audit-log";
import {
  CLAIM_RELEASED_REASON_CODE,
  releaseHeldAccount
} from "./account-directory";
import type { SecretStorePort } from "./secret-store";
import { CHANNEL_ACCOUNTS_MODULE_KEY } from "../domain/channel-accounts-constants";
import { normalizeExternalId } from "../domain/provider-matrix";
import type { ClaimReleaseReasonCode } from "../domain/channel-accounts-validation";

export type ClaimHolder = {
  tenantId: string;
  accountId: string;
  accountKind: string;
  status: string;
  claimBasis: string;
};

/** The ONE caller of the locator function. `tests/channel-accounts-claim-basis.test.ts` keeps it that way. */
export async function findClaimHolder(
  tx: Bun.SQL,
  provider: string,
  accountKind: string,
  externalId: string
): Promise<ClaimHolder | null> {
  const rows = (await tx`
    SELECT tenant_id, account_id, account_kind, status, claim_basis
    FROM awcms_find_channel_account_claim_holder(${provider}, ${accountKind}, ${normalizeExternalId(provider, accountKind, externalId)})
  `) as {
    tenant_id: string;
    account_id: string;
    account_kind: string;
    status: string;
    claim_basis: string;
  }[];
  const row = rows[0];

  return row
    ? {
        tenantId: row.tenant_id,
        accountId: row.account_id,
        accountKind: row.account_kind,
        status: row.status,
        claimBasis: row.claim_basis
      }
    : null;
}

export type ReleaseClaimInput = {
  provider: string;
  accountKind: string;
  externalId: string;
  /** Closed enum. The ONLY reason that reaches the holder's trail. */
  reasonCode: ClaimReleaseReasonCode;
  /** Optional ticket reference of a narrow pattern; also reaches the holder's trail. */
  ticketRef: string | null;
  /** Mandatory free text, bounded and screened by the route. The PLATFORM operator's trail ONLY. */
  reason: string;
};

export type ReleaseClaimActor = {
  /** The PLATFORM tenant: the acting tenant of the request, and the tenant `tx` is bound to. */
  platformTenantId: string;
  tenantUserId: string;
  correlationId?: string;
};

export type ReleaseClaimOutcome =
  | {
      outcome: "released";
      holderTenantId: string;
      accountId: string;
      accountKind: string;
      credentialErased: boolean;
      releasedChildren: number;
    }
  | { outcome: "not_found" }
  | { outcome: "refused"; code: "HAS_CHILD_ACCOUNTS" };

async function bindTenant(tx: Bun.SQL, tenantId: string): Promise<void> {
  // Transaction-local, like `withTenant`'s own `SET LOCAL`.
  await tx`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`;
}

/**
 * Locates the holder, ends its account in its own tenant context, writes the
 * audit rows to the HOLDER's trail (the tenant is entitled to see that its
 * account and its childless-of-claim children were ended by the platform, and the
 * closed reason code, never the operator's free text), rebinds the platform tenant, and
 * writes the operator-side audit row. All in the caller's one transaction.
 */
export async function releaseContestedClaim(
  tx: Bun.SQL,
  store: SecretStorePort,
  actor: ReleaseClaimActor,
  input: ReleaseClaimInput
): Promise<ReleaseClaimOutcome> {
  const holder = await findClaimHolder(
    tx,
    input.provider,
    input.accountKind,
    input.externalId
  );

  if (!holder) return { outcome: "not_found" };

  await bindTenant(tx, holder.tenantId);

  const released = await releaseHeldAccount(
    tx,
    store,
    holder.tenantId,
    holder.accountId
  );

  if (released.outcome === "released") {
    // Written from inside the holder's context (ADR-0091): the operator's own
    // tenant-user id is NOT carried across, because the customer cannot resolve
    // it; `actorTenantId` says the platform did it. The operator-side row below
    // keeps the individual. The external id is not an attribute (an audit log
    // is read by more people than the screen); the account id identifies it.
    //
    // The HOLDER is the opposing party of the dispute (audit M2): its trail
    // carries only the closed reason code and the ticket reference of a narrow
    // pattern, never the operator's free text, which stays in the platform trail.
    const holderAttributes = (accountId: string) => ({
      provider: input.provider,
      reasonCode: CLAIM_RELEASED_REASON_CODE,
      releaseReason: input.reasonCode,
      ...(input.ticketRef ? { ticketRef: input.ticketRef } : {}),
      accountId
    });

    for (const child of released.children) {
      await recordAuditEvent(tx, {
        tenantId: holder.tenantId,
        actorTenantId: actor.platformTenantId,
        moduleKey: CHANNEL_ACCOUNTS_MODULE_KEY,
        action: "channel_accounts.account.claim_released",
        resourceType: "channel_account",
        resourceId: child.accountId,
        severity: "warning",
        message:
          "Channel account ended with its container by the platform operator (it held no claim of its own).",
        attributes: {
          ...holderAttributes(child.accountId),
          accountKind: child.accountKind,
          parentAccountId: holder.accountId,
          // Not named `credential...`: the redaction by key name would print
          // the boolean as [REDACTED] (the audit pattern list catches
          // credential, secret, token, ...).
          ciphertextErased: child.credentialErased
        },
        ...(actor.correlationId ? { correlationId: actor.correlationId } : {})
      });
    }

    await recordAuditEvent(tx, {
      tenantId: holder.tenantId,
      actorTenantId: actor.platformTenantId,
      moduleKey: CHANNEL_ACCOUNTS_MODULE_KEY,
      action: "channel_accounts.account.claim_released",
      resourceType: "channel_account",
      resourceId: holder.accountId,
      severity: "warning",
      message:
        "Channel account ended by the platform operator to release a contested external-account claim.",
      attributes: {
        ...holderAttributes(holder.accountId),
        accountKind: released.accountKind,
        ciphertextErased: released.credentialErased
      },
      ...(actor.correlationId ? { correlationId: actor.correlationId } : {})
    });
  }

  // Back to the platform tenant BEFORE anything else is written: the caller's
  // audit and idempotency records belong to its own tenant's partition.
  await bindTenant(tx, actor.platformTenantId);

  if (released.outcome === "not_found") return { outcome: "not_found" };
  if (released.outcome === "refused") return released;

  await recordAuditEvent(tx, {
    tenantId: actor.platformTenantId,
    actorTenantUserId: actor.tenantUserId,
    moduleKey: CHANNEL_ACCOUNTS_MODULE_KEY,
    action: "channel_accounts.claim.release",
    resourceType: "channel_account",
    resourceId: holder.accountId,
    severity: "critical",
    message:
      "Platform operator released a contested external-account claim held by another tenant.",
    attributes: {
      provider: input.provider,
      accountKind: released.accountKind,
      holderTenantId: holder.tenantId,
      reasonCode: CLAIM_RELEASED_REASON_CODE,
      releaseReason: input.reasonCode,
      ...(input.ticketRef ? { ticketRef: input.ticketRef } : {}),
      reason: input.reason,
      ciphertextErased: released.credentialErased,
      releasedChildren: released.children.length
    },
    ...(actor.correlationId ? { correlationId: actor.correlationId } : {})
  });

  return {
    outcome: "released",
    holderTenantId: holder.tenantId,
    accountId: holder.accountId,
    accountKind: released.accountKind,
    credentialErased: released.credentialErased,
    releasedChildren: released.children.length
  };
}
