/**
 * Aggregate analytics read queries (ported from awcms-micro epic #617-#624).
 * All queries run inside the caller's own tenant-scoped transaction
 * (`withTenant`) — RLS on `awcms_visitor_sessions`/`awcms_visit_events` is
 * defense in depth on top of the explicit `tenant_id = ${tenantId}` filter
 * every query below already carries.
 *
 * Computed directly from raw `visit_events`/`visitor_sessions` rows, not
 * `awcms_visitor_daily_rollups` — the rollup table feeds long-range
 * historical reporting; the live dashboard reads current raw data so it is
 * never stale relative to the most recent visits.
 */
import type { AnalyticsRange } from "../domain/analytics-range";

export type RealtimeStats = {
  onlineHumanCount: number;
  onlineAdminCount: number;
  onlinePublicCount: number;
  onlineApiCount: number;
  onlineWindowSeconds: number;
  lastUpdatedAt: string;
};

export async function fetchRealtimeStats(
  tx: Bun.SQL,
  tenantId: string,
  onlineWindowSeconds: number
): Promise<RealtimeStats> {
  const rows = (await tx`
    SELECT
      count(*) FILTER (WHERE is_human) AS online_human_count,
      count(*) FILTER (WHERE area = 'admin') AS online_admin_count,
      count(*) FILTER (WHERE area = 'public') AS online_public_count,
      count(*) FILTER (WHERE area IN ('api', 'auth', 'setup')) AS online_api_count
    FROM awcms_visitor_sessions
    WHERE tenant_id = ${tenantId}
      AND last_seen_at >= now() - make_interval(secs => ${onlineWindowSeconds})
  `) as {
    online_human_count: string;
    online_admin_count: string;
    online_public_count: string;
    online_api_count: string;
  }[];

  const row = rows[0];

  return {
    onlineHumanCount: Number(row?.online_human_count ?? 0),
    onlineAdminCount: Number(row?.online_admin_count ?? 0),
    onlinePublicCount: Number(row?.online_public_count ?? 0),
    onlineApiCount: Number(row?.online_api_count ?? 0),
    onlineWindowSeconds,
    lastUpdatedAt: new Date().toISOString()
  };
}

export type NamedCount = { name: string; count: number };

async function topPathCounts(
  tx: Bun.SQL,
  tenantId: string,
  start: Date,
  limit: number
): Promise<NamedCount[]> {
  const rows = (await tx`
    SELECT path_sanitized AS name, count(*) AS count
    FROM awcms_visit_events
    WHERE tenant_id = ${tenantId} AND occurred_at >= ${start} AND human_status = 'human'
    GROUP BY path_sanitized
    ORDER BY count DESC, name ASC
    LIMIT ${limit}
  `) as { name: string; count: string }[];

  return rows.map((row) => ({ name: row.name, count: Number(row.count) }));
}

/** The only two `jsonColumn` values `topJsonFieldCounts` may ever interpolate into SQL text. */
const ALLOWED_JSON_COLUMNS = new Set(["user_agent_parsed", "geo"]);
/** The only three `jsonKey` values `topJsonFieldCounts` may ever interpolate into SQL text. */
const ALLOWED_JSON_KEYS = new Set(["browserName", "deviceType", "countryCode"]);

async function topJsonFieldCounts(
  tx: Bun.SQL,
  tenantId: string,
  start: Date,
  jsonColumn: "user_agent_parsed" | "geo",
  jsonKey: "browserName" | "deviceType" | "countryCode",
  limit: number
): Promise<NamedCount[]> {
  // `jsonColumn`/`jsonKey` are never user input — always one of the fixed
  // literal values this file's own call sites pass — so interpolating them
  // directly into the SQL text is safe. `tenantId`/`start`/`limit` remain
  // real bound parameters via `tx.unsafe`'s `$1`/`$2`/`$3` placeholders,
  // never string-concatenated. Defense in depth: a runtime allow-list assert
  // means a future caller that bypasses the TS union type fails loudly
  // instead of silently building unsafe SQL text.
  if (
    !ALLOWED_JSON_COLUMNS.has(jsonColumn) ||
    !ALLOWED_JSON_KEYS.has(jsonKey)
  ) {
    throw new Error(
      `topJsonFieldCounts: unexpected jsonColumn/jsonKey ("${jsonColumn}"/"${jsonKey}") — refusing to build SQL from an unvalidated identifier.`
    );
  }

  const rows = (await tx.unsafe(
    `SELECT ${jsonColumn}->>'${jsonKey}' AS name, count(*) AS count
     FROM awcms_visit_events
     WHERE tenant_id = $1 AND occurred_at >= $2 AND human_status = 'human'
       AND ${jsonColumn}->>'${jsonKey}' IS NOT NULL
     GROUP BY name
     ORDER BY count DESC, name ASC
     LIMIT $3`,
    [tenantId, start, limit]
  )) as { name: string; count: string }[];

  return rows.map((row) => ({ name: row.name, count: Number(row.count) }));
}

export async function fetchTopPaths(
  tx: Bun.SQL,
  tenantId: string,
  start: Date,
  limit = 50
): Promise<NamedCount[]> {
  return topPathCounts(tx, tenantId, start, limit);
}

export async function fetchTopBrowsers(
  tx: Bun.SQL,
  tenantId: string,
  start: Date,
  limit = 50
): Promise<NamedCount[]> {
  return topJsonFieldCounts(
    tx,
    tenantId,
    start,
    "user_agent_parsed",
    "browserName",
    limit
  );
}

export async function fetchTopDevices(
  tx: Bun.SQL,
  tenantId: string,
  start: Date,
  limit = 50
): Promise<NamedCount[]> {
  return topJsonFieldCounts(
    tx,
    tenantId,
    start,
    "user_agent_parsed",
    "deviceType",
    limit
  );
}

export async function fetchTopCountries(
  tx: Bun.SQL,
  tenantId: string,
  start: Date,
  limit = 50
): Promise<NamedCount[]> {
  return topJsonFieldCounts(tx, tenantId, start, "geo", "countryCode", limit);
}

export type AnalyticsSummary = {
  range: AnalyticsRange;
  humanUniqueVisitors: number;
  humanPageviews: number;
  botPageviews: number;
  adminUniqueUsers: number;
  publicUniqueVisitors: number;
  topPaths: NamedCount[];
  topBrowsers: NamedCount[];
  topDevices: NamedCount[];
  topCountries: NamedCount[];
};

export async function fetchAnalyticsSummary(
  tx: Bun.SQL,
  tenantId: string,
  range: AnalyticsRange,
  start: Date
): Promise<AnalyticsSummary> {
  const countRows = (await tx`
    SELECT
      count(DISTINCT visitor_session_id) FILTER (WHERE human_status = 'human') AS human_unique_visitors,
      count(*) FILTER (WHERE human_status = 'human') AS human_pageviews,
      count(*) FILTER (WHERE human_status = 'bot') AS bot_pageviews,
      count(DISTINCT identity_id) FILTER (WHERE area = 'admin' AND identity_id IS NOT NULL) AS admin_unique_users,
      count(DISTINCT visitor_session_id) FILTER (WHERE area = 'public') AS public_unique_visitors
    FROM awcms_visit_events
    WHERE tenant_id = ${tenantId} AND occurred_at >= ${start}
  `) as {
    human_unique_visitors: string;
    human_pageviews: string;
    bot_pageviews: string;
    admin_unique_users: string;
    public_unique_visitors: string;
  }[];

  const counts = countRows[0];

  // Sequential, not Promise.all: concurrent queries on one tx connection leak it (idle in transaction).
  const topPaths = await fetchTopPaths(tx, tenantId, start, 10);
  const topBrowsers = await fetchTopBrowsers(tx, tenantId, start, 10);
  const topDevices = await fetchTopDevices(tx, tenantId, start, 10);
  const topCountries = await fetchTopCountries(tx, tenantId, start, 10);

  return {
    range,
    humanUniqueVisitors: Number(counts?.human_unique_visitors ?? 0),
    humanPageviews: Number(counts?.human_pageviews ?? 0),
    botPageviews: Number(counts?.bot_pageviews ?? 0),
    adminUniqueUsers: Number(counts?.admin_unique_users ?? 0),
    publicUniqueVisitors: Number(counts?.public_unique_visitors ?? 0),
    topPaths,
    topBrowsers,
    topDevices,
    topCountries
  };
}

export type SecurityView = {
  range: AnalyticsRange;
  botPageviews: number;
  topBotReasons: NamedCount[];
  botPageviewsByArea: NamedCount[];
};

export async function fetchSecurityView(
  tx: Bun.SQL,
  tenantId: string,
  range: AnalyticsRange,
  start: Date
): Promise<SecurityView> {
  const totalRows = (await tx`
    SELECT count(*) AS bot_pageviews
    FROM awcms_visit_events
    WHERE tenant_id = ${tenantId} AND occurred_at >= ${start} AND human_status = 'bot'
  `) as { bot_pageviews: string }[];

  const reasonRows = (await tx`
    SELECT s.bot_reason AS name, count(*) AS count
    FROM awcms_visit_events e
    JOIN awcms_visitor_sessions s ON s.id = e.visitor_session_id
    WHERE e.tenant_id = ${tenantId} AND e.occurred_at >= ${start}
      AND e.human_status = 'bot' AND s.bot_reason IS NOT NULL
    GROUP BY s.bot_reason
    ORDER BY count DESC, name ASC
    LIMIT 20
  `) as { name: string; count: string }[];

  const areaRows = (await tx`
    SELECT area AS name, count(*) AS count
    FROM awcms_visit_events
    WHERE tenant_id = ${tenantId} AND occurred_at >= ${start} AND human_status = 'bot'
    GROUP BY area
    ORDER BY count DESC, name ASC
  `) as { name: string; count: string }[];

  return {
    range,
    botPageviews: Number(totalRows[0]?.bot_pageviews ?? 0),
    topBotReasons: reasonRows.map((row) => ({
      name: row.name,
      count: Number(row.count)
    })),
    botPageviewsByArea: areaRows.map((row) => ({
      name: row.name,
      count: Number(row.count)
    }))
  };
}
