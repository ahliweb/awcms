/**
 * Unit test for `legalHoldGuardPortAdapter` (the concrete `LegalHoldGuardPort`
 * that logging/visitor_analytics consume at their purge composition roots). No
 * DB — a fake tagged-template `tx` returns canned active-hold rows so we exercise
 * the exact wiring `fetchActiveLegalHoldsForPlanning` -> `evaluateLegalHoldForDescriptor`
 * the adapter performs, including the tenant-wide (null) match.
 */
import { describe, expect, test } from "bun:test";

import { legalHoldGuardPortAdapter } from "../src/modules/data-lifecycle/application/legal-hold-guard-port-adapter";

type HoldRow = {
  id: string;
  tenant_id: string;
  descriptor_key: string | null;
  status: "active" | "released";
};

/** A `Bun.SQL`-shaped tagged-template stub: `tx\`...\`` resolves to `rows`. */
function fakeTx(rows: HoldRow[]): Bun.SQL {
  return ((..._args: unknown[]) => Promise.resolve(rows)) as unknown as Bun.SQL;
}

const TENANT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const KEY = "logging.audit_events";

function row(descriptorKey: string | null): HoldRow {
  return {
    id: crypto.randomUUID(),
    tenant_id: TENANT,
    descriptor_key: descriptorKey,
    status: "active"
  };
}

describe("legalHoldGuardPortAdapter.isDescriptorHeld", () => {
  test("false when there are no active holds", async () => {
    expect(
      await legalHoldGuardPortAdapter.isDescriptorHeld(fakeTx([]), TENANT, KEY)
    ).toBe(false);
  });

  test("true when a hold is scoped exactly to the descriptor", async () => {
    expect(
      await legalHoldGuardPortAdapter.isDescriptorHeld(
        fakeTx([row(KEY)]),
        TENANT,
        KEY
      )
    ).toBe(true);
  });

  test("true when a tenant-wide (null) hold exists — applies to every descriptor", async () => {
    expect(
      await legalHoldGuardPortAdapter.isDescriptorHeld(
        fakeTx([row(null)]),
        TENANT,
        KEY
      )
    ).toBe(true);
  });

  test("false when the only hold targets a DIFFERENT descriptor", async () => {
    expect(
      await legalHoldGuardPortAdapter.isDescriptorHeld(
        fakeTx([row("visitor_analytics.visit_events")]),
        TENANT,
        KEY
      )
    ).toBe(false);
  });
});
