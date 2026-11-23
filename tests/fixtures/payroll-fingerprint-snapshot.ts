/**
 * The parts of a hand-built catalog snapshot that make the required payroll
 * tables match their pinned fingerprints (Issue #1436, ADR-0173): every
 * column, every required trigger with its function and `tgtype`, every foreign
 * key with its columns. Derived from `PAYROLL_REQUIRED_TABLE_FINGERPRINTS`, so
 * a unit test's "healthy" catalog is healthy by the same definition the real
 * catalog is held to.
 */
import { PAYROLL_REQUIRED_TABLE_FINGERPRINTS } from "../../src/modules/_shared/payroll-data-boundary";
import type { CatalogSnapshot } from "../../scripts/lib/payroll-catalog-boundary";

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
      type: trigger.type
    }))
  );

export const HEALTHY_PAYROLL_FOREIGN_KEYS: CatalogSnapshot["foreignKeys"] =
  entries.flatMap(([table, fingerprint]) =>
    fingerprint.foreignKeys.map((fk) => ({
      from: `public.${table}`,
      to: `public.${fk.to}`,
      columns: [...fk.columns]
    }))
  );
