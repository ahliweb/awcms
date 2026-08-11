#!/usr/bin/env bun
/**
 * identity-access-entitlement-backfill.ts — `bun run entitlements:backfill`.
 *
 * ADR-0084, Gelombang 5 PR 5.3 of Issue #423. Grandfathers every tenant that
 * PREDATES an entitlement onto it, so a descriptor declaring
 * `requiresEntitlement` does not turn a working installation into a wall of
 * `403 ENTITLEMENT_REQUIRED` on the day it merges.
 *
 * DRY-RUN BY DEFAULT. Pass `--commit` to write. `--tenant <code>` limits the
 * pass to one tenant, for a staged rollout.
 *
 * ## Run this BEFORE the descriptor, not after
 *
 * The blast-radius report it prints — "N tenant(s) would start receiving 403
 * ENTITLEMENT_REQUIRED for X" — is the check that catches the mistake while it
 * is still cheap. Run after the descriptor merges, it describes an outage
 * instead of preventing one. `bun run security:readiness` carries the same
 * report so it is also reachable without knowing this script exists.
 *
 * ## Why a blanket grandfather is legitimate here
 *
 * `identity-access:permissions:backfill` refuses to re-grant anything older than
 * the owner role, because a missing older permission may have been REVOKED and a
 * backfill cannot tell that from "never granted". Entitlements have no such
 * history: the schema landed empty (`sql/109`), so an absent row can only mean
 * "before entitlements". That asymmetry is the whole argument, and it expires
 * the moment the first revocation happens — which is why tenants NEWER than an
 * entitlement's catalogue row are reported rather than granted.
 */
import { getDatabaseClient } from "../src/lib/database/client";
import { runEntitlementBackfill } from "../src/modules/identity-access/application/entitlement-backfill-job";

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
const sql = getDatabaseClient();

try {
  const result = await runEntitlementBackfill(sql, {
    commit,
    now: new Date(),
    tenantCode
  });

  if (result.requiredEntitlementKeys.length === 0) {
    console.log(
      "entitlements:backfill — no module declares `requiresEntitlement`, so " +
        "there is nothing to grandfather. This is the state this base ships in " +
        "(ADR-0084: the wave landed inert)."
    );
    process.exit(0);
  }

  console.log(
    `entitlements:backfill — ${result.requiredEntitlementKeys.length} entitlement(s) required by the registry: ${result.requiredEntitlementKeys.join(", ")}`
  );

  console.log("\nBLAST RADIUS — who is refused if nothing is granted:");
  for (const entry of result.blastRadius) {
    console.log(
      `  ${entry.entitlementKey} — ${entry.deniedTenantCount} tenant(s) would receive 403 ENTITLEMENT_REQUIRED: ${entry.deniedTenantCodes.join(", ")}`
    );
  }

  const skippedByReason = new Map<string, number>();
  for (const skip of result.plan.skipped) {
    skippedByReason.set(
      skip.reason,
      (skippedByReason.get(skip.reason) ?? 0) + 1
    );
  }

  console.log(
    `\nPlan: ${result.plan.grants.length} grant(s), ${result.plan.skipped.length} skipped` +
      (skippedByReason.size > 0
        ? ` (${[...skippedByReason.entries()].map(([reason, count]) => `${reason}=${count}`).join(", ")})`
        : "")
  );

  // Named individually rather than folded into the count: this is the one skip
  // reason that means "a human decision may be involved", and a number cannot
  // say which tenant to go and ask about.
  const newer = result.plan.skipped.filter(
    (skip) => skip.reason === "tenant_newer_than_entitlement"
  );

  if (newer.length > 0) {
    console.log(
      "\nNOT grandfathered — newer than the entitlement, so the absence is a fact about the tenant rather than about the feature. Re-granting these would risk undoing a revocation:"
    );
    for (const skip of newer) {
      console.log(`  ${skip.tenantCode} — ${skip.entitlementKey}`);
    }
  }

  console.log(
    commit
      ? `\nCOMMITTED — ${result.granted} entitlement(s) granted.`
      : "\nDRY RUN — nothing was written. Re-run with --commit to apply."
  );
} finally {
  await sql.close();
}
