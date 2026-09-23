import { defineTenantRoute } from "../../../../../../modules/_shared/tenant-route";
import {
  created,
  fail,
  jsonResponse
} from "../../../../../../modules/_shared/api-response";
import {
  computeRequestHash,
  findIdempotencyRecord,
  saveIdempotencyRecord
} from "../../../../../../modules/_shared/idempotency";
import { checkSharedRateLimit } from "../../../../../../lib/security/rate-limit";
import { OMES_GUARDS } from "../../../../../../modules/omes-control/domain/permissions";
import { submitBackupRestore } from "../../../../../../modules/omes-control/application/backup-restore";
import { recordAuditEvent } from "../../../../../../modules/logging/application/audit-log";

const IDEMPOTENCY_SCOPE = "omes_backup_restore";
const RESTORE_RATE_LIMIT = { maxAttempts: 10, windowMs: 60_000 };

type Prepared = { idempotencyKey: string };

/**
 * `POST /api/v1/omes/backups/{id}/restore` (Issue ahliweb/omes#198) —
 * always-destructive; routes through the canonical `workflow-approval`
 * engine exactly like a `rollback`/`stop` operation submission. See
 * `application/backup-restore.ts`'s header for why this is not folded into
 * `POST /api/v1/omes/operations`.
 */
export const POST = defineTenantRoute<Prepared>({
  workClass: "interactive",
  prepare: ({ request }): Prepared | Response => {
    const idempotencyKey = request.headers.get("idempotency-key");

    if (!idempotencyKey) {
      return fail(400, "IDEMPOTENCY_REQUIRED", "Idempotency-Key header is required.");
    }

    return { idempotencyKey };
  },
  authorize: OMES_GUARDS.backups.restore,
  handler: async ({ tx, tenantId, now, auth, prepared, params, locals }) => {
    const backupId = params.id;

    if (!backupId) {
      return fail(400, "VALIDATION_ERROR", "Backup id is required.");
    }

    const requestHash = computeRequestHash({ action: "restore_backup", backupId });
    const existing = await findIdempotencyRecord(tx, tenantId, IDEMPOTENCY_SCOPE, prepared.idempotencyKey);

    if (existing) {
      if (existing.requestHash !== requestHash) {
        return fail(409, "IDEMPOTENCY_CONFLICT", "Idempotency-Key was already used with a different request.");
      }
      return jsonResponse(existing.responseBody, { status: existing.responseStatus });
    }

    const rateLimit = await checkSharedRateLimit(
      `omes-backup-restore:${auth.context.tenantUserId}`,
      RESTORE_RATE_LIMIT,
      now.getTime()
    );

    if (!rateLimit.allowed) {
      return fail(
        429,
        "RATE_LIMITED",
        "Too many restore requests. Try again shortly.",
        {},
        undefined,
        { "retry-after": String(rateLimit.retryAfterSec) }
      );
    }

    const outcome = await submitBackupRestore(
      tx,
      tenantId,
      auth.context.tenantUserId,
      backupId,
      now,
      locals.correlationId
    );

    if (outcome.outcome === "backup_not_found") {
      return fail(404, "RESOURCE_NOT_FOUND", "Backup not found.");
    }

    if (outcome.outcome === "approval_workflow_not_configured") {
      return fail(
        409,
        "APPROVAL_WORKFLOW_NOT_CONFIGURED",
        "This tenant has not published an active approval workflow for destructive OMES operations. Publish one under workflow key \"omes_control.destructive_operation\" via /admin/approvals before requesting a restore."
      );
    }

    await recordAuditEvent(tx, {
      tenantId,
      actorTenantUserId: auth.context.tenantUserId,
      moduleKey: "omes_control",
      action: "omes_control.backups.restore",
      resourceType: "omes_operation_request",
      resourceId: outcome.operationRequest.id,
      severity: "critical",
      message: `Backup restore requested from backup ${backupId}.`,
      attributes: { backupId, status: outcome.operationRequest.status },
      correlationId: locals.correlationId
    });

    const response = created({ operationRequest: outcome.operationRequest });
    const responseBody = await response.clone().json();

    await saveIdempotencyRecord(tx, tenantId, IDEMPOTENCY_SCOPE, prepared.idempotencyKey, requestHash, 201, responseBody);

    return response;
  }
});
