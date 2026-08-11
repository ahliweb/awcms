import { created, fail, ok } from "../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../modules/_shared/tenant-route";
import {
  bodyTooLargeResponse,
  readJsonBody
} from "../../../../lib/security/request-body-limit";
import {
  computeRequestHash,
  findIdempotencyRecord,
  saveIdempotencyRecord
} from "../../../../modules/_shared/idempotency";
import { decodeKeysetCursor } from "../../../../modules/_shared/keyset-pagination";
import { jsonResponse } from "../../../../modules/_shared/api-response";
import { authorizeInTransaction } from "../../../../modules/identity-access/application/access-guard";
import {
  createInvitation,
  listInvitations
} from "../../../../modules/identity-access/application/invitation-admin";
import { validateCreateInvitationInput } from "../../../../modules/identity-access/domain/invitation-policy";
import { createEmailAuthNotificationAdapter } from "../../../../modules/email/application/auth-notification-port-adapter";
import { resolveInvitationConfig } from "../../../../lib/auth/invitation-config";
import type { CreateInvitationInput } from "../../../../modules/identity-access/domain/invitation-policy";
import type { KeysetCursor } from "../../../../modules/_shared/keyset-pagination";

/**
 * `GET`/`POST /api/v1/invitations` (ADR-0082, Gelombang 4 PR 4.1 of #423).
 *
 * ## Two guards on one POST, and why
 *
 * `invitations.create` decides who may be invited. It does NOT decide what they
 * may do — an invitation naming roles additionally requires
 * `access_control.assign`, the permission that already means "hand out a role".
 *
 * That is ADR-0081's split, and it matters more here than it did for groups: a
 * grant to a group reaches whoever joins later, while a grant carried by an
 * invitation reaches someone who does not exist yet. An administrator holding
 * only `invitations.create` can admit a person and nothing more.
 *
 * `skip_email_confirmation` takes a THIRD guard, PLATFORM-scoped, because it
 * removes the only proof the recipient controls that mailbox — and after
 * Gelombang 7 the object it mints is a global principal. It is waived only when
 * the address already holds an active identity in this tenant, which is that
 * proof, already given.
 *
 * Each extra guard is a full `authorizeInTransaction` call, so each writes its
 * own decision-log row — the same thing `loadAdminScreen`'s `can()` does.
 */
const INVITE_GUARD = {
  moduleKey: "identity_access",
  activityCode: "invitations",
  action: "create"
} as const;

const ASSIGN_GUARD = {
  moduleKey: "identity_access",
  activityCode: "access_control",
  action: "assign"
} as const;

const SKIP_CONFIRMATION_GUARD = {
  moduleKey: "identity_access",
  activityCode: "invitations",
  action: "configure"
} as const;

const IDEMPOTENCY_SCOPE = "invitation_create";

type CreatePrepared = {
  input: CreateInvitationInput;
  idempotencyKey: string;
  rawBody: unknown;
};

type ListPrepared = {
  status: string | null;
  cursor: KeysetCursor | undefined;
};

const LISTABLE_STATUSES = new Set([
  "pending",
  "accepted",
  "revoked",
  "expired"
]);

export const GET = defineTenantRoute<ListPrepared>({
  workClass: "interactive",
  prepare: ({ url }): ListPrepared | Response => {
    const status = url.searchParams.get("status");
    if (status !== null && !LISTABLE_STATUSES.has(status)) {
      return fail(400, "VALIDATION_ERROR", "status is not a known value.");
    }

    const rawCursor = url.searchParams.get("cursor");
    if (rawCursor === null) {
      return { status, cursor: undefined };
    }

    // A cursor that does not decode is a 400, never a silent "start from the
    // beginning" — the caller would page forever without noticing.
    const cursor = decodeKeysetCursor(rawCursor);
    if (!cursor) {
      return fail(400, "VALIDATION_ERROR", "cursor is not a valid cursor.");
    }

    return { status, cursor };
  },
  authorize: {
    moduleKey: "identity_access",
    activityCode: "invitations",
    action: "read"
  },
  handler: async ({ tx, tenantId, prepared }) =>
    ok(
      await listInvitations(
        tx,
        tenantId,
        prepared.status === null ? {} : { status: prepared.status },
        prepared.cursor
      )
    )
});

export const POST = defineTenantRoute<CreatePrepared>({
  workClass: "interactive",
  // Body parsing belongs in `prepare`: `await request.json()` waits on the
  // CLIENT, so reading it inside the transaction would hold a reserved pool
  // connection for as long as the caller chooses to take (#504).
  prepare: async ({ request }): Promise<CreatePrepared | Response> => {
    const idempotencyKey = request.headers.get("idempotency-key");
    if (!idempotencyKey) {
      return fail(
        400,
        "IDEMPOTENCY_REQUIRED",
        "Idempotency-Key header is required."
      );
    }

    const bodyRead = await readJsonBody(request);
    if (bodyRead.tooLarge) return bodyTooLargeResponse(bodyRead.limitBytes);

    const validation = validateCreateInvitationInput(bodyRead.value);
    if (!validation.valid) {
      return fail(
        400,
        "VALIDATION_ERROR",
        "Invitation input is invalid.",
        {},
        validation.errors
      );
    }

    return {
      input: validation.value,
      idempotencyKey,
      rawBody: bodyRead.value ?? null
    };
  },
  authorize: INVITE_GUARD,
  handler: async ({ tx, tenantId, auth, tokenHash, prepared, now, locals }) => {
    const { input } = prepared;

    // Carrying roles is a second authority. Checked before any read of the
    // invitation tables so a refusal costs one decision-log row and nothing
    // else.
    if (input.roleIds.length > 0) {
      const assign = await authorizeInTransaction(
        tx,
        tenantId,
        tokenHash,
        now,
        ASSIGN_GUARD
      );
      if (!assign.allowed) return assign.denied;
    }

    if (input.skipEmailConfirmation) {
      // Already-proven mailbox control is the sanctioned waiver: an address
      // that already holds an active identity here has verified it once, and
      // re-inviting them (new roles, same person) does not demand a second
      // proof. Anything else needs the platform-scoped permission.
      const proven = (await tx`
        SELECT 1 FROM awcms_identities
        WHERE tenant_id = ${tenantId}
          AND login_identifier = ${input.loginIdentifier}
          AND status = 'active'
      `) as unknown[];

      if (proven.length === 0) {
        const platform = await authorizeInTransaction(
          tx,
          tenantId,
          tokenHash,
          now,
          SKIP_CONFIRMATION_GUARD
        );
        if (!platform.allowed) return platform.denied;
      }
    }

    const requestHash = computeRequestHash(prepared.rawBody);
    const existing = await findIdempotencyRecord(
      tx,
      tenantId,
      IDEMPOTENCY_SCOPE,
      prepared.idempotencyKey
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

    const result = await createInvitation(
      tx,
      tenantId,
      auth.context.tenantUserId,
      input,
      now,
      {
        ...resolveInvitationConfig(),
        notifications: createEmailAuthNotificationAdapter(),
        correlationId: locals.correlationId
      }
    );

    // Every one of these returns from INSIDE the transaction and therefore
    // COMMITs. That is safe because `createInvitation` resolves each of them
    // before it writes anything.
    if (result.outcome === "identifier_taken") {
      return fail(
        409,
        "IDENTIFIER_TAKEN",
        "That address already has an account in this tenant."
      );
    }
    if (result.outcome === "already_pending") {
      return fail(
        409,
        "INVITATION_ALREADY_PENDING",
        "That address already has a pending invitation."
      );
    }
    if (result.outcome === "system_role") {
      return fail(
        409,
        "ROLE_SYSTEM_PROTECTED",
        "A system role cannot be granted through an invitation."
      );
    }
    if (result.outcome === "unknown_role") {
      return fail(
        400,
        "UNKNOWN_ROLE",
        "One or more roleIds do not name a live role in this tenant."
      );
    }

    const response = created({
      id: result.invitationId,
      delivery: result.delivery,
      roleCodes: result.grantedRoleCodes
    });
    const body = await response.clone().json();
    await saveIdempotencyRecord(
      tx,
      tenantId,
      IDEMPOTENCY_SCOPE,
      prepared.idempotencyKey,
      requestHash,
      201,
      body
    );

    return response;
  }
});
