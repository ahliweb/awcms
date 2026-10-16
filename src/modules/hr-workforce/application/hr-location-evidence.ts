/**
 * Geolocation attendance evidence (Issue #970, ADR-0138): the per-tenant switch,
 * geofences, notice versions and acknowledgements, the capture of a verdict, and
 * the reads of it.
 *
 * ## The one rule of this file
 *
 * A `PositionSample` is handled in exactly one place, `captureLocationEvidence`,
 * which passes it to the PURE evaluator and then forgets it. It is never bound to
 * a SQL parameter, written to an audit row, an event payload, a log line or a
 * response. The only coordinates this file ever writes are a tenant's own WORK
 * SITE (a geofence), which is a place of business, not personal data.
 *
 * ## What the database already decided
 *
 * `sql/306` refuses an evidence row while the tenant's switch is off, for any
 * event but a `self` clock_in / clock_out, and a second row for one event. This
 * file maps those refusals to a quiet "no evidence" (capture is best-effort and
 * never blocks clocking: ADR-0138 section 9) and does the application-level
 * work: the DPIA / notice / geofence preconditions to ENABLE (409s), the notice
 * acknowledgement, the audit and who may read which rows.
 */
import { createHash } from "node:crypto";

import {
  decodeKeysetCursor,
  encodeKeysetCursor,
  utcMicrosecondTextSql,
  type KeysetCursor
} from "../../_shared/keyset-pagination";
import { recordAuditEvent } from "../../logging/application/audit-log";
import { HR_WORKFORCE_MODULE_KEY } from "../domain/hr-workforce-permissions";
import { evaluatePositionSample } from "../domain/hr-geolocation-evaluator";
import {
  GEO_LIMITS,
  GEO_RULE_VERSION,
  isGeoEligibleEvent,
  type GeoAccuracyBand,
  type GeoDistanceBand,
  type GeoVerdict,
  type Geofence,
  type PositionSample
} from "../domain/hr-geolocation-types";
import type {
  GeofenceInput,
  GeolocationSettingsInput,
  NoticeInput
} from "../domain/hr-geolocation-validation";
import type { ReadBasis } from "./hr-attendance-directory";

export const EVIDENCE_PAGE_SIZE = 100;

type Actor = {
  actorTenantUserId: string | null;
  correlationId: string | undefined;
};

const iso = (value: Date | string): string =>
  value instanceof Date ? value.toISOString() : new Date(value).toISOString();

export function parseEvidenceCursor(cursor: string): KeysetCursor | null {
  return decodeKeysetCursor(cursor);
}

// --- Settings -----------------------------------------------------------------------

export type GeolocationSettings = {
  /** FALSE for every tenant until an authorised person enables it. */
  enabled: boolean;
  accuracyCeilingMeters: number;
  dpiaReference: string | null;
  dpiaRecordedOn: string | null;
  noticeId: string | null;
  noticeVersion: number | null;
};

type SettingsRow = {
  enabled: boolean;
  accuracy_ceiling_m: number;
  dpia_reference: string | null;
  dpia_recorded_on: Date | string | null;
  notice_id: string | null;
  notice_version: number | null;
};

const DEFAULT_SETTINGS: GeolocationSettings = {
  enabled: false,
  accuracyCeilingMeters: GEO_LIMITS.defaultAccuracyCeilingMeters,
  dpiaReference: null,
  dpiaRecordedOn: null,
  noticeId: null,
  noticeVersion: null
};

function dateOnly(value: Date | string | null): string | null {
  if (value === null) return null;

  return value instanceof Date
    ? value.toISOString().slice(0, 10)
    : String(value).slice(0, 10);
}

export async function readGeolocationSettings(
  tx: Bun.SQL,
  tenantId: string
): Promise<GeolocationSettings> {
  const rows = (await tx`
    SELECT s.enabled, s.accuracy_ceiling_m, s.dpia_reference, s.dpia_recorded_on,
           s.notice_id, n.version AS notice_version
    FROM awcms_hr_geolocation_settings s
    LEFT JOIN awcms_hr_geolocation_notices n
      ON n.tenant_id = s.tenant_id AND n.id = s.notice_id
    WHERE s.tenant_id = ${tenantId}
  `) as SettingsRow[];
  const row = rows[0];

  if (!row) {
    return { ...DEFAULT_SETTINGS };
  }

  return {
    enabled: row.enabled,
    accuracyCeilingMeters: row.accuracy_ceiling_m,
    dpiaReference: row.dpia_reference,
    dpiaRecordedOn: dateOnly(row.dpia_recorded_on),
    noticeId: row.notice_id,
    noticeVersion: row.notice_version
  };
}

export type WriteSettingsOutcome =
  | { outcome: "ok"; settings: GeolocationSettings }
  | {
      outcome: "refused";
      reason:
        | "dpia_required"
        | "notice_required"
        | "notice_not_found"
        | "geofence_required";
    };

/**
 * Change the switch. Turning it ON needs a DPIA reference + date, a published
 * notice and a live geofence (otherwise a 409 outcome); turning it OFF needs
 * nothing. An omitted field keeps its value. Audited at `critical` severity when
 * the switch flips, `warning` otherwise, with the before / after STATE and the
 * actor and never a location.
 */
export async function writeGeolocationSettings(
  tx: Bun.TransactionSQL,
  tenantId: string,
  actor: Actor,
  input: GeolocationSettingsInput
): Promise<WriteSettingsOutcome> {
  const before = await readGeolocationSettings(tx, tenantId);
  const next = {
    enabled: input.enabled,
    accuracyCeilingMeters:
      input.accuracyCeilingMeters ?? before.accuracyCeilingMeters,
    dpiaReference:
      input.dpiaReference === undefined
        ? before.dpiaReference
        : input.dpiaReference,
    dpiaRecordedOn:
      input.dpiaRecordedOn === undefined
        ? before.dpiaRecordedOn
        : input.dpiaRecordedOn,
    noticeId: input.noticeId === undefined ? before.noticeId : input.noticeId
  };

  if (next.noticeId !== null) {
    const notice = (await tx`
      SELECT 1 AS present FROM awcms_hr_geolocation_notices
      WHERE tenant_id = ${tenantId} AND id = ${next.noticeId}
    `) as { present: number }[];

    if (notice.length === 0) {
      return { outcome: "refused", reason: "notice_not_found" };
    }
  }

  if (next.enabled) {
    if (!next.dpiaReference || !next.dpiaRecordedOn) {
      return { outcome: "refused", reason: "dpia_required" };
    }

    if (!next.noticeId) {
      return { outcome: "refused", reason: "notice_required" };
    }

    if ((await countLiveGeofences(tx, tenantId)) === 0) {
      return { outcome: "refused", reason: "geofence_required" };
    }
  }

  try {
    await tx.savepoint(
      (sp) => sp`
        INSERT INTO awcms_hr_geolocation_settings
          (tenant_id, enabled, accuracy_ceiling_m, dpia_reference,
           dpia_recorded_on, notice_id, updated_by)
        VALUES (${tenantId}, ${next.enabled}, ${next.accuracyCeilingMeters},
                ${next.dpiaReference}, ${next.dpiaRecordedOn}::date,
                ${next.noticeId}::uuid, ${actor.actorTenantUserId})
        ON CONFLICT (tenant_id) DO UPDATE
        SET enabled = EXCLUDED.enabled,
            accuracy_ceiling_m = EXCLUDED.accuracy_ceiling_m,
            dpia_reference = EXCLUDED.dpia_reference,
            dpia_recorded_on = EXCLUDED.dpia_recorded_on,
            notice_id = EXCLUDED.notice_id,
            updated_at = now(), updated_by = EXCLUDED.updated_by
      `
    );
  } catch (error) {
    // The last live geofence was removed between the check and the write.
    if (
      error instanceof Error &&
      error.message.includes("HR_GEO_NO_GEOFENCE")
    ) {
      return { outcome: "refused", reason: "geofence_required" };
    }

    throw error;
  }

  const settings = await readGeolocationSettings(tx, tenantId);
  const flipped = settings.enabled !== before.enabled;

  await recordAuditEvent(tx, {
    tenantId,
    actorTenantUserId: actor.actorTenantUserId ?? undefined,
    moduleKey: HR_WORKFORCE_MODULE_KEY,
    action: flipped
      ? settings.enabled
        ? "hr_workforce.geolocation_evidence.enabled"
        : "hr_workforce.geolocation_evidence.disabled"
      : "hr_workforce.geolocation_evidence.configured",
    resourceType: "hr_geolocation_settings",
    resourceId: tenantId,
    severity: flipped ? "critical" : "warning",
    message: flipped
      ? settings.enabled
        ? "Geolocation attendance evidence was switched on."
        : "Geolocation attendance evidence was switched off."
      : "Geolocation attendance evidence settings changed.",
    attributes: {
      before: {
        enabled: before.enabled,
        accuracyCeilingMeters: before.accuracyCeilingMeters,
        noticeVersion: before.noticeVersion,
        dpiaRecorded: before.dpiaReference !== null
      },
      after: {
        enabled: settings.enabled,
        accuracyCeilingMeters: settings.accuracyCeilingMeters,
        noticeVersion: settings.noticeVersion,
        dpiaRecorded: settings.dpiaReference !== null
      }
    },
    correlationId: actor.correlationId
  });

  return { outcome: "ok", settings };
}

async function countLiveGeofences(
  tx: Bun.SQL,
  tenantId: string
): Promise<number> {
  const rows = (await tx`
    SELECT count(*)::int AS n FROM awcms_hr_geofences
    WHERE tenant_id = ${tenantId} AND deleted_at IS NULL
  `) as { n: number }[];

  return rows[0]!.n;
}

// --- Geofences -----------------------------------------------------------------------

export type GeofenceRecord = Geofence & {
  /** Bumped by every replace; the audit row carries it with a geometry hash. */
  revision: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};

type GeofenceRow = {
  id: string;
  office_id: string;
  label: string;
  shape: "circle" | "polygon";
  center_latitude: number | null;
  center_longitude: number | null;
  radius_m: number | null;
  vertices: [number, number][] | null;
  revision: number;
  created_at: Date | string;
  updated_at: Date | string;
  deleted_at: Date | string | null;
};

const GEOFENCE_SELECT = `
  id, office_id, label, shape, center_latitude, center_longitude, radius_m,
  vertices, revision, created_at, updated_at, deleted_at`;

function mapGeofence(row: GeofenceRow): GeofenceRecord {
  return {
    id: row.id,
    officeId: row.office_id,
    label: row.label,
    shape: row.shape,
    latitude: row.center_latitude,
    longitude: row.center_longitude,
    radiusMeters: row.radius_m,
    vertices: row.vertices,
    revision: row.revision,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    deletedAt: row.deleted_at === null ? null : iso(row.deleted_at)
  };
}

export async function listGeofences(
  tx: Bun.SQL,
  tenantId: string,
  filters: { officeId?: string; includeDeleted: boolean }
): Promise<GeofenceRecord[]> {
  const officeId = filters.officeId ?? null;
  const rows = (await tx`
    SELECT ${tx.unsafe(GEOFENCE_SELECT)} FROM awcms_hr_geofences
    WHERE tenant_id = ${tenantId}
      AND (${officeId}::uuid IS NULL OR office_id = ${officeId}::uuid)
      AND (${filters.includeDeleted} OR deleted_at IS NULL)
    ORDER BY created_at DESC, id DESC
    LIMIT 200
  `) as GeofenceRow[];

  return rows.map(mapGeofence);
}

async function getGeofence(
  tx: Bun.SQL,
  tenantId: string,
  id: string
): Promise<GeofenceRecord | null> {
  const rows = (await tx`
    SELECT ${tx.unsafe(GEOFENCE_SELECT)} FROM awcms_hr_geofences
    WHERE tenant_id = ${tenantId} AND id = ${id}
  `) as GeofenceRow[];

  return rows[0] ? mapGeofence(rows[0]) : null;
}

async function officeIsLive(
  tx: Bun.SQL,
  tenantId: string,
  officeId: string
): Promise<boolean> {
  const rows = (await tx`
    SELECT 1 AS present FROM awcms_offices
    WHERE tenant_id = ${tenantId} AND id = ${officeId} AND deleted_at IS NULL
  `) as { present: number }[];

  return rows.length > 0;
}

export type GeofenceOutcome =
  | { outcome: "ok"; geofence: GeofenceRecord }
  | { outcome: "not_found" }
  | { outcome: "office_not_found" }
  | { outcome: "already_in_state" }
  /** The office already has the maximum number of live geofences. */
  | { outcome: "office_limit" }
  /** The tenant's switch is ON and this is its last live geofence. */
  | { outcome: "last_live_fence" };

/**
 * A short, stable fingerprint of a geofence's geometry for the audit trail, so
 * a change of the site can be seen without writing its coordinates into a row
 * more people read. Canonical JSON of the shape only (never the label).
 */
export function geometryHash(fence: {
  shape: string;
  latitude: number | null;
  longitude: number | null;
  radiusMeters: number | null;
  vertices: [number, number][] | null;
}): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        fence.shape,
        fence.latitude,
        fence.longitude,
        fence.radiusMeters,
        fence.vertices
      ])
    )
    .digest("hex")
    .slice(0, 16);
}

async function officeIsFull(
  tx: Bun.SQL,
  tenantId: string,
  officeId: string,
  exceptId: string | null
): Promise<boolean> {
  // One writer at a time per office, so two concurrent creates cannot both pass.
  await tx`SELECT pg_advisory_xact_lock(hashtext(${`hr_geofence_office:${officeId}`}))`;

  const rows = (await tx`
    SELECT count(*)::int AS n FROM awcms_hr_geofences
    WHERE tenant_id = ${tenantId} AND office_id = ${officeId}
      AND deleted_at IS NULL AND (${exceptId}::uuid IS NULL OR id <> ${exceptId}::uuid)
  `) as { n: number }[];

  return rows[0]!.n >= GEO_LIMITS.maxFencesPerOffice;
}

/** A database guard that fired between the check and the write (a race) is the same refusal. */
function geofenceRefusal(error: unknown): GeofenceOutcome | null {
  const text = error instanceof Error ? error.message : "";

  if (text.includes("HR_GEO_OFFICE_CAP")) return { outcome: "office_limit" };
  if (text.includes("HR_GEO_LAST_FENCE")) return { outcome: "last_live_fence" };

  return null;
}

async function auditGeofence(
  tx: Bun.SQL,
  tenantId: string,
  actor: Actor,
  action: string,
  geofence: GeofenceRecord,
  message: string
): Promise<void> {
  // Ids, the revision and a geometry fingerprint: no coordinate of the site is
  // needed to explain who changed what, and a changed site shows as a new hash.
  await recordAuditEvent(tx, {
    tenantId,
    actorTenantUserId: actor.actorTenantUserId ?? undefined,
    moduleKey: HR_WORKFORCE_MODULE_KEY,
    action,
    resourceType: "hr_geofence",
    resourceId: geofence.id,
    severity: "warning",
    message,
    attributes: {
      officeId: geofence.officeId,
      shape: geofence.shape,
      revision: geofence.revision,
      geometryHash: geometryHash(geofence)
    },
    correlationId: actor.correlationId
  });
}

export async function createGeofence(
  tx: Bun.SQL,
  tenantId: string,
  actor: Actor,
  input: GeofenceInput
): Promise<GeofenceOutcome> {
  if (!(await officeIsLive(tx, tenantId, input.officeId))) {
    return { outcome: "office_not_found" };
  }

  if (await officeIsFull(tx, tenantId, input.officeId, null)) {
    return { outcome: "office_limit" };
  }

  const rows = (await tx`
    INSERT INTO awcms_hr_geofences
      (tenant_id, office_id, label, shape, center_latitude, center_longitude,
       radius_m, vertices, created_by, updated_by)
    VALUES (${tenantId}, ${input.officeId}, ${input.label}, ${input.shape},
            ${input.latitude}, ${input.longitude}, ${input.radiusMeters},
            ${input.vertices}::jsonb, ${actor.actorTenantUserId},
            ${actor.actorTenantUserId})
    RETURNING id
  `) as { id: string }[];
  const geofence = (await getGeofence(tx, tenantId, rows[0]!.id))!;

  await auditGeofence(
    tx,
    tenantId,
    actor,
    "hr_workforce.geofence.created",
    geofence,
    "A geofence was created."
  );

  return { outcome: "ok", geofence };
}

export async function replaceGeofence(
  tx: Bun.SQL,
  tenantId: string,
  actor: Actor,
  id: string,
  input: GeofenceInput
): Promise<GeofenceOutcome> {
  const existing = await getGeofence(tx, tenantId, id);

  if (!existing || existing.deletedAt) {
    return { outcome: "not_found" };
  }

  if (!(await officeIsLive(tx, tenantId, input.officeId))) {
    return { outcome: "office_not_found" };
  }

  if (
    input.officeId !== existing.officeId &&
    (await officeIsFull(tx, tenantId, input.officeId, id))
  ) {
    return { outcome: "office_limit" };
  }

  await tx`
    UPDATE awcms_hr_geofences
    SET office_id = ${input.officeId}, label = ${input.label},
        shape = ${input.shape}, center_latitude = ${input.latitude},
        center_longitude = ${input.longitude}, radius_m = ${input.radiusMeters},
        vertices = ${input.vertices}::jsonb, revision = revision + 1,
        updated_at = now(), updated_by = ${actor.actorTenantUserId}
    WHERE tenant_id = ${tenantId} AND id = ${id}
  `;
  const geofence = (await getGeofence(tx, tenantId, id))!;

  await auditGeofence(
    tx,
    tenantId,
    actor,
    "hr_workforce.geofence.updated",
    geofence,
    "A geofence was changed."
  );

  return { outcome: "ok", geofence };
}

export async function setGeofenceDeleted(
  tx: Bun.TransactionSQL,
  tenantId: string,
  actor: Actor,
  id: string,
  deleted: boolean
): Promise<GeofenceOutcome> {
  const existing = await getGeofence(tx, tenantId, id);

  if (!existing) {
    return { outcome: "not_found" };
  }

  if ((existing.deletedAt !== null) === deleted) {
    return { outcome: "already_in_state" };
  }

  if (!deleted && !(await officeIsLive(tx, tenantId, existing.officeId))) {
    return { outcome: "office_not_found" };
  }

  if (!deleted && (await officeIsFull(tx, tenantId, existing.officeId, id))) {
    return { outcome: "office_limit" };
  }

  if (deleted) {
    // The settings row is read FOR SHARE, so a concurrent switch serialises
    // with this delete: an enabled tenant keeps at least one live geofence.
    const switched = (await tx`
      SELECT enabled FROM awcms_hr_geolocation_settings
      WHERE tenant_id = ${tenantId}
      FOR SHARE
    `) as { enabled: boolean }[];

    if (switched[0]?.enabled && (await countLiveGeofences(tx, tenantId)) <= 1) {
      return { outcome: "last_live_fence" };
    }
  }

  try {
    await tx.savepoint(
      (sp) => sp`
        UPDATE awcms_hr_geofences
        SET deleted_at = ${deleted ? new Date().toISOString() : null}::timestamptz,
            deleted_by = ${deleted ? actor.actorTenantUserId : null}::uuid,
            updated_at = now(), updated_by = ${actor.actorTenantUserId}
        WHERE tenant_id = ${tenantId} AND id = ${id}
      `
    );
  } catch (error) {
    const refusal = geofenceRefusal(error);

    if (refusal) return refusal;

    throw error;
  }
  const geofence = (await getGeofence(tx, tenantId, id))!;

  await auditGeofence(
    tx,
    tenantId,
    actor,
    deleted
      ? "hr_workforce.geofence.deleted"
      : "hr_workforce.geofence.restored",
    geofence,
    deleted ? "A geofence was deleted." : "A geofence was restored."
  );

  return { outcome: "ok", geofence };
}

// --- Notices ---------------------------------------------------------------------------

export type GeolocationNotice = {
  id: string;
  version: number;
  texts: Record<string, string>;
  createdAt: string;
};

type NoticeRow = {
  id: string;
  version: number;
  texts: Record<string, string>;
  created_at: Date | string;
};

function mapNotice(row: NoticeRow): GeolocationNotice {
  return {
    id: row.id,
    version: row.version,
    texts: row.texts,
    createdAt: iso(row.created_at)
  };
}

export async function listNotices(
  tx: Bun.SQL,
  tenantId: string
): Promise<GeolocationNotice[]> {
  const rows = (await tx`
    SELECT id, version, texts, created_at FROM awcms_hr_geolocation_notices
    WHERE tenant_id = ${tenantId}
    ORDER BY version DESC
    LIMIT 100
  `) as NoticeRow[];

  return rows.map(mapNotice);
}

async function getNotice(
  tx: Bun.SQL,
  tenantId: string,
  id: string
): Promise<GeolocationNotice | null> {
  const rows = (await tx`
    SELECT id, version, texts, created_at FROM awcms_hr_geolocation_notices
    WHERE tenant_id = ${tenantId} AND id = ${id}
  `) as NoticeRow[];

  return rows[0] ? mapNotice(rows[0]) : null;
}

/**
 * Publish a NEW notice version (versions are append-only). Publishing does not
 * make it current: pointing the settings at it is a separate, audited step, which
 * is what re-requests every employee's acknowledgement.
 */
export async function publishNotice(
  tx: Bun.SQL,
  tenantId: string,
  actor: Actor,
  input: NoticeInput
): Promise<GeolocationNotice> {
  // One publisher at a time per tenant, so two concurrent publishes get
  // consecutive versions instead of one unique-violation 500.
  await tx`SELECT pg_advisory_xact_lock(hashtext(${`hr_geo_notice:${tenantId}`}))`;

  const rows = (await tx`
    INSERT INTO awcms_hr_geolocation_notices
      (tenant_id, version, texts, created_by)
    SELECT ${tenantId}, COALESCE(max(version), 0) + 1, ${input.texts}::jsonb,
           ${actor.actorTenantUserId}
    FROM awcms_hr_geolocation_notices WHERE tenant_id = ${tenantId}
    RETURNING id
  `) as { id: string }[];
  const notice = (await getNotice(tx, tenantId, rows[0]!.id))!;

  await recordAuditEvent(tx, {
    tenantId,
    actorTenantUserId: actor.actorTenantUserId ?? undefined,
    moduleKey: HR_WORKFORCE_MODULE_KEY,
    action: "hr_workforce.geolocation_notice.published",
    resourceType: "hr_geolocation_notice",
    resourceId: notice.id,
    severity: "warning",
    message: "A geolocation evidence notice version was published.",
    attributes: { version: notice.version },
    correlationId: actor.correlationId
  });

  return notice;
}

// --- Acknowledgement -------------------------------------------------------------------

export type NoticeStatus = {
  enabled: boolean;
  accuracyCeilingMeters: number;
  notice: GeolocationNotice | null;
  acknowledged: boolean;
};

async function hasAcknowledged(
  tx: Bun.SQL,
  tenantId: string,
  employmentId: string,
  noticeId: string
): Promise<boolean> {
  const rows = (await tx`
    SELECT 1 AS present FROM awcms_hr_geolocation_notice_acknowledgements
    WHERE tenant_id = ${tenantId} AND employment_id = ${employmentId}
      AND notice_id = ${noticeId}
  `) as { present: number }[];

  return rows.length > 0;
}

/** What the employee's client needs before it may offer a position: the switch, the notice and whether they acknowledged it. */
export async function readNoticeStatus(
  tx: Bun.SQL,
  tenantId: string,
  employmentId: string
): Promise<NoticeStatus> {
  const settings = await readGeolocationSettings(tx, tenantId);
  const notice =
    settings.enabled && settings.noticeId
      ? await getNotice(tx, tenantId, settings.noticeId)
      : null;

  return {
    enabled: settings.enabled,
    accuracyCeilingMeters: settings.accuracyCeilingMeters,
    notice,
    acknowledged: notice
      ? await hasAcknowledged(tx, tenantId, employmentId, notice.id)
      : false
  };
}

export type AcknowledgeOutcome =
  { outcome: "ok"; replayed: boolean } | { outcome: "not_current" };

/**
 * Record that the employee has seen the CURRENT notice version. A second
 * acknowledgement of the same version is a quiet no-op (`replayed`). Evidence of
 * notice, not a claim that consent is the lawful basis (ADR-0138 section 4).
 */
export async function acknowledgeNotice(
  tx: Bun.SQL,
  tenantId: string,
  actor: Actor,
  employmentId: string,
  noticeId: string
): Promise<AcknowledgeOutcome> {
  const settings = await readGeolocationSettings(tx, tenantId);

  if (!settings.enabled || settings.noticeId !== noticeId) {
    return { outcome: "not_current" };
  }

  const rows = (await tx`
    INSERT INTO awcms_hr_geolocation_notice_acknowledgements
      (tenant_id, employment_id, notice_id, acknowledged_by)
    VALUES (${tenantId}, ${employmentId}, ${noticeId}, ${actor.actorTenantUserId})
    ON CONFLICT (tenant_id, employment_id, notice_id) DO NOTHING
    RETURNING id
  `) as { id: string }[];

  return { outcome: "ok", replayed: rows.length === 0 };
}

// --- Capture ----------------------------------------------------------------------------

export type CapturedEvidence = {
  verdict: GeoVerdict;
  distanceBand: GeoDistanceBand | null;
  accuracyBand: GeoAccuracyBand | null;
};

async function geofencesForOffice(
  tx: Bun.SQL,
  tenantId: string,
  officeId: string
): Promise<Geofence[]> {
  const rows = (await tx`
    SELECT ${tx.unsafe(GEOFENCE_SELECT)} FROM awcms_hr_geofences
    WHERE tenant_id = ${tenantId} AND office_id = ${officeId}
      AND deleted_at IS NULL
  `) as GeofenceRow[];

  return rows.map(mapGeofence);
}

async function currentOffice(
  tx: Bun.SQL,
  tenantId: string,
  employmentId: string
): Promise<string | null> {
  const rows = (await tx`
    SELECT office_id FROM awcms_hr_employment_terms
    WHERE tenant_id = ${tenantId} AND employment_id = ${employmentId}
      AND effective_to IS NULL
  `) as { office_id: string | null }[];

  return rows[0]?.office_id ?? null;
}

/**
 * Evaluate `sample` for a just-recorded event and persist ONLY the verdict.
 * Returns `null` when nothing was recorded: the switch is off, or the event is
 * not an eligible one (a recorded event never fails because of this).
 *
 * The sample is dropped when the employee has not acknowledged the current
 * notice (ADR-0138 section 4: before the first sample is accepted); the verdict
 * is then `not_provided`, exactly like a declined fix. `sample === null` is the
 * declined / no-fix path.
 */
export async function captureLocationEvidence(
  tx: Bun.TransactionSQL,
  tenantId: string,
  event: {
    id: string;
    employmentId: string;
    kind: string;
    source: string;
    officeId: string | null;
  },
  sample: PositionSample | null
): Promise<CapturedEvidence | null> {
  if (!isGeoEligibleEvent(event.kind, event.source)) {
    return null;
  }

  const settings = await readGeolocationSettings(tx, tenantId);

  if (!settings.enabled || !settings.noticeId) {
    return null;
  }

  const accepted =
    sample !== null &&
    (await hasAcknowledged(tx, tenantId, event.employmentId, settings.noticeId))
      ? sample
      : null;

  let geofences: Geofence[] = [];

  if (accepted) {
    const officeId =
      event.officeId ?? (await currentOffice(tx, tenantId, event.employmentId));

    geofences = officeId
      ? await geofencesForOffice(tx, tenantId, officeId)
      : [];
  }

  // The coordinates end here: the evaluator returns bands only.
  const result = evaluatePositionSample(
    accepted,
    geofences,
    settings.accuracyCeilingMeters
  );

  try {
    await tx.savepoint(
      (sp) => sp`
        INSERT INTO awcms_hr_attendance_location_evidence
          (tenant_id, event_id, employment_id, verdict, distance_band,
           accuracy_band, geofence_id, rule_version)
        VALUES (${tenantId}, ${event.id}, ${event.employmentId}, ${result.verdict},
                ${result.distanceBand}, ${result.accuracyBand},
                ${result.geofenceId}, ${GEO_RULE_VERSION})
      `
    );
  } catch (error) {
    // The switch was turned off between the read and the insert: the database
    // guard is the arbiter, and capture simply did not happen.
    if (error instanceof Error && error.message.includes("HR_GEO_DISABLED")) {
      return null;
    }

    throw error;
  }

  return {
    verdict: result.verdict,
    distanceBand: result.distanceBand,
    accuracyBand: result.accuracyBand
  };
}

/** The verdict already recorded for an event (a replayed clock request), or `null`. */
export async function readEvidenceVerdict(
  tx: Bun.SQL,
  tenantId: string,
  eventId: string
): Promise<CapturedEvidence | null> {
  const rows = (await tx`
    SELECT verdict, distance_band, accuracy_band
    FROM awcms_hr_attendance_location_evidence
    WHERE tenant_id = ${tenantId} AND event_id = ${eventId}
  `) as {
    verdict: GeoVerdict;
    distance_band: GeoDistanceBand | null;
    accuracy_band: GeoAccuracyBand | null;
  }[];

  return rows[0]
    ? {
        verdict: rows[0].verdict,
        distanceBand: rows[0].distance_band,
        accuracyBand: rows[0].accuracy_band
      }
    : null;
}

// --- Reads -----------------------------------------------------------------------------

export type LocationEvidence = {
  id: string;
  eventId: string;
  employmentId: string;
  verdict: GeoVerdict;
  distanceBand: GeoDistanceBand | null;
  accuracyBand: GeoAccuracyBand | null;
  geofenceId: string | null;
  ruleVersion: number;
  evaluatedAt: string;
};

type EvidenceRow = {
  id: string;
  event_id: string;
  employment_id: string;
  verdict: GeoVerdict;
  distance_band: GeoDistanceBand | null;
  accuracy_band: GeoAccuracyBand | null;
  geofence_id: string | null;
  rule_version: number;
  evaluated_at: Date | string;
  evaluated_at_cursor: string;
};

function mapEvidence(row: EvidenceRow): LocationEvidence {
  return {
    id: row.id,
    eventId: row.event_id,
    employmentId: row.employment_id,
    verdict: row.verdict,
    distanceBand: row.distance_band,
    accuracyBand: row.accuracy_band,
    geofenceId: row.geofence_id,
    ruleVersion: row.rule_version,
    evaluatedAt: iso(row.evaluated_at)
  };
}

export type EvidenceFilters = {
  employmentId?: string;
  eventId?: string;
  from?: Date;
  to?: Date;
};

/** Newest first, keyset on `(evaluated_at, id)`. `scope` null = every employment (the permission); otherwise the employment ids of an ownership grant. */
export async function listEvidence(
  tx: Bun.SQL,
  tenantId: string,
  scope: string[] | null,
  filters: EvidenceFilters,
  cursor?: KeysetCursor
): Promise<{ evidence: LocationEvidence[]; nextCursor: string | null }> {
  if (scope !== null && scope.length === 0) {
    return { evidence: [], nextCursor: null };
  }

  const employmentId = filters.employmentId ?? null;
  const eventId = filters.eventId ?? null;
  const from = filters.from ? filters.from.toISOString() : null;
  const to = filters.to ? filters.to.toISOString() : null;
  const cursorAt = cursor ? cursor.createdAt : null;
  const cursorId = cursor ? cursor.id : null;

  const rows = (await tx`
    SELECT e.id, e.event_id, e.employment_id, e.verdict, e.distance_band,
           e.accuracy_band, e.geofence_id, e.rule_version, e.evaluated_at,
           ${tx.unsafe(utcMicrosecondTextSql("e.evaluated_at"))} AS evaluated_at_cursor
    FROM awcms_hr_attendance_location_evidence e
    WHERE e.tenant_id = ${tenantId}
      AND (${scope}::jsonb IS NULL
           OR e.employment_id IN (
                SELECT jsonb_array_elements_text(${scope}::jsonb)::uuid))
      AND (${employmentId}::uuid IS NULL OR e.employment_id = ${employmentId}::uuid)
      AND (${eventId}::uuid IS NULL OR e.event_id = ${eventId}::uuid)
      AND (${from}::timestamptz IS NULL OR e.evaluated_at >= ${from}::timestamptz)
      AND (${to}::timestamptz IS NULL OR e.evaluated_at < ${to}::timestamptz)
      AND (
        ${cursorAt}::timestamptz IS NULL
        OR (e.evaluated_at, e.id) < (${cursorAt}::timestamptz, ${cursorId}::uuid)
      )
    ORDER BY e.evaluated_at DESC, e.id DESC
    LIMIT ${EVIDENCE_PAGE_SIZE}
  `) as EvidenceRow[];
  const last = rows[rows.length - 1];

  return {
    evidence: rows.map(mapEvidence),
    nextCursor:
      rows.length === EVIDENCE_PAGE_SIZE && last
        ? encodeKeysetCursor(last.evaluated_at_cursor, last.id)
        : null
  };
}

/** A read of OTHER people's evidence leaves a trace (ADR-0138 section 6): ids and counts only, never a verdict. */
export async function auditEvidenceRead(
  tx: Bun.SQL,
  tenantId: string,
  actor: Actor,
  basis: ReadBasis,
  details: {
    employmentId?: string;
    returned: number;
    /** The employments whose verdicts this page carried (Issue #1083 L-2). */
    employmentIds?: readonly string[];
  }
): Promise<void> {
  if (basis.mode !== "all") {
    return;
  }

  await recordAuditEvent(tx, {
    tenantId,
    actorTenantUserId: actor.actorTenantUserId ?? undefined,
    moduleKey: HR_WORKFORCE_MODULE_KEY,
    action: "hr_workforce.location_evidence.read",
    resourceType: "hr_attendance_location_evidence",
    resourceId: details.employmentId ?? tenantId,
    severity: "info",
    message: "Location-evidence verdicts of other employments were read.",
    attributes: {
      employmentId: details.employmentId ?? null,
      returned: details.returned,
      employmentIds: [...new Set(details.employmentIds ?? [])]
    },
    correlationId: actor.correlationId
  });
}

/**
 * Immediate erasure of ONE employment's verdicts (ADR-0138 section 7), for the day
 * counsel decides an erasure request must not wait for the retention bound.
 *
 * NOT reachable from any route and NOT called by the subject-request executor
 * (ADR-0142 allows only `retain_under_obligation` for an indirect subject path):
 * an operator runs it on a `awcms_worker` connection inside the tenant's
 * transaction. The SQL function is owned by a role holding DELETE on this table
 * and a two-column SELECT, and returns the count, which is audited at `critical`
 * (the employment id and the count, never a verdict).
 */
export async function eraseLocationEvidenceForEmployment(
  tx: Bun.SQL,
  tenantId: string,
  actor: Actor,
  employmentId: string
): Promise<number> {
  const rows = (await tx`
    SELECT awcms_hr_erase_location_evidence(${tenantId}, ${employmentId}) AS n
  `) as { n: number }[];
  const erased = rows[0]!.n;

  await recordAuditEvent(tx, {
    tenantId,
    actorTenantUserId: actor.actorTenantUserId ?? undefined,
    moduleKey: HR_WORKFORCE_MODULE_KEY,
    action: "hr_workforce.location_evidence.erased",
    resourceType: "hr_attendance_location_evidence",
    resourceId: employmentId,
    severity: "critical",
    message:
      "Location-evidence verdicts of an employment were erased on request.",
    attributes: { employmentId, erased },
    correlationId: actor.correlationId
  });

  return erased;
}
