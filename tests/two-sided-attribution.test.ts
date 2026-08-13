/**
 * Atribusi dua sisi — ADR-0091, Gelombang 8 PR 8.3 (#423).
 *
 * Yang dijaga di sini adalah hal-hal yang MUDAH hilang tanpa memerahkan apa pun
 * yang lain:
 *
 *   1. penulis audit dan decision log benar-benar meneruskan kolom barunya —
 *      sebuah parameter yang diterima lalu tidak dipakai adalah bug yang paling
 *      sunyi di kelas ini;
 *   2. chokepoint meneruskan `context.delegatedGrantId` pada SETIAP jalur
 *      terminal, bukan sebagian — satu yang terlewat berarti satu kelas
 *      keputusan yang tidak bisa diatribusikan, dan tidak ada test perilaku yang
 *      akan menyebutkannya;
 *   3. catatan kelahiran tenant ditulis DI DALAM konteks tenant baru, sebelum
 *      pemulihan GUC. Urutannya adalah seluruh alasan ia mungkin.
 *
 * Murni: tidak ada basis data.
 */
import { describe, expect, test } from "bun:test";

const AUDIT_WRITER = "src/modules/logging/application/audit-log.ts";
const DECISION_WRITER =
  "src/modules/identity-access/application/decision-log.ts";
const GUARD = "src/modules/identity-access/application/access-guard.ts";
const BOOTSTRAP = "src/modules/tenant-admin/application/platform-bootstrap.ts";
const AUTH_CONTEXT = "src/modules/identity-access/application/auth-context.ts";
const MIGRATION = "sql/118_awcms_two_sided_attribution.sql";

describe("penulisnya benar-benar menulis kolomnya", () => {
  test("audit menerima DAN meneruskan `actorTenantId` + `delegatedGrantId`", async () => {
    const source = await Bun.file(AUDIT_WRITER).text();

    // Diterima di tipe input…
    expect(source).toContain("actorTenantId?: string;");
    expect(source).toContain("delegatedGrantId?: string;");
    // …dan benar-benar sampai ke INSERT. Parameter yang diterima lalu diabaikan
    // adalah bug yang lulus setiap typecheck dan setiap test yang hanya
    // memanggilnya.
    expect(source).toContain("actor_tenant_id, delegated_grant_id");
    expect(source).toContain("${input.actorTenantId ?? null}");
    expect(source).toContain("${input.delegatedGrantId ?? null}");
  });

  test("decision log menerima DAN meneruskan `delegatedGrantId`", async () => {
    const source = await Bun.file(DECISION_WRITER).text();

    expect(source).toContain("delegatedGrantId?: string");
    expect(source).toContain("delegated_grant_id)");
    expect(source).toContain("${delegatedGrantId ?? null}");
  });

  test("decision log TIDAK mendapat `actor_tenant_id` — penghematan yang disengaja", async () => {
    // Bila seseorang menambahkannya nanti, test ini memerah dan memaksa
    // argumennya ditulis ulang: dua kolom per request pada tabel terbesar di
    // repo, untuk menghindari satu join yang hanya dijalankan investigasi.
    const source = await Bun.file(DECISION_WRITER).text();

    expect(source).not.toContain("actor_tenant_id");
  });
});

describe("chokepoint mengatribusikan SETIAP keputusan", () => {
  test("setiap panggilan `recordDecisionLog` meneruskan grant id", async () => {
    const source = await Bun.file(GUARD).text();

    // Bukan "ada minimal satu": SEMUA. Satu jalur terminal yang terlewat adalah
    // satu kelas keputusan yang tidak bisa diatribusikan, dan tidak ada yang
    // akan memberitahu. Tiap panggilan diperiksa SENDIRI-SENDIRI, karena
    // menghitung dua angka lalu membandingkannya lulus juga bila satu panggilan
    // menyebutnya dua kali dan satu lagi tidak sama sekali.
    const unattributed: string[] = [];

    for (const [index, part] of source.split("recordDecisionLog(").entries()) {
      if (index === 0) continue; // teks sebelum panggilan pertama

      const args = part.slice(0, part.indexOf(");"));
      if (!args.includes("context.delegatedGrantId")) {
        unattributed.push(args.replace(/\s+/g, " ").trim().slice(0, 80));
      }
    }

    expect(source.split("recordDecisionLog(").length - 1).toBeGreaterThan(5);
    expect(unattributed).toEqual([]);
  });
});

describe("catatan kelahiran tenant — urutannya adalah seluruh alasannya", () => {
  test("ditulis SEBELUM konteks tenant dipulihkan", async () => {
    const source = await Bun.file(BOOTSTRAP).text();

    const auditAt = source.indexOf(
      "Tenant provisioned by the platform operator"
    );
    const restoreAt = source.indexOf(
      "SET LOCAL app.current_tenant_id = '${assertUuid(options.restoreTenantId)}'"
    );

    expect(auditAt).toBeGreaterThan(-1);
    expect(restoreAt).toBeGreaterThan(-1);
    // Dibalik, barisnya mendarat di tenant PLATFORM — persis duplikat baris yang
    // sudah ada, dan tindak lanjut ADR-0054 diam-diam tetap terbuka sementara
    // kodenya tampak menutupnya.
    expect(auditAt).toBeLessThan(restoreAt);
  });

  test("ia membawa `actorTenantId` dan TIDAK membawa id tenant user operator", async () => {
    const source = await Bun.file(BOOTSTRAP).text();
    const block = source.slice(
      source.indexOf("await recordAuditEvent(tx, {"),
      source.indexOf("Tenant provisioned by the platform operator") + 120
    );

    expect(block).toContain("actorTenantId: options.restoreTenantId");
    expect(block).not.toContain("actorTenantUserId");
  });
});

describe("resolusi grant id — biaya di tempat yang benar", () => {
  test("berhenti lebih awal untuk anggota biasa", async () => {
    const source = await Bun.file(AUTH_CONTEXT).text();
    const fn = source.slice(
      source.indexOf("async function resolveDelegatedGrantId("),
      source.indexOf("export async function resolveTenantContextForTenantUser(")
    );

    expect(fn).toContain(
      'if (principalKind !== "delegated") return undefined;'
    );
    // Guard clause di ATAS query-nya, bukan sesudahnya: kalau tidak, setiap
    // request biasa membayar round trip untuk kasus yang jarang.
    expect(fn.indexOf('principalKind !== "delegated"')).toBeLessThan(
      fn.indexOf("FROM awcms_delegated_access_grants")
    );
  });

  test("hanya mempertimbangkan grant yang HIDUP", async () => {
    const source = await Bun.file(AUTH_CONTEXT).text();

    expect(source).toContain("granted_tenant_user_id = ${tenantUserId}");
    expect(source).toContain("revoked_at IS NULL");
  });
});

describe("migrasi menyatakan bentuknya", () => {
  test("FK grant KOMPOSIT di kedua tabel", async () => {
    const source = await Bun.file(MIGRATION).text();

    // FK sederhana pada `id` melewati RLS dan menerima grant tenant lain.
    const composite =
      source.split("FOREIGN KEY (tenant_id, delegated_grant_id)").length - 1;
    expect(composite).toBe(2);
  });

  test("index-nya PARSIAL", async () => {
    const source = await Bun.file(MIGRATION).text();

    const partial =
      source.split("WHERE delegated_grant_id IS NOT NULL").length - 1;
    expect(partial).toBe(2);
    expect(source).toContain("WHERE actor_tenant_id IS NOT NULL");
  });

  test("tidak ada backfill", async () => {
    const source = await Bun.file(MIGRATION).text();

    // Baris lama ditulis sebelum akses terdelegasi ada, jadi NULL sudah BENAR.
    // Backfill akan mengubah setiap baris lama menjadi klaim yang kebetulan
    // benar dan menghapus perbedaan yang menjadi guna kolom ini.
    expect(source).not.toContain(
      "UPDATE awcms_audit_events SET actor_tenant_id"
    );
  });
});
