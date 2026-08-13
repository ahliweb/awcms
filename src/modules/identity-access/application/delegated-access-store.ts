/**
 * Siklus hidup grant akses terdelegasi — ADR-0090, Gelombang 8 PR 8.2 (#423).
 *
 * Empat operasi, dan ketiga yang mengubah keanggotaan menulis SEMUANYA di
 * transaksi pemanggil:
 *
 *   approve  → baris grant + kode penebusan sekali-pakai
 *   redeem   → identity + tenant user (`principal_kind = 'delegated'`) + role
 *   revoke   → grant mati, keanggotaannya nonaktif, sesinya dicabut
 *   expire   → sama, tanpa aktor manusia
 *
 * ## Mengapa "di transaksi yang sama" bukan detail
 *
 * `setTenantUserStatus` sudah menetapkan bentuknya: penonaktifan yang commit
 * sementara pencabutan sesinya gagal meninggalkan sesi hidup untuk akun yang
 * baru saja diputuskan seseorang untuk ditutup. Di sini taruhannya lebih besar,
 * karena akun itu milik ORGANISASI LAIN.
 *
 * ## Mendarat inert
 *
 * Belum ada rute yang memanggil satu pun fungsi di bawah. Permukaannya PR 8.4.
 * Yang mendarat sekarang adalah bentuknya, gerbangnya, dan skema yang
 * menegakkan keduanya — supaya PR yang menambahkan permukaan tidak juga
 * menambahkan model datanya.
 */
import {
  generateDelegatedAccessCode,
  hashDelegatedAccessCode
} from "../../../lib/auth/delegated-access-code";
import {
  DELEGATED_ACCESS_CODE_TTL_SEC,
  validateDelegatedGrantTtl
} from "../domain/delegated-access";
import { materializeMembership } from "./membership-materialization";
import { findPrincipalById } from "./principal-store";
import { revokeAllSessionsForIdentity } from "./session-revocation";

export type ApproveDelegatedAccessInput = {
  partnerTenantId: string;
  roleId: string;
  approvedByTenantUserId: string;
  purpose: string;
  expiresAt: Date;
};

export type ApproveDelegatedAccessResult =
  | {
      ok: true;
      grantId: string;
      /** Diberikan SEKALI. Hanya hash-nya yang tersimpan. */
      accessCode: string;
      codeExpiresAt: Date;
    }
  | { ok: false; code: "TTL_IN_THE_PAST" | "TTL_TOO_LONG" | "NO_ENGAGEMENT" };

/**
 * Pelanggan menyetujui jangkauan seorang partner ke tenantnya sendiri.
 *
 * FK ke `awcms_roles` menolak role dari tenant lain, dan predikat `WHERE
 * EXISTS` di bawah menolak grant tanpa kemitraan hidup — keduanya di basis
 * data, keduanya tak bisa dilewati penulis kedua yang lupa.
 */
export async function approveDelegatedAccess(
  tx: Bun.SQL,
  tenantId: string,
  now: Date,
  input: ApproveDelegatedAccessInput
): Promise<ApproveDelegatedAccessResult> {
  const ttl = validateDelegatedGrantTtl(now, input.expiresAt);
  if (!ttl.ok) {
    return {
      ok: false,
      code:
        ttl.reason === "expires_in_the_past"
          ? "TTL_IN_THE_PAST"
          : "TTL_TOO_LONG"
    };
  }

  const accessCode = generateDelegatedAccessCode();
  const codeExpiresAt = new Date(
    now.getTime() + DELEGATED_ACCESS_CODE_TTL_SEC * 1000
  );

  // `INSERT … SELECT … WHERE EXISTS`, not a SELECT followed by an INSERT.
  //
  // The engagement must exist AT THE MOMENT the grant is written, and a check
  // that precedes the INSERT is a TOCTOU: the customer can sever the
  // partnership between the two statements and still end up with a grant. A
  // predicate inside the same statement cannot be raced — no engagement means
  // ZERO ROWS rather than a wrong row.
  //
  // `sql/120` moved the FK off the engagement and onto the partner REGISTRY, so
  // this predicate is now the only thing enforcing "no grant without a live
  // partnership" — and it is enforced by the database, not by TypeScript.
  const rows = (await tx`
    INSERT INTO awcms_delegated_access_grants
      (tenant_id, partner_tenant_id, role_id, approved_by_tenant_user_id,
       purpose, access_code_hash, expires_at)
    SELECT ${tenantId}, ${input.partnerTenantId}, ${input.roleId},
           ${input.approvedByTenantUserId}, ${input.purpose},
           ${hashDelegatedAccessCode(accessCode)}, ${input.expiresAt}
    WHERE EXISTS (
      SELECT 1 FROM awcms_partner_managed_tenants
      WHERE tenant_id = ${tenantId}
        AND partner_tenant_id = ${input.partnerTenantId}
    )
    RETURNING id
  `) as { id: string }[];

  const grantId = rows[0]?.id;
  if (!grantId) return { ok: false, code: "NO_ENGAGEMENT" };

  return {
    ok: true,
    grantId,
    accessCode,
    codeExpiresAt
  };
}

export type RedeemDelegatedAccessResult =
  | { ok: true; grantId: string; tenantUserId: string; roleId: string }
  | { ok: false; code: "CODE_INVALID" | "GRANT_EXPIRED" }
  | {
      ok: false;
      code: "MEMBERSHIP_REFUSED";
      /** `identifier_taken` | `unknown_role` | `system_role` — dari `materializeMembership`. */
      refusal: string;
    };

/**
 * Partner menebus kodenya dan menjadi anggota — sungguhan, bukan aktor jenis
 * baru.
 *
 * `principalId` datang dari kredensial GLOBAL penebus, yang sudah diverifikasi
 * pemanggil. Itulah yang membuat langkah ini tidak membaca apa pun lintas
 * tenant: alamat manusianya diambil dari `awcms_principals` (global, tanpa RLS),
 * bukan dari identitasnya di tenant partner — baris yang tenant target ini tidak
 * akan pernah bisa lihat.
 *
 * Penebusan adalah COMPARE-AND-SWAP. Predikatnya menegaskan ulang hash kode DAN
 * kedaluwarsa grant di dalam statement yang menghapus kodenya, sehingga dua
 * penebusan konkuren tidak bisa dua-duanya menang — bentuk yang sama dengan
 * penebusan token seleksi ADR-0088.
 */
export async function redeemDelegatedAccess(
  tx: Bun.SQL,
  tenantId: string,
  accessCode: string,
  principalId: string,
  now: Date
): Promise<RedeemDelegatedAccessResult> {
  const codeHash = hashDelegatedAccessCode(accessCode);

  const grantRows = (await tx`
    SELECT id, role_id, expires_at
    FROM awcms_delegated_access_grants
    WHERE tenant_id = ${tenantId}
      AND access_code_hash = ${codeHash}
      AND revoked_at IS NULL
    FOR UPDATE
  `) as { id: string; role_id: string; expires_at: string }[];

  const grant = grantRows[0];
  if (!grant) return { ok: false, code: "CODE_INVALID" };

  if (new Date(grant.expires_at).getTime() <= now.getTime()) {
    return { ok: false, code: "GRANT_EXPIRED" };
  }

  // Alamatnya dari baris principal GLOBAL, lewat store yang memiliki tabel itu
  // — `identity:principal-access:check` menuntutnya, dan aturannya benar: yang
  // membatasi siapa boleh membaca tabel tanpa RLS hanyalah daftar itu.
  const principal = await findPrincipalById(tx, principalId);
  if (!principal) return { ok: false, code: "CODE_INVALID" };

  // Penulis keanggotaan KELIMA, dan sengaja bukan yang kelima: profil,
  // identity, tenant user, dan role semuanya lewat `materializeMembership`
  // (ADR-0082) — termasuk penolakan ROLE SISTEM, yang di sini justru penting.
  // Pelanggan memilih role partnernya, dan `owner` tidak boleh menjadi pilihan.
  const membership = await materializeMembership(tx, tenantId, {
    loginIdentifier: principal.emailNormalized,
    displayName: principal.emailNormalized,
    existingPrincipalId: principalId,
    principalKind: "delegated",
    // Alamatnya sudah terbukti dimiliki manusia itu di tenant asalnya, dan
    // penebusan ini menuntut kredensial global yang sama. Tidak ada yang bisa
    // dibuktikan lebih lanjut oleh email konfirmasi kedua.
    emailVerified: true,
    roleIds: [grant.role_id],
    reason: `delegated_access:${grant.id}`
  });

  if (membership.outcome !== "created") {
    return {
      ok: false,
      code: "MEMBERSHIP_REFUSED",
      refusal: membership.outcome
    };
  }

  const tenantUserId = membership.tenantUserId;

  const swapped = (await tx`
    UPDATE awcms_delegated_access_grants
    SET access_code_hash = NULL,
        granted_tenant_user_id = ${tenantUserId},
        redeemed_at = ${now},
        updated_at = ${now}
    WHERE tenant_id = ${tenantId}
      AND id = ${grant.id}
      AND access_code_hash = ${codeHash}
      AND revoked_at IS NULL
      AND expires_at > ${now}
    RETURNING id
  `) as { id: string }[];

  if (swapped.length === 0) return { ok: false, code: "CODE_INVALID" };

  return {
    ok: true,
    grantId: grant.id,
    tenantUserId,
    roleId: grant.role_id
  };
}

/**
 * Mencabut jangkauan: grantnya mati, keanggotaannya nonaktif, sesinya hilang —
 * satu transaksi, tidak ada urutan yang bisa meninggalkan salah satunya.
 *
 * `actorTenantUserId` NULL berarti kedaluwarsa, bukan keputusan seseorang; CHECK
 * `sql/117` mengizinkan itu dan melarang kebalikannya (aktor tanpa waktu).
 */
export async function revokeDelegatedAccess(
  tx: Bun.SQL,
  tenantId: string,
  grantId: string,
  actorTenantUserId: string | null,
  reason: string | null,
  now: Date
): Promise<{ revoked: boolean }> {
  const rows = (await tx`
    UPDATE awcms_delegated_access_grants
    SET revoked_at = ${now},
        revoked_by_tenant_user_id = ${actorTenantUserId},
        revoke_reason = ${reason},
        updated_at = ${now}
    WHERE tenant_id = ${tenantId}
      AND id = ${grantId}
      AND revoked_at IS NULL
    RETURNING granted_tenant_user_id
  `) as { granted_tenant_user_id: string | null }[];

  if (rows.length === 0) return { revoked: false };

  const tenantUserId = rows[0]!.granted_tenant_user_id;
  // Belum ditebus: tidak ada keanggotaan yang perlu dimatikan, dan kodenya sudah
  // tidak bisa ditebus karena setiap jalur penebusan menuntut `revoked_at IS NULL`.
  if (!tenantUserId) return { revoked: true };

  await deactivateDelegatedMembership(tx, tenantId, tenantUserId, now);
  return { revoked: true };
}

/**
 * Menyapu grant yang lewat tanggalnya. Dipanggil job, bukan request.
 *
 * Kedaluwarsa dievaluasi terhadap JAM, jadi sebuah grant berhenti memberi
 * apa pun pada detik `expires_at` — sapuan ini yang mematikan keanggotaan dan
 * sesinya, bukan yang membuat grantnya berhenti berlaku.
 */
export async function expireDelegatedAccessGrants(
  tx: Bun.SQL,
  tenantId: string,
  now: Date,
  limit = 200
): Promise<{ expired: number }> {
  const rows = (await tx`
    UPDATE awcms_delegated_access_grants
    SET revoked_at = ${now},
        revoke_reason = 'expired',
        updated_at = ${now}
    WHERE tenant_id = ${tenantId}
      AND id IN (
        SELECT id FROM awcms_delegated_access_grants
        WHERE tenant_id = ${tenantId}
          AND revoked_at IS NULL
          AND expires_at <= ${now}
        ORDER BY expires_at
        LIMIT ${limit}
      )
    RETURNING granted_tenant_user_id
  `) as { granted_tenant_user_id: string | null }[];

  for (const row of rows) {
    if (row.granted_tenant_user_id) {
      await deactivateDelegatedMembership(
        tx,
        tenantId,
        row.granted_tenant_user_id,
        now
      );
    }
  }

  return { expired: rows.length };
}

/**
 * Menonaktifkan keanggotaan terdelegasi dan mencabut sesinya.
 *
 * Sengaja TIDAK memanggil `setTenantUserStatus`: aturan "admin sistem terakhir"
 * dan "tidak boleh menonaktifkan diri sendiri" di sana adalah kontrol untuk
 * ANGGOTA, dan keduanya salah di sini — sebuah keanggotaan terdelegasi tidak
 * boleh bisa memblokir pencabutannya sendiri dengan memegang role sistem.
 */
async function deactivateDelegatedMembership(
  tx: Bun.SQL,
  tenantId: string,
  tenantUserId: string,
  now: Date
): Promise<void> {
  const rows = (await tx`
    UPDATE awcms_tenant_users
    SET status = 'inactive', updated_at = ${now}
    WHERE tenant_id = ${tenantId}
      AND id = ${tenantUserId}
      AND principal_kind = 'delegated'
    RETURNING identity_id
  `) as { identity_id: string }[];

  const identityId = rows[0]?.identity_id;
  if (!identityId) return;

  await revokeAllSessionsForIdentity(tx, tenantId, identityId, now);
}

export type DelegatedGrantSummary = {
  id: string;
  partnerTenantId: string;
  roleId: string;
  purpose: string;
  expiresAt: Date;
  redeemedAt: Date | null;
  revokedAt: Date | null;
  grantedTenantUserId: string | null;
};

/**
 * Pandangan pelanggan atas setiap jangkauan ke dalam tenantnya — ADR-0089
 * §"pandangan pelanggan yang otoritatif" — termasuk yang sudah mati.
 *
 * Yang sudah dicabut TETAP ditampilkan, dan itu bukan kelalaian: "siapa yang
 * pernah bisa melihat data kami, dan sampai kapan" adalah pertanyaan yang
 * ditanyakan audit, dan daftar yang hanya memuat yang hidup menjawab pertanyaan
 * yang berbeda. Retensinya diatur deskriptor lifecycle-nya (365 hari), bukan
 * oleh query ini.
 *
 * `access_code_hash` tidak pernah keluar dari fungsi ini. Ia bahkan tidak
 * di-SELECT: sebuah kolom yang tidak diambil tidak bisa bocor lewat serialisasi
 * yang lupa menyaring.
 */
export async function listDelegatedGrants(
  tx: Bun.SQL,
  tenantId: string
): Promise<DelegatedGrantSummary[]> {
  const rows = (await tx`
    SELECT id, partner_tenant_id, role_id, purpose, expires_at,
           redeemed_at, revoked_at, granted_tenant_user_id
    FROM awcms_delegated_access_grants
    WHERE tenant_id = ${tenantId}
    ORDER BY created_at DESC
  `) as {
    id: string;
    partner_tenant_id: string;
    role_id: string;
    purpose: string;
    expires_at: string;
    redeemed_at: string | null;
    revoked_at: string | null;
    granted_tenant_user_id: string | null;
  }[];

  return rows.map((row) => ({
    id: row.id,
    partnerTenantId: row.partner_tenant_id,
    roleId: row.role_id,
    purpose: row.purpose,
    expiresAt: new Date(row.expires_at),
    redeemedAt: row.redeemed_at ? new Date(row.redeemed_at) : null,
    revokedAt: row.revoked_at ? new Date(row.revoked_at) : null,
    grantedTenantUserId: row.granted_tenant_user_id
  }));
}
