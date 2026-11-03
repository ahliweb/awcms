import { fail } from "../../../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../../../modules/_shared/tenant-route";
import {
  lookupJobAccount,
  retryJob
} from "../../../../../../modules/social-publishing/application/publication-directory";
import {
  asUuid,
  auditPublishing,
  badId,
  canUseAllAccounts,
  mutationRefusal,
  notFound,
  readIdempotencyKey,
  readJson,
  runIdempotent,
  validationFailure
} from "../../../../../../modules/social-publishing/application/route-support";
import { SOCIAL_PUBLISHING_GUARDS } from "../../../../../../modules/social-publishing/domain/social-publishing-constants";
import { validateRetry } from "../../../../../../modules/social-publishing/domain/social-publishing-validation";

type Prepared = {
  id: string;
  idempotencyKey: string;
  confirmPossiblyPublished: boolean;
};

/**
 * `POST /api/v1/social-publishing/jobs/{id}/retry` (Issue #1145) — retry ONE
 * per-account job that `failed` or whose outcome is UNKNOWN
 * (`needs_reconciliation`: a timeout or a lost response, the post may exist). The
 * dispatcher never retries an unknown outcome by itself; here the operator must
 * send `{ "confirmPossiblyPublished": true }` to say they checked, otherwise
 * `409 RECONCILIATION_CONFIRMATION_REQUIRED`. A job that has spent the whole
 * attempt ceiling is `409 RETRY_BUDGET_EXHAUSTED`, never a 500. Only that job moves: a published sibling is never
 * touched and never replayed, and a job that already PUBLISHED can never be
 * retried (`409 JOB_ALREADY_PUBLISHED`; the database enforces it as well).
 * The publication must still be ready (approved and not cancelled). A manual
 * retry grants a small bounded extra attempt budget, never an unlimited one.
 *
 * The caller must be able to use the job's account (otherwise `404`, like an
 * unknown id). `Idempotency-Key` required; audited.
 */
export const POST = defineTenantRoute<Prepared>({
  workClass: "interactive",
  prepare: async ({ request, params }) => {
    const id = asUuid(params.id);

    if (!id) return badId();

    const idempotencyKey = readIdempotencyKey(request);

    if (idempotencyKey instanceof Response) return idempotencyKey;

    // An empty body is `null`, which `validateRetry` accepts (no confirmation).
    const body = await readJson(request);

    if (body instanceof Response) return body;

    const input = validateRetry(body);

    return input.valid
      ? {
          id,
          idempotencyKey,
          confirmPossiblyPublished: input.value.confirmPossiblyPublished
        }
      : validationFailure(input.errors);
  },
  authorize: SOCIAL_PUBLISHING_GUARDS.jobsRetry,
  handler: async (context) => {
    const refused = mutationRefusal(context.auth);

    if (refused) return refused;

    const { tx, tenantId, auth, prepared } = context;
    const actor = auth.context.tenantUserId;
    const target = await lookupJobAccount(tx, tenantId, prepared.id);

    if (
      !target ||
      !(await canUseAllAccounts(context, SOCIAL_PUBLISHING_GUARDS.jobsRetry, [
        target.accountId
      ]))
    ) {
      return notFound("Job");
    }

    return runIdempotent(
      tx,
      tenantId,
      "social_publishing_job_retry",
      prepared.idempotencyKey,
      actor,
      {
        id: prepared.id,
        confirmPossiblyPublished: prepared.confirmPossiblyPublished
      },
      async () => {
        const result = await retryJob(tx, tenantId, prepared.id, {
          confirmPossiblyPublished: prepared.confirmPossiblyPublished
        });

        if (result.outcome === "not_found") return notFound("Job");

        if (result.outcome === "refused") {
          return fail(
            409,
            result.code,
            result.code === "JOB_ALREADY_PUBLISHED"
              ? "The job was already published and can never be sent again."
              : result.code === "RECONCILIATION_CONFIRMATION_REQUIRED"
                ? "The outcome of this job is unknown and the post may already exist: check the account, then retry with confirmPossiblyPublished."
                : result.code === "RETRY_BUDGET_EXHAUSTED"
                  ? "This job has used every attempt it can be given."
                  : "Only a failed job of a ready publication can be retried."
          );
        }

        await auditPublishing(context, {
          action: "social_publishing.job.retry",
          resourceType: "social_publish_job",
          resourceId: prepared.id,
          // An override of a reconciliation (the outcome was UNKNOWN and the post
          // may exist) is not the same act as retrying a failure, and is audited
          // as the riskier one (L-4 of the #1145 re-audit).
          severity:
            result.previousStatus === "needs_reconciliation"
              ? "warning"
              : "info",
          message:
            result.previousStatus === "needs_reconciliation"
              ? "A social publish job with an unknown outcome was sent again on an operator's confirmation."
              : "A failed social publish job was queued for another try.",
          attributes: {
            publicationId: result.publicationId,
            accountId: result.accountId,
            previousStatus: result.previousStatus,
            previousFailureCode: result.previousFailureCode,
            confirmPossiblyPublished: prepared.confirmPossiblyPublished
          }
        });

        return {
          status: 200,
          body: {
            jobId: result.jobId,
            publicationId: result.publicationId,
            status: "queued"
          }
        };
      }
    );
  }
});
