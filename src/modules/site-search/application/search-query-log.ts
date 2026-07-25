/**
 * Opt-in, minimized query logging for `site_search` (ADR-0040 §6 — privacy-first,
 * ported from awcms-micro Issue #270). ONLY written when the tenant's
 * `analytics_enabled` config is on, and it stores ONLY a sha256 of the normalized
 * query (never the raw query), its length, the locale, and the result count — so
 * no PII / sensitive parameter can leak, and the follow-on retention purge
 * (data_lifecycle) keeps it bounded.
 */
export async function recordSearchQuery(
  tx: Bun.SQL,
  tenantId: string,
  input: {
    queryHash: string;
    queryLength: number;
    locale: string;
    resultCount: number;
  }
): Promise<void> {
  await tx`
    INSERT INTO awcms_site_search_query_log
      (tenant_id, query_hash, query_length, locale, result_count)
    VALUES (${tenantId}, ${input.queryHash}, ${input.queryLength},
            ${input.locale}, ${input.resultCount})
  `;
}
