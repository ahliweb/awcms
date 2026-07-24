/**
 * Daily rollup aggregation (ported from awcms-micro epic #617-#624),
 * scheduled via `bun run analytics:rollup`
 * (`scripts/visitor-analytics-rollup.ts`). Aggregates `awcms_visit_events`
 * into `awcms_visitor_daily_rollups` (migration 050).
 *
 * Idempotent by construction: every run fully RECOMPUTES a (tenant, date,
 * area) row from raw events and UPSERTs it (`ON CONFLICT (tenant_id, date,
 * area) DO UPDATE SET ... = EXCLUDED...`), never increments an existing
 * value. Re-running the same date any number of times converges on the same
 * row, it never double-counts.
 *
 * Uses the same SQL-safety pattern as `application/analytics-queries.ts`
 * (allow-listed jsonb column/key before any `tx.unsafe` string
 * interpolation, real bound parameters for every value) scoped to a closed
 * `[dayStart, dayEnd)` window AND a per-`area` split (the rollup table's own
 * primary key is `(tenant_id, date, area)`).
 */

export type NamedCount = { name: string; count: number };

export type DailyAreaRollup = {
  area: string;
  humanUniqueVisitors: number;
  humanPageviews: number;
  botPageviews: number;
  authenticatedUniqueUsers: number;
  publicUniqueVisitors: number;
  adminUniqueUsers: number;
  topPaths: NamedCount[];
  topBrowsers: NamedCount[];
  topDevices: NamedCount[];
  topCountries: NamedCount[];
};

export type RollupDateResult = {
  date: string;
  areasProcessed: number;
  areas: string[];
};

/** Top-N size for each rollup's jsonb array columns — matches
 * `fetchAnalyticsSummary`'s own top-10 default. */
const ROLLUP_TOP_N_LIMIT = 10;

type AreaCountRow = {
  area: string;
  human_unique_visitors: string;
  human_pageviews: string;
  bot_pageviews: string;
  authenticated_unique_users: string;
  all_unique_visitors: string;
};

async function fetchDailyAreaCounts(
  tx: Bun.SQL,
  tenantId: string,
  dayStart: Date,
  dayEnd: Date
): Promise<AreaCountRow[]> {
  return (await tx`
    SELECT
      area,
      count(DISTINCT visitor_session_id) FILTER (WHERE human_status = 'human') AS human_unique_visitors,
      count(*) FILTER (WHERE human_status = 'human') AS human_pageviews,
      count(*) FILTER (WHERE human_status = 'bot') AS bot_pageviews,
      count(DISTINCT identity_id) FILTER (WHERE identity_id IS NOT NULL) AS authenticated_unique_users,
      count(DISTINCT visitor_session_id) AS all_unique_visitors
    FROM awcms_visit_events
    WHERE tenant_id = ${tenantId} AND occurred_at >= ${dayStart} AND occurred_at < ${dayEnd}
    GROUP BY area
  `) as AreaCountRow[];
}

async function fetchTopPathsForDay(
  tx: Bun.SQL,
  tenantId: string,
  area: string,
  dayStart: Date,
  dayEnd: Date,
  limit: number
): Promise<NamedCount[]> {
  const rows = (await tx`
    SELECT path_sanitized AS name, count(*) AS count
    FROM awcms_visit_events
    WHERE tenant_id = ${tenantId} AND area = ${area}
      AND occurred_at >= ${dayStart} AND occurred_at < ${dayEnd}
      AND human_status = 'human'
    GROUP BY path_sanitized
    ORDER BY count DESC, name ASC
    LIMIT ${limit}
  `) as { name: string; count: string }[];

  return rows.map((row) => ({ name: row.name, count: Number(row.count) }));
}

/** The only two `jsonColumn` values this function may ever interpolate into SQL text. */
const ALLOWED_JSON_COLUMNS = new Set(["user_agent_parsed", "geo"]);
/** The only three `jsonKey` values this function may ever interpolate into SQL text. */
const ALLOWED_JSON_KEYS = new Set(["browserName", "deviceType", "countryCode"]);

async function fetchTopJsonFieldForDay(
  tx: Bun.SQL,
  tenantId: string,
  area: string,
  dayStart: Date,
  dayEnd: Date,
  jsonColumn: "user_agent_parsed" | "geo",
  jsonKey: "browserName" | "deviceType" | "countryCode",
  limit: number
): Promise<NamedCount[]> {
  // Same defense-in-depth convention as `analytics-queries.ts`'s
  // `topJsonFieldCounts`: `jsonColumn`/`jsonKey` are never user input, only
  // ever one of this file's own fixed literal call-site values, but a runtime
  // allow-list check means a future caller that bypasses the TS union type
  // still fails loudly instead of building unsafe SQL text.
  if (
    !ALLOWED_JSON_COLUMNS.has(jsonColumn) ||
    !ALLOWED_JSON_KEYS.has(jsonKey)
  ) {
    throw new Error(
      `fetchTopJsonFieldForDay: unexpected jsonColumn/jsonKey ("${jsonColumn}"/"${jsonKey}") — refusing to build SQL from an unvalidated identifier.`
    );
  }

  const rows = (await tx.unsafe(
    `SELECT ${jsonColumn}->>'${jsonKey}' AS name, count(*) AS count
     FROM awcms_visit_events
     WHERE tenant_id = $1 AND area = $2
       AND occurred_at >= $3 AND occurred_at < $4
       AND human_status = 'human'
       AND ${jsonColumn}->>'${jsonKey}' IS NOT NULL
     GROUP BY name
     ORDER BY count DESC, name ASC
     LIMIT $5`,
    [tenantId, area, dayStart, dayEnd, limit]
  )) as { name: string; count: string }[];

  return rows.map((row) => ({ name: row.name, count: Number(row.count) }));
}

/**
 * Computes the full rollup row for a single `(tenantId, date, area)`. Reads
 * only — callers are responsible for persisting via `upsertDailyRollup`.
 */
async function computeDailyAreaRollup(
  tx: Bun.SQL,
  tenantId: string,
  area: string,
  dayStart: Date,
  dayEnd: Date,
  counts: AreaCountRow
): Promise<DailyAreaRollup> {
  // Sequential, not Promise.all: concurrent queries on one tx connection leak it (idle in transaction).
  const topPaths = await fetchTopPathsForDay(
    tx,
    tenantId,
    area,
    dayStart,
    dayEnd,
    ROLLUP_TOP_N_LIMIT
  );
  const topBrowsers = await fetchTopJsonFieldForDay(
    tx,
    tenantId,
    area,
    dayStart,
    dayEnd,
    "user_agent_parsed",
    "browserName",
    ROLLUP_TOP_N_LIMIT
  );
  const topDevices = await fetchTopJsonFieldForDay(
    tx,
    tenantId,
    area,
    dayStart,
    dayEnd,
    "user_agent_parsed",
    "deviceType",
    ROLLUP_TOP_N_LIMIT
  );
  const topCountries = await fetchTopJsonFieldForDay(
    tx,
    tenantId,
    area,
    dayStart,
    dayEnd,
    "geo",
    "countryCode",
    ROLLUP_TOP_N_LIMIT
  );

  const authenticatedUniqueUsers = Number(counts.authenticated_unique_users);
  const allUniqueVisitors = Number(counts.all_unique_visitors);

  return {
    area,
    humanUniqueVisitors: Number(counts.human_unique_visitors),
    humanPageviews: Number(counts.human_pageviews),
    botPageviews: Number(counts.bot_pageviews),
    authenticatedUniqueUsers,
    // Matches `fetchAnalyticsSummary`'s semantics: `publicUniqueVisitors`/
    // `adminUniqueUsers` are each only meaningful for their own area's row;
    // every other area's row carries 0 for both, so summing a date's rollup
    // rows across areas reproduces the same tenant-wide totals
    // `fetchAnalyticsSummary` computes directly from raw events.
    publicUniqueVisitors: area === "public" ? allUniqueVisitors : 0,
    adminUniqueUsers: area === "admin" ? authenticatedUniqueUsers : 0,
    topPaths,
    topBrowsers,
    topDevices,
    topCountries
  };
}

/**
 * Idempotent UPSERT into `awcms_visitor_daily_rollups`. `ON CONFLICT
 * (tenant_id, date, area) DO UPDATE SET ... = EXCLUDED...` — a rerun for a
 * date/area already rolled up overwrites every aggregate column with the
 * freshly recomputed value, it never adds to the existing one.
 */
export async function upsertDailyRollup(
  tx: Bun.SQL,
  tenantId: string,
  date: string,
  rollup: DailyAreaRollup
): Promise<void> {
  await tx`
    INSERT INTO awcms_visitor_daily_rollups (
      tenant_id, date, area,
      human_unique_visitors, human_pageviews, bot_pageviews,
      authenticated_unique_users, public_unique_visitors, admin_unique_users,
      top_paths, top_browsers, top_devices, top_countries, updated_at
    ) VALUES (
      ${tenantId}, ${date}, ${rollup.area},
      ${rollup.humanUniqueVisitors}, ${rollup.humanPageviews}, ${rollup.botPageviews},
      ${rollup.authenticatedUniqueUsers}, ${rollup.publicUniqueVisitors}, ${rollup.adminUniqueUsers},
      ${rollup.topPaths}::jsonb, ${rollup.topBrowsers}::jsonb, ${rollup.topDevices}::jsonb, ${rollup.topCountries}::jsonb,
      now()
    )
    ON CONFLICT (tenant_id, date, area) DO UPDATE SET
      human_unique_visitors = EXCLUDED.human_unique_visitors,
      human_pageviews = EXCLUDED.human_pageviews,
      bot_pageviews = EXCLUDED.bot_pageviews,
      authenticated_unique_users = EXCLUDED.authenticated_unique_users,
      public_unique_visitors = EXCLUDED.public_unique_visitors,
      admin_unique_users = EXCLUDED.admin_unique_users,
      top_paths = EXCLUDED.top_paths,
      top_browsers = EXCLUDED.top_browsers,
      top_devices = EXCLUDED.top_devices,
      top_countries = EXCLUDED.top_countries,
      updated_at = now()
  `;
}

/**
 * Rolls up ONE calendar date (UTC day boundary — `date` is a plain
 * `YYYY-MM-DD` string) for one tenant. Only areas that actually had at least
 * one event that day get a row. Called from
 * `scripts/visitor-analytics-rollup.ts` inside the caller's own `withTenant`
 * transaction — this function does not open its own tenant context.
 */
export async function rollupVisitorAnalyticsForDate(
  tx: Bun.SQL,
  tenantId: string,
  date: string
): Promise<RollupDateResult> {
  const dayStart = new Date(`${date}T00:00:00.000Z`);
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

  const countRows = await fetchDailyAreaCounts(tx, tenantId, dayStart, dayEnd);
  const areas: string[] = [];

  for (const row of countRows) {
    const rollup = await computeDailyAreaRollup(
      tx,
      tenantId,
      row.area,
      dayStart,
      dayEnd,
      row
    );

    await upsertDailyRollup(tx, tenantId, date, rollup);
    areas.push(row.area);
  }

  return { date, areasProcessed: areas.length, areas };
}
