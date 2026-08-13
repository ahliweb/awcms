/**
 * Penebusan kode akses terdelegasi — sisi DUA TENANT — ADR-0090, PR 8.4 (#423).
 *
 * Penebusan menjangkau dua tenant, dan satu `withTenant` menyetel tepat satu
 * konteks. Jadi ia dua transaksi, persis bentuk `session-switch.ts`:
 *
 *   1. di tenant ASAL partner — siapa yang bertanya, dan manusia mana di
 *      baliknya (`principal_id`);
 *   2. di tenant TARGET — tukar kode itu menjadi keanggotaan.
 *
 * ## Yang TIDAK dikerjakan penebusan
 *
 * Ia tidak menerbitkan sesi. Ia membuat penebusnya menjadi ANGGOTA, dan
 * sesudahnya login biasa atau `POST /auth/session/switch` bekerja karena mereka
 * memang anggota sekarang.
 *
 * Itu keputusan, bukan penghematan. Sebuah endpoint yang menukar kode menjadi
 * sesi harus mengulang seluruh jalur login — kebijakan auth tenant tujuan,
 * kebijakan MFA-nya, serviceability, rate limit — dan `evaluateTenantEntry`
 * sudah melakukan semua itu untuk jalur yang ada. Mengulangnya di sini akan
 * membuat satu-satunya salinan kedua dari kebijakan masuk tenant, dan salinan
 * kedua adalah tempat kebijakan MFA diam-diam terlewat.
 *
 * ## Kenapa pemanggilnya wajib punya sesi
 *
 * Kode penebusan tidak mengautentikasi apa pun (ADR-0090). Yang membuktikan
 * penebusnya adalah manusia tertentu adalah sesi hidup di tenantnya sendiri,
 * dan `principal_id` di baliknya — kredensial GLOBAL yang tak satu tenant pun
 * bisa terbitkan. Tanpa itu, siapa pun yang memegang kode bisa menjadi anggota
 * dengan nama siapa pun.
 */
import { withTenantOrThrow } from "../../../lib/database/tenant-context";
import { recordAuditEvent } from "../../logging/application/audit-log";
import { redeemDelegatedAccess } from "./delegated-access-store";
import type { RedeemDelegatedAccessResult } from "./delegated-access-store";

/** Manusia di balik sesi penebus, dibuktikan di tenant ASALNYA. */
export type RedeemerIdentity = {
  principalId: string;
  sourceTenantId: string;
};

/**
 * Langkah 1, di konteks tenant asal: sesi hidup → principal.
 *
 * `null` mencakup sesi yang tidak dikenal, dicabut, kedaluwarsa, DAN identitas
 * tanpa tautan principal. Yang terakhir fail-closed dengan sengaja: tanpa
 * principal tidak ada manusia yang bisa dibawa menyeberang, dan menebak
 * identitas mana di tenant target adalah "orang yang sama" persis inferensi
 * yang seluruh gelombang ini ganti dengan sebuah baris.
 */
export async function loadRedeemer(
  sql: Bun.SQL,
  sourceTenantId: string,
  tokenHash: string,
  now: Date
): Promise<RedeemerIdentity | null> {
  return withTenantOrThrow<RedeemerIdentity | null>(
    sql,
    sourceTenantId,
    async (tx) => {
      const rows = (await tx`
        SELECT i.principal_id
        FROM awcms_sessions s
        JOIN awcms_identities i
          ON i.id = s.identity_id AND i.tenant_id = s.tenant_id
        WHERE s.tenant_id = ${sourceTenantId}
          AND s.token_hash = ${tokenHash}
          AND s.revoked_at IS NULL
          AND s.expires_at > ${now}
      `) as { principal_id: string | null }[];

      const principalId = rows[0]?.principal_id;
      if (!principalId) return null;

      return { principalId, sourceTenantId };
    },
    { workClass: "interactive" }
  );
}

export type CompleteRedemptionResult = {
  outcome: RedeemDelegatedAccessResult;
};

/**
 * Langkah 2, di konteks tenant TARGET: kode → keanggotaan, plus baris auditnya.
 *
 * Baris auditnya ditulis di tenant target dan membawa `actorTenantId` tenant
 * ASAL penebus (ADR-0091) — inilah baris pertama di repo ini yang lahir
 * langsung dari tindakan orang luar, dan tanpa kolom itu ia akan terbaca
 * seperti tindakan karyawan.
 */
export async function completeRedemption(
  sql: Bun.SQL,
  targetTenantId: string,
  accessCode: string,
  redeemer: RedeemerIdentity,
  now: Date,
  correlationId?: string
): Promise<CompleteRedemptionResult> {
  return withTenantOrThrow<CompleteRedemptionResult>(
    sql,
    targetTenantId,
    async (tx) => {
      const outcome = await redeemDelegatedAccess(
        tx,
        targetTenantId,
        accessCode,
        redeemer.principalId,
        now
      );

      if (outcome.ok) {
        await recordAuditEvent(tx, {
          tenantId: targetTenantId,
          actorTenantUserId: outcome.tenantUserId,
          actorTenantId: redeemer.sourceTenantId,
          delegatedGrantId: outcome.grantId,
          moduleKey: "identity_access",
          action: "create",
          resourceType: "tenant_user",
          resourceId: outcome.tenantUserId,
          severity: "critical",
          message: "Delegated access redeemed; a partner is now a member here.",
          attributes: { roleId: outcome.roleId },
          correlationId
        });
      }

      return { outcome };
    },
    { workClass: "interactive" }
  );
}
