/**
 * Reads and writes `awcms_tax_snapshots` (ADR-0127, `sql/172`).
 *
 * ## Naturally idempotent, in addition to `Idempotency-Key`
 *
 * A document is finalised once: `(tenant, kind, document_type, document_id)` is
 * unique, and the row stores the hash of the request that produced it. Finalising
 * the same document with the SAME request replays the existing snapshot; with a
 * DIFFERENT request it is refused. That holds even for a caller that rotates its
 * `Idempotency-Key` on every retry — which an offline POS replaying a queue
 * routinely does — so the guarantee does not depend on the caller's key hygiene.
 *
 * ## Reversals are serialised per original
 *
 * `reverseSnapshot` takes a row lock on the original FIRST, so concurrent refunds
 * of one sale queue behind each other and each computes against what the previous
 * one committed. The trigger in `sql/172` repeats the arithmetic as a backstop.
 */
import {
  encodeKeysetCursor,
  keysetCursorCreatedAtSql,
  type KeysetCursor
} from "../../_shared/keyset-pagination";
import {
  TaxDecimalError,
  parseDecimal,
  ratFromInt,
  rationalToExactUnits,
  unitsToDecimalString,
  type Rational,
  type RoundingMode
} from "../domain/decimal";
import { QUANTITY_FRACTION_DIGITS } from "../domain/tax-calculator";
import {
  computeReversal,
  type ReversedSoFar,
  type ReversalRequestLine,
  type ReversalResult
} from "../domain/tax-reversal";
import {
  TaxCalculationError,
  type PricingMode,
  type ResolvedTaxRuleVersion,
  type RoundingLevel,
  type TaxCalculation,
  type TaxComponentTotal,
  type TaxLineResult,
  type TaxRuleDefinition,
  type TaxTreatmentTotal
} from "../domain/tax-types";
import { TAX_LIST_LIMIT } from "./tax-rule-version-directory";

export type SnapshotKind = "sale" | "reversal";

/**
 * What a LIST returns: the document's identity, version and totals, without its
 * `lines` (up to 500 per row, each with components). A page of 100 full snapshots
 * is a response amplification a caller who can merely list should not trigger;
 * the lines come from the detail endpoint.
 */
export type SnapshotSummary = Omit<SnapshotView, "lines">;

export type SnapshotView = {
  id: string;
  kind: SnapshotKind;
  documentType: string;
  documentId: string;
  originalSnapshotId: string | null;
  ruleVersionId: string;
  profileCode: string;
  versionNo: number;
  taxDate: string;
  currencyCode: string;
  pricingMode: PricingMode;
  roundingMode: RoundingMode;
  roundingScale: number;
  roundingLevel: RoundingLevel;
  lines: TaxLineResult[];
  netTotal: string;
  taxTotal: string;
  grossTotal: string;
  componentTotals: TaxComponentTotal[];
  treatmentTotals: TaxTreatmentTotal[];
  reason: string | null;
  createdAt: string;
  createdBy: string | null;
};

type SnapshotRow = {
  id: string;
  kind: SnapshotKind;
  document_type: string;
  document_id: string;
  original_snapshot_id: string | null;
  rule_version_id: string;
  profile_code: string;
  version_no: number;
  tax_date: string;
  currency_code: string;
  pricing_mode: PricingMode;
  rounding_mode: RoundingMode;
  rounding_scale: number;
  rounding_level: RoundingLevel;
  lines?: TaxLineResult[];
  net_total: string;
  tax_total: string;
  gross_total: string;
  component_totals: TaxComponentTotal[];
  treatment_totals: TaxTreatmentTotal[];
  input_hash: string;
  reason: string | null;
  created_at: Date;
  created_by: string | null;
};

/**
 * Neither view reads `rule_definition`: it is the snapshot's own evidence, large,
 * and only a reversal reads it (to copy it forward). It is never returned over the
 * API — rule definitions are `tax.rules.read`.
 */
const SUMMARY_COLUMNS = `id, kind, document_type, document_id, original_snapshot_id,
  rule_version_id, profile_code, version_no,
  to_char(tax_date, 'YYYY-MM-DD') AS tax_date,
  currency_code, pricing_mode, rounding_mode, rounding_scale, rounding_level,
  net_total, tax_total, gross_total, component_totals, treatment_totals,
  input_hash, reason, created_at, created_by`;
const COLUMNS = `${SUMMARY_COLUMNS}, lines`;

/**
 * `numeric(24,6)` comes back as `"59.970000"`. Re-render it at the snapshot's own
 * scale so the API says `"59.97"` — exact in both directions, because the stored
 * value was written from a string at that scale.
 */
function amountAtScale(value: string, scale: number): string {
  try {
    return unitsToDecimalString(
      rationalToExactUnits(
        parseDecimal(value, {
          maxFractionDigits: 6,
          allowNegative: true,
          maxIntegerDigits: 18
        }),
        scale
      ),
      scale
    );
  } catch (error) {
    if (error instanceof TaxDecimalError) return value;
    throw error;
  }
}

function toView(row: SnapshotRow): SnapshotView {
  return { ...toSummary(row), lines: row.lines! };
}

function toSummary(row: SnapshotRow): SnapshotSummary {
  const scale = Number(row.rounding_scale);

  return {
    id: row.id,
    kind: row.kind,
    documentType: row.document_type,
    documentId: row.document_id,
    originalSnapshotId: row.original_snapshot_id,
    ruleVersionId: row.rule_version_id,
    profileCode: row.profile_code,
    versionNo: Number(row.version_no),
    taxDate: row.tax_date,
    currencyCode: row.currency_code,
    pricingMode: row.pricing_mode,
    roundingMode: row.rounding_mode,
    roundingScale: scale,
    roundingLevel: row.rounding_level,
    netTotal: amountAtScale(row.net_total, scale),
    taxTotal: amountAtScale(row.tax_total, scale),
    grossTotal: amountAtScale(row.gross_total, scale),
    componentTotals: row.component_totals,
    treatmentTotals: row.treatment_totals,
    reason: row.reason,
    createdAt: row.created_at.toISOString(),
    createdBy: row.created_by
  };
}

export type FinaliseOutcome =
  | { kind: "created"; snapshot: SnapshotView }
  | { kind: "replayed"; snapshot: SnapshotView }
  | { kind: "conflict" };

export async function finaliseSnapshot(
  tx: Bun.SQL,
  tenantId: string,
  actorId: string,
  args: {
    documentType: string;
    documentId: string;
    taxDate: string;
    version: ResolvedTaxRuleVersion;
    calculation: TaxCalculation;
    inputHash: string;
  }
): Promise<FinaliseOutcome> {
  const { version, calculation } = args;

  const inserted = (await tx`
    INSERT INTO awcms_tax_snapshots (
      tenant_id, kind, document_type, document_id, rule_version_id,
      profile_code, version_no, tax_date, currency_code, pricing_mode,
      rounding_mode, rounding_scale, rounding_level, rule_definition, lines,
      component_totals, treatment_totals, net_total, tax_total, gross_total,
      input_hash, created_by
    )
    VALUES (
      ${tenantId}, 'sale', ${args.documentType}, ${args.documentId},
      ${version.ruleVersionId}, ${version.profileCode}, ${version.versionNo},
      ${args.taxDate}::date, ${calculation.currencyCode},
      ${calculation.pricingMode}, ${calculation.roundingMode},
      ${calculation.roundingScale}, ${calculation.roundingLevel},
      ${version.definition}::jsonb, ${calculation.lines}::jsonb,
      ${calculation.componentTotals}::jsonb,
      ${calculation.treatmentTotals}::jsonb,
      ${calculation.netTotal}::numeric, ${calculation.taxTotal}::numeric,
      ${calculation.grossTotal}::numeric, ${args.inputHash}, ${actorId}
    )
    ON CONFLICT (tenant_id, kind, document_type, document_id) DO NOTHING
    RETURNING ${tx.unsafe(COLUMNS)}
  `) as SnapshotRow[];

  if (inserted[0]) return { kind: "created", snapshot: toView(inserted[0]) };

  // Somebody finalised this document first (or an earlier attempt of ours did).
  const existing = (await tx`
    SELECT ${tx.unsafe(COLUMNS)}
    FROM awcms_tax_snapshots
    WHERE tenant_id = ${tenantId} AND kind = 'sale'
      AND document_type = ${args.documentType}
      AND document_id = ${args.documentId}
  `) as SnapshotRow[];

  const row = existing[0];

  if (row && row.input_hash === args.inputHash) {
    return { kind: "replayed", snapshot: toView(row) };
  }

  return { kind: "conflict" };
}

export async function getSnapshot(
  tx: Bun.SQL,
  tenantId: string,
  id: string
): Promise<SnapshotView | null> {
  const rows = (await tx`
    SELECT ${tx.unsafe(COLUMNS)}
    FROM awcms_tax_snapshots
    WHERE tenant_id = ${tenantId} AND id = ${id}
  `) as SnapshotRow[];

  return rows[0] ? toView(rows[0]) : null;
}

export type SnapshotListFilters = {
  documentType?: string;
  documentId?: string;
  kind?: SnapshotKind;
};

export async function listSnapshots(
  tx: Bun.SQL,
  tenantId: string,
  filters: SnapshotListFilters,
  cursor?: KeysetCursor
): Promise<{ snapshots: SnapshotSummary[]; nextCursor: string | null }> {
  const documentType = filters.documentType ?? null;
  const documentId = filters.documentId ?? null;
  const kind = filters.kind ?? null;
  const cursorCreatedAt = cursor ? cursor.createdAt : null;
  const cursorId = cursor ? cursor.id : null;

  const rows = (await tx`
    SELECT ${tx.unsafe(SUMMARY_COLUMNS)},
           ${tx.unsafe(keysetCursorCreatedAtSql())} AS created_at_cursor
    FROM awcms_tax_snapshots
    WHERE tenant_id = ${tenantId}
      AND (${documentType}::text IS NULL OR document_type = ${documentType})
      AND (${documentId}::text IS NULL OR document_id = ${documentId})
      AND (${kind}::text IS NULL OR kind = ${kind})
      AND (
        ${cursorCreatedAt}::timestamptz IS NULL
        OR (created_at, id) < (${cursorCreatedAt}::timestamptz, ${cursorId}::uuid)
      )
    ORDER BY created_at DESC, id DESC
    LIMIT ${TAX_LIST_LIMIT + 1}
  `) as (SnapshotRow & { created_at_cursor: string })[];

  const page = rows.slice(0, TAX_LIST_LIMIT);
  const last = page[page.length - 1];

  return {
    snapshots: page.map(toSummary),
    nextCursor:
      rows.length > TAX_LIST_LIMIT && last
        ? encodeKeysetCursor(last.created_at_cursor, last.id)
        : null
  };
}

export type ReverseOutcome =
  | { kind: "created"; snapshot: SnapshotView }
  | { kind: "replayed"; snapshot: SnapshotView }
  | { kind: "original_not_found" }
  | { kind: "conflict" }
  | { kind: "invalid"; message: string };

export async function reverseSnapshot(
  tx: Bun.SQL,
  tenantId: string,
  actorId: string,
  args: {
    originalId: string;
    documentId: string;
    requested: ReversalRequestLine[] | null;
    /** The reversal's own tax date (already window-checked by the route); the SERVER's date (`now()`, UTC) when absent. */
    taxDate: string | null;
    reason: string | null;
    inputHash: string;
  }
): Promise<ReverseOutcome> {
  // Lock FIRST: every concurrent reversal of this sale queues here.
  const originals = (await tx`
    SELECT ${tx.unsafe(COLUMNS)}, rule_definition
    FROM awcms_tax_snapshots
    WHERE tenant_id = ${tenantId} AND id = ${args.originalId} AND kind = 'sale'
    FOR UPDATE
  `) as (SnapshotRow & { rule_definition: TaxRuleDefinition })[];

  const original = originals[0];

  if (!original) return { kind: "original_not_found" };

  const replay = (await tx`
    SELECT ${tx.unsafe(COLUMNS)}
    FROM awcms_tax_snapshots
    WHERE tenant_id = ${tenantId} AND kind = 'reversal'
      AND document_type = ${original.document_type}
      AND document_id = ${args.documentId}
  `) as SnapshotRow[];

  if (replay[0]) {
    return replay[0].input_hash === args.inputHash &&
      replay[0].original_snapshot_id === original.id
      ? { kind: "replayed", snapshot: toView(replay[0]) }
      : { kind: "conflict" };
  }

  const priorRows = (await tx`
    SELECT lines
    FROM awcms_tax_snapshots
    WHERE tenant_id = ${tenantId} AND kind = 'reversal'
      AND original_snapshot_id = ${original.id}
  `) as { lines: TaxLineResult[] }[];

  const scale = Number(original.rounding_scale);
  const reversedSoFar = new Map<string, ReversedSoFar>();

  for (const prior of priorRows) {
    for (const line of prior.lines as (TaxLineResult & {
      originalLineRef?: string;
    })[]) {
      const key = line.originalLineRef ?? line.lineRef;
      const entry = reversedSoFar.get(key) ?? {
        quantity: ratFromInt(0n) as Rational,
        netUnits: 0n,
        componentUnits: new Map<string, bigint>()
      };
      const quantity = parseDecimal(line.quantity, {
        maxFractionDigits: QUANTITY_FRACTION_DIGITS
      });

      // Reversal lines store NEGATIVE amounts; "so far" is a positive running total.
      entry.quantity = {
        num:
          entry.quantity.num * quantity.den + quantity.num * entry.quantity.den,
        den: entry.quantity.den * quantity.den
      };
      entry.netUnits += -rationalToExactUnits(
        parseDecimal(line.netAmount, {
          maxFractionDigits: scale,
          allowNegative: true,
          maxIntegerDigits: 24
        }),
        scale
      );

      for (const component of line.components) {
        entry.componentUnits.set(
          component.code,
          (entry.componentUnits.get(component.code) ?? 0n) +
            -rationalToExactUnits(
              parseDecimal(component.taxAmount, {
                maxFractionDigits: scale,
                allowNegative: true,
                maxIntegerDigits: 24
              }),
              scale
            )
        );
      }

      reversedSoFar.set(key, entry);
    }
  }

  let result: ReversalResult;

  try {
    result = computeReversal({
      roundingMode: original.rounding_mode,
      roundingScale: scale,
      originalLines: original.lines!,
      reversedSoFar,
      ...(args.requested ? { requested: args.requested } : {})
    });
  } catch (error) {
    if (error instanceof TaxCalculationError) {
      return { kind: "invalid", message: error.message };
    }
    throw error;
  }

  const inserted = (await tx`
    INSERT INTO awcms_tax_snapshots (
      tenant_id, kind, document_type, document_id, original_snapshot_id,
      rule_version_id, profile_code, version_no, tax_date, currency_code,
      pricing_mode, rounding_mode, rounding_scale, rounding_level,
      rule_definition, lines, component_totals, treatment_totals, net_total,
      tax_total, gross_total, input_hash, reason, created_by
    )
    VALUES (
      ${tenantId}, 'reversal', ${original.document_type}, ${args.documentId},
      ${original.id}, ${original.rule_version_id}, ${original.profile_code},
      ${original.version_no}, COALESCE(${args.taxDate}::date, (now() AT TIME ZONE 'UTC')::date),
      ${original.currency_code}, ${original.pricing_mode},
      ${original.rounding_mode}, ${scale}, ${original.rounding_level},
      ${original.rule_definition}::jsonb, ${result.lines}::jsonb,
      ${result.componentTotals}::jsonb, ${result.treatmentTotals}::jsonb,
      ${result.netTotal}::numeric, ${result.taxTotal}::numeric,
      ${result.grossTotal}::numeric, ${args.inputHash}, ${args.reason},
      ${actorId}
    )
    RETURNING ${tx.unsafe(COLUMNS)}
  `) as SnapshotRow[];

  return { kind: "created", snapshot: toView(inserted[0]!) };
}
