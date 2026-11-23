/**
 * The parts of a hand-built catalog snapshot that make the required payroll
 * tables match their pinned fingerprints (Issue #1436, ADR-0173): every
 * column, every required trigger with its function, `tgtype` and neutral shape
 * (no WHEN, no UPDATE OF, no arguments, not deferrable), every foreign key with
 * its columns, actions and state, and the trigger functions themselves.
 *
 * A hand-built snapshot cannot carry the real trigger-function bodies, so the
 * functions here have test bodies and {@link TEST_PAYROLL_FINGERPRINTS} is the
 * registered fingerprint set with `functionSha256` re-pinned to them. Every
 * other part of the fingerprint is the registered one. {@link
 * analysePayrollCatalog} below is the real analyser with those two defaults; a
 * test that passes its own `fingerprints` or functions overrides them.
 */
import {
  PAYROLL_REQUIRED_TABLE_FINGERPRINTS,
  type PayrollTableFingerprint
} from "../../src/modules/_shared/payroll-data-boundary";
import {
  analysePayrollCatalog as analyseReal,
  functionDefinitionSha256,
  type AnalyseOptions,
  type CatalogFinding,
  type CatalogFunction,
  type CatalogSnapshot
} from "../../scripts/lib/payroll-catalog-boundary";

const entries = Object.entries(PAYROLL_REQUIRED_TABLE_FINGERPRINTS);

export const HEALTHY_PAYROLL_COLUMNS: CatalogSnapshot["columns"] = entries.map(
  ([table, fingerprint]) => ({
    relation: `public.${table}`,
    columns: [...fingerprint.columns]
  })
);

export const HEALTHY_PAYROLL_TRIGGERS: CatalogSnapshot["triggers"] =
  entries.flatMap(([table, fingerprint]) =>
    fingerprint.triggers.map((trigger) => ({
      relation: `public.${table}`,
      name: trigger.name,
      function: `public.${trigger.function}`,
      type: trigger.type,
      hasWhen: false,
      updateOf: [],
      argumentCount: 0,
      deferrable: false,
      constraintTrigger: false
    }))
  );

export const HEALTHY_PAYROLL_FOREIGN_KEYS: CatalogSnapshot["foreignKeys"] =
  entries.flatMap(([table, fingerprint]) =>
    fingerprint.foreignKeys.map((fk) => ({
      from: `public.${table}`,
      to: `public.${fk.to}`,
      columns: [...fk.columns],
      refColumns: [...fk.refColumns],
      onUpdate: fk.onUpdate,
      onDelete: fk.onDelete,
      enforced: true,
      validated: true,
      deferrable: false
    }))
  );

/** The trigger functions, with test bodies, owned by `owner`. */
export function healthyPayrollTriggerFunctions(
  owner = "owner"
): CatalogFunction[] {
  const names = [
    ...new Set(
      entries.flatMap(([, fingerprint]) =>
        fingerprint.triggers.map((trigger) => trigger.function)
      )
    )
  ];

  return names.map((name) => ({
    name: `public.${name}`,
    language: "plpgsql",
    securityDefiner: false,
    returnsTrigger: true,
    returnsSet: false,
    returnType: "trigger",
    owner,
    source: `BEGIN /* test body of ${name} */ RETURN NEW; END`,
    rowTypeRelations: [],
    dependsOnRelations: [],
    executeGrantees: [owner],
    identity: "",
    config: ["search_path=public, pg_temp"],
    kind: "f",
    volatility: "v",
    strict: false,
    leakproof: false
  }));
}

const testDigests = new Map(
  healthyPayrollTriggerFunctions().map((fn) => [
    fn.name,
    functionDefinitionSha256(fn)
  ])
);

export const TEST_PAYROLL_FINGERPRINTS: Readonly<
  Record<string, PayrollTableFingerprint>
> = Object.fromEntries(
  entries.map(([table, fingerprint]) => [
    table,
    {
      ...fingerprint,
      triggers: fingerprint.triggers.map((trigger) => ({
        ...trigger,
        functionSha256: testDigests.get(`public.${trigger.function}`)!
      }))
    }
  ])
);

/**
 * The real analyser, with the test fingerprints and the healthy trigger
 * functions added to the snapshot when it does not name them itself.
 */
export function analysePayrollCatalog(
  snapshot: CatalogSnapshot,
  options: AnalyseOptions = {}
): CatalogFinding[] {
  const owner =
    snapshot.migrationOwner ?? snapshot.relations[0]?.owner ?? "owner";
  const present = new Set(snapshot.functions.map((fn) => fn.name));

  return analyseReal(
    {
      ...snapshot,
      functions: [
        ...healthyPayrollTriggerFunctions(owner).filter(
          (fn) => !present.has(fn.name)
        ),
        ...snapshot.functions
      ]
    },
    { fingerprints: TEST_PAYROLL_FINGERPRINTS, ...options }
  );
}
