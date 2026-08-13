/**
 * PENERBITAN kelas tulis — ADR-0092, tindak lanjut Gelombang 8 PR 8.5 (#423).
 *
 * `sql/121` membuka kelasnya di skema dan di chokepoint, dan sengaja tidak
 * memberinya permukaan. Berkas ini menjaga permukaan itu, dan tiga sifatnya
 * yang paling mudah hilang:
 *
 *   1. permintaan yang TIDAK menyebut kelas tulis harus menghasilkan persis
 *      kredensial ADR-0049 yang sama seperti sebelum kelas ini ada;
 *   2. kelas tulis digerbangi izin BERBEDA — kalau tidak, setiap peran yang
 *      hari ini memegang `machine_credentials.create` melebar sendiri pada hari
 *      perubahan ini dirilis, tanpa satu grant pun disunting;
 *   3. ada TIGA daftar kolom terpisah di lapisan aplikasinya, dan melewatkan
 *      satu membuat GET benar sementara POST mengembalikan `undefined`.
 *
 * Murni: tidak ada basis data. Pernyataan SQL-nya diperiksa dengan merekam
 * tagged-template, bukan dengan menjalankannya — pola `principal-mfa-store`.
 */
import { describe, expect, test } from "bun:test";

import { listModules } from "../src/modules";
import { isHighRiskAction } from "../src/modules/identity-access/domain/access-control";
import type { AccessAction } from "../src/modules/identity-access/domain/access-control";
import {
  MACHINE_CREDENTIAL_WRITE_ALLOWED_ACTIONS,
  MACHINE_CREDENTIAL_WRITE_MAX_LIFETIME_DAYS,
  isIpInAnyCidr,
  isValidIpCidr,
  validateIssueMachineCredentialInput
} from "../src/modules/identity-access/domain/machine-credential";
import {
  issueMachineCredential,
  listMachineCredentials,
  revokeMachineCredential
} from "../src/modules/identity-access/application/machine-credential-directory";

const ROUTE = "src/pages/api/v1/access/machine-credentials/index.ts";
const MIGRATION = "sql/122_awcms_identity_machine_credential_write_permissions.sql";

const NOW = new Date("2026-08-13T00:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;

/** Real uuids: the token generator refuses anything else, by design. */
const TENANT = "00000000-0000-4000-8000-000000000001";
const ACTOR = "99999999-8888-7777-6666-555555555555";

function body(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: "deploy hook",
    tenantUserId: "11111111-2222-3333-4444-555555555555",
    allowedPermissionKeys: ["blog_content.posts.create"],
    expiresAt: new Date(NOW.getTime() + 7 * DAY).toISOString(),
    ...overrides
  };
}

function validate(overrides: Record<string, unknown> = {}) {
  return validateIssueMachineCredentialInput(body(overrides), NOW);
}

/** Every field the validator complained about, as a set. */
function fieldsOf(result: ReturnType<typeof validate>): string[] {
  return result.valid ? [] : [...new Set(result.errors.map((e) => e.field))];
}

describe("permintaan yang tidak menyebut kelas tulis tidak berubah sama sekali", () => {
  test("field-nya absen → kedua daftar KOSONG, bukan undefined", () => {
    const result = validate();

    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.value.allowedWriteActions).toEqual([]);
      expect(result.value.allowedIpCidrs).toEqual([]);
    }
  });

  test("plafon umur kelas BACA tetap 365 hari untuknya", () => {
    // Kalau plafon 30 hari bocor ke kelas baca, setiap build feed yang ada
    // berhenti bisa diterbitkan ulang — regresi senyap dengan bentuk 422.
    const result = validate({
      expiresAt: new Date(NOW.getTime() + 300 * DAY).toISOString()
    });

    expect(result.valid).toBe(true);
  });
});

describe("aksi tulis diterima persis sebanyak plafon KODE", () => {
  test("setiap anggota plafon diterima — dihitung dari konstanta hidup", () => {
    for (const action of MACHINE_CREDENTIAL_WRITE_ALLOWED_ACTIONS) {
      const result = validate({
        allowedWriteActions: [action],
        allowedIpCidrs: ["203.0.113.0/24"]
      });

      expect(fieldsOf(result)).toEqual([]);
      if (result.valid) {
        expect(result.value.allowedWriteActions).toEqual([action]);
      }
    }
  });

  test("dan plafonnya tidak kosong — kalau tidak, asersi di atas hampa", () => {
    expect(MACHINE_CREDENTIAL_WRITE_ALLOWED_ACTIONS.size).toBeGreaterThan(0);
  });

  test("aksi high-risk ditolak, dan yang dipakai sebagai contoh MEMANG high-risk", () => {
    // Pasangan ini disengaja: tanpa asersi kedua, hari seseorang mengeluarkan
    // `delete` dari daftar high-risk membuat test pertama menguji apa-apa.
    expect(isHighRiskAction("delete" as AccessAction)).toBe(true);
    expect(
      fieldsOf(
        validate({
          allowedWriteActions: ["delete"],
          allowedIpCidrs: ["203.0.113.0/24"]
        })
      )
    ).toEqual(["allowedWriteActions"]);
  });

  test("`read` DITOLAK, dan pesannya menjelaskan kenapa alih-alih menyebutnya terlarang", () => {
    const result = validate({
      allowedWriteActions: ["read"],
      allowedIpCidrs: ["203.0.113.0/24"]
    });

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors[0]!.message).toContain("read is implicit");
    }
  });

  test("duplikat diringkas, bukan ditolak", () => {
    const result = validate({
      allowedWriteActions: ["create", "create"],
      allowedIpCidrs: ["203.0.113.5", "203.0.113.5"]
    });

    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.value.allowedWriteActions).toEqual(["create"]);
      expect(result.value.allowedIpCidrs).toEqual(["203.0.113.5"]);
    }
  });
});

describe("ikatan IP — dua arah, dan arah kedua tidak dijaga apa pun selain ini", () => {
  test("kelas tulis TANPA CIDR ditolak, mencerminkan CHECK sql/121", () => {
    expect(fieldsOf(validate({ allowedWriteActions: ["create"] }))).toEqual([
      "allowedIpCidrs"
    ]);
  });

  test("CIDR pada kredensial BACA ditolak — ia tidak akan pernah dikonsultasi", () => {
    // Arah yang tidak dijaga basis data maupun gerbang runtime.
    // `isMachineCredentialWriteRefused` menjawab `false` untuk `read` SEBELUM
    // menyentuh daftar CIDR, jadi menyimpannya menggambarkan ikatan yang tidak
    // ditegakkan. Ditolak, bukan dibuang diam-diam: membuangnya tetap
    // meninggalkan operator yang mengira ia mengikatnya.
    expect(fieldsOf(validate({ allowedIpCidrs: ["203.0.113.0/24"] }))).toEqual([
      "allowedIpCidrs"
    ]);
  });

  test("CIDR yang tidak bisa di-parse ditolak DI PENERBITAN", () => {
    for (const bad of ["not-a-cidr", "10.0.0.0/33", "10.0.0.0/", "999.0.0.1"]) {
      expect(
        fieldsOf(
          validate({ allowedWriteActions: ["create"], allowedIpCidrs: [bad] })
        )
      ).toEqual(["allowedIpCidrs"]);
    }
  });

  test("apa pun yang DITERIMA penerbitan bisa dicocokkan penegakan", () => {
    // Sifat yang menghubungkan kedua fungsi. Kalau penerbitan menerima sesuatu
    // yang `isIpInAnyCidr` tak pernah cocokkan, hasilnya kredensial yang
    // terbaca terikat dan tidak pernah bisa lolos — kegagalan yang baru
    // terlihat pada request pertama.
    const accepted = [
      ["203.0.113.7", "203.0.113.7"],
      ["203.0.113.0/24", "203.0.113.9"],
      ["10.0.0.0/8", "10.255.255.254"],
      ["2001:db8::/32", "2001:db8::5"],
      ["::1", "::1"]
    ] as const;

    for (const [entry, inside] of accepted) {
      expect(isValidIpCidr(entry)).toBe(true);
      expect(
        validate({ allowedWriteActions: ["create"], allowedIpCidrs: [entry] })
          .valid
      ).toBe(true);
      expect(isIpInAnyCidr(inside, [entry])).toBe(true);
    }
  });

  test("`/0` diterima — melebarkan adalah keputusan operator, bukan kecelakaan parser", () => {
    expect(isValidIpCidr("0.0.0.0/0")).toBe(true);
    // Tetapi `10.0.0.0/` BUKAN `/0`. Suffix kosong dulu lolos `Number("") === 0`
    // dan akan mengubah salah ketik menjadi "seluruh internet".
    expect(isValidIpCidr("10.0.0.0/")).toBe(false);
  });

  test("entri di-trim sebelum disimpan, karena pencocoknya tidak men-trim prefix", () => {
    const result = validate({
      allowedWriteActions: ["create"],
      allowedIpCidrs: ["  203.0.113.0/24  "]
    });

    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.value.allowedIpCidrs).toEqual(["203.0.113.0/24"]);
    }
  });
});

describe("umur kelas tulis", () => {
  test("melebihi plafon ditolak, dan pesannya menyebut kelasnya", () => {
    const result = validate({
      allowedWriteActions: ["create"],
      allowedIpCidrs: ["203.0.113.0/24"],
      expiresAt: new Date(
        NOW.getTime() + (MACHINE_CREDENTIAL_WRITE_MAX_LIFETIME_DAYS + 1) * DAY
      ).toISOString()
    });

    expect(fieldsOf(result)).toEqual(["expiresAt"]);
    if (!result.valid) {
      expect(result.errors[0]!.message).toContain("can write");
    }
  });

  test("tepat di bawah plafon diterima", () => {
    expect(
      validate({
        allowedWriteActions: ["create"],
        allowedIpCidrs: ["203.0.113.0/24"],
        expiresAt: new Date(
          NOW.getTime() + (MACHINE_CREDENTIAL_WRITE_MAX_LIFETIME_DAYS - 1) * DAY
        ).toISOString()
      }).valid
    ).toBe(true);
  });
});

/**
 * Merekam tagged-template sebagai `Bun.SQL` — pernyataannya diperiksa sebagai
 * teks, tanpa Postgres. Baris yang sama dikembalikan untuk setiap query, yang
 * cukup: pencarian service account hanya butuh `id`, dan RETURNING butuh
 * bentuk baris penuh.
 */
function recordingTx(rows: unknown[]): { tx: Bun.SQL; statements: string[] } {
  const statements: string[] = [];

  const tx = ((strings: TemplateStringsArray, ...args: unknown[]) => {
    statements.push(
      strings.raw
        .map((part, i) => part + (i < args.length ? "?" : ""))
        .join("")
        .replace(/\s+/g, " ")
        .trim()
    );
    return Promise.resolve(rows);
  }) as unknown as Bun.SQL;

  return { tx, statements };
}

const ROW = {
  id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
  name: "deploy hook",
  tenant_user_id: "11111111-2222-3333-4444-555555555555",
  allowed_permission_keys: ["blog_content.posts.create"],
  allowed_write_actions: ["create"],
  allowed_ip_cidrs: ["203.0.113.0/24"],
  expires_at: new Date(NOW.getTime() + 7 * DAY),
  last_used_at: null,
  revoked_at: null,
  created_by_tenant_user_id: "99999999-8888-7777-6666-555555555555",
  created_at: NOW
};

describe("TIGA daftar kolom, dan tidak satu pun boleh terlewat", () => {
  test("penerbitan, daftar, dan pencabutan semuanya memproyeksikan kedua kolom", async () => {
    // Trap yang dijaga di sini: melewatkan satu daftar membuat GET benar
    // sementara POST/revoke mengembalikan `undefined` untuk field baru — dan
    // test yang hanya memeriksa daftar tidak akan pernah melihatnya.
    const calls: [string, (tx: Bun.SQL) => Promise<unknown>][] = [
      ["list", (tx) => listMachineCredentials(tx, TENANT, NOW)],
      [
        "issue",
        (tx) =>
          issueMachineCredential(
            tx,
            TENANT,
            ACTOR,
            {
              name: "deploy hook",
              tenantUserId: ROW.tenant_user_id,
              allowedPermissionKeys: ["blog_content.posts.create"],
              allowedWriteActions: ["create"],
              allowedIpCidrs: ["203.0.113.0/24"],
              expiresAt: ROW.expires_at
            },
            NOW
          )
      ],
      ["revoke", (tx) => revokeMachineCredential(tx, TENANT, ROW.id, ACTOR, NOW)]
    ];

    for (const [label, call] of calls) {
      const { tx, statements } = recordingTx([ROW]);
      await call(tx);

      const projecting = statements.filter(
        (s) => s.includes("SELECT") || s.includes("RETURNING")
      );
      const withColumns = projecting.filter(
        (s) =>
          s.includes("allowed_write_actions") && s.includes("allowed_ip_cidrs")
      );

      expect(`${label}: ${withColumns.length}`).toBe(`${label}: 1`);
    }
  });

  test("penerbitan MENULIS kedua kolom, dirender sebagai text[]", async () => {
    const { tx, statements } = recordingTx([ROW]);

    await issueMachineCredential(
      tx,
      TENANT,
      ACTOR,
      {
        name: "deploy hook",
        tenantUserId: ROW.tenant_user_id,
        allowedPermissionKeys: ["blog_content.posts.create"],
        allowedWriteActions: ["create"],
        allowedIpCidrs: ["203.0.113.0/24"],
        expiresAt: ROW.expires_at
      },
      NOW
    );

    const insert = statements.find((s) => s.includes("INSERT INTO"))!;

    expect(insert).toContain("allowed_write_actions");
    expect(insert).toContain("allowed_ip_cidrs");
    // Bun.SQL tidak mem-bind array JS: `${array}` tiba sebagai teks
    // gabung-koma dan Postgres menolaknya (22P02). Cast-nya adalah kontraknya.
    expect(insert.match(/::text\[\]/g)?.length).toBe(3);
  });

  test("dan tetap tidak MEMINTA material rahasia", async () => {
    const { tx, statements } = recordingTx([ROW]);
    await listMachineCredentials(tx, TENANT, NOW);

    // Bukan sekadar "tidak mengembalikannya" — tidak MEMINTANYA.
    expect(statements[0]).not.toContain("token_hash");
  });
});

describe("izin terpisah, dan ia benar-benar ada", () => {
  test("rute memilih activityCode dari ADA-TIDAKNYA aksi tulis", async () => {
    const source = await Bun.file(ROUTE).text();

    // Diiris ke blok `authorize:` lebih dulu. Berkas ini juga menulis baris
    // audit, dan asersi se-berkas atas nama izin akan mencampur keduanya —
    // kegagalan yang persis dialami test kontrak `/admin/partners`.
    const start = source.indexOf("  authorize: ({ prepared })");
    const guard = source.slice(start, source.indexOf("  handler:", start));

    expect(start).toBeGreaterThan(-1);
    expect(guard).toContain("prepared.allowedWriteActions.length > 0");
    expect(guard).toContain('"machine_credentials_write"');
    expect(guard).toContain('"machine_credentials"');
    expect(guard).toContain('action: "create"');
  });

  test("izinnya DIDEKLARASIKAN sebuah modul — kalau tidak, tak ada peran bisa memegangnya", () => {
    const declared = listModules().flatMap((module) =>
      (module.permissions ?? []).map(
        (permission) =>
          `${module.key}.${permission.activityCode}.${permission.action}`
      )
    );

    expect(declared).toContain(
      "identity_access.machine_credentials_write.create"
    );
  });

  test("dan DISEED — aksi yang tak diseed menolak owner secara senyap", async () => {
    // Katalog izin bersifat global dan hanya bertambah lewat migrasi. Sebuah
    // deklarasi modul tanpa baris katalognya adalah izin yang tidak bisa
    // diberikan siapa pun, dan gejalanya 403 yang tidak bisa dijelaskan.
    const migration = await Bun.file(MIGRATION).text();

    expect(migration).toContain("'machine_credentials_write'");
    expect(migration).toContain("'identity_access'");
    expect(migration).toContain("ON CONFLICT");
  });

  test("kelas BACA tetap di izin lamanya — kalau tidak, ini pelebaran senyap", async () => {
    const source = await Bun.file(ROUTE).text();
    const start = source.indexOf("  authorize: ({ prepared })");
    const guard = source.slice(start, source.indexOf("  handler:", start));

    // Cabang yang dipilih ketika daftar aksi tulis KOSONG harus tetap
    // `machine_credentials`. Kalau keduanya menjadi `machine_credentials_write`
    // setiap penerbit read-only yang ada kehilangan aksesnya; kalau keduanya
    // menjadi `machine_credentials`, setiap penerbit read-only yang ada
    // MENDAPAT hak mencetak kredensial tulis. Dua arah, satu asersi.
    const writeAt = guard.indexOf('? "machine_credentials_write"');
    const readAt = guard.indexOf(': "machine_credentials",');

    expect(writeAt).toBeGreaterThan(-1);
    expect(readAt).toBeGreaterThan(writeAt);
  });
});

describe("jejak audit membedakan kedua kelas", () => {
  test("severity dan atribut ikut kelasnya", async () => {
    const source = await Bun.file(ROUTE).text();

    expect(source).toContain("severity: writeClass ?");
    expect(source).toContain('"critical"');
    expect(source).toContain("allowedWriteActions: result.credential.allowedWriteActions");
    expect(source).toContain("allowedIpCidrs: result.credential.allowedIpCidrs");
  });

  test("dan token-nya tetap TIDAK ada di sana", async () => {
    const source = await Bun.file(ROUTE).text();
    const auditAt = source.indexOf("recordAuditEvent(tx, {");
    const audit = source.slice(auditAt, source.indexOf("});", auditAt));

    expect(auditAt).toBeGreaterThan(-1);
    expect(audit).not.toContain("result.token");
  });
});
