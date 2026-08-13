import { fail, ok } from "../../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../../modules/_shared/tenant-route";
import {
  listSubjectRequests,
  type SubjectRequestRow
} from "../../../../../modules/data-lifecycle/application/subject-request-service";

/**
 * `GET /api/v1/data-lifecycle/subject-requests` — ADR-0094, Issue #557.
 *
 * The request log, and — filtered to `pending_approval` — the checker's inbox.
 * One list rather than two endpoints: they differ by a `WHERE`, and a separate
 * inbox route would be a second place for the same authorization to drift.
 *
 * Gated on `subject_request.read`, which discloses nothing about any subject:
 * the rows carry ids, a status and the stated reason, never exported content.
 * That is what lets a data-protection officer watch the queue without holding
 * the authority to export or erase anyone.
 */
const STATUSES: readonly SubjectRequestRow["status"][] = [
  "disclosed",
  "pending_approval",
  "rejected",
  "completed"
];

type Prepared = {
  status: SubjectRequestRow["status"] | undefined;
  limit: number | undefined;
};

export const GET = defineTenantRoute<Prepared>({
  workClass: "interactive",
  prepare: ({ url }) => {
    const statusParam = url.searchParams.get("status");

    if (
      statusParam &&
      !STATUSES.includes(statusParam as SubjectRequestRow["status"])
    ) {
      return fail(
        400,
        "VALIDATION_ERROR",
        `status must be one of ${STATUSES.join(", ")}.`
      );
    }

    const limitParam = url.searchParams.get("limit");
    const limit = limitParam ? Number.parseInt(limitParam, 10) : undefined;

    if (limitParam && (!Number.isFinite(limit) || (limit as number) < 1)) {
      return fail(400, "VALIDATION_ERROR", "limit must be a positive integer.");
    }

    return {
      status: (statusParam as SubjectRequestRow["status"]) ?? undefined,
      limit
    };
  },
  authorize: {
    moduleKey: "data_lifecycle",
    activityCode: "subject_request",
    action: "read"
  },
  handler: async ({ tx, prepared, tenantId }) => {
    const requests = await listSubjectRequests(tx, tenantId, {
      status: prepared.status,
      limit: prepared.limit
    });

    return ok({ requests });
  }
});
