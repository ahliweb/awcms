/**
 * Privacy-minimized 404 governance data access (ADR-0039; adapted from awcms-micro
 * ADR-0028 threat model) over `awcms_seo_not_found_observations` (sql/060). Runs
 * inside a tenant transaction (RLS FORCE'd).
 *
 * ## Privacy is enforced at the WRITE boundary, here
 *
 * `recordNotFoundObservation` accepts an ALREADY-sanitized path (query dropped) and
 * an ALREADY-extracted bare referrer domain — the middleware capture composes the
 * path with seo-distribution's own `normalizeRedirectPath` (query dropped by
 * normalization) and the referrer with `visitor-analytics`'s `extractReferrerDomain`
 * before calling in. A full URL, query string, or secret can never reach this table.
 * Writes are AGGREGATE upserts (one row per distinct tenant+path+referrer+locale+host,
 * `hit_count` incremented), so probing the SAME 404 a million times is one row, not
 * a million.
 *
 * ## What the upsert does NOT bound (Issue #722)
 *
 * This used to claim "bounded cardinality". It is not bounded, and the word was
 * doing real work: the same claim in `module.ts` is the stated justification for
 * `partition.eligible: false`.
 *
 * The upsert collapses REPEATS of one key. It does nothing about distinct keys, and
 * the caller controls two of the five columns that make one — the path is whatever
 * they request (up to `MAX_REDIRECT_PATH_LENGTH`), and `referrer_domain` is the
 * hostname of whatever `Referer` header they send, with no allow-list. So `/a1 … /aN`
 * is N rows, each multipliable again by varying `Referer`. Cardinality is bounded by
 * distinct REQUESTS, which is to say by traffic.
 *
 * What actually bounds it is the pair outside this function: a per-IP rate limit in
 * `presentation/redirect-middleware.ts` fronting every call, and the age-based purge
 * from the data_lifecycle registry (30d default). Neither is visible from here,
 * which is why they are named here.
 */

export type NotFoundObservation = {
  id: string;
  normalizedPath: string;
  referrerDomain: string | null;
  locale: string | null;
  domainHost: string | null;
  hitCount: number;
  firstSeenAt: string;
  lastSeenAt: string;
  suggestedRedirectId: string | null;
  resolvedAt: string | null;
};

type ObservationRow = {
  id: string;
  normalized_path: string;
  referrer_domain: string | null;
  locale: string | null;
  domain_host: string | null;
  hit_count: string | number;
  first_seen_at: Date;
  last_seen_at: Date;
  suggested_redirect_id: string | null;
  resolved_at: Date | null;
};

function toObservation(row: ObservationRow): NotFoundObservation {
  return {
    id: row.id,
    normalizedPath: row.normalized_path,
    referrerDomain: row.referrer_domain,
    locale: row.locale,
    domainHost: row.domain_host,
    hitCount: Number(row.hit_count),
    firstSeenAt: row.first_seen_at.toISOString(),
    lastSeenAt: row.last_seen_at.toISOString(),
    suggestedRedirectId: row.suggested_redirect_id,
    resolvedAt: row.resolved_at ? row.resolved_at.toISOString() : null
  };
}

export type RecordNotFoundInput = {
  /** Sanitized + normalized path (query already dropped). */
  normalizedPath: string;
  /** Bare referrer hostname only (already extracted), or null. */
  referrerDomain: string | null;
  locale: string | null;
  domainHost: string | null;
  at: Date;
};

/**
 * Upsert-increment one 404 observation. Best-effort by contract — the caller wraps
 * it so a failure can never break the 404 response the visitor sees. On a repeat of
 * the same (path, referrer, locale, host) the existing row's `hit_count` is bumped
 * and `last_seen_at` advanced; a resolved observation is RE-OPENED (resolved_at
 * cleared) when it recurs, since it clearly is not actually fixed.
 */
export async function recordNotFoundObservation(
  tx: Bun.SQL,
  tenantId: string,
  input: RecordNotFoundInput
): Promise<void> {
  await tx`
    INSERT INTO awcms_seo_not_found_observations
      (tenant_id, normalized_path, referrer_domain, locale, domain_host,
       hit_count, first_seen_at, last_seen_at)
    VALUES (
      ${tenantId}, ${input.normalizedPath}, ${input.referrerDomain},
      ${input.locale}, ${input.domainHost}, 1, ${input.at}, ${input.at}
    )
    ON CONFLICT (tenant_id, normalized_path,
                 COALESCE(referrer_domain, ''), COALESCE(locale, ''),
                 COALESCE(domain_host, ''))
    DO UPDATE SET
      hit_count = awcms_seo_not_found_observations.hit_count + 1,
      last_seen_at = ${input.at},
      resolved_at = NULL,
      resolved_by = NULL
  `;
}

export const NOT_FOUND_LIST_LIMIT = 100;

/** Operator dashboard listing — top 404s by hit count, optionally unresolved-only. */
export async function listNotFoundObservations(
  tx: Bun.SQL,
  tenantId: string,
  options: { unresolvedOnly?: boolean } = {}
): Promise<NotFoundObservation[]> {
  const unresolvedOnly = options.unresolvedOnly === true;

  const rows = (await tx`
    SELECT id, normalized_path, referrer_domain, locale, domain_host, hit_count,
           first_seen_at, last_seen_at, suggested_redirect_id, resolved_at
    FROM awcms_seo_not_found_observations
    WHERE tenant_id = ${tenantId}
      AND (${unresolvedOnly} = false OR resolved_at IS NULL)
    ORDER BY hit_count DESC, last_seen_at DESC
    LIMIT ${NOT_FOUND_LIST_LIMIT}
  `) as ObservationRow[];

  return rows.map(toObservation);
}

/** Mark an observation resolved (optionally attaching a suggested redirect id). */
export async function resolveNotFoundObservation(
  tx: Bun.SQL,
  tenantId: string,
  actorTenantUserId: string,
  id: string,
  suggestedRedirectId: string | null,
  at: Date
): Promise<NotFoundObservation | null> {
  const rows = (await tx`
    UPDATE awcms_seo_not_found_observations
    SET resolved_at = ${at}, resolved_by = ${actorTenantUserId},
        suggested_redirect_id = ${suggestedRedirectId}
    WHERE tenant_id = ${tenantId} AND id = ${id}
    RETURNING id, normalized_path, referrer_domain, locale, domain_host, hit_count,
              first_seen_at, last_seen_at, suggested_redirect_id, resolved_at
  `) as ObservationRow[];

  return rows[0] ? toObservation(rows[0]) : null;
}

/** Dismiss (hard-delete) an observation the operator does not want to track. */
export async function dismissNotFoundObservation(
  tx: Bun.SQL,
  tenantId: string,
  id: string
): Promise<boolean> {
  const rows = (await tx`
    DELETE FROM awcms_seo_not_found_observations
    WHERE tenant_id = ${tenantId} AND id = ${id}
    RETURNING id
  `) as { id: string }[];

  return rows.length > 0;
}
