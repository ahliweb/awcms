/**
 * Reads and writes `awcms_tax_rule_versions` (ADR-0127, `sql/171`).
 *
 * ## What lives here and what lives in the database
 *
 * The invariants that must hold against EVERY writer — a published row never
 * changes, published windows never overlap — are enforced by triggers in
 * `sql/171`. What is here is the choreography around them: assigning the next
 * version number, closing the predecessor's window, and refusing a publish that
 * would put versions out of order. All of it runs under the same
 * transaction-scoped advisory lock the overlap trigger takes, so two concurrent
 * publishes for one profile serialise instead of racing — and the lock is
 * re-entrant, so taking it here and again in the trigger costs nothing.
 *
 * ## Versions are appended in time order
 *
 * A new version must take effect strictly AFTER the latest published one, and
 * ends that one's window at its own start. There is no way to publish into the
 * past: back-dating a rule would re-tax days that already have documents on them.
 * A correction to history is a reversal of the affected documents, not a rule
 * edit.
 */
import {
  encodeKeysetCursor,
  keysetCursorCreatedAtSql,
  type KeysetCursor
} from "../../_shared/keyset-pagination";
import type { RoundingMode } from "../domain/decimal";
import {
  TaxCalculationError,
  type PricingMode,
  type ResolvedTaxRuleVersion,
  type RoundingLevel,
  type TaxRuleDefinition
} from "../domain/tax-types";
import {
  newCollector,
  validateTaxDefinition,
  type RuleVersionInput
} from "../domain/tax-validation";
import { selectEffectiveVersion } from "../domain/tax-version-resolution";

export const TAX_LIST_LIMIT = 100;

/**
 * What a LIST returns: everything except the `definition` (up to 256 KiB per
 * row). A page of 100 full definitions is a response amplification a caller who
 * can merely list should not trigger; the body comes from the detail endpoint.
 */
export type RuleVersionSummary = {
  id: string;
  profileCode: string;
  versionNo: number;
  status: "draft" | "published";
  name: string;
  jurisdictionCode: string;
  countryCode: string | null;
  regionCode: string | null;
  currencyCode: string;
  pricingMode: PricingMode;
  roundingMode: RoundingMode;
  roundingScale: number;
  roundingLevel: RoundingLevel;
  effectiveFrom: string;
  effectiveTo: string | null;
  notes: string | null;
  createdAt: string;
  createdBy: string | null;
  publishedAt: string | null;
  publishedBy: string | null;
};

export type RuleVersionView = RuleVersionSummary & {
  definition: TaxRuleDefinition;
};

type RuleVersionRow = {
  id: string;
  profile_code: string;
  version_no: number;
  status: "draft" | "published";
  name: string;
  jurisdiction_code: string;
  country_code: string | null;
  region_code: string | null;
  currency_code: string;
  pricing_mode: PricingMode;
  rounding_mode: RoundingMode;
  rounding_scale: number;
  rounding_level: RoundingLevel;
  effective_from: string;
  effective_to: string | null;
  notes: string | null;
  definition?: TaxRuleDefinition;
  created_at: Date;
  created_by: string | null;
  published_at: Date | null;
  published_by: string | null;
};

/** `date` columns are read as text: a JS `Date` would put a time zone into a calendar date. */
const SUMMARY_COLUMNS = `id, profile_code, version_no, status, name, jurisdiction_code,
  country_code, region_code, currency_code, pricing_mode, rounding_mode,
  rounding_scale, rounding_level,
  to_char(effective_from, 'YYYY-MM-DD') AS effective_from,
  to_char(effective_to, 'YYYY-MM-DD') AS effective_to,
  notes, created_at, created_by, published_at, published_by`;
const COLUMNS = `${SUMMARY_COLUMNS}, definition`;

function toView(row: RuleVersionRow): RuleVersionView {
  return { ...toSummary(row), definition: row.definition! };
}

function toSummary(row: RuleVersionRow): RuleVersionSummary {
  return {
    id: row.id,
    profileCode: row.profile_code,
    versionNo: Number(row.version_no),
    status: row.status,
    name: row.name,
    jurisdictionCode: row.jurisdiction_code,
    countryCode: row.country_code,
    regionCode: row.region_code,
    currencyCode: row.currency_code,
    pricingMode: row.pricing_mode,
    roundingMode: row.rounding_mode,
    roundingScale: Number(row.rounding_scale),
    roundingLevel: row.rounding_level,
    effectiveFrom: row.effective_from,
    effectiveTo: row.effective_to,
    notes: row.notes,
    createdAt: row.created_at.toISOString(),
    createdBy: row.created_by,
    publishedAt: row.published_at ? row.published_at.toISOString() : null,
    publishedBy: row.published_by
  };
}

/**
 * The key the overlap trigger in `sql/171` takes: `tenant_id::text || ':' ||
 * profile_code`, where `tenant_id::text` is the CANONICAL lower-case uuid.
 *
 * `tenantId` arrives from a request header and may be upper-case, so it is cast
 * through `::uuid` first: the key is then byte-identical to the trigger's whatever
 * the header said. Otherwise the application's lock and the trigger's would be two
 * different locks and the serialisation this exists for would silently not happen.
 * This is the only key in the module built from a caller-supplied string.
 */
const PROFILE_LOCK_KEY_SQL = `hashtextextended($1::uuid::text || ':' || $2::text, 0)`;

/** Exclusive: authoring and publishing serialise per profile. */
export async function lockProfile(
  tx: Bun.SQL,
  tenantId: string,
  profileCode: string
): Promise<void> {
  await tx.unsafe(`SELECT pg_advisory_xact_lock(${PROFILE_LOCK_KEY_SQL})`, [
    tenantId,
    profileCode
  ]);
}

/**
 * Shared: finalising a document takes this BEFORE resolving its rule version, so
 * a publish (exclusive, above) waits for in-flight finalises to commit and then
 * sees their tax dates, and a finalise that starts during a publish waits for it.
 * That closes the window in which a document could be computed under the old
 * version for a date the new version is about to claim.
 */
export async function lockProfileShared(
  tx: Bun.SQL,
  tenantId: string,
  profileCode: string
): Promise<void> {
  await tx.unsafe(
    `SELECT pg_advisory_xact_lock_shared(${PROFILE_LOCK_KEY_SQL})`,
    [tenantId, profileCode]
  );
}

export async function createDraftVersion(
  tx: Bun.SQL,
  tenantId: string,
  actorId: string,
  input: RuleVersionInput
): Promise<RuleVersionView> {
  await lockProfile(tx, tenantId, input.profileCode);

  const rows = (await tx`
    INSERT INTO awcms_tax_rule_versions (
      tenant_id, profile_code, version_no, status, name, jurisdiction_code,
      country_code, region_code, currency_code, pricing_mode, rounding_mode,
      rounding_scale, rounding_level, effective_from, notes, definition,
      created_by
    )
    VALUES (
      ${tenantId}, ${input.profileCode},
      (SELECT COALESCE(MAX(version_no), 0) + 1
         FROM awcms_tax_rule_versions
        WHERE tenant_id = ${tenantId} AND profile_code = ${input.profileCode}),
      'draft', ${input.name}, ${input.jurisdictionCode}, ${input.countryCode},
      ${input.regionCode}, ${input.currencyCode}, ${input.pricingMode},
      ${input.roundingMode}, ${input.roundingScale}, ${input.roundingLevel},
      ${input.effectiveFrom}::date, ${input.notes}, ${input.definition}::jsonb,
      ${actorId}
    )
    RETURNING ${tx.unsafe(COLUMNS)}
  `) as RuleVersionRow[];

  return toView(rows[0]!);
}

export async function getRuleVersion(
  tx: Bun.SQL,
  tenantId: string,
  id: string
): Promise<RuleVersionView | null> {
  const rows = (await tx`
    SELECT ${tx.unsafe(COLUMNS)}
    FROM awcms_tax_rule_versions
    WHERE tenant_id = ${tenantId} AND id = ${id}
  `) as RuleVersionRow[];

  return rows[0] ? toView(rows[0]) : null;
}

export type RuleVersionListFilters = {
  profileCode?: string;
  status?: "draft" | "published";
};

export async function listRuleVersions(
  tx: Bun.SQL,
  tenantId: string,
  filters: RuleVersionListFilters,
  cursor?: KeysetCursor
): Promise<{ versions: RuleVersionSummary[]; nextCursor: string | null }> {
  const profileCode = filters.profileCode ?? null;
  const status = filters.status ?? null;
  const cursorCreatedAt = cursor ? cursor.createdAt : null;
  const cursorId = cursor ? cursor.id : null;

  const rows = (await tx`
    SELECT ${tx.unsafe(SUMMARY_COLUMNS)},
           ${tx.unsafe(keysetCursorCreatedAtSql())} AS created_at_cursor
    FROM awcms_tax_rule_versions
    WHERE tenant_id = ${tenantId}
      AND (${profileCode}::text IS NULL OR profile_code = ${profileCode})
      AND (${status}::text IS NULL OR status = ${status})
      AND (
        ${cursorCreatedAt}::timestamptz IS NULL
        OR (created_at, id) < (${cursorCreatedAt}::timestamptz, ${cursorId}::uuid)
      )
    ORDER BY created_at DESC, id DESC
    LIMIT ${TAX_LIST_LIMIT + 1}
  `) as (RuleVersionRow & { created_at_cursor: string })[];

  const page = rows.slice(0, TAX_LIST_LIMIT);
  const last = page[page.length - 1];

  return {
    versions: page.map(toSummary),
    nextCursor:
      rows.length > TAX_LIST_LIMIT && last
        ? encodeKeysetCursor(last.created_at_cursor, last.id)
        : null
  };
}

export type PublishOutcome =
  | {
      kind: "published";
      version: RuleVersionView;
      closedVersionId: string | null;
    }
  | { kind: "not_found" }
  | { kind: "already_published" }
  | { kind: "out_of_order"; latestEffectiveFrom: string }
  | {
      kind: "backdated";
      /** `before_today`: earlier than the server's date. `snapshots_exist`: on or before a tax date already finalised. */
      reason: "before_today" | "snapshots_exist";
      /** The server's date, or the latest finalised tax date — the earliest date that would NOT be refused is the day after. */
      boundary: string;
    };

export async function publishRuleVersion(
  tx: Bun.SQL,
  tenantId: string,
  actorId: string,
  id: string
): Promise<PublishOutcome> {
  const target = (await tx`
    SELECT profile_code, status,
           to_char(effective_from, 'YYYY-MM-DD') AS effective_from
    FROM awcms_tax_rule_versions
    WHERE tenant_id = ${tenantId} AND id = ${id}
    FOR UPDATE
  `) as { profile_code: string; status: string; effective_from: string }[];

  const draft = target[0];

  if (!draft) return { kind: "not_found" };
  if (draft.status === "published") return { kind: "already_published" };

  await lockProfile(tx, tenantId, draft.profile_code);

  const latestRows = (await tx`
    SELECT id, to_char(effective_from, 'YYYY-MM-DD') AS effective_from
    FROM awcms_tax_rule_versions
    WHERE tenant_id = ${tenantId}
      AND profile_code = ${draft.profile_code}
      AND status = 'published'
    ORDER BY awcms_tax_rule_versions.effective_from DESC
    LIMIT 1
  `) as { id: string; effective_from: string }[];

  const latest = latestRows[0];

  if (latest && latest.effective_from >= draft.effective_from) {
    return { kind: "out_of_order", latestEffectiveFrom: latest.effective_from };
  }

  // Never publish into the past (ADR-0127 §4). A version that takes effect on
  // or before a tax date already finalised under this profile would claim days
  // that already carry documents computed under the previous rule, and one that
  // takes effect before TODAY would re-tax days that are over. "Today" is the
  // database's `now()` in UTC, not JavaScript time. This runs under the profile
  // lock, and finalise holds the shared form of it, so no document can land
  // between this read and the commit.
  const clock = (await tx`
    SELECT to_char((now() AT TIME ZONE 'UTC')::date, 'YYYY-MM-DD') AS today,
           (SELECT to_char(MAX(tax_date), 'YYYY-MM-DD')
              FROM awcms_tax_snapshots
             WHERE tenant_id = ${tenantId}
               AND profile_code = ${draft.profile_code}) AS latest_tax_date
  `) as { today: string; latest_tax_date: string | null }[];
  const { today, latest_tax_date: latestTaxDate } = clock[0]!;

  if (draft.effective_from < today) {
    return { kind: "backdated", reason: "before_today", boundary: today };
  }

  if (latestTaxDate !== null && draft.effective_from <= latestTaxDate) {
    return {
      kind: "backdated",
      reason: "snapshots_exist",
      boundary: latestTaxDate
    };
  }

  if (latest) {
    // The ONE mutation a published row permits (see `sql/171`'s guard): end an
    // open window at the successor's own start.
    await tx`
      UPDATE awcms_tax_rule_versions
      SET effective_to = ${draft.effective_from}::date, updated_at = now()
      WHERE tenant_id = ${tenantId} AND id = ${latest.id}
        AND effective_to IS NULL
    `;
  }

  const rows = (await tx`
    UPDATE awcms_tax_rule_versions
    SET status = 'published', published_at = now(), published_by = ${actorId},
        updated_at = now()
    WHERE tenant_id = ${tenantId} AND id = ${id}
    RETURNING ${tx.unsafe(COLUMNS)}
  `) as RuleVersionRow[];

  return {
    kind: "published",
    version: toView(rows[0]!),
    closedVersionId: latest?.id ?? null
  };
}

/**
 * The published version in force for `profileCode` on `taxDate`, in the shape the
 * calculator takes. `null` when no published version covers the date — the
 * caller turns that into a 422, never a silent "no tax".
 */
export async function resolveRuleVersion(
  tx: Bun.SQL,
  tenantId: string,
  profileCode: string,
  taxDate: string
): Promise<ResolvedTaxRuleVersion | null> {
  const rows = (await tx`
    SELECT ${tx.unsafe(COLUMNS)}
    FROM awcms_tax_rule_versions
    WHERE tenant_id = ${tenantId}
      AND profile_code = ${profileCode}
      AND status = 'published'
      AND effective_from <= ${taxDate}::date
      AND (effective_to IS NULL OR ${taxDate}::date < effective_to)
  `) as RuleVersionRow[];

  const row = selectEffectiveVersion(
    rows.map((entry) => ({
      ...entry,
      effectiveFrom: entry.effective_from,
      effectiveTo: entry.effective_to
    })),
    taxDate
  );

  if (!row) return null;

  // Re-validated on the way out: the table's CHECK only guarantees "an object",
  // and a row written by something other than this module must fail loudly here
  // rather than compute a wrong tax.
  const collector = newCollector();
  const definition = validateTaxDefinition(row.definition, collector);

  if (!definition || collector.errors.length > 0) {
    throw new TaxCalculationError(
      "TAX_DEFINITION_INVALID",
      `Stored rule version ${row.id} does not pass validation: ${collector.errors[0]?.message ?? "unknown"}`
    );
  }

  return {
    ruleVersionId: row.id,
    profileCode: row.profile_code,
    versionNo: Number(row.version_no),
    jurisdictionCode: row.jurisdiction_code,
    currencyCode: row.currency_code,
    pricingMode: row.pricing_mode,
    roundingMode: row.rounding_mode,
    roundingScale: Number(row.rounding_scale),
    roundingLevel: row.rounding_level,
    definition
  };
}
