/**
 * Pure view-model helpers for the `/admin/analytics` dashboard (ported from
 * awcms-micro epic #617-#624). No DOM, no `fetch`, no `process.env` here —
 * these functions are imported both by `src/pages/admin/analytics.astro`
 * (server-side render) and by this module's own unit tests, so the
 * dashboard's empty-state decisions and raw-detail-null formatting are
 * testable without a browser or a live server.
 *
 * **Never a second authorization gate.** `visitor_analytics.raw_detail.read`
 * is checked exactly once, server-side, in
 * `domain/analytics-response-shaping.ts`'s `shapeVisitorSession`/
 * `shapeVisitEvent` — a caller without that permission always receives `null`
 * for `ipAddress`/`ipHash`/`userAgentHash`/`loginIdentifierSnapshot`,
 * regardless of anything this file does. `buildSessionRowCells`'s
 * `showRawDetailColumns` option only decides whether the dashboard bothers to
 * render four columns that would otherwise be a wall of placeholder dashes —
 * a presentation nicety, not a security decision. It can never cause a leak.
 */

export const DASHBOARD_VALUE_PLACEHOLDER = "—"; // em dash — never render the literal "null"/"undefined".

/**
 * Renders a possibly-null/blank field as-is, or the shared placeholder. The
 * one place every raw-detail column (and every other nullable display field)
 * funnels through.
 */
export function displayOrPlaceholder(value: string | null | undefined): string {
  if (value === null || value === undefined) return DASHBOARD_VALUE_PLACEHOLDER;
  const trimmed = value.trim();
  return trimmed.length === 0 ? DASHBOARD_VALUE_PLACEHOLDER : value;
}

export type NamedCountLike = { name: string; count: number };

/** A "top N" list section is empty when there is nothing to show, or every count is zero. */
export function isNamedCountListEmpty(list: NamedCountLike[]): boolean {
  return list.length === 0 || list.every((item) => item.count === 0);
}

export type RealtimeStatsLike = {
  onlineHumanCount: number;
  onlineAdminCount: number;
  onlinePublicCount: number;
  onlineApiCount: number;
};

export function isRealtimeAllZero(stats: RealtimeStatsLike): boolean {
  return (
    stats.onlineHumanCount === 0 &&
    stats.onlineAdminCount === 0 &&
    stats.onlinePublicCount === 0 &&
    stats.onlineApiCount === 0
  );
}

export type SummaryLike = {
  humanUniqueVisitors: number;
  humanPageviews: number;
  botPageviews: number;
};

export function isSummaryEmpty(summary: SummaryLike): boolean {
  return (
    summary.humanUniqueVisitors === 0 &&
    summary.humanPageviews === 0 &&
    summary.botPageviews === 0
  );
}

export type SecurityViewLike = { botPageviews: number };

export function isSecurityViewEmpty(view: SecurityViewLike): boolean {
  return view.botPageviews === 0;
}

export const ANALYTICS_AREA_FILTERS = [
  "all",
  "admin",
  "public",
  "api"
] as const;
export type AnalyticsAreaFilter = (typeof ANALYTICS_AREA_FILTERS)[number];

export const ANALYTICS_VISITOR_TYPE_FILTERS = ["all", "human", "bot"] as const;
export type AnalyticsVisitorTypeFilter =
  (typeof ANALYTICS_VISITOR_TYPE_FILTERS)[number];

/**
 * Row filter for the active-sessions table (Area / Visitor type filters).
 * This is a display filter over rows the caller is ALREADY authorized to see
 * in full — never a substitute for, or a second copy of, the server's own
 * ABAC/raw-detail gating.
 */
export function matchesAreaFilter(
  area: string,
  filter: AnalyticsAreaFilter
): boolean {
  if (filter === "all") return true;
  if (filter === "api")
    return area === "api" || area === "auth" || area === "setup";
  return area === filter;
}

export function matchesVisitorTypeFilter(
  isHuman: boolean,
  filter: AnalyticsVisitorTypeFilter
): boolean {
  if (filter === "all") return true;
  return filter === "human" ? isHuman : !isHuman;
}

/** Structural subset of `VisitorSessionDto` this file actually reads. */
export type SessionRowLike = {
  area: string;
  currentPath: string | null;
  browserName: string | null;
  osName: string | null;
  deviceType: string | null;
  isHuman: boolean;
  countryCode: string | null;
  ipAddress: string | null;
  ipHash: string | null;
  userAgentHash: string | null;
  loginIdentifierSnapshot: string | null;
};

export type SessionRowCells = {
  area: string;
  currentPath: string;
  browser: string;
  os: string;
  device: string;
  visitorType: string;
  country: string;
  raw: {
    ipAddress: string;
    ipHash: string;
    userAgentHash: string;
    loginIdentifier: string;
  } | null;
};

/**
 * Turns one already-shaped session row into display-ready strings for the
 * active-sessions table. `raw` is `null` when `showRawDetailColumns` is
 * `false`; when non-null, every one of its four fields still goes through
 * `displayOrPlaceholder`.
 */
export function buildSessionRowCells(
  session: SessionRowLike,
  options: {
    showRawDetailColumns: boolean;
    humanLabel: string;
    botLabel: string;
  }
): SessionRowCells {
  return {
    area: session.area,
    currentPath: displayOrPlaceholder(session.currentPath),
    browser: displayOrPlaceholder(session.browserName),
    os: displayOrPlaceholder(session.osName),
    device: displayOrPlaceholder(session.deviceType),
    visitorType: session.isHuman ? options.humanLabel : options.botLabel,
    country: displayOrPlaceholder(session.countryCode),
    raw: options.showRawDetailColumns
      ? {
          ipAddress: displayOrPlaceholder(session.ipAddress),
          ipHash: displayOrPlaceholder(session.ipHash),
          userAgentHash: displayOrPlaceholder(session.userAgentHash),
          loginIdentifier: displayOrPlaceholder(session.loginIdentifierSnapshot)
        }
      : null
  };
}
