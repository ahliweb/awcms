/**
 * Registri partner — permukaan pendaftarannya (ADR-0089, `sql/116` + `sql/123`).
 *
 * `sql/116` mengirim tabelnya tanpa penulis: satu-satunya cara membuat baris
 * partner adalah operator dengan prompt psql. Berkas ini menjaga permukaan yang
 * menutup celah itu, dan terutama tiga hal yang mudah runtuh diam-diam:
 *
 *   1. kedua izinnya ber-scope PLATFORM — versi tenant-scoped dari `read`
 *      adalah direktori lintas-tenant yang ADR-0089 tolak, dibangun ulang
 *      sebagai permission;
 *   2. seed grant-nya berjalan di atas `awcms_setup_state`, BUKAN
 *      `awcms_tenants` — bentuk kedua adalah cacat asli yang ADR-0053 tutup;
 *   3. `status` tidak pernah ditulis permukaan ini, karena `sql/116`
 *      mematoknya sampai ada yang MEMBACA suspensi.
 *
 * Murni: tidak ada basis data. SQL-nya diperiksa dengan merekam
 * tagged-template — pola `principal-mfa-store`.
 */
import { describe, expect, test } from "bun:test";

import { listModules } from "../src/modules";
import {
  isPlatformScopedPermissionKey,
  resetPlatformScopeCacheForTests
} from "../src/modules/identity-access/domain/platform-scope";
import { validateRegisterPartnerInput } from "../src/modules/identity-access/domain/partner-registration";
import {
  listPartners,
  registerPartner
} from "../src/modules/identity-access/application/partner-registry-store";

const ROUTE = "src/pages/api/v1/partners/index.ts";
const MIGRATION = "sql/123_awcms_partner_registry_permissions.sql";

const PLATFORM = "00000000-0000-4000-8000-000000000001";
const PARTNER = "00000000-0000-4000-8000-000000000002";

function body(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    partnerTenantId: PARTNER,
    partnerCode: "acme-digital",
    displayName: "Acme Digital",
    ...overrides
  };
}

function fieldsOf(
  result: ReturnType<typeof validateRegisterPartnerInput>
): string[] {
  return result.valid ? [] : [...new Set(result.errors.map((e) => e.field))];
}

describe("validasi pendaftaran", () => {
  test("bentuk yang benar diterima dan di-trim", () => {
    const result = validateRegisterPartnerInput(
      body({ partnerCode: "  acme-digital  ", displayName: "  Acme  " })
    );

    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.value.partnerCode).toBe("acme-digital");
      expect(result.value.displayName).toBe("Acme");
    }
  });

  test("partnerCode ditolak untuk bentuk yang MEMBUAT baris kedua yang terbaca sama", () => {
    // Index unik-nya GLOBAL dan tanpa normalisasi apa pun, jadi "Acme-Digital"
    // dan "acme-digital" adalah dua partner berbeda bagi Postgres dan satu
    // partner bagi manusia yang membaca daftarnya.
    for (const bad of [
      "Acme-Digital",
      "acme digital",
      "-acme",
      "acme-",
      "acme_digital",
      ""
    ]) {
      expect(
        fieldsOf(validateRegisterPartnerInput(body({ partnerCode: bad })))
      ).toEqual(["partnerCode"]);
    }
  });

  test("partnerTenantId wajib uuid", () => {
    expect(
      fieldsOf(validateRegisterPartnerInput(body({ partnerTenantId: "acme" })))
    ).toEqual(["partnerTenantId"]);
  });

  test("displayName wajib ada", () => {
    expect(
      fieldsOf(validateRegisterPartnerInput(body({ displayName: "   " })))
    ).toEqual(["displayName"]);
  });

  test("`status` DIABAIKAN, tidak diterima — ia dipatok sampai ada pembacanya", () => {
    const result = validateRegisterPartnerInput(body({ status: "suspended" }));

    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(Object.keys(result.value).sort()).toEqual([
        "displayName",
        "partnerCode",
        "partnerTenantId"
      ]);
    }
  });

  test("setiap masalah dilaporkan sekaligus, bukan satu per satu", () => {
    expect(
      fieldsOf(
        validateRegisterPartnerInput({
          partnerTenantId: "x",
          partnerCode: "BAD",
          displayName: ""
        })
      ).sort()
    ).toEqual(["displayName", "partnerCode", "partnerTenantId"]);
  });
});

/** Tagged-template palsu: satu array baris per pemanggilan, berurutan. */
function recordingTx(rowsByCall: unknown[][]): {
  tx: Bun.SQL;
  statements: string[];
} {
  const statements: string[] = [];
  let call = 0;

  const tx = ((strings: TemplateStringsArray, ...args: unknown[]) => {
    statements.push(
      strings.raw
        .map((part, i) => part + (i < args.length ? "?" : ""))
        .join("")
        .replace(/\s+/g, " ")
        .trim()
    );
    const rows = rowsByCall[call] ?? [];
    call += 1;
    return Promise.resolve(rows);
  }) as unknown as Bun.SQL;

  return { tx, statements };
}

const PARTNER_ROW = {
  id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
  partner_tenant_id: PARTNER,
  partner_code: "acme-digital",
  display_name: "Acme Digital",
  status: "active",
  registered_at: new Date("2026-08-13T00:00:00.000Z"),
  tenant_code: "acme",
  tenant_name: "Acme Sdn Bhd"
};

describe("penulisannya, dibaca sebagai SQL", () => {
  test("INSERT tidak pernah menyebut `status`", async () => {
    const { tx, statements } = recordingTx([
      [{ id: PARTNER }],
      [{ id: PARTNER_ROW.id }],
      [PARTNER_ROW]
    ]);

    await registerPartner(tx, PLATFORM, {
      partnerTenantId: PARTNER,
      partnerCode: "acme-digital",
      displayName: "Acme Digital"
    });

    const insert = statements.find((s) => s.includes("INSERT INTO"))!;

    expect(insert).toContain("awcms_partners");
    // Kalau permukaan ini mulai menulis `status`, ia menulis satu-satunya nilai
    // yang CHECK izinkan — dan pada hari CHECK-nya dilebarkan, ia diam-diam
    // menjadi permukaan yang bisa men-suspend tanpa ada yang memutuskannya.
    expect(insert).not.toContain("status");
  });

  test("konflik diselesaikan TANPA membaca SQLSTATE dari driver", async () => {
    // Bun mengisi `error.code` dengan konstantanya sendiri untuk setiap error
    // server, jadi `code === "23505"` tidak pernah benar di repo ini; SQLSTATE
    // hidup di `errno`. `ON CONFLICT DO NOTHING` menghindari pertanyaannya
    // sekaligus menjaga transaksi tetap bisa dipakai untuk membedakan KEDUA
    // index unik globalnya.
    const { tx, statements } = recordingTx([
      [{ id: PARTNER }],
      [], // INSERT ... ON CONFLICT DO NOTHING → nol baris
      [{ tenant_taken: true }]
    ]);

    const result = await registerPartner(tx, PLATFORM, {
      partnerTenantId: PARTNER,
      partnerCode: "acme-digital",
      displayName: "Acme Digital"
    });

    expect(result.outcome).toBe("already_registered");
    expect(statements[1]).toContain("ON CONFLICT DO NOTHING");
  });

  test("kode terpakai dibedakan dari tenant terdaftar", async () => {
    const { tx } = recordingTx([
      [{ id: PARTNER }],
      [],
      [{ tenant_taken: false }]
    ]);

    const result = await registerPartner(tx, PLATFORM, {
      partnerTenantId: PARTNER,
      partnerCode: "acme-digital",
      displayName: "Acme Digital"
    });

    expect(result.outcome).toBe("code_taken");
  });

  test("pendaftaran diri sendiri ditolak SEBELUM menyentuh basis data", async () => {
    const { tx, statements } = recordingTx([]);

    const result = await registerPartner(tx, PLATFORM, {
      partnerTenantId: PLATFORM,
      partnerCode: "self",
      displayName: "Self"
    });

    expect(result.outcome).toBe("self");
    expect(statements).toEqual([]);
  });

  test("tenant yang tidak ada menjawab sendiri, bukan lewat 23503", async () => {
    const { tx } = recordingTx([[]]);

    const result = await registerPartner(tx, PLATFORM, {
      partnerTenantId: PARTNER,
      partnerCode: "acme-digital",
      displayName: "Acme Digital"
    });

    expect(result.outcome).toBe("tenant_not_found");
  });

  test("daftar disaring ke tenant platform DAN mengambil nama dari awcms_tenants", async () => {
    const { tx, statements } = recordingTx([[PARTNER_ROW]]);

    await listPartners(tx, PLATFORM);

    // Filter `tenant_id` ditulis meski RLS sudah melakukannya: query yang benar
    // hanya karena kebijakan basis data adalah query yang salah pada hari
    // seseorang menjalankannya sebagai role yang mem-bypass RLS.
    expect(statements[0]).toContain("WHERE p.tenant_id = ?");
    expect(statements[0]).toContain("JOIN awcms_tenants");
  });
});

describe("scope PLATFORM, dan seed yang menegakkannya", () => {
  test("kedua izin ber-scope platform, dibaca dari registry hidup", () => {
    resetPlatformScopeCacheForTests();

    expect(
      isPlatformScopedPermissionKey("identity_access.partner_registry.read")
    ).toBe(true);
    expect(
      isPlatformScopedPermissionKey("identity_access.partner_registry.create")
    ).toBe(true);
  });

  test("dan `partner_access` milik PELANGGAN tetap tenant-scoped", () => {
    resetPlatformScopeCacheForTests();

    // Pemisahan yang membuat ADR-0089 bekerja: tidak ada satu aktor pun yang
    // memegang kedua paruh. Kalau `partner_access.configure` ikut menjadi
    // platform, pelanggan kehilangan kendali atas siapa yang menjangkaunya.
    expect(
      isPlatformScopedPermissionKey("identity_access.partner_access.configure")
    ).toBe(false);
  });

  test("modul mendeklarasikan keduanya", () => {
    const declared = listModules().flatMap((module) =>
      (module.permissions ?? []).map(
        (permission) =>
          `${module.key}.${permission.activityCode}.${permission.action}`
      )
    );

    expect(declared).toContain("identity_access.partner_registry.read");
    expect(declared).toContain("identity_access.partner_registry.create");
  });

  test("seed menulis scope 'platform' dan grant-nya lewat awcms_setup_state", async () => {
    const migration = await Bun.file(MIGRATION).text();

    expect(migration).toContain("'platform'");
    // Bentuk yang terbaca "lebih rapi" — grant di atas `awcms_tenants` — adalah
    // cacat asli yang ADR-0053 tutup: ia memberi izin platform kepada SETIAP
    // owner tenant.
    expect(migration).toContain("FROM awcms_setup_state");
    expect(migration).not.toContain("FROM awcms_tenants");
  });
});

describe("rutenya", () => {
  test("kedua guard menyebut aktivitas registry, bukan partner_access", async () => {
    const source = await Bun.file(ROUTE).text();

    expect(source).toContain('activityCode: "partner_registry"');
    expect(source).toContain('action: "read"');
    expect(source).toContain('action: "create"');
  });

  test("tidak ada DELETE — barisnya target FK yang sengaja hidup lebih lama", async () => {
    // `awcms_partners.partner_tenant_id` direferensi keterlibatan DAN grant
    // terdelegasi, dan `sql/120` membuat grant sengaja hidup lebih lama dari
    // kemitraannya. DELETE akan gagal begitu satu kemitraan pernah ada, dan
    // "memperbaikinya" dengan ON DELETE CASCADE memutus setiap kemitraan di
    // instalasi.
    const source = await Bun.file(ROUTE).text();

    expect(source).not.toContain("export const DELETE");
  });
});
