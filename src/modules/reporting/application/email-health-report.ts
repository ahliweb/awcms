import { shapeEmailHealth, type EmailHealthView } from "../domain/email-health";

export type EmailHealthReport = EmailHealthView & {
  oldestQueuedAt: string | null;
  mostRecentSentAt: string | null;
  emailEnabled: boolean;
  provider: string | null;
};

/**
 * Email queue health summary (Issue #499, `GET /reports/email-health`).
 * Live read-aggregation over `awcms_email_messages` (migration 020) —
 * no new tables. Every `COUNT(*)` comes back from Bun.SQL as a **string**
 * (same lesson as `sync-health-report.ts`) — wrapped with `Number(...)`
 * explicitly, never `as number`.
 *
 * `emailEnabled`/`provider` reflect the *current process's* env, not a
 * per-tenant DB setting (email config is process-wide, `.env`-driven, doc
 * 18) — reported here purely for the operator's convenience alongside the
 * live queue counts, not re-validated (that's `config:validate`'s job).
 */
export async function fetchEmailHealthReport(
  tx: Bun.SQL,
  tenantId: string,
  env: NodeJS.ProcessEnv = process.env
): Promise<EmailHealthReport> {
  const countRows = await tx`
    SELECT
      COUNT(*) FILTER (WHERE status = 'queued') AS queued_count,
      COUNT(*) FILTER (WHERE status = 'retry_wait') AS retry_wait_count,
      COUNT(*) FILTER (WHERE status = 'failed') AS failed_count,
      COUNT(*) FILTER (WHERE status = 'suppressed') AS suppressed_count,
      COUNT(*) FILTER (
        WHERE status = 'sent' AND sent_at >= now() - interval '24 hours'
      ) AS sent_last_24h_count,
      MIN(created_at) FILTER (
        WHERE status IN ('queued', 'retry_wait')
      ) AS oldest_queued_at,
      MAX(sent_at) AS most_recent_sent_at
    FROM awcms_email_messages
    WHERE tenant_id = ${tenantId}
  `;

  const row = countRows[0] as
    | {
        queued_count: string;
        retry_wait_count: string;
        failed_count: string;
        suppressed_count: string;
        sent_last_24h_count: string;
        oldest_queued_at: Date | null;
        most_recent_sent_at: Date | null;
      }
    | undefined;

  const shaped = shapeEmailHealth({
    queuedCount: Number(row?.queued_count ?? 0),
    retryWaitCount: Number(row?.retry_wait_count ?? 0),
    failedCount: Number(row?.failed_count ?? 0),
    suppressedCount: Number(row?.suppressed_count ?? 0),
    sentLast24hCount: Number(row?.sent_last_24h_count ?? 0)
  });

  return {
    ...shaped,
    oldestQueuedAt: row?.oldest_queued_at?.toISOString() ?? null,
    mostRecentSentAt: row?.most_recent_sent_at?.toISOString() ?? null,
    emailEnabled: env.EMAIL_ENABLED === "true",
    provider: env.EMAIL_ENABLED === "true" ? (env.EMAIL_PROVIDER ?? null) : null
  };
}
