#!/usr/bin/env bun
/**
 * `bun run identity:principals:preflight` — Issue #430.
 *
 * READ-ONLY. No migration, no writes, and no flag that writes. It answers one
 * question months before the migration that needs the answer: what stands
 * between today's tenant-scoped identities and a global principal (Gelombang 7
 * of #423)?
 *
 * ## Why it must run early
 *
 * `awcms_identities` is UNIQUE on `(tenant_id, login_identifier)`; a principal
 * is UNIQUE on the normalized address. Two rows in ONE tenant differing only by
 * case or surrounding whitespace are legal today and impossible afterwards —
 * and the fix is never a patch. It is a conversation with a customer about
 * which of two accounts is the person and which is a duplicate someone created
 * by accident. That conversation cannot happen inside a migration window.
 *
 * Running this early turns a migration abort into scheduled customer support.
 *
 * ## Per-tenant, on the ordinary app role
 *
 * `awcms_identities` is FORCE-RLS, so the rows are read one tenant at a time
 * inside `withTenantOrThrow` — the same pattern every per-tenant worker here
 * uses, and the reason this needs no owner credentials. The listing of tenants
 * itself runs outside a tenant context because `awcms_tenants` is the
 * deliberately RLS-free root table.
 *
 * That is sound for the blocking finding by construction: a within-tenant
 * collision is, by definition, inside one tenant. The cross-tenant counts are
 * aggregated across the loop.
 */
import { getDatabaseClient } from "../src/lib/database/client";
import { withTenantOrThrow } from "../src/lib/database/tenant-context";
import {
  runPrincipalPreflight,
  type PreflightIdentity
} from "../src/modules/identity-access/domain/principal-preflight";

type TenantRow = { id: string; tenant_code: string };
type IdentityRow = { id: string; login_identifier: string };

async function main(): Promise<void> {
  const sql = getDatabaseClient();

  const tenants = (await sql`
    SELECT id, tenant_code FROM awcms_tenants ORDER BY tenant_code
  `) as TenantRow[];

  const identities: PreflightIdentity[] = [];

  for (const tenant of tenants) {
    const rows = await withTenantOrThrow(sql, tenant.id, async (tx) => {
      return (await tx`
        SELECT id, login_identifier FROM awcms_identities
        ORDER BY login_identifier
      `) as IdentityRow[];
    });

    for (const row of rows) {
      identities.push({
        identityId: row.id,
        tenantId: tenant.id,
        tenantCode: tenant.tenant_code,
        loginIdentifier: row.login_identifier
      });
    }
  }

  const report = runPrincipalPreflight(identities);

  console.log("identity:principals:preflight — sensus (READ-ONLY)\n");
  console.log(`  tenant dipindai               : ${tenants.length}`);
  console.log(`  identitas dipindai            : ${report.identitiesScanned}`);
  console.log(
    `  principal yang akan dibuat    : ${report.principalsThatWouldBeCreated}`
  );
  console.log(
    `  manusia di >1 tenant          : ${report.principalsSpanningMultipleTenants}`
  );

  const collisions = report.findings.filter(
    (finding) => finding.kind === "within_tenant_collision"
  );
  const nonEmail = report.findings.filter(
    (finding) => finding.kind === "non_email_identifier"
  );

  if (collisions.length > 0) {
    console.log(
      `\nMEMBLOKIR — ${collisions.length} tabrakan DI DALAM satu tenant.`
    );
    console.log(
      "Dua identitas di tenant yang sama ternormalisasi ke alamat yang sama. Itu legal"
    );
    console.log(
      "hari ini dan mustahil setelah principal. Perbaikannya bukan patch: seseorang"
    );
    console.log(
      "harus memutuskan akun mana yang orangnya dan mana yang duplikat.\n"
    );

    for (const finding of collisions) {
      if (finding.kind !== "within_tenant_collision") continue;
      console.log(
        `  [${finding.tenantCode}] ${finding.normalized} <- ${finding.rawIdentifiers
          .map((raw) => JSON.stringify(raw))
          .join(", ")}`
      );
    }
  }

  if (nonEmail.length > 0) {
    console.log(
      `\nADVISORY — ${nonEmail.length} identifier bukan alamat email.`
    );
    console.log(
      "Ia tetap menjadi principal, tetapi tidak akan pernah bisa menerima undangan"
    );
    console.log("maupun reset password.\n");

    for (const finding of nonEmail.slice(0, 50)) {
      if (finding.kind !== "non_email_identifier") continue;
      console.log(
        `  [${finding.tenantCode}] ${JSON.stringify(finding.loginIdentifier)}`
      );
    }

    if (nonEmail.length > 50) {
      console.log(`  … dan ${nonEmail.length - 50} lagi`);
    }
  }

  console.log(
    report.clear
      ? "\nBERSIH — tidak ada yang memblokir migrasi principal."
      : "\nTIDAK BERSIH — selesaikan tabrakan di atas sebelum menulis migrasinya."
  );

  // Exit 0 even when NOT clear. This is a census, not a gate: it reports a state
  // of the DATA, which is nobody's regression and belongs in no pipeline. A
  // non-zero exit here would either wedge something this does not belong in, or
  // teach people to ignore it. Gelombang 7's migration is what refuses, loudly,
  // at the point where refusing is the correct answer.
  process.exit(0);
}

if (import.meta.main) {
  await main();
}
