#!/usr/bin/env bun
/**
 * `bun run identity:mfa-collisions:preflight` — ADR-0087, Gelombang 7 PR 7.3 of
 * Issue #423.
 *
 * READ-ONLY. No migration, no writes, no flag that writes. It answers, before
 * the deploy window, the one question `sql/114` decides silently: which
 * authenticator does each human keep, and whose phone stops working tomorrow?
 *
 * ## Why this exists instead of a migration that refuses
 *
 * `sql/112` aborts on an identifier collision because merging two people is
 * unrecoverable. This is the opposite case: one human enrolled in three tenants
 * holds three TOTP secrets BECAUSE THIS PRODUCT TOLD THEM TO, and the
 * factor-per-human table keeps one. Blocking a deploy on a state the product
 * manufactured is a gate pointed at the wrong thing — so the migration proceeds,
 * the losing factors are disabled rather than deleted, and this reports who is
 * affected while there is still time to tell them.
 *
 * ## Per-tenant, on the ordinary app role
 *
 * `awcms_identity_mfa_factors` and `awcms_identities` are FORCE-RLS, so the rows
 * are read one tenant at a time inside `withTenantOrThrow` — the same pattern
 * `identity:principals:preflight` uses, and the reason this needs no owner
 * credentials and no `NO FORCE` toggle. The grouping that matters is
 * cross-tenant, and it happens in memory after the loop: the whole point is that
 * one human appears in several of these per-tenant result sets.
 *
 * **The `tenant_id` predicate is written explicitly, and this is not belt-and-
 * braces.** The first version relied on RLS alone and was WRONG WHEN RUN AS THE
 * OWNER — a superuser or the migration role bypasses RLS entirely, so every
 * per-tenant pass saw every factor in the installation. Two seeded factors were
 * reported as four, and each was tagged with whichever tenant's turn it was, so
 * the census named the wrong tenants with complete confidence. An operator
 * running ops scripts as the owner is an ordinary setup, not an abuse, and a
 * report that is silently multiplied is worse than no report. Found by seeding a
 * real collision and reading the output — not by review.
 *
 * Run it BEFORE `sql/114`. Afterwards it still runs and still tells the truth,
 * but the truth is "nothing left to decide" — the legacy table it reads is
 * frozen history by then.
 */
import { getDatabaseClient } from "../src/lib/database/client";
import { withTenantOrThrow } from "../src/lib/database/tenant-context";
import {
  runMfaCollisionPreflight,
  type MfaCollisionFactor,
  type MfaFactorFate
} from "../src/modules/identity-access/domain/mfa-collision-preflight";

type TenantRow = { id: string; tenant_code: string };

type FactorRow = {
  id: string;
  identity_id: string;
  principal_id: string | null;
  factor_type: string;
  status: string;
  last_used_step: number | string;
  activated_at: Date | null;
};

function describe(fate: MfaFactorFate): string {
  const at = fate.activatedAt
    ? new Date(fate.activatedAt).toISOString()
    : "belum aktif";

  return `[${fate.tenantCode}] ${fate.status}, langkah terakhir ${fate.lastUsedStep}, aktif ${at}`;
}

async function main(): Promise<void> {
  const sql = getDatabaseClient();

  const tenants = (await sql`
    SELECT id, tenant_code FROM awcms_tenants ORDER BY tenant_code
  `) as TenantRow[];

  const factors: MfaCollisionFactor[] = [];

  for (const tenant of tenants) {
    const rows = await withTenantOrThrow(sql, tenant.id, async (tx) => {
      return (await tx`
        SELECT f.id, f.identity_id, i.principal_id, f.factor_type, f.status,
               f.last_used_step, f.activated_at
        FROM awcms_identity_mfa_factors f
        JOIN awcms_identities i ON i.id = f.identity_id
         AND i.tenant_id = f.tenant_id
        WHERE f.tenant_id = ${tenant.id} AND f.status <> 'disabled'
        ORDER BY f.id
      `) as FactorRow[];
    });

    for (const row of rows) {
      factors.push({
        factorId: row.id,
        principalId: row.principal_id,
        identityId: row.identity_id,
        tenantId: tenant.id,
        tenantCode: tenant.tenant_code,
        factorType: row.factor_type,
        status: row.status,
        // `bigint` arrives as a string from the driver; the ranking compares it
        // numerically, and a string comparison would put step 9 above step 10.
        lastUsedStep: Number(row.last_used_step),
        activatedAt: row.activated_at ? new Date(row.activated_at) : null
      });
    }
  }

  const report = runMfaCollisionPreflight(factors);

  console.log("identity:mfa-collisions:preflight — sensus (READ-ONLY)\n");
  console.log(`  tenant dipindai                  : ${tenants.length}`);
  console.log(`  faktor hidup dipindai            : ${report.factorsScanned}`);
  console.log(
    `  manusia ber-faktor              : ${report.principalsWithFactor}`
  );
  console.log(
    `  faktor yang akan dinonaktifkan  : ${report.factorsThatWouldBeDisabled}`
  );

  const collisions = report.findings.filter(
    (finding) => finding.kind === "multi_factor_principal"
  );
  const unlinked = report.findings.filter(
    (finding) => finding.kind === "unlinked_factor"
  );

  if (collisions.length > 0) {
    console.log(
      `\nPERHATIAN — ${collisions.length} manusia memegang lebih dari satu faktor hidup.`
    );
    console.log(
      "Migrasi TIDAK menolak jalan untuk keadaan ini: ia sah, dan produk ini sendiri"
    );
    console.log(
      "yang membuatnya. Yang dipertahankan adalah faktor yang PALING BELAKANGAN"
    );
    console.log(
      "BENAR-BENAR DIPAKAI (langkah TOTP tertinggi), bukan yang terbaru dibuat —"
    );
    console.log(
      "enrolment terbaru bisa saja ada di ponsel yang sejak itu hilang.\n"
    );
    console.log(
      "Sisanya menjadi `disabled` (tidak dihapus) dan pemiliknya bisa enroll ulang."
    );
    console.log("Beri tahu mereka SEBELUM jendela deploy, bukan sesudahnya.\n");

    for (const finding of collisions) {
      if (finding.kind !== "multi_factor_principal") continue;

      console.log(`  principal ${finding.principalId} (${finding.factorType})`);
      console.log(`    DIPERTAHANKAN  ${describe(finding.survivor)}`);

      for (const loser of finding.disabled) {
        console.log(`    dinonaktifkan  ${describe(loser)}`);
      }
    }
  }

  if (unlinked.length > 0) {
    console.log(
      `\nMEMBLOKIR — ${unlinked.length} faktor hidup menempel pada identitas TANPA principal.`
    );
    console.log(
      "Faktor ini tidak ikut pindah sama sekali (`sql/114` §3a membaca"
    );
    console.log(
      "`WHERE i.principal_id IS NOT NULL`), jadi MFA orang itu hilang tanpa sisa —"
    );
    console.log("bukan sekadar kehilangan duplikat.\n");
    console.log(
      "Daftar ini seharusnya KOSONG: `sql/112` menautkan setiap identitas yang ada"
    );
    console.log(
      "dan ADR-0086 mengajari keempat penulis identitas menautkan saat pembuatan."
    );
    console.log(
      "Isinya berarti ada penulis KELIMA — yang juga membuat percobaan login orang"
    );
    console.log(
      "itu tidak terhitung sama sekali. Tautkan dulu, baru deploy.\n"
    );

    for (const finding of unlinked.slice(0, 50)) {
      if (finding.kind !== "unlinked_factor") continue;
      console.log(
        `  [${finding.tenantCode}] identitas ${finding.identityId} — faktor ${finding.factorId} (${finding.status})`
      );
    }

    if (unlinked.length > 50) {
      console.log(`  … dan ${unlinked.length - 50} lagi`);
    }
  }

  console.log(
    report.clear
      ? "\nBERSIH — tidak ada manusia yang kehilangan authenticator."
      : "\nTIDAK BERSIH — baca di atas sebelum membuka jendela deploy."
  );

  // Exit 0 even when NOT clear, for the reason `identity:principals:preflight`
  // records: this reports a state of the DATA, which is nobody's regression and
  // belongs in no pipeline. A non-zero exit would either wedge something this
  // does not belong in, or teach people to ignore it.
  process.exit(0);
}

if (import.meta.main) {
  await main();
}
