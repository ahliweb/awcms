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
  runIdempotent
} from "../../../../../../modules/social-publishing/application/route-support";
import { SOCIAL_PUBLISHING_GUARDS } from "../../../../../../modules/social-publishing/domain/social-publishing-constants";

type Prepared = { id: string; idempotencyKey: string };

/**
 * `POST /api/v1/social-publishing/jobs/{id}/retry` (Issue #1145) — retry ONE
 * failed per-account job. Only that job moves: a published sibling is never
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
  prepare: ({ request, params }) => {
    const id = asUuid(params.id);

    if (!id) return badId();

    const idempotencyKey = readIdempotencyKey(request);

    return idempotencyKey instanceof Response
      ? idempotencyKey
      : { id, idempotencyKey };
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
      { id: prepared.id },
      async () => {
        const result = await retryJob(tx, tenantId, prepared.id);

        if (result.outcome === "not_found") return notFound("Job");

        if (result.outcome === "refused") {
          return fail(
            409,
            result.code,
            result.code === "JOB_ALREADY_PUBLISHED"
              ? "The job was already published and can never be sent again."
              : "Only a failed job of a ready publication can be retried."
          );
        }

        await auditPublishing(context, {
          action: "social_publishing.job.retry",
          resourceType: "social_publish_job",
          resourceId: prepared.id,
          severity: "info",
          message: "A failed social publish job was queued for another try.",
          attributes: {
            publicationId: result.publicationId,
            accountId: result.accountId
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
