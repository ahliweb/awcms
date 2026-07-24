/**
 * Visitor telemetry collector (ported from awcms-micro epic #617-#624). The
 * only writer of `awcms_visitor_sessions`/`awcms_visit_events`. In
 * awcms-micro `src/middleware.ts` was the sole caller; this base does NOT
 * wire collection into middleware (kept untouched so login/Turnstile/CSP
 * guarantees are unchanged) — instead the additive public visit-ingest
 * endpoint (`src/pages/api/v1/analytics/collect.ts`) is the sole caller,
 * invoking this after resolving the tenant from the beacon's `tenantCode`.
 *
 * BINDING (fail-open): `collectVisitorTelemetry` never throws — every
 * failure is caught, logged as a `warning` with `correlationId` and no
 * sensitive data, and the request always proceeds. Analytics must never
 * become a critical availability dependency (reinforced by `withTenant`'s
 * own `workClass: "background_sync"` — the lowest-priority DB work class, so
 * a saturated pool queues real interactive/reporting work ahead of telemetry
 * writes, never the reverse).
 *
 * BINDING: `identityId` must always be the caller's own server-derived
 * authenticated identity — never a client-supplied value. The public ingest
 * endpoint is anonymous-only, so it always passes `null`. `visitor_session_id`
 * is always resolved from a session row this function itself just found or
 * created inside its own tenant-scoped transaction, never from a raw
 * client-supplied UUID — closing the cross-tenant existence-oracle risk.
 */
import { withTenant } from "../../../lib/database/tenant-context";
import { log } from "../../../lib/logging/logger";
import { isTrackablePath, sanitizePath } from "../domain/path-sanitizer";
import { extractReferrerDomain } from "../domain/referrer";
import { determineArea, type RequestArea } from "../domain/request-area";
import {
  classifyHumanStatus,
  classifySessionHumanity
} from "../domain/human-classifier";
import { parseUserAgent, type ParsedUserAgent } from "../domain/user-agent";
import {
  hashIpAddress,
  hashUserAgent,
  hashVisitorKey
} from "../domain/visitor-key";
import type { GeoEnrichment } from "../domain/geo-enrichment";
import type { VisitorAnalyticsConfig } from "../domain/visitor-analytics-config";

/**
 * A session row already updated within this many seconds is left alone —
 * `last_seen_at` still reflects "recently active" for realtime-presence
 * purposes without a write on every single request from the same visitor.
 * Not env-tunable — a small, fixed constant.
 */
const SESSION_UPDATE_THROTTLE_MS = 30_000;

/**
 * Gates whether the collector should do anything at all for this request —
 * pure, so it's independently unit-testable without a database. `pathname`
 * must be the RAW (unsanitized) path; static/internal/health/spec paths are
 * excluded regardless of every other flag.
 */
export function shouldCollectRequest(input: {
  pathname: string;
  area: RequestArea;
  config: VisitorAnalyticsConfig;
}): boolean {
  const { pathname, area, config } = input;

  if (!config.enabled) return false;
  if (!isTrackablePath(pathname)) return false;
  if (area === "admin") return config.collectAdmin;
  if (pathname.startsWith("/api")) return config.collectApi;

  return config.collectPublic;
}

export type CollectVisitorTelemetryInput = {
  sql: Bun.SQL;
  tenantId: string;
  correlationId: string;
  config: VisitorAnalyticsConfig;
  method: string;
  /** Raw path (with query string), NOT yet sanitized — this function sanitizes it. */
  rawPath: string;
  statusCode: number | null;
  /** Resolved by the caller from the visitor cookie (`resolveVisitorKey`). */
  visitorKey: string;
  ipAddress: string | null;
  userAgent: string | null;
  referrerHeader: string | null;
  isAuthenticated: boolean;
  /** Server-derived from the caller's own authenticated session — see file header note. */
  identityId: string | null;
  /** Resolved by the caller from trusted headers only — always all-null when geo enrichment is disabled/untrusted. */
  geo: GeoEnrichment;
};

type SessionRow = { id: string; last_seen_at: string };

/**
 * Known, benign limitation: two concurrent requests from the same visitor
 * that both observe "no session yet" can each `INSERT` a new row — session-
 * count fragmentation, not a correctness/security bug (tenant isolation and
 * RLS are unaffected, `visit_events` FK integrity holds either way). Not
 * worth a `SELECT ... FOR UPDATE`/advisory-lock fix for an analytics table.
 */
async function upsertVisitorSession(
  tx: Bun.SQL,
  input: {
    tenantId: string;
    area: RequestArea;
    visitorKeyHash: string;
    pathSanitized: string;
    ipHash: string | null;
    rawIpAddress: string | null;
    userAgentHash: string | null;
    parsedUserAgent: ParsedUserAgent;
    isHuman: boolean;
    botReason: string | null;
    isAuthenticated: boolean;
    identityId: string | null;
    onlineWindowSeconds: number;
    geo: GeoEnrichment;
  }
): Promise<string> {
  const existingRows = (await tx`
    SELECT id, last_seen_at FROM awcms_visitor_sessions
    WHERE tenant_id = ${input.tenantId}
      AND visitor_key_hash = ${input.visitorKeyHash}
      AND area = ${input.area}
    ORDER BY last_seen_at DESC
    LIMIT 1
  `) as SessionRow[];

  const existing = existingRows[0];
  const nowMs = Date.now();
  const lastSeenMs = existing
    ? new Date(existing.last_seen_at).getTime()
    : null;
  const withinSameSession =
    lastSeenMs !== null &&
    nowMs - lastSeenMs <= input.onlineWindowSeconds * 1000;

  if (existing && withinSameSession) {
    const dueForWrite =
      lastSeenMs === null || nowMs - lastSeenMs >= SESSION_UPDATE_THROTTLE_MS;

    if (dueForWrite) {
      await tx`
        UPDATE awcms_visitor_sessions
        SET last_seen_at = now(),
            current_path = ${input.pathSanitized},
            is_human = ${input.isHuman},
            bot_reason = ${input.botReason},
            browser_name = ${input.parsedUserAgent.browserName},
            browser_version_major = ${input.parsedUserAgent.browserVersionMajor},
            os_name = ${input.parsedUserAgent.osName},
            device_type = ${input.parsedUserAgent.deviceType},
            country_code = ${input.geo.countryCode},
            region = ${input.geo.region},
            city = ${input.geo.city},
            timezone = ${input.geo.timezone},
            updated_at = now()
        WHERE id = ${existing.id}
      `;
    }

    return existing.id;
  }

  // No recent session for this visitor+area — start a new one.
  // login_identifier_snapshot is deliberately always null here: it's a
  // nullable display convenience, never populated for anonymous visitors
  // (the only kind the public ingest endpoint produces).
  const insertedRows = (await tx`
    INSERT INTO awcms_visitor_sessions
      (tenant_id, visitor_key_hash, identity_id, login_identifier_snapshot,
       is_authenticated, area, current_path, ip_hash, ip_address,
       user_agent_hash, browser_name, browser_version_major, os_name,
       device_type, is_human, bot_reason, country_code, region, city, timezone)
    VALUES (
      ${input.tenantId}, ${input.visitorKeyHash}, ${input.identityId}, null,
      ${input.isAuthenticated}, ${input.area}, ${input.pathSanitized},
      ${input.ipHash}, ${input.rawIpAddress}, ${input.userAgentHash},
      ${input.parsedUserAgent.browserName}, ${input.parsedUserAgent.browserVersionMajor},
      ${input.parsedUserAgent.osName}, ${input.parsedUserAgent.deviceType},
      ${input.isHuman}, ${input.botReason}, ${input.geo.countryCode},
      ${input.geo.region}, ${input.geo.city}, ${input.geo.timezone}
    )
    RETURNING id
  `) as { id: string }[];

  return insertedRows[0]!.id;
}

/**
 * Writes one `awcms_visit_events` row and creates/refreshes the matching
 * `awcms_visitor_sessions` row. Never throws — see the file header's
 * fail-open note. Callers should still check `shouldCollectRequest` first
 * (cheap, no DB) to avoid the function-call overhead for requests that will
 * be skipped anyway, but this function re-checks `isTrackablePath` itself as
 * defense in depth.
 */
export async function collectVisitorTelemetry(
  input: CollectVisitorTelemetryInput
): Promise<void> {
  const {
    sql,
    tenantId,
    correlationId,
    config,
    method,
    rawPath,
    statusCode,
    visitorKey,
    ipAddress,
    userAgent,
    referrerHeader,
    isAuthenticated,
    identityId,
    geo
  } = input;

  try {
    if (!isTrackablePath(rawPath)) return;

    const area = determineArea(rawPath.split("?")[0] ?? rawPath);
    const pathSanitized = sanitizePath(rawPath);
    const parsedUserAgent = parseUserAgent(userAgent);
    const humanStatus = classifyHumanStatus({
      isAuthenticated,
      parsedUserAgent
    });
    const sessionHumanity = classifySessionHumanity({
      isAuthenticated,
      parsedUserAgent
    });
    // Visitor identifiers are keyed by BOTH the deployment salt AND `tenantId`
    // (see `visitor-key.ts`) so the same browser/IP/user-agent yields different
    // hashes across tenants sharing one origin — cross-tenant unlinkability at
    // the storage layer.
    const visitorKeyHash = hashVisitorKey(
      visitorKey,
      config.hashSalt,
      tenantId
    );
    const ipHash = ipAddress
      ? hashIpAddress(ipAddress, config.hashSalt, tenantId)
      : null;
    const userAgentHash = userAgent
      ? hashUserAgent(userAgent, config.hashSalt, tenantId)
      : null;
    const rawIpAddress = config.rawIpEnabled ? ipAddress : null;
    const referrerDomain = extractReferrerDomain(referrerHeader);

    await withTenant(
      sql,
      tenantId,
      async (tx) => {
        const sessionId = await upsertVisitorSession(tx, {
          tenantId,
          area,
          visitorKeyHash,
          pathSanitized,
          ipHash,
          rawIpAddress,
          userAgentHash,
          parsedUserAgent,
          isHuman: sessionHumanity.isHuman,
          botReason: sessionHumanity.botReason,
          isAuthenticated,
          identityId,
          onlineWindowSeconds: config.onlineWindowSeconds,
          geo
        });

        // Pass a plain JS object as the jsonb query parameter, never a
        // pre-`JSON.stringify`'d string. Bun.SQL only decodes a `jsonb`
        // column back into a parsed object on SELECT when the matching INSERT
        // parameter was itself passed as an object — `${JSON.stringify(x)}::jsonb`
        // stores the same bytes but every later SELECT returns a raw JSON
        // string, breaking `VisitEventRow.user_agent_parsed`/`geo`'s
        // `Record<string, unknown>` type.
        const userAgentParsed = {
          browserName: parsedUserAgent.browserName,
          browserVersionMajor: parsedUserAgent.browserVersionMajor,
          osName: parsedUserAgent.osName,
          deviceType: parsedUserAgent.deviceType
        };
        const geoJson = {
          countryCode: geo.countryCode,
          region: geo.region,
          city: geo.city,
          timezone: geo.timezone
        };

        await tx`
          INSERT INTO awcms_visit_events
            (tenant_id, visitor_session_id, identity_id, method, status_code,
             area, path_sanitized, referrer_domain, ip_hash, user_agent_hash,
             user_agent_parsed, geo, human_status, correlation_id)
          VALUES (
            ${tenantId}, ${sessionId}, ${identityId}, ${method}, ${statusCode},
            ${area}, ${pathSanitized}, ${referrerDomain}, ${ipHash}, ${userAgentHash},
            ${userAgentParsed}::jsonb, ${geoJson}::jsonb, ${humanStatus}, ${correlationId}
          )
        `;
      },
      // `queueTimeoutMs` deliberately far below `withTenant`'s own 2000ms
      // default: this collector is a synchronous, per-request caller of
      // `background_sync`. Awaiting the 2000ms default here would mean every
      // collected request could pick up up to two seconds of added latency
      // under pool saturation before the fail-open path even triggers —
      // exactly the "critical availability dependency" this module forbids.
      // 200ms bounds the worst case to something a caller never notices,
      // while still giving the write a fair shot under ordinary load.
      { workClass: "background_sync", queueTimeoutMs: 200 }
    );
  } catch (error) {
    log("warning", "visitor_analytics.collector.failed", {
      correlationId,
      tenantId,
      moduleKey: "visitor_analytics",
      error: error instanceof Error ? error.message : "unknown error"
    });
  }
}
