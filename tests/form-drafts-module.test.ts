/**
 * `form_drafts` module wiring (ported from awcms-micro Issue #484).
 *
 * These are the checks that catch the two failure modes this module can have
 * without anything visibly breaking:
 *
 * 1. **Permission drift.** The module descriptor, the SQL catalog seed, and
 *    every route guard must name the same four permissions. When they disagree
 *    the symptom is a bare 403 that denies even the tenant owner, with nothing
 *    pointing at the cause — a real incident on this project's production
 *    tenant, from exactly this class of mismatch.
 * 2. **Lifecycle key drift.** A legal hold is placed against a descriptor key;
 *    the purge checks a key. If those two strings ever diverge, the hold fails
 *    OPEN — the purge finds no hold and deletes the data anyway. Silent, and
 *    only observable after the rows are gone.
 *
 * Pure and DB-free: everything asserted here is code/SQL text, so it runs in
 * the ordinary unit suite rather than the DB-gated one.
 */
import { describe, expect, test } from "bun:test";

import { listModules } from "../src/modules/index";
import {
  formDraftsModule,
  FORM_DRAFTS_LIFECYCLE_KEY
} from "../src/modules/form-drafts/module";
import { FORM_DRAFT_PERMISSIONS } from "../src/modules/form-drafts/domain/form-draft-permissions";

const PERMISSION_SEED_PATH = "sql/063_awcms_form_drafts_permissions.sql";
const SCHEMA_PATH = "sql/062_awcms_form_drafts_schema.sql";
const PURGE_PATH = "src/modules/form-drafts/application/form-draft-purge.ts";

async function readRepoFile(path: string): Promise<string> {
  return Bun.file(path).text();
}

describe("form_drafts — registry wiring", () => {
  test("is registered in the base module registry", () => {
    expect(listModules().map((m) => m.key)).toContain("form_drafts");
  });

  test("depends only on identity_access, so the module DAG stays acyclic", () => {
    expect(formDraftsModule.dependencies).toEqual(["identity_access"]);
  });

  test("declares its own OpenAPI fragment and base path", () => {
    expect(formDraftsModule.api?.openApiPath).toBe(
      "openapi/modules/form-drafts.openapi.yaml"
    );
    expect(formDraftsModule.api?.basePath).toBe("/api/v1/form-drafts");
  });
});

describe("form_drafts — permission single-source agreement", () => {
  test("module.ts declares exactly the permissions in the single source", () => {
    const declared = (formDraftsModule.permissions ?? []).map(
      (p) => `${p.activityCode}.${p.action}`
    );
    const source = FORM_DRAFT_PERMISSIONS.map(
      (p) => `${p.activityCode}.${p.action}`
    );

    expect(declared.sort()).toEqual(source.sort());
  });

  test("the SQL catalog seed inserts exactly those same permissions", async () => {
    const sql = await readRepoFile(PERMISSION_SEED_PATH);

    for (const permission of FORM_DRAFT_PERMISSIONS) {
      expect(sql).toContain(
        `('form_drafts', '${permission.activityCode}', '${permission.action}', '${permission.description}')`
      );
    }

    // ...and nothing beyond them: count the seeded tuples so an extra row
    // added to the migration alone (without the descriptor) still fails.
    const seededTuples = sql.match(/\('form_drafts',/g) ?? [];
    expect(seededTuples).toHaveLength(FORM_DRAFT_PERMISSIONS.length);
  });

  test("there is no `submit` action anywhere — submit guards on draft.update", async () => {
    const sql = await readRepoFile(PERMISSION_SEED_PATH);
    const submitRoute = await readRepoFile(
      "src/pages/api/v1/form-drafts/[id]/submit.ts"
    );

    expect(sql).not.toContain("'submit'");
    expect(FORM_DRAFT_PERMISSIONS.some((p) => p.action === "update")).toBe(
      true
    );
    // The guard the route actually enforces.
    expect(submitRoute).toContain('action: "update"');
  });
});

describe("form_drafts — legal hold cannot fail open", () => {
  test("the purge checks the SAME descriptor key the module registers", async () => {
    const purge = await readRepoFile(PURGE_PATH);

    // Imported, not re-typed — a literal string here would be the drift.
    expect(purge).toContain("FORM_DRAFTS_LIFECYCLE_KEY");
    expect(purge).not.toContain('"form_drafts.form_drafts"');

    // PINNED LITERAL, deliberately. Asserting the descriptor equals
    // FORM_DRAFTS_LIFECYCLE_KEY would be tautological — both sides read the
    // same constant, so renaming it keeps the test green while every legal
    // hold already recorded against the old key silently stops matching.
    // Pinning the string means a rename has to be a conscious edit here, next
    // to this explanation of why existing holds would break.
    const descriptorKeys = (formDraftsModule.dataLifecycle ?? []).map(
      (d) => d.key
    );
    expect(descriptorKeys).toEqual(["form_drafts.form_drafts"]);
    expect(FORM_DRAFTS_LIFECYCLE_KEY).toBe("form_drafts.form_drafts");
  });

  test("the destructive phase is gated and the non-destructive one is not", async () => {
    const purge = await readRepoFile(PURGE_PATH);

    const purgeFn = purge.slice(
      purge.indexOf("export async function purgeExpiredFormDrafts")
    );
    const expireFn = purge.slice(
      purge.indexOf("export async function expireOverdueFormDrafts"),
      purge.indexOf("export type PurgeFormDraftsOptions")
    );

    // The DELETE path asks the guard first and bails on a held descriptor.
    expect(purgeFn).toContain("legalHoldGuard.isDescriptorHeld");
    expect(purgeFn).toContain("DELETE FROM awcms_form_drafts");

    // The status-transition path deletes nothing, so it is deliberately
    // ungated — asserting that keeps a future "consistency" refactor from
    // quietly gating it and stalling expiry whenever a hold exists.
    expect(expireFn).not.toContain("legalHoldGuard");
    expect(expireFn).not.toContain("DELETE FROM");
  });

  test("the descriptor is `delegated`, matching where enforcement really lives", () => {
    const descriptor = (formDraftsModule.dataLifecycle ?? [])[0];

    expect(descriptor?.executionMode).toBe("delegated");
    expect(descriptor?.legalHold.applicable).toBe(true);
    expect(descriptor?.deletion.mode).toBe("status_transition_then_purge");
  });
});

describe("form_drafts — schema invariants the application layer relies on", () => {
  test("the table is ENABLE + FORCE RLS with a tenant_isolation policy", async () => {
    const sql = await readRepoFile(SCHEMA_PATH);

    expect(sql).toContain(
      "ALTER TABLE awcms_form_drafts ENABLE ROW LEVEL SECURITY"
    );
    // ENABLE alone is inert for the table owner — which is the role migrations
    // run as. FORCE is what makes the policy real.
    expect(sql).toContain(
      "ALTER TABLE awcms_form_drafts FORCE ROW LEVEL SECURITY"
    );
    expect(sql).toContain("CREATE POLICY awcms_form_drafts_tenant_isolation");
  });

  test("the worker gets exactly the privileges its purge job needs — no INSERT", async () => {
    const sql = await readRepoFile(SCHEMA_PATH);

    expect(sql).toContain(
      "GRANT SELECT, UPDATE, DELETE ON awcms_form_drafts TO awcms_worker;"
    );
    expect(sql).not.toContain("INSERT ON awcms_form_drafts TO awcms_worker");
  });

  test("the key-format CHECKs mirror the validator's KEY_FORMAT", async () => {
    const sql = await readRepoFile(SCHEMA_PATH);
    const validator = await readRepoFile(
      "src/modules/form-drafts/domain/form-draft-validation.ts"
    );

    // Same pattern in both places; the app-layer copy exists to return a 422
    // with a field name instead of surfacing a raw 23514.
    expect(sql).toContain("'^[a-z][a-z0-9_]{1,63}$'");
    expect(validator).toContain("/^[a-z][a-z0-9_]{1,63}$/");
  });
});
