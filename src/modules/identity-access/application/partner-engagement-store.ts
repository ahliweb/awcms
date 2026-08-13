/**
 * Kemitraan dari kedua sisi — ADR-0089, Gelombang 8 PR 8.4 (#423).
 *
 * Sisi pelanggan membaca dan menulis `awcms_partner_managed_tenants` biasa:
 * barisnya ada di tenant mereka, jadi RLS sudah melakukan seluruh pekerjaannya.
 *
 * Sisi partner tidak bisa melakukan itu — barisnya bukan miliknya — dan karena
 * itu satu-satunya pembaca `awcms_list_partner_managed_tenants`, fungsi
 * SECURITY DEFINER sempit `sql/119`. Asimetri itu disengaja: pandangan
 * pelanggan yang otoritatif, pandangan partner yang kenyamanan.
 */

export type PartnerEngagement = {
  id: string;
  partnerTenantId: string;
  partnerTenantCode: string;
  partnerTenantName: string;
  engagedAt: Date;
};

/**
 * Siapa yang menjangkau tenant ini.
 *
 * `awcms_tenants` adalah tabel GLOBAL tanpa RLS, jadi nama partner dibaca dari
 * sana alih-alih didenormalisasi ke baris pemetaan — salinan yang bisa basi
 * tanpa ada yang tahu (ADR-0089).
 */
export async function listPartnerEngagements(
  tx: Bun.SQL,
  tenantId: string
): Promise<PartnerEngagement[]> {
  const rows = (await tx`
    SELECT m.id, m.partner_tenant_id, m.engaged_at,
           t.tenant_code, t.tenant_name
    FROM awcms_partner_managed_tenants m
    JOIN awcms_tenants t ON t.id = m.partner_tenant_id
    WHERE m.tenant_id = ${tenantId}
    ORDER BY m.engaged_at DESC
  `) as {
    id: string;
    partner_tenant_id: string;
    engaged_at: string;
    tenant_code: string;
    tenant_name: string;
  }[];

  return rows.map((row) => ({
    id: row.id,
    partnerTenantId: row.partner_tenant_id,
    partnerTenantCode: row.tenant_code,
    partnerTenantName: row.tenant_name,
    engagedAt: new Date(row.engaged_at)
  }));
}

export type EngagePartnerResult =
  | { ok: true; engagement: PartnerEngagement }
  | {
      ok: false;
      code: "NOT_A_PARTNER" | "SELF" | "ALREADY_ENGAGED" | "PARTNER_SUSPENDED";
    };

/**
 * Pelanggan menyewa partner untuk tenantnya sendiri.
 *
 * Tiga penolakan, dan hanya SATU-nya yang ditulis di sini. `SELF` dan
 * `NOT_A_PARTNER` sudah ditegakkan basis data (`..._not_self_check` dan FK ke
 * registri partner) — kode di bawah menerjemahkan pelanggarannya menjadi pesan
 * yang bisa dibaca manusia, bukan menggantikan constraint-nya. Kalau ia
 * menggantikannya, penulis kedua akan melewatinya.
 *
 * Ia sengaja TIDAK memeriksa lebih dulu apakah tenant yang dinamai adalah
 * partner terdaftar: pemeriksaan seperti itu akan menjadi ORACLE — pemanggil
 * bisa menyapu id tenant dan mempelajari siapa saja partner platform ini.
 * Penolakannya sama untuk "bukan partner" dan "tidak ada", karena keduanya
 * memang harus terlihat sama.
 */
export async function engagePartner(
  tx: Bun.SQL,
  tenantId: string,
  partnerTenantId: string,
  engagedByTenantUserId: string
): Promise<EngagePartnerResult> {
  if (partnerTenantId === tenantId) return { ok: false, code: "SELF" };

  const existing = (await tx`
    SELECT 1 FROM awcms_partner_managed_tenants
    WHERE tenant_id = ${tenantId} AND partner_tenant_id = ${partnerTenantId}
  `) as unknown[];

  if (existing.length > 0) return { ok: false, code: "ALREADY_ENGAGED" };

  // ADR-0093 — a suspended partner cannot be engaged. The predicate is INSIDE
  // the statement rather than a SELECT before it: the platform can suspend a
  // partner between two statements, and a check that precedes the INSERT is a
  // TOCTOU (the reasoning `sql/120` records for the engagement predicate on
  // the grant path). The registry is FORCE-RLS and platform-owned, so this
  // reads through `sql/124`'s narrow SECURITY DEFINER function; `NULL` (no
  // registry row) fails the comparison, which is the fail-closed direction.
  //
  // Zero rows therefore means one of two things, and the caller distinguishes
  // them: the FK already refuses an unregistered tenant outright, so a row
  // that survives the FK and produces nothing here was suspended.
  const rows = (await tx`
    INSERT INTO awcms_partner_managed_tenants
      (tenant_id, partner_tenant_id, engaged_by_tenant_user_id)
    SELECT ${tenantId}, ${partnerTenantId}, ${engagedByTenantUserId}
    WHERE awcms_partner_registry_status(${partnerTenantId}) = 'active'
    RETURNING id, partner_tenant_id, engaged_at
  `) as { id: string; partner_tenant_id: string; engaged_at: string }[];

  if (!rows[0]) {
    // Zero rows means the predicate refused, and there are TWO reasons it
    // could have. Distinguished by a SECOND read — which is not a second gate:
    // the write has already refused, and this only chooses the sentence. A
    // TOCTOU on a message is harmless, while collapsing the two answers is not:
    // a tenant that is not registered at all must stay indistinguishable from
    // one that does not exist (the 404 `awcms_partner_managed_tenants`' foreign
    // key used to produce, and which a test pins), or the registry becomes
    // enumerable one guess at a time.
    const status = (await tx`
      SELECT awcms_partner_registry_status(${partnerTenantId}) AS status
    `) as { status: string | null }[];

    return status[0]?.status === "suspended"
      ? { ok: false, code: "PARTNER_SUSPENDED" }
      : { ok: false, code: "NOT_A_PARTNER" };
  }

  const named = (await tx`
    SELECT tenant_code, tenant_name FROM awcms_tenants WHERE id = ${partnerTenantId}
  `) as { tenant_code: string; tenant_name: string }[];

  return {
    ok: true,
    engagement: {
      id: rows[0]!.id,
      partnerTenantId: rows[0]!.partner_tenant_id,
      partnerTenantCode: named[0]?.tenant_code ?? "",
      partnerTenantName: named[0]?.tenant_name ?? "",
      engagedAt: new Date(rows[0]!.engaged_at)
    }
  };
}

export type SeverPartnerResult =
  | { ok: true; partnerTenantId: string; revokedGrants: number }
  | { ok: false; code: "NOT_FOUND" };

/**
 * Pelanggan memutus kemitraan — dan setiap grant di bawahnya ikut mati, di
 * transaksi yang sama.
 *
 * Urutannya bukan pilihan: FK `awcms_delegated_access_grants` menunjuk pasangan
 * ini, jadi menghapus pemetaan sebelum mencabut grantnya akan GAGAL. Yang
 * membuat itu bagus adalah bahwa kegagalannya keras: tidak ada jalan untuk
 * memutus kemitraan sambil meninggalkan akses hidup di belakangnya, bahkan bila
 * seseorang lupa memanggil pencabutannya.
 */
export async function severPartner(
  tx: Bun.SQL,
  tenantId: string,
  engagementId: string,
  actorTenantUserId: string,
  now: Date,
  revokeGrant: (grantId: string) => Promise<unknown>
): Promise<SeverPartnerResult> {
  const rows = (await tx`
    SELECT partner_tenant_id FROM awcms_partner_managed_tenants
    WHERE tenant_id = ${tenantId} AND id = ${engagementId}
  `) as { partner_tenant_id: string }[];

  const partnerTenantId = rows[0]?.partner_tenant_id;
  if (!partnerTenantId) return { ok: false, code: "NOT_FOUND" };

  const live = (await tx`
    SELECT id FROM awcms_delegated_access_grants
    WHERE tenant_id = ${tenantId}
      AND partner_tenant_id = ${partnerTenantId}
      AND revoked_at IS NULL
  `) as { id: string }[];

  for (const grant of live) {
    await revokeGrant(grant.id);
  }

  await tx`
    DELETE FROM awcms_partner_managed_tenants
    WHERE tenant_id = ${tenantId} AND id = ${engagementId}
  `;

  // `actorTenantUserId` dan `now` diterima supaya pemanggil tidak perlu membaca
  // ulang keduanya untuk baris auditnya; keduanya sengaja tidak ditulis di sini
  // karena audit adalah keputusan rute, bukan store (pola modul ini).
  void actorTenantUserId;
  void now;

  return { ok: true, partnerTenantId, revokedGrants: live.length };
}

export type ManagedTenant = {
  tenantId: string;
  tenantCode: string;
  tenantName: string;
  tenantStatus: string;
  engagedAt: Date;
};

/**
 * Pandangan partner: tenant mana yang saya kelola.
 *
 * Satu-satunya pemanggil `awcms_list_partner_managed_tenants`. `partnerTenantId`
 * WAJIB berasal dari konteks tenant pemanggil, tidak pernah dari input — lihat
 * header `sql/119`.
 */
export async function listManagedTenants(
  tx: Bun.SQL,
  partnerTenantId: string
): Promise<ManagedTenant[]> {
  const rows = (await tx`
    SELECT tenant_id, tenant_code, tenant_name, tenant_status, engaged_at
    FROM awcms_list_partner_managed_tenants(${partnerTenantId})
  `) as {
    tenant_id: string;
    tenant_code: string;
    tenant_name: string;
    tenant_status: string;
    engaged_at: string;
  }[];

  return rows.map((row) => ({
    tenantId: row.tenant_id,
    tenantCode: row.tenant_code,
    tenantName: row.tenant_name,
    tenantStatus: row.tenant_status,
    engagedAt: new Date(row.engaged_at)
  }));
}
