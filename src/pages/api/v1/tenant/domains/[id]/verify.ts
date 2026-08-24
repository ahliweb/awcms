import type { APIRoute } from "astro";

import {
  fail,
  jsonResponse,
  ok
} from "../../../../../../modules/_shared/api-response";
import { getDatabaseClient } from "../../../../../../lib/database/client";
import { withTenant } from "../../../../../../lib/database/tenant-context";
import {
  authorizeInTransaction,
  resolveAuthInputs
} from "../../../../../../modules/identity-access/application/access-guard";
import { hashSessionToken } from "../../../../../../lib/auth/session-token";
import { recordAuditEvent } from "../../../../../../modules/logging/application/audit-log";
import { checkSharedRateLimit } from "../../../../../../lib/security/rate-limit";
import {
  computeRequestHash,
  findIdempotencyRecord,
  saveIdempotencyRecord
} from "../../../../../../modules/_shared/idempotency";
import {
  beginTenantDomainVerification,
  completeTenantDomainVerification
} from "../../../../../../modules/tenant-domain/application/tenant-domain-directory";
import { txtRecordsCarryValue } from "../../../../../../modules/tenant-domain/domain/domain-verification-challenge";
import { resolveVerificationTxtRecords } from "../../../../../../modules/tenant-domain/infrastructure/dns-txt-verifier";

const VERIFY_GUARD = {
  moduleKey: "tenant_domain",
  activityCode: "domains",
  action: "verify" as const
};

const IDEMPOTENCY_SCOPE = "tenant_domain_verify";

/**
 * Bounds how often ONE authenticated principal can make this route issue a DNS
 * query. The idempotency key is not a rate limit — a caller mints a fresh one
 * per attempt by design — so without this an authenticated button becomes a DNS
 * query generator pointed at any hostname the caller can name. See phase 2 for
 * why the bucket is keyed on the principal rather than on the tenant.
 *
 * Generous by intent: a person clicking "Verify" after publishing a record
 * retries a handful of times, and the limit exists to stop a loop, not to
 * punish impatience.
 */
const VERIFY_RATE_LIMIT = { maxAttempts: 30, windowMs: 60_000 };

/**
 * `POST /api/v1/tenant/domains/{id}/verify` — proves control of the hostname by
 * looking for the server-minted TXT challenge in its zone (ADR-0106).
 *
 * ## Three phases, and why they cannot be one
 *
 * 1. A tenant transaction reads the row, refuses what is not verifiable, and
 *    hands back the challenge to look for.
 * 2. The DNS lookup, **outside** any transaction. ADR-0006: an outbound call
 *    never runs inside a database transaction — it holds a connection from a
 *    bounded pool open for as long as somebody else's resolver feels like
 *    taking, which is how one slow dependency becomes a database outage.
 * 3. A second tenant transaction records the outcome, re-authorises, and only
 *    activates if the row still carries the exact challenge that was proven.
 *
 * ## Idempotency across two transactions
 *
 * The stored response is looked up in phase 1 and written in phase 3, so two
 * concurrent calls with the same key can both pass the lookup. Phase 3 re-reads
 * before writing and returns the stored response if the other one got there
 * first; the cost of the race is one redundant DNS query, never a second
 * activation. Verification is naturally idempotent — the same challenge
 * published at the same name gives the same answer — which is why this is the
 * right trade rather than a lock.
 */
export const POST: APIRoute = async ({ request, params, cookies, locals }) => {
  const { tenantId, token } = resolveAuthInputs(request, cookies);
  const domainId = params.id;

  if (!tenantId) {
    return fail(400, "TENANT_REQUIRED", "Tenant header is required.");
  }

  if (!domainId) {
    return fail(400, "VALIDATION_ERROR", "Domain id is required.");
  }

  if (!token) {
    return fail(401, "AUTH_REQUIRED", "Authentication required.");
  }

  const idempotencyKey = request.headers.get("idempotency-key");

  const requestHash = computeRequestHash({ domainId, action: "verify" });
  const sql = getDatabaseClient();
  const tokenHash = hashSessionToken(token);
  const now = new Date();
  const correlationId = locals.correlationId;

  // ---- Phase 1: read the challenge --------------------------------------
  const begun = await withTenant(sql, tenantId, async (tx) => {
    const auth = await authorizeInTransaction(
      tx,
      tenantId,
      tokenHash,
      now,
      VERIFY_GUARD
    );

    if (!auth.allowed) {
      return auth.denied;
    }

    // Allowed — so the caller is entitled to hear what is actually wrong, and
    // the decision log now carries the row saying they were here.
    if (!idempotencyKey) {
      return fail(
        400,
        "IDEMPOTENCY_REQUIRED",
        "Idempotency-Key header is required."
      );
    }

    const existingIdempotency = await findIdempotencyRecord(
      tx,
      tenantId,
      IDEMPOTENCY_SCOPE,
      idempotencyKey
    );

    if (existingIdempotency) {
      if (existingIdempotency.requestHash !== requestHash) {
        return fail(
          409,
          "IDEMPOTENCY_CONFLICT",
          "Idempotency-Key was already used with a different request."
        );
      }

      return jsonResponse(existingIdempotency.responseBody, {
        status: existingIdempotency.responseStatus
      });
    }

    const result = await beginTenantDomainVerification(
      tx,
      tenantId,
      auth.context.tenantUserId,
      domainId
    );

    if (result.outcome === "not_found") {
      return fail(404, "RESOURCE_NOT_FOUND", "Tenant domain not found.");
    }

    if (result.outcome === "hostname_too_long") {
      return fail(
        409,
        "DOMAIN_NOT_VERIFIABLE",
        "This hostname is too long to carry a DNS verification record."
      );
    }

    if (result.outcome === "not_verifiable") {
      return fail(
        409,
        "INVALID_STATUS_TRANSITION",
        `Cannot verify a domain in status "${result.currentStatus}".`
      );
    }

    if (result.outcome === "already_active") {
      return { kind: "settled" as const, response: ok(result.entry) };
    }

    if (result.outcome === "challenge_issued") {
      return {
        kind: "settled" as const,
        response: fail(
          409,
          "DOMAIN_NOT_VERIFIED",
          "A DNS verification record has just been issued for this domain. Publish it, then verify again — GET this domain to read the record name and value."
        )
      };
    }

    return {
      kind: "lookup" as const,
      recordName: result.recordName,
      recordValue: result.recordValue,
      actorTenantUserId: auth.context.tenantUserId,
      // Carried forward rather than re-read out here. The refusal above is what
      // proves it is present, and it is HELD until authorization has answered
      // (gap C19) — so this is the only place that narrowing exists.
      idempotencyKey
    };
  });

  if (begun instanceof Response) {
    return begun;
  }

  // An `already_active` / `challenge_issued` answer is complete on its own: no
  // lookup was made, so there is no outcome for phase 3 to record. It is
  // deliberately NOT stored against the idempotency key either — both are
  // states the row can leave, and replaying a stale "publish it, then verify
  // again" to a caller who has since published would be worse than making them
  // ask twice.
  if (begun.kind === "settled") {
    return begun.response;
  }

  // ---- Phase 2: the lookup, outside every transaction --------------------
  //
  // Keyed on the AUTHENTICATED PRINCIPAL, not on the tenant and not on the
  // domain.
  //
  // Not the tenant: `tenantId` arrives in `x-awcms-tenant-id`, and Issue #447
  // is the record of what happens when a bucket key comes from a request
  // header — an attacker picks their own bucket and the limiter never counts
  // past one. `tests/auth-source-rate-limit.test.ts` refuses any route that
  // keys on it, and it is right to: this route validates the tenant before
  // getting here, but "the header was checked first" is a property a future
  // edit can remove without noticing. Keying on a tenant would also let one
  // looping administrator deny verification to their colleagues.
  //
  // Not the domain: the resource being protected is this deployment's
  // resolver, and a caller with a hundred domain rows is not entitled to a
  // hundred times the budget.
  //
  // The principal id comes out of the session inside a transaction, so it is
  // not the caller's to choose, and it is the right unit of blame — the thing
  // that can loop is a person holding a button.
  const rateLimit = await checkSharedRateLimit(
    `tenant-domain-verify:${begun.actorTenantUserId}`,
    VERIFY_RATE_LIMIT,
    now.getTime()
  );

  if (!rateLimit.allowed) {
    return fail(
      429,
      "RATE_LIMITED",
      "Too many verification attempts. Try again shortly.",
      {},
      undefined,
      { "retry-after": String(rateLimit.retryAfterSec) }
    );
  }

  const lookup = await resolveVerificationTxtRecords(begun.recordName);

  if (lookup.outcome === "unavailable") {
    // Nothing is written. "We could not find out" is not "the record is not
    // there", and marking the domain `failed` on our own resolver's bad day
    // would be a lie told in the tenant's audit trail.
    return fail(
      503,
      "SERVICE_UNAVAILABLE",
      "DNS verification could not be completed right now. Try again shortly."
    );
  }

  const passed =
    lookup.outcome === "records" &&
    txtRecordsCarryValue(lookup.records, begun.recordValue);

  // ---- Phase 3: record the outcome ---------------------------------------
  return withTenant(sql, tenantId, async (tx) => {
    const auth = await authorizeInTransaction(
      tx,
      tenantId,
      tokenHash,
      now,
      VERIFY_GUARD
    );

    // Re-authorised rather than carried over from phase 1: this transaction
    // performs the write, and ADR-0063 puts the gate in the transaction that
    // does the work. A session revoked or a permission withdrawn while DNS was
    // being queried must stop the write, not merely have stopped the read.
    if (!auth.allowed) {
      return auth.denied;
    }

    const replayed = await findIdempotencyRecord(
      tx,
      tenantId,
      IDEMPOTENCY_SCOPE,
      begun.idempotencyKey
    );

    if (replayed && replayed.requestHash === requestHash) {
      return jsonResponse(replayed.responseBody, {
        status: replayed.responseStatus
      });
    }

    const result = await completeTenantDomainVerification(
      tx,
      tenantId,
      auth.context.tenantUserId,
      domainId,
      begun.recordValue,
      passed
    );

    if (result.outcome === "stale") {
      return fail(
        409,
        "CONFLICT",
        "This domain changed while it was being verified. Read it again and retry."
      );
    }

    await recordAuditEvent(tx, {
      tenantId,
      actorTenantUserId: auth.context.tenantUserId,
      moduleKey: "tenant_domain",
      action: passed
        ? "tenant_domain.domain.verified"
        : "tenant_domain.domain.verification_failed",
      resourceType: "tenant_domain",
      resourceId: domainId,
      severity: passed ? "info" : "warning",
      message: passed
        ? `Tenant domain verified by DNS TXT record: ${result.entry.normalizedHostname}.`
        : `Tenant domain verification failed — the DNS TXT challenge was not found for ${result.entry.normalizedHostname}.`,
      correlationId
    });

    // A 4xx returned from INSIDE `withTenant` commits the transaction (this
    // repo has been bitten by that the other way round). Here it is exactly
    // what is wanted: a failed check still records `status = 'failed'`, the
    // audit event and the idempotency row. The refusal is the RESULT of the
    // work, not an abort of it.
    const response = passed
      ? ok(result.entry)
      : fail(
          409,
          "DOMAIN_NOT_VERIFIED",
          "The DNS TXT verification record was not found. Publish it and verify again — GET this domain to read the record name and value."
        );
    const responseBody = await response.clone().json();

    await saveIdempotencyRecord(
      tx,
      tenantId,
      IDEMPOTENCY_SCOPE,
      begun.idempotencyKey,
      requestHash,
      passed ? 200 : 409,
      responseBody
    );

    return response;
  });
};
