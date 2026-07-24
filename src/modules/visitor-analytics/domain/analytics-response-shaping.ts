/**
 * Raw-detail field omission for the `sessions`/`events` list endpoints
 * (ported from awcms-micro epic #617-#624). Pure — the caller (route
 * handler) decides `canSeeRawDetail` from whether the requester holds
 * `visitor_analytics.raw_detail.read`; this module only shapes the response
 * once that decision is made. Never the other way around — these functions
 * must never themselves make an authorization decision.
 *
 * `*Row` types mirror the raw DB column names (snake_case); `*Dto` types are
 * the actual HTTP response shape and are fully camelCase.
 */

export type VisitorSessionRow = {
  id: string;
  visitor_key_hash: string;
  identity_id: string | null;
  login_identifier_snapshot: string | null;
  is_authenticated: boolean;
  area: string;
  current_path: string | null;
  first_seen_at: Date;
  last_seen_at: Date;
  ip_hash: string | null;
  ip_address: string | null;
  user_agent_hash: string | null;
  browser_name: string | null;
  browser_version_major: string | null;
  os_name: string | null;
  device_type: string | null;
  is_human: boolean;
  bot_reason: string | null;
  country_code: string | null;
  region: string | null;
  city: string | null;
  timezone: string | null;
};

export type VisitorSessionDto = {
  id: string;
  visitorKeyHash: string;
  identityId: string | null;
  isAuthenticated: boolean;
  area: string;
  currentPath: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  browserName: string | null;
  browserVersionMajor: string | null;
  osName: string | null;
  deviceType: string | null;
  isHuman: boolean;
  botReason: string | null;
  countryCode: string | null;
  region: string | null;
  city: string | null;
  timezone: string | null;
  loginIdentifierSnapshot: string | null;
  ipHash: string | null;
  ipAddress: string | null;
  userAgentHash: string | null;
};

export function shapeVisitorSession(
  row: VisitorSessionRow,
  canSeeRawDetail: boolean
): VisitorSessionDto {
  return {
    id: row.id,
    visitorKeyHash: row.visitor_key_hash,
    identityId: row.identity_id,
    isAuthenticated: row.is_authenticated,
    area: row.area,
    currentPath: row.current_path,
    firstSeenAt: row.first_seen_at.toISOString(),
    lastSeenAt: row.last_seen_at.toISOString(),
    browserName: row.browser_name,
    browserVersionMajor: row.browser_version_major,
    osName: row.os_name,
    deviceType: row.device_type,
    isHuman: row.is_human,
    botReason: row.bot_reason,
    countryCode: row.country_code,
    region: row.region,
    city: row.city,
    timezone: row.timezone,
    loginIdentifierSnapshot: canSeeRawDetail
      ? row.login_identifier_snapshot
      : null,
    ipHash: canSeeRawDetail ? row.ip_hash : null,
    ipAddress: canSeeRawDetail ? row.ip_address : null,
    userAgentHash: canSeeRawDetail ? row.user_agent_hash : null
  };
}

export type VisitEventRow = {
  id: string;
  visitor_session_id: string | null;
  identity_id: string | null;
  occurred_at: Date;
  method: string;
  status_code: number | null;
  area: string;
  route_pattern: string | null;
  path_sanitized: string;
  referrer_domain: string | null;
  duration_ms: number | null;
  ip_hash: string | null;
  user_agent_hash: string | null;
  user_agent_parsed: Record<string, unknown>;
  geo: Record<string, unknown>;
  human_status: string;
  correlation_id: string | null;
};

export type VisitEventDto = {
  id: string;
  visitorSessionId: string | null;
  identityId: string | null;
  occurredAt: string;
  method: string;
  statusCode: number | null;
  area: string;
  routePattern: string | null;
  pathSanitized: string;
  referrerDomain: string | null;
  durationMs: number | null;
  userAgentParsed: Record<string, unknown>;
  geo: Record<string, unknown>;
  humanStatus: string;
  correlationId: string | null;
  ipHash: string | null;
  userAgentHash: string | null;
};

export function shapeVisitEvent(
  row: VisitEventRow,
  canSeeRawDetail: boolean
): VisitEventDto {
  return {
    id: row.id,
    visitorSessionId: row.visitor_session_id,
    identityId: row.identity_id,
    occurredAt: row.occurred_at.toISOString(),
    method: row.method,
    statusCode: row.status_code,
    area: row.area,
    routePattern: row.route_pattern,
    pathSanitized: row.path_sanitized,
    referrerDomain: row.referrer_domain,
    durationMs: row.duration_ms,
    userAgentParsed: row.user_agent_parsed,
    geo: row.geo,
    humanStatus: row.human_status,
    correlationId: row.correlation_id,
    ipHash: canSeeRawDetail ? row.ip_hash : null,
    userAgentHash: canSeeRawDetail ? row.user_agent_hash : null
  };
}
