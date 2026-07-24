/**
 * Redirect-rule data access (ADR-0039; adapted from awcms-micro ADR-0028 §8) over
 * `awcms_seo_redirects` (sql/060). Every query runs inside a caller-provided tenant
 * transaction (`withTenant`, RLS FORCE'd on this table), so tenant isolation holds
 * twice: the explicit `tenant_id` filter here AND RLS. Tenant A can never read,
 * resolve, or mutate tenant B's rules.
 *
 * The resolve-time lookup (`findActiveRedirectByPath`) is a single INDEXED point
 * query per hop — the chain resolver (`domain/redirect-chain.ts`) calls it a
 * bounded number of times; there is NO recursive SQL. Writers stamp
 * `created_by`/`updated_by`; deletes are soft (with restore/purge) except an
 * explicit operator purge of already-soft-deleted rows.
 */
import type {
  RedirectOrigin,
  RedirectRuleInput,
  RedirectRuleUpdate,
  RedirectState,
  RedirectStatusCode,
  RedirectTargetType
} from "../domain/redirect-rule";
import {
  encodeKeysetCursor,
  KEYSET_CURSOR_CREATED_AT_SQL,
  type KeysetCursor
} from "../../_shared/keyset-pagination";

/** The admin list page size (keyset-paginated, newest first). */
export const REDIRECT_LIST_LIMIT = 100;

export type RedirectRecord = {
  id: string;
  sourcePath: string;
  normalizedSourcePath: string;
  localeScope: string | null;
  domainScopeHost: string | null;
  targetType: RedirectTargetType;
  target: string;
  statusCode: RedirectStatusCode;
  state: RedirectState;
  effectiveFrom: string | null;
  effectiveUntil: string | null;
  preserveQuery: boolean;
  reason: string | null;
  origin: RedirectOrigin;
  hitCount: number;
  lastHitAt: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};

type RedirectRow = {
  id: string;
  source_path: string;
  normalized_source_path: string;
  locale_scope: string | null;
  domain_scope_host: string | null;
  target_type: RedirectTargetType;
  target: string;
  status_code: number;
  state: RedirectState;
  effective_from: Date | null;
  effective_until: Date | null;
  preserve_query: boolean;
  reason: string | null;
  origin: RedirectOrigin;
  hit_count: string | number;
  last_hit_at: Date | null;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
};

const SELECT_COLUMNS =
  "id, source_path, normalized_source_path, locale_scope, domain_scope_host, " +
  "target_type, target, status_code, state, effective_from, effective_until, " +
  "preserve_query, reason, origin, hit_count, last_hit_at, created_at, updated_at, deleted_at";

function toRecord(row: RedirectRow): RedirectRecord {
  return {
    id: row.id,
    sourcePath: row.source_path,
    normalizedSourcePath: row.normalized_source_path,
    localeScope: row.locale_scope,
    domainScopeHost: row.domain_scope_host,
    targetType: row.target_type,
    target: row.target,
    statusCode: row.status_code as RedirectStatusCode,
    state: row.state,
    effectiveFrom: row.effective_from ? row.effective_from.toISOString() : null,
    effectiveUntil: row.effective_until
      ? row.effective_until.toISOString()
      : null,
    preserveQuery: row.preserve_query,
    reason: row.reason,
    origin: row.origin,
    hitCount: Number(row.hit_count),
    lastHitAt: row.last_hit_at ? row.last_hit_at.toISOString() : null,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    deletedAt: row.deleted_at ? row.deleted_at.toISOString() : null
  };
}

/** The minimal shape the resolve-time chain lookup needs. */
export type ResolvedRedirectRule = {
  id: string;
  targetType: RedirectTargetType;
  target: string;
  statusCode: RedirectStatusCode;
  preserveQuery: boolean;
};

/**
 * Resolve-time point lookup: the single best ACTIVE, in-effect rule for a tenant +
 * exact normalized path, honoring locale/host scope precedence (a rule scoped to
 * the request's host/locale beats an all-scopes rule). One indexed query.
 */
export async function findActiveRedirectByPath(
  tx: Bun.SQL,
  tenantId: string,
  normalizedPath: string,
  ctx: { locale: string | null; host: string | null; now: Date }
): Promise<ResolvedRedirectRule | null> {
  const localeParam = ctx.locale ?? null;
  const hostParam = ctx.host ?? null;

  const rows = (await tx`
    SELECT id, target_type, target, status_code, preserve_query
    FROM awcms_seo_redirects
    WHERE tenant_id = ${tenantId}
      AND normalized_source_path = ${normalizedPath}
      AND state = 'active'
      AND deleted_at IS NULL
      AND (effective_from IS NULL OR effective_from <= ${ctx.now})
      AND (effective_until IS NULL OR effective_until > ${ctx.now})
      AND (locale_scope IS NULL OR locale_scope = ${localeParam})
      AND (domain_scope_host IS NULL OR domain_scope_host = ${hostParam})
    ORDER BY
      (domain_scope_host IS NOT NULL) DESC,
      (locale_scope IS NOT NULL) DESC,
      created_at ASC
    LIMIT 1
  `) as {
    id: string;
    target_type: RedirectTargetType;
    target: string;
    status_code: number;
    preserve_query: boolean;
  }[];

  const row = rows[0];
  if (!row) return null;

  return {
    id: row.id,
    targetType: row.target_type,
    target: row.target,
    statusCode: row.status_code as RedirectStatusCode,
    preserveQuery: row.preserve_query
  };
}

/**
 * The single live (non-deleted, non-archived) rule that already occupies a
 * source+scope slot, if any — the conflict the unique index would reject. Used to
 * EXPLAIN a conflict on validate/create instead of surfacing a raw DB error.
 */
export async function findConflictingRedirect(
  tx: Bun.SQL,
  tenantId: string,
  normalizedSourcePath: string,
  localeScope: string | null,
  domainScopeHost: string | null,
  excludeId?: string
): Promise<RedirectRecord | null> {
  const rows = (await tx`
    SELECT ${tx.unsafe(SELECT_COLUMNS)}
    FROM awcms_seo_redirects
    WHERE tenant_id = ${tenantId}
      AND normalized_source_path = ${normalizedSourcePath}
      AND COALESCE(locale_scope, '') = ${localeScope ?? ""}
      AND COALESCE(domain_scope_host, '') = ${domainScopeHost ?? ""}
      AND deleted_at IS NULL
      AND state <> 'archived'
      AND (${excludeId ?? null}::uuid IS NULL OR id <> ${excludeId ?? null}::uuid)
    LIMIT 1
  `) as RedirectRow[];

  return rows[0] ? toRecord(rows[0]) : null;
}

export type RedirectListFilters = {
  state?: RedirectState;
  targetType?: RedirectTargetType;
  /** Substring match on the normalized source path (LIKE wildcards escaped). */
  q?: string;
};

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (m) => `\\${m}`);
}

/**
 * Admin list/search/filter — keyset paginated, newest first, non-deleted only. The
 * `next` cursor is minted from the last row's FULL-PRECISION `created_at` text
 * (`KEYSET_CURSOR_CREATED_AT_SQL`, microseconds preserved), never a JS `Date`, so a
 * page boundary can't skip a row that shares a millisecond (Issue #158 hazard).
 */
export async function listRedirects(
  tx: Bun.SQL,
  tenantId: string,
  filters: RedirectListFilters = {},
  cursor?: KeysetCursor
): Promise<{ redirects: RedirectRecord[]; nextCursor: string | null }> {
  const stateParam = filters.state ?? null;
  const targetTypeParam = filters.targetType ?? null;
  const qParam =
    filters.q && filters.q.trim() !== ""
      ? `%${escapeLike(filters.q.trim())}%`
      : null;
  const cursorCreatedAt = cursor ? cursor.createdAt : null;
  const cursorId = cursor ? cursor.id : null;

  const rows = (await tx`
    SELECT ${tx.unsafe(SELECT_COLUMNS)},
           ${tx.unsafe(KEYSET_CURSOR_CREATED_AT_SQL)} AS created_at_cursor
    FROM awcms_seo_redirects
    WHERE tenant_id = ${tenantId}
      AND deleted_at IS NULL
      AND (${stateParam}::text IS NULL OR state = ${stateParam})
      AND (${targetTypeParam}::text IS NULL OR target_type = ${targetTypeParam})
      AND (${qParam}::text IS NULL OR normalized_source_path ILIKE ${qParam} ESCAPE '\\')
      AND (
        ${cursorCreatedAt}::timestamptz IS NULL
        OR (created_at, id) < (${cursorCreatedAt}::timestamptz, ${cursorId}::uuid)
      )
    ORDER BY created_at DESC, id DESC
    LIMIT ${REDIRECT_LIST_LIMIT}
  `) as (RedirectRow & { created_at_cursor: string })[];

  const redirects = rows.map(toRecord);
  const last = rows[rows.length - 1];
  const nextCursor =
    rows.length === REDIRECT_LIST_LIMIT && last
      ? encodeKeysetCursor(last.created_at_cursor, last.id)
      : null;

  return { redirects, nextCursor };
}

/** Read one rule by id (non-deleted unless `includeDeleted`). */
export async function getRedirectById(
  tx: Bun.SQL,
  tenantId: string,
  id: string,
  includeDeleted = false
): Promise<RedirectRecord | null> {
  const rows = (await tx`
    SELECT ${tx.unsafe(SELECT_COLUMNS)}
    FROM awcms_seo_redirects
    WHERE tenant_id = ${tenantId}
      AND id = ${id}
      AND (${includeDeleted} OR deleted_at IS NULL)
    LIMIT 1
  `) as RedirectRow[];

  return rows[0] ? toRecord(rows[0]) : null;
}

/** Create a rule. The unique index enforces source+scope conflict — the caller maps a violation to 409. */
export async function createRedirect(
  tx: Bun.SQL,
  tenantId: string,
  actorTenantUserId: string,
  input: RedirectRuleInput
): Promise<RedirectRecord> {
  const rows = (await tx`
    INSERT INTO awcms_seo_redirects
      (tenant_id, source_path, normalized_source_path, locale_scope, domain_scope_host,
       target_type, target, status_code, state, effective_from, effective_until,
       preserve_query, reason, origin, created_by, updated_by)
    VALUES (
      ${tenantId}, ${input.sourcePath}, ${input.normalizedSourcePath},
      ${input.localeScope}, ${input.domainScopeHost}, ${input.targetType},
      ${input.target}, ${input.statusCode}, ${input.state},
      ${input.effectiveFrom}, ${input.effectiveUntil}, ${input.preserveQuery},
      ${input.reason}, ${input.origin}, ${actorTenantUserId}, ${actorTenantUserId}
    )
    RETURNING ${tx.unsafe(SELECT_COLUMNS)}
  `) as RedirectRow[];

  return toRecord(rows[0]!);
}

/** Update the mutable fields of a non-deleted rule (source path is immutable). */
export async function updateRedirect(
  tx: Bun.SQL,
  tenantId: string,
  actorTenantUserId: string,
  id: string,
  update: RedirectRuleUpdate
): Promise<RedirectRecord | null> {
  const rows = (await tx`
    UPDATE awcms_seo_redirects
    SET locale_scope = ${update.localeScope},
        domain_scope_host = ${update.domainScopeHost},
        target_type = ${update.targetType},
        target = ${update.target},
        status_code = ${update.statusCode},
        state = ${update.state},
        effective_from = ${update.effectiveFrom},
        effective_until = ${update.effectiveUntil},
        preserve_query = ${update.preserveQuery},
        reason = ${update.reason},
        updated_by = ${actorTenantUserId},
        updated_at = now()
    WHERE tenant_id = ${tenantId} AND id = ${id} AND deleted_at IS NULL
    RETURNING ${tx.unsafe(SELECT_COLUMNS)}
  `) as RedirectRow[];

  return rows[0] ? toRecord(rows[0]) : null;
}

/** Transition state (activate/deactivate/archive) of a non-deleted rule. */
export async function setRedirectState(
  tx: Bun.SQL,
  tenantId: string,
  actorTenantUserId: string,
  id: string,
  state: RedirectState
): Promise<RedirectRecord | null> {
  const rows = (await tx`
    UPDATE awcms_seo_redirects
    SET state = ${state}, updated_by = ${actorTenantUserId}, updated_at = now()
    WHERE tenant_id = ${tenantId} AND id = ${id} AND deleted_at IS NULL
    RETURNING ${tx.unsafe(SELECT_COLUMNS)}
  `) as RedirectRow[];

  return rows[0] ? toRecord(rows[0]) : null;
}

/** Soft-delete a rule (reason required by the caller). */
export async function softDeleteRedirect(
  tx: Bun.SQL,
  tenantId: string,
  actorTenantUserId: string,
  id: string,
  reason: string
): Promise<RedirectRecord | null> {
  const rows = (await tx`
    UPDATE awcms_seo_redirects
    SET deleted_at = now(), deleted_by = ${actorTenantUserId},
        delete_reason = ${reason}, updated_by = ${actorTenantUserId}, updated_at = now()
    WHERE tenant_id = ${tenantId} AND id = ${id} AND deleted_at IS NULL
    RETURNING ${tx.unsafe(SELECT_COLUMNS)}
  `) as RedirectRow[];

  return rows[0] ? toRecord(rows[0]) : null;
}

/** Restore a soft-deleted rule (comes back INACTIVE so it cannot resume redirecting silently). */
export async function restoreRedirect(
  tx: Bun.SQL,
  tenantId: string,
  actorTenantUserId: string,
  id: string
): Promise<RedirectRecord | null> {
  const rows = (await tx`
    UPDATE awcms_seo_redirects
    SET deleted_at = NULL, deleted_by = NULL, delete_reason = NULL,
        state = 'inactive', updated_by = ${actorTenantUserId}, updated_at = now()
    WHERE tenant_id = ${tenantId} AND id = ${id} AND deleted_at IS NOT NULL
    RETURNING ${tx.unsafe(SELECT_COLUMNS)}
  `) as RedirectRow[];

  return rows[0] ? toRecord(rows[0]) : null;
}

/** Hard-delete a rule — only permitted for an already-soft-deleted row (operator purge). */
export async function purgeRedirect(
  tx: Bun.SQL,
  tenantId: string,
  id: string
): Promise<boolean> {
  const rows = (await tx`
    DELETE FROM awcms_seo_redirects
    WHERE tenant_id = ${tenantId} AND id = ${id} AND deleted_at IS NOT NULL
    RETURNING id
  `) as { id: string }[];

  return rows.length > 0;
}

/**
 * Best-effort hit projection (never on the request's critical path — the caller
 * wraps this so a failure can never break the redirect response). A single indexed
 * UPDATE by id.
 */
export async function incrementRedirectHit(
  tx: Bun.SQL,
  tenantId: string,
  id: string,
  at: Date
): Promise<void> {
  await tx`
    UPDATE awcms_seo_redirects
    SET hit_count = hit_count + 1, last_hit_at = ${at}
    WHERE tenant_id = ${tenantId} AND id = ${id} AND deleted_at IS NULL
  `;
}
