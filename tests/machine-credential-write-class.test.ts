/**
 * Kelas TULIS kredensial mesin — ADR-0092, Gelombang 8 PR 8.5 (#423).
 *
 * Satu asersi di berkas ini lebih penting dari sisanya, dan ia dihitung dari
 * KONSTANTA HIDUP alih-alih ditulis sebagai daftar:
 *
 *     MACHINE_CREDENTIAL_WRITE_ALLOWED_ACTIONS ∩ HIGH_RISK_ACTIONS = ∅
 *
 * Daftar literal "yang high-risk" akan menyimpang pada hari seseorang menambah
 * aksi high-risk baru — dan menyimpang DIAM-DIAM, karena tidak ada yang
 * memerah. Menurunkannya tidak bisa.
 *
 * Murni: tidak ada basis data.
 */
import { describe, expect, test } from "bun:test";

import { isHighRiskAction } from "../src/modules/identity-access/domain/access-control";
import {
  MACHINE_CREDENTIAL_ALLOWED_ACTIONS,
  MACHINE_CREDENTIAL_MAX_LIFETIME_DAYS,
  MACHINE_CREDENTIAL_WRITE_ALLOWED_ACTIONS,
  MACHINE_CREDENTIAL_WRITE_MAX_LIFETIME_DAYS,
  isIpInAnyCidr,
  isMachineCredentialWriteRefused
} from "../src/modules/identity-access/domain/machine-credential";

const IP_ONLY = ["203.0.113.10/32"] as const;

function refuse(
  overrides: Partial<Parameters<typeof isMachineCredentialWriteRefused>[0]> = {}
) {
  return isMachineCredentialWriteRefused({
    action: "create",
    allowedWriteActions: ["create"],
    allowedIpCidrs: [...IP_ONLY],
    clientIp: "203.0.113.10",
    ...overrides
  });
}

describe("plafon tulis TIDAK PERNAH memuat aksi high-risk", () => {
  test("irisannya kosong, dihitung dari konstanta hidup", () => {
    const overlap = [...MACHINE_CREDENTIAL_WRITE_ALLOWED_ACTIONS].filter(
      (action) => isHighRiskAction(action)
    );

    expect(overlap).toEqual([]);
  });

  test("dan plafonnya tidak kosong — kalau tidak, asersi di atas hampa", () => {
    expect(MACHINE_CREDENTIAL_WRITE_ALLOWED_ACTIONS.size).toBeGreaterThan(0);
  });

  test("`read` tetap milik kelas BACA, bukan kelas tulis", () => {
    expect([...MACHINE_CREDENTIAL_ALLOWED_ACTIONS]).toEqual(["read"]);
    expect(MACHINE_CREDENTIAL_WRITE_ALLOWED_ACTIONS.has("read")).toBe(false);
  });

  test("kredensial tulis hidup jauh lebih pendek daripada kredensial baca", () => {
    expect(MACHINE_CREDENTIAL_WRITE_MAX_LIFETIME_DAYS).toBeLessThan(
      MACHINE_CREDENTIAL_MAX_LIFETIME_DAYS
    );
    // Plafon basis datanya 31 hari (`sql/121`); aturannya harus lebih ketat,
    // dengan alasan `created_at` DEFAULT now() yang sama seperti `sql/117`.
    expect(MACHINE_CREDENTIAL_WRITE_MAX_LIFETIME_DAYS).toBeLessThan(31);
  });
});

describe("penolakan tulis — deny-only, dan tiga penolakannya", () => {
  test("`read` tidak pernah tersentuh aturan ini", () => {
    expect(
      isMachineCredentialWriteRefused({
        action: "read",
        allowedWriteActions: [],
        allowedIpCidrs: [],
        clientIp: undefined
      })
    ).toBe(false);
  });

  test("aksi di luar plafon KODE ditolak meski kolomnya menamainya", () => {
    // Ini kasus yang menjadi seluruh alasan plafonnya ada di kode: sebuah baris
    // yang mengklaim `delete` — lewat restore backup, INSERT tangan, atau jalur
    // provisioning yang kehilangan `WHERE` — tetap tidak bisa apa-apa.
    expect(refuse({ action: "delete", allowedWriteActions: ["delete"] })).toBe(
      true
    );
  });

  test("aksi dalam plafon kode tapi TIDAK di kolomnya ditolak", () => {
    expect(refuse({ action: "update", allowedWriteActions: ["create"] })).toBe(
      true
    );
  });

  test("aksi yang ada di keduanya, dari IP yang cocok, TIDAK ditolak", () => {
    expect(refuse()).toBe(false);
  });
});

describe("kondisi IP fail-closed", () => {
  test("clientIp yang TIDAK TERSEDIA menolak", () => {
    // Rute yang belum meneruskan alamat pemanggil harus menghasilkan 403, bukan
    // diam-diam mematikan kondisinya.
    expect(refuse({ clientIp: undefined })).toBe(true);
  });

  test("IP di luar allow-list menolak", () => {
    expect(refuse({ clientIp: "198.51.100.7" })).toBe(true);
  });

  test("daftar CIDR KOSONG pada kredensial tulis menolak", () => {
    // `sql/121` melarang baris seperti ini; kalau ia tetap muncul (baris
    // pra-kelas yang disunting tangan), ia tidak boleh bisa menulis.
    expect(refuse({ allowedIpCidrs: [] })).toBe(true);
  });
});

describe("pencocokan CIDR", () => {
  test("IPv4 exact dan prefix", () => {
    expect(isIpInAnyCidr("10.1.2.3", ["10.1.2.3"])).toBe(true);
    expect(isIpInAnyCidr("10.1.2.3", ["10.1.2.0/24"])).toBe(true);
    expect(isIpInAnyCidr("10.1.3.3", ["10.1.2.0/24"])).toBe(false);
    expect(isIpInAnyCidr("10.1.2.3", ["10.0.0.0/8"])).toBe(true);
  });

  test("batas prefix non-byte dihitung benar", () => {
    expect(isIpInAnyCidr("192.168.1.130", ["192.168.1.128/25"])).toBe(true);
    expect(isIpInAnyCidr("192.168.1.127", ["192.168.1.128/25"])).toBe(false);
  });

  test("`/0` mencocokkan segalanya — dan itu keputusan operator, bukan kecelakaan parser", () => {
    expect(isIpInAnyCidr("203.0.113.1", ["0.0.0.0/0"])).toBe(true);
  });

  test("IPv6, termasuk bentuk terkompresi", () => {
    expect(isIpInAnyCidr("2001:db8::1", ["2001:db8::/32"])).toBe(true);
    expect(isIpInAnyCidr("2001:db9::1", ["2001:db8::/32"])).toBe(false);
    expect(isIpInAnyCidr("::1", ["::1"])).toBe(true);
  });

  test("keluarga yang berbeda tidak pernah cocok", () => {
    expect(isIpInAnyCidr("10.0.0.1", ["::/0"])).toBe(false);
    expect(isIpInAnyCidr("::1", ["0.0.0.0/0"])).toBe(false);
  });

  test("input yang tidak bisa di-parse MENYEMPIT ke nol, tidak pernah melebar", () => {
    // Arahnya disengaja: CIDR rusak di baris kredensial harus tidak cocok
    // apa-apa, bukan cocok segalanya.
    expect(isIpInAnyCidr("10.0.0.1", ["not-a-cidr"])).toBe(false);
    expect(isIpInAnyCidr("10.0.0.1", ["10.0.0.0/99"])).toBe(false);
    expect(isIpInAnyCidr("10.0.0.1", ["10.0.0.0/-1"])).toBe(false);
    expect(isIpInAnyCidr("999.0.0.1", ["0.0.0.0/0"])).toBe(false);
    expect(isIpInAnyCidr("", ["0.0.0.0/0"])).toBe(false);
  });
});

describe("gerbangnya, dan sentinel yang dipertahankan", () => {
  test("dua sentinel, dan yang lama VERBATIM", async () => {
    const source = await Bun.file(
      "src/modules/identity-access/application/access-guard.ts"
    ).text();

    // `machine_credential_readonly` ada di sejarah decision log dan di
    // ADR-0049. Mendaur ulangnya untuk penolakan tulis akan menulis ulang masa
    // lalu bagi setiap konsumen log.
    expect(source).toContain('"machine_credential_readonly"');
    expect(source).toContain('"machine_credential_write_forbidden"');
  });

  test("gerbangnya berjalan SEBELUM permission diambil", async () => {
    const source = await Bun.file(
      "src/modules/identity-access/application/access-guard.ts"
    ).text();
    const body = source.slice(
      source.indexOf("export async function authorizeInTransaction")
    );

    const gateAt = body.indexOf("isMachineCredentialWriteRefused");
    const fetchAt = body.indexOf("const accountPermissionKeys =");

    expect(gateAt).toBeGreaterThan(-1);
    expect(fetchAt).toBeGreaterThan(-1);
    expect(gateAt).toBeLessThan(fetchAt);
  });

  test("factory rute meneruskan clientIp di KEDUA jalurnya", async () => {
    // Satu jalur yang terlewat berarti sekelas rute yang diam-diam mematikan
    // kondisi IP — kontrol yang terbaca sebagai ditegakkan dan tidak.
    const source = await Bun.file("src/modules/_shared/tenant-route.ts").text();

    const calls = source.split("authorizeInTransaction(").length - 1;
    const withIp = source.split("clientIp").length - 1;

    expect(calls).toBeGreaterThan(1);
    expect(withIp).toBeGreaterThanOrEqual(calls);
  });
});
