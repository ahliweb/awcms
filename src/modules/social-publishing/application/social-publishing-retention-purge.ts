/**
 * Retention for the social publishing evidence (Issue #1145, an admission
 * condition of ADR-0157). The registered "delegated" adopter of the three
 * `dataLifecycle` descriptors in `../module.ts`, in the shape
 * `whatsapp-delivery/application/whatsapp-queue-purge.ts` uses: bounded
 * batches, legal-hold gated, self-auditing. Run by
 * `bun run social-publishing:retention:purge` as `awcms_worker`.
 *
 * ## Why delegated and not `generic`
 *
 * The generic executor deletes rows by age, one table at a time, with no status
 * predicate. Here that would be wrong three ways: it would delete a waiting job
 * (or one an operator must reconcile) because it is old, it would orphan
 * attempts or fail on the foreign keys, and it would split one piece of evidence
 * (a publication, its jobs, their attempts) into parts kept for different
 * lengths of time.
 *
 * ## The unit is a whole publication
 *
 * A publication is removed only when it is `ready`, `cancelled` or `refused`,
 * it and EVERY one of its jobs are older than the window, and every job is
 * terminal (`published`, `failed`, `cancelled`). Attempts go first, then jobs,
 * then the publication, in ONE transaction, so a pass never leaves half a
 * publication. A `needs_reconciliation` job (the post may or may not exist) and
 * a `pending_approval` publication are never removed, however old: they wait
 * for a person.
 *
 * The database enforces its own floor under this (`sql/357`): the worker cannot
 * delete anything younger than 365 days or not terminal, whatever this code
 * asks. A legal hold on ANY of the three descriptors stops the whole purge for
 * the tenant, because the three tables are one record.
 *
 * Runs regardless of `SOCIAL_PUBLISHING_ENABLED`: a deployment that switched the
 * module off still holds rows from when it was on.
 */
import { withTenantOrThrow } from "../../../lib/database/tenant-context";
import type { LegalHoldGuardPort } from "../../_shared/ports/legal-hold-guard-port";
import { recordAuditEvent } from "../../logging/application/audit-log";
import {
  SOCIAL_PUBLISHING_DEFAULT_RETENTION_DAYS,
  SOCIAL_PUBLISHING_LIFECYCLE_KEYS,
  SOCIAL_PUBLISHING_PURGE_BATCH_LIMIT,
  clampSocialPublishingRetentionDays
} from "../domain/social-publishing-lifecycle";
import { SOCIAL_PUBLISHING_MODULE_KEY } from "../domain/social-publishing-constants";

export type PurgeSocialPublishingOptions = {
  /** Clamped into 365..3650; defaults to 730. */
  retentionDays?: number;
  /** Publications per pass. */
  batchLimit?: number;
  now?: Date;
  correlationId?: string;
};

export type PurgeSocialPublishingResult = {
  purgedPublications: number;
  purgedJobs: number;
  purgedAttempts: number;
  /** A legal hold on one of the three descriptors stopped the pass. */
  held: boolean;
};

export function resolveSocialPublishingRetentionCutoff(
  now: Date,
  retentionDays: number
): Date {
  return new Date(
    now.getTime() -
      clampSocialPublishingRetentionDays(retentionDays) * 24 * 60 * 60 * 1000
  );
}

export async function purgeSocialPublishing(
  sql: Bun.SQL,
  tenantId: string,
  legalHoldGuard: LegalHoldGuardPort,
  options: PurgeSocialPublishingOptions = {}
): Promise<PurgeSocialPublishingResult> {
  const now = options.now ?? new Date();
  const batchLimit = Math.max(
    1,
    Math.min(
      options.batchLimit ?? SOCIAL_PUBLISHING_PURGE_BATCH_LIMIT,
      SOCIAL_PUBLISHING_PURGE_BATCH_LIMIT
    )
  );
  const retentionDays = clampSocialPublishingRetentionDays(
    options.retentionDays ?? SOCIAL_PUBLISHING_DEFAULT_RETENTION_DAYS
  );
  const cutoff = resolveSocialPublishingRetentionCutoff(now, retentionDays);

  return withTenantOrThrow(
    sql,
    tenantId,
    async (tx) => {
      const result: PurgeSocialPublishingResult = {
        purgedPublications: 0,
        purgedJobs: 0,
        purgedAttempts: 0,
        held: false
      };

      for (const key of SOCIAL_PUBLISHING_LIFECYCLE_KEYS) {
        if (await legalHoldGuard.isDescriptorHeld(tx, tenantId, key)) {
          result.held = true;

          return result;
        }
      }

      const candidates = (await tx`
        SELECT p.id
        FROM awcms_social_publications p
        WHERE p.tenant_id = ${tenantId}
          AND p.state IN ('ready', 'cancelled', 'refused')
          AND p.terminal_at < ${cutoff}
          AND NOT EXISTS (
            SELECT 1 FROM awcms_social_publish_jobs j
            WHERE j.tenant_id = p.tenant_id AND j.publication_id = p.id
              AND (j.status NOT IN ('published', 'failed', 'cancelled')
                   OR j.terminal_at IS NULL OR j.terminal_at >= ${cutoff})
          )
        ORDER BY p.terminal_at ASC, p.id ASC
        LIMIT ${batchLimit}
      `) as { id: string }[];

      if (candidates.length === 0) return result;

      const publicationIds = candidates.map((row) => row.id);

      // Lock the jobs so an operator's concurrent retry (failed -> queued, as
      // `awcms_app`) either lands first, and the re-check below drops the
      // publication, or waits for this transaction. SKIP LOCKED: a job held by
      // a live transaction is not history yet.
      const locked = (await tx`
        SELECT j.id, j.publication_id, j.status, j.terminal_at
        FROM awcms_social_publish_jobs j
        WHERE j.tenant_id = ${tenantId}
          AND j.publication_id = ANY(${tx.array(publicationIds, "uuid")})
        FOR UPDATE SKIP LOCKED
      `) as {
        id: string;
        publication_id: string;
        status: string;
        terminal_at: Date | null;
      }[];

      const lockedByPublication = new Map<string, typeof locked>();

      for (const job of locked) {
        lockedByPublication.set(job.publication_id, [
          ...(lockedByPublication.get(job.publication_id) ?? []),
          job
        ]);
      }

      const jobCounts = (await tx`
        SELECT publication_id, count(*)::int AS n
        FROM awcms_social_publish_jobs
        WHERE tenant_id = ${tenantId}
          AND publication_id = ANY(${tx.array(publicationIds, "uuid")})
        GROUP BY publication_id
      `) as { publication_id: string; n: number }[];
      const totalByPublication = new Map(
        jobCounts.map((row) => [row.publication_id, row.n])
      );

      // A publication is removed only when EVERY job of it was locked and is
      // still terminal and old: anything else stays whole for the next pass.
      const units = publicationIds.filter((id) => {
        const jobs = lockedByPublication.get(id) ?? [];

        return (
          jobs.length === (totalByPublication.get(id) ?? 0) &&
          jobs.every(
            (job) =>
              ["published", "failed", "cancelled"].includes(job.status) &&
              job.terminal_at !== null &&
              new Date(job.terminal_at).getTime() < cutoff.getTime()
          )
        );
      });

      if (units.length === 0) return result;

      const jobIds = units.flatMap((id) =>
        (lockedByPublication.get(id) ?? []).map((job) => job.id)
      );

      if (jobIds.length > 0) {
        const attempts = (await tx`
          DELETE FROM awcms_social_publish_attempts
          WHERE tenant_id = ${tenantId}
            AND job_id = ANY(${tx.array(jobIds, "uuid")})
          RETURNING id
        `) as { id: string }[];

        result.purgedAttempts = attempts.length;

        const jobs = (await tx`
          DELETE FROM awcms_social_publish_jobs
          WHERE tenant_id = ${tenantId}
            AND id = ANY(${tx.array(jobIds, "uuid")})
          RETURNING id
        `) as { id: string }[];

        result.purgedJobs = jobs.length;
      }

      const publications = (await tx`
        DELETE FROM awcms_social_publications
        WHERE tenant_id = ${tenantId}
          AND id = ANY(${tx.array(units, "uuid")})
        RETURNING id
      `) as { id: string }[];

      result.purgedPublications = publications.length;

      const total =
        result.purgedPublications + result.purgedJobs + result.purgedAttempts;

      if (total > 0) {
        await recordAuditEvent(tx, {
          tenantId,
          moduleKey: SOCIAL_PUBLISHING_MODULE_KEY,
          action: "purge",
          resourceType: "social_publication",
          severity: "warning",
          message: `Purged ${result.purgedPublications} social publication(s) past retention, with their jobs and attempts.`,
          // Counts and the cutoff only: never a caption, a URL or a post id.
          attributes: {
            purgedPublications: result.purgedPublications,
            purgedJobs: result.purgedJobs,
            purgedAttempts: result.purgedAttempts,
            retentionDays,
            cutoffIso: cutoff.toISOString()
          },
          correlationId: options.correlationId
        });
      }

      return result;
    },
    { workClass: "maintenance" }
  );
}
