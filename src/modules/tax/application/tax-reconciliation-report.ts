/**
 * Tax reconciliation report (ADR-0127) — the monetary half of the module's
 * reporting surface.
 *
 * ## Why a live aggregation AND a projection
 *
 * The `reporting` engine's `cursor_table` projections (declared in `tax/module.ts`)
 * can only COUNT — `ProjectionCursorMetricRule` has `increment`/`decrement` and no
 * "sum a column". So the projection answers "how many documents and reversals
 * has this tenant finalised, and is the pipeline fresh", and this report answers
 * what a finance reviewer actually asks: how much, by period, by component, by
 * treatment — and whether the stored rows agree with themselves.
 *
 * ## The integrity block
 *
 * Every snapshot is checked against its own lines: do the line nets, taxes and
 * grosses sum to the document's totals, and do the components sum to the tax
 * total? A mismatch cannot be produced by the calculator, so a non-zero count
 * means a row was written some other way — which is the thing a reconciliation
 * exists to surface. It is reported as a count rather than a pass/fail so an
 * operator can see HOW wrong the ledger is.
 *
 * Bounded by construction: the period is capped (`TAX_REPORT_MAX_DAYS`), and
 * everything is aggregated in SQL, so the response size depends on the number of
 * profiles / components / treatments, never on the number of documents.
 */
import {
  TaxDecimalError,
  parseDecimal,
  rationalToTrimmedDecimal
} from "../domain/decimal";

export const TAX_REPORT_MAX_DAYS = 366;

export type ReconciliationReport = {
  from: string;
  to: string;
  byVersion: {
    kind: "sale" | "reversal";
    profileCode: string;
    versionNo: number;
    currencyCode: string;
    documents: number;
    netTotal: string;
    taxTotal: string;
    grossTotal: string;
  }[];
  byComponent: {
    kind: "sale" | "reversal";
    profileCode: string;
    currencyCode: string;
    componentCode: string;
    taxAmount: string;
  }[];
  byTreatment: {
    kind: "sale" | "reversal";
    profileCode: string;
    currencyCode: string;
    treatment: string;
    netAmount: string;
    taxAmount: string;
  }[];
  /** Sales plus (negative) reversals, per currency. */
  netOfReversals: {
    currencyCode: string;
    sales: number;
    reversals: number;
    netTotal: string;
    taxTotal: string;
    grossTotal: string;
  }[];
  integrity: {
    documentsChecked: number;
    lineSumMismatches: number;
    componentSumMismatches: number;
  };
};

/** PostgreSQL `numeric` text, exact, with trailing zeros trimmed ("10.500000" -> "10.5"). */
function amount(value: string | null): string {
  try {
    return rationalToTrimmedDecimal(
      parseDecimal(value ?? "0", {
        maxFractionDigits: 6,
        allowNegative: true,
        maxIntegerDigits: 24
      }),
      6
    );
  } catch (error) {
    if (error instanceof TaxDecimalError) return value ?? "0";
    throw error;
  }
}

type Kind = "sale" | "reversal";

export async function fetchReconciliationReport(
  tx: Bun.SQL,
  tenantId: string,
  from: string,
  to: string,
  profileCode: string | null
): Promise<ReconciliationReport> {
  // Sequential on purpose — one connection, one query at a time.
  const versions = (await tx`
    SELECT kind, profile_code, version_no, currency_code,
           COUNT(*)::int AS documents,
           SUM(net_total)::text AS net_total,
           SUM(tax_total)::text AS tax_total,
           SUM(gross_total)::text AS gross_total
    FROM awcms_tax_snapshots
    WHERE tenant_id = ${tenantId}
      AND tax_date >= ${from}::date AND tax_date <= ${to}::date
      AND (${profileCode}::text IS NULL OR profile_code = ${profileCode})
    GROUP BY kind, profile_code, version_no, currency_code
    ORDER BY profile_code, version_no, kind
  `) as {
    kind: Kind;
    profile_code: string;
    version_no: number;
    currency_code: string;
    documents: number;
    net_total: string;
    tax_total: string;
    gross_total: string;
  }[];

  const components = (await tx`
    SELECT s.kind, s.profile_code, s.currency_code,
           component ->> 'code' AS component_code,
           SUM((component ->> 'taxAmount')::numeric)::text AS tax_amount
    FROM awcms_tax_snapshots s
    CROSS JOIN LATERAL jsonb_array_elements(s.lines) AS line
    CROSS JOIN LATERAL jsonb_array_elements(line -> 'components') AS component
    WHERE s.tenant_id = ${tenantId}
      AND s.tax_date >= ${from}::date AND s.tax_date <= ${to}::date
      AND (${profileCode}::text IS NULL OR s.profile_code = ${profileCode})
    GROUP BY s.kind, s.profile_code, s.currency_code, component ->> 'code'
    ORDER BY s.profile_code, component ->> 'code', s.kind
  `) as {
    kind: Kind;
    profile_code: string;
    currency_code: string;
    component_code: string;
    tax_amount: string;
  }[];

  const treatments = (await tx`
    SELECT s.kind, s.profile_code, s.currency_code,
           line ->> 'treatment' AS treatment,
           SUM((line ->> 'netAmount')::numeric)::text AS net_amount,
           SUM((line ->> 'taxAmount')::numeric)::text AS tax_amount
    FROM awcms_tax_snapshots s
    CROSS JOIN LATERAL jsonb_array_elements(s.lines) AS line
    WHERE s.tenant_id = ${tenantId}
      AND s.tax_date >= ${from}::date AND s.tax_date <= ${to}::date
      AND (${profileCode}::text IS NULL OR s.profile_code = ${profileCode})
    GROUP BY s.kind, s.profile_code, s.currency_code, line ->> 'treatment'
    ORDER BY s.profile_code, line ->> 'treatment', s.kind
  `) as {
    kind: Kind;
    profile_code: string;
    currency_code: string;
    treatment: string;
    net_amount: string;
    tax_amount: string;
  }[];

  const net = (await tx`
    SELECT currency_code,
           COUNT(*) FILTER (WHERE kind = 'sale')::int AS sales,
           COUNT(*) FILTER (WHERE kind = 'reversal')::int AS reversals,
           SUM(net_total)::text AS net_total,
           SUM(tax_total)::text AS tax_total,
           SUM(gross_total)::text AS gross_total
    FROM awcms_tax_snapshots
    WHERE tenant_id = ${tenantId}
      AND tax_date >= ${from}::date AND tax_date <= ${to}::date
      AND (${profileCode}::text IS NULL OR profile_code = ${profileCode})
    GROUP BY currency_code
    ORDER BY currency_code
  `) as {
    currency_code: string;
    sales: number;
    reversals: number;
    net_total: string;
    tax_total: string;
    gross_total: string;
  }[];

  const integrity = (await tx`
    SELECT COUNT(*)::int AS documents_checked,
           COUNT(*) FILTER (
             WHERE s.net_total <> sums.net
                OR s.tax_total <> sums.tax
                OR s.gross_total <> sums.gross
           )::int AS line_sum_mismatches,
           COUNT(*) FILTER (WHERE s.tax_total <> sums.component_tax)::int
             AS component_sum_mismatches
    FROM awcms_tax_snapshots s
    CROSS JOIN LATERAL (
      SELECT
        COALESCE(SUM((line ->> 'netAmount')::numeric), 0) AS net,
        COALESCE(SUM((line ->> 'taxAmount')::numeric), 0) AS tax,
        COALESCE(SUM((line ->> 'grossAmount')::numeric), 0) AS gross,
        COALESCE(SUM((
          SELECT COALESCE(SUM((component ->> 'taxAmount')::numeric), 0)
          FROM jsonb_array_elements(line -> 'components') AS component
        )), 0) AS component_tax
      FROM jsonb_array_elements(s.lines) AS line
    ) AS sums
    WHERE s.tenant_id = ${tenantId}
      AND s.tax_date >= ${from}::date AND s.tax_date <= ${to}::date
      AND (${profileCode}::text IS NULL OR s.profile_code = ${profileCode})
  `) as {
    documents_checked: number;
    line_sum_mismatches: number;
    component_sum_mismatches: number;
  }[];

  const check = integrity[0];

  return {
    from,
    to,
    byVersion: versions.map((row) => ({
      kind: row.kind,
      profileCode: row.profile_code,
      versionNo: Number(row.version_no),
      currencyCode: row.currency_code,
      documents: Number(row.documents),
      netTotal: amount(row.net_total),
      taxTotal: amount(row.tax_total),
      grossTotal: amount(row.gross_total)
    })),
    byComponent: components.map((row) => ({
      kind: row.kind,
      profileCode: row.profile_code,
      currencyCode: row.currency_code,
      componentCode: row.component_code,
      taxAmount: amount(row.tax_amount)
    })),
    byTreatment: treatments.map((row) => ({
      kind: row.kind,
      profileCode: row.profile_code,
      currencyCode: row.currency_code,
      treatment: row.treatment,
      netAmount: amount(row.net_amount),
      taxAmount: amount(row.tax_amount)
    })),
    netOfReversals: net.map((row) => ({
      currencyCode: row.currency_code,
      sales: Number(row.sales),
      reversals: Number(row.reversals),
      netTotal: amount(row.net_total),
      taxTotal: amount(row.tax_total),
      grossTotal: amount(row.gross_total)
    })),
    integrity: {
      documentsChecked: Number(check?.documents_checked ?? 0),
      lineSumMismatches: Number(check?.line_sum_mismatches ?? 0),
      componentSumMismatches: Number(check?.component_sum_mismatches ?? 0)
    }
  };
}
