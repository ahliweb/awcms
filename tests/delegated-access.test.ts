/**
 * Akses terdelegasi — ADR-0090, Gelombang 8 PR 8.2 (#423).
 *
 * Tiga hal yang dijaga di sini, dan hanya yang pertama yang bisa dilihat test
 * perilaku biasa:
 *
 *   1. aturan deny-only itu sendiri, murni;
 *   2. bahwa gerbangnya berada DI ATAS `fetchGrantedPermissionKeys` — klaim
 *      urutan, jadi wajib di level source (aturan lintas-gelombang 4);
 *   3. bahwa KEDUA resolver konteks mengisi `principal_kind` — kalau salah satu
 *      berhenti, gerbangnya diam-diam berhenti berlaku untuk jalur itu, yang
 *      persis kelas kegagalan yang menghasilkan ADR-0079.
 *
 * Murni: tidak ada basis data.
 */
import { describe, expect, test } from "bun:test";

import {
  DELEGATED_ACCESS_MAX_TTL_DAYS,
  isDelegatedWriteForbidden,
  validateDelegatedGrantTtl
} from "../src/modules/identity-access/domain/delegated-access";
import {
  DELEGATED_ACCESS_CODE_PREFIX,
  DELEGATED_ACCESS_HASH_PREFIX,
  generateDelegatedAccessCode,
  hashDelegatedAccessCode,
  isDelegatedAccessCodeHash
} from "../src/lib/auth/delegated-access-code";
import {
  generateSessionToken,
  hashSessionToken
} from "../src/lib/auth/session-token";
import { NON_SWITCHABLE_ORIGIN_AUTH } from "../src/modules/identity-access/application/mfa-session-assurance";
import { authorizeInTransaction } from "../src/modules/identity-access/application/access-guard";

const GUARD_SOURCE = "src/modules/identity-access/application/access-guard.ts";
const AUTH_CONTEXT_SOURCE =
  "src/modules/identity-access/application/auth-context.ts";

describe("aturan deny-only: di identity_access, aktor terdelegasi hanya membaca", () => {
  test("anggota biasa tidak pernah tersentuh", () => {
    for (const action of ["read", "create", "update", "delete", "configure"]) {
      expect(
        isDelegatedWriteForbidden({
          principalKind: "user",
          moduleKey: "identity_access",
          action
        })
      ).toBe(false);
    }
  });

  test("aktor terdelegasi boleh membaca identity_access", () => {
    expect(
      isDelegatedWriteForbidden({
        principalKind: "delegated",
        moduleKey: "identity_access",
        action: "read"
      })
    ).toBe(false);
  });

  test("aktor terdelegasi ditolak untuk setiap tulis di identity_access", () => {
    // Termasuk aksi yang BELUM ADA. Itu maksud dari aturan berbentuk satu
    // kalimat: aktivitas baru di modul ini lahir tertutup, bukan lahir terbuka
    // lalu menunggu seseorang ingat menambahkannya ke sebuah daftar.
    for (const action of [
      "create",
      "update",
      "delete",
      "assign",
      "configure",
      "an_action_nobody_has_written_yet"
    ]) {
      expect(
        isDelegatedWriteForbidden({
          principalKind: "delegated",
          moduleKey: "identity_access",
          action
        })
      ).toBe(true);
    }
  });

  test("modul lain tidak disentuh aturan ini — role pilihan pelanggan yang membatasinya", () => {
    for (const moduleKey of ["blog", "media_library", "tenant_admin"]) {
      expect(
        isDelegatedWriteForbidden({
          principalKind: "delegated",
          moduleKey,
          action: "delete"
        })
      ).toBe(false);
    }
  });
});

describe("TTL grant", () => {
  test("kedaluwarsa di masa lalu ditolak", () => {
    const now = new Date("2026-08-13T00:00:00Z");
    expect(validateDelegatedGrantTtl(now, now)).toEqual({
      ok: false,
      reason: "expires_in_the_past"
    });
  });

  test("tepat di plafon diterima, sedetik di atasnya tidak", () => {
    const now = new Date("2026-08-13T00:00:00Z");
    const cap = DELEGATED_ACCESS_MAX_TTL_DAYS * 24 * 60 * 60 * 1000;

    expect(
      validateDelegatedGrantTtl(now, new Date(now.getTime() + cap))
    ).toEqual({
      ok: true
    });
    expect(
      validateDelegatedGrantTtl(now, new Date(now.getTime() + cap + 1000))
    ).toEqual({ ok: false, reason: "exceeds_max_ttl" });
  });

  test("plafon aplikasi lebih ketat dari plafon basis data", () => {
    // `sql/117` memaksa 31 hari; aturannya 30. Selisihnya ada karena
    // `created_at` DEFAULT now() adalah instant MULAI TRANSAKSI — CHECK "tepat
    // 30 hari" akan menolak baris yang benar-benar normal.
    expect(DELEGATED_ACCESS_MAX_TTL_DAYS).toBeLessThan(31);
  });
});

describe("kode penebusan adalah bearer yang gerbangnya TOLAK", () => {
  function forbiddenTx(): Bun.SQL {
    return ((strings: TemplateStringsArray) => {
      throw new Error(
        `gerbang menanyai basis data untuk kode terdelegasi: ${strings.join("?")}`
      );
    }) as unknown as Bun.SQL;
  }

  test("hash-nya punya namespace sendiri, dan `hashSessionToken` mengarahkannya ke sana", () => {
    const code = generateDelegatedAccessCode();

    expect(code.startsWith(DELEGATED_ACCESS_CODE_PREFIX)).toBe(true);
    expect(hashDelegatedAccessCode(code)).toStartWith(
      DELEGATED_ACCESS_HASH_PREFIX
    );
    expect(hashSessionToken(code)).toBe(hashDelegatedAccessCode(code));
  });

  test("token sesi biasa tidak pernah mendarat di namespace itu", () => {
    for (let i = 0; i < 200; i += 1) {
      const token = generateSessionToken();

      expect(token.startsWith(DELEGATED_ACCESS_CODE_PREFIX)).toBe(false);
      expect(isDelegatedAccessCodeHash(hashSessionToken(token))).toBe(false);
    }
  });

  test("gerbang menolaknya 401 tanpa satu query pun", async () => {
    const result = await authorizeInTransaction(
      forbiddenTx(),
      "11111111-1111-4111-8111-111111111111",
      hashDelegatedAccessCode(generateDelegatedAccessCode()),
      new Date(),
      { moduleKey: "identity_access", activityCode: "users", action: "read" }
    );

    expect(result.allowed).toBe(false);
    if (result.allowed) return;
    expect(result.denied.status).toBe(401);
  });
});

describe("klaim URUTAN dan klaim PEMBACA — dipin di level source", () => {
  test("penolakan terdelegasi berada DI ATAS `fetchGrantedPermissionKeys`", async () => {
    const source = await Bun.file(GUARD_SOURCE).text();
    const body = source.slice(
      source.indexOf("export async function authorizeInTransaction")
    );

    const gateAt = body.indexOf("delegated_access_forbidden");
    const fetchAt = body.indexOf("const accountPermissionKeys =");

    // Rename-proof: keduanya wajib ADA, kalau tidak `-1 < n` akan lulus hampa.
    expect(gateAt).toBeGreaterThan(-1);
    expect(fetchAt).toBeGreaterThan(-1);
    expect(gateAt).toBeLessThan(fetchAt);
  });

  test("KEDUA resolver konteks memilih `principal_kind`", async () => {
    // Ini asersi yang menjaga gerbangnya tetap ada artinya. `principalKind`
    // opsional dan absennya terbaca `"user"`, jadi resolver yang berhenti
    // memilih kolomnya membuat setiap aktor terdelegasi lewat jalur itu tampak
    // seperti anggota biasa — hijau di setiap test perilaku.
    const source = await Bun.file(AUTH_CONTEXT_SOURCE).text();

    const bySession = source.slice(
      source.indexOf("export async function resolveTenantPrincipal("),
      source.indexOf("export async function isModuleAvailable") + 1 ||
        source.length
    );
    const byTenantUser = source.slice(
      source.indexOf(
        "export async function resolveTenantPrincipalForTenantUser("
      ),
      source.indexOf("export async function resolveTenantContext(")
    );

    expect(byTenantUser).toContain("tu.principal_kind");
    expect(byTenantUser).toContain("principalKind:");
    expect(bySession).toContain("tu.principal_kind");
    expect(bySession).toContain("principalKind:");
  });
});

describe("sesi terdelegasi tidak boleh berpindah tenant", () => {
  test("`delegated` ada di daftar non-switchable, bersama sso dan handoff", () => {
    expect([...NON_SWITCHABLE_ORIGIN_AUTH].sort()).toEqual([
      "delegated",
      "handoff",
      "sso"
    ]);
  });

  test("`password` dan `switch` TIDAK ada di sana", () => {
    // Keduanya berakar pada kredensial GLOBAL, yang justru satu-satunya hal
    // yang membuat perpindahan aman.
    expect(NON_SWITCHABLE_ORIGIN_AUTH).not.toContain("password");
    expect(NON_SWITCHABLE_ORIGIN_AUTH).not.toContain("switch");
  });

  test("rute switch membaca daftar itu, bukan mengejanya sendiri", async () => {
    const source = await Bun.file(
      "src/pages/api/v1/auth/session/switch.ts"
    ).text();

    expect(source).toContain("NON_SWITCHABLE_ORIGIN_AUTH");
    // Ejaan inline yang lama tidak boleh hidup berdampingan dengan daftarnya —
    // dua sumber kebenaran, dan yang satu akan menua.
    expect(source).not.toContain('source.originAuth === "sso"');
  });
});
