#!/usr/bin/env bun
/**
 * identity-access-owner-permission-backfill.ts — `bun run
 * identity-access:permissions:backfill`.
 *
 * Closes the gap every permission-seed migration opens: those migrations extend
 * the GLOBAL catalog (`awcms_permissions`) only, while a tenant's `owner` role
 * was granted whatever the catalog held on the day that tenant was created.
 * Every tenant older than a module therefore gets `403 ACCESS_DENIED` on that
 * module's admin surface, with nothing in the release saying so.
 *
 * DRY-RUN BY DEFAULT. Pass `--commit` to write. The accident this guards
 * against — silently widening authorization across every tenant at once — is
 * not one an operator should be able to have by typing a command that looks
 * read-only.
 *
 * `--tenant <code>` limits the pass to one tenant, for a staged rollout.
 *
 * Only permissions NEWER than the owner role are granted; anything older that is
 * missing was removed deliberately and is reported, never re-granted. See
 * `src/modules/identity-access/domain/owner-permission-backfill.ts`.
 */
import { getDatabaseClient } from "../src/lib/database/client";
import { runOwnerPermissionBackfill } from "../src/modules/identity-access/application/owner-permission-backfill-job";

function parseArgs(argv: string[]): { commit: boolean; tenantCode?: string } {
  const commit = argv.includes("--commit");
  const tenantIndex = argv.indexOf("--tenant");
  const tenantCode =
    tenantIndex >= 0 ? (argv[tenantIndex + 1] ?? undefined) : undefined;

  if (tenantIndex >= 0 && (!tenantCode || tenantCode.startsWith("--"))) {
    throw new Error("--tenant requires a tenant code.");
  }

  return { commit, tenantCode };
}

const { commit, tenantCode } = parseArgs(process.argv.slice(2));

const result = await runOwnerPermissionBackfill(getDatabaseClient(), {
  commit,
  now: new Date(),
  tenantCode
});

const mode = commit ? "COMMIT" : "DRY-RUN";
console.log(
  `identity-access:permissions:backfill ${mode} — ${result.tenants.length} tenant(s) scanned, ${result.totalGranted} grant(s) ${commit ? "written" : "pending"}.`
);

for (const tenant of result.tenants) {
  if (tenant.ownerRoleMissing) {
    console.log(
      `  ${tenant.tenantCode}: no system 'owner' role — skipped (nothing to backfill).`
    );
    continue;
  }

  if (tenant.granted.length === 0 && tenant.skippedAsDeliberate.length === 0) {
    console.log(`  ${tenant.tenantCode}: already complete.`);
    continue;
  }

  if (tenant.granted.length > 0) {
    console.log(
      `  ${tenant.tenantCode}: ${commit ? "granted" : "would grant"} ${tenant.granted.length} — ${tenant.granted.join(", ")}`
    );
  }

  if (tenant.skippedAsDeliberate.length > 0) {
    console.log(
      `  ${tenant.tenantCode}: ${tenant.skippedAsDeliberate.length} missing but OLDER than the role (presumed removed on purpose, NOT granted) — ${tenant.skippedAsDeliberate.join(", ")}`
    );
  }
}

if (!commit && result.totalGranted > 0) {
  console.log("\nRe-run with --commit to apply.");
}
