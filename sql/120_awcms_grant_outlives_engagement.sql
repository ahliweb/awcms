-- Gelombang 8 PR 8.4 (Issue #423) — sebuah grant HIDUP LEBIH LAMA dari
-- kemitraannya, dan `sql/117` membuat itu mustahil.
--
-- ## Cacat yang ditemukan E2E, bukan review
--
-- `sql/117` memberi `awcms_delegated_access_grants` FK komposit
-- `(tenant_id, partner_tenant_id)` → `awcms_partner_managed_tenants`, dengan
-- alasan yang terdengar benar: "sebuah grant hanya bisa ada di tempat
-- kemitraannya ada".
--
-- Diukur dengan menjalankannya: begitu SATU grant pernah dibuat, memutus
-- kemitraan **GAGAL selamanya**. Grant yang sudah dicabut tetap mereferensi
-- baris pemetaan, dan pencabutan tidak menghapusnya — memang tidak boleh, itu
-- catatan retensi 365 hari (ADR-0090).
--
-- Jadi pelanggan yang paling butuh memutus kemitraan — yang partnernya PERNAH
-- benar-benar masuk — adalah satu-satunya pelanggan yang tidak bisa. Kelas
-- kegagalan yang tepat berlawanan dengan tujuannya.
--
-- ## Yang benar: grant adalah SEJARAH, kemitraan adalah KEADAAN SEKARANG
--
-- "Siapa yang pernah bisa melihat data kami, dan sampai kapan" harus tetap
-- terjawab SETELAH vendornya diberhentikan — justru terutama setelah itu.
-- Baris grant karena itu harus bertahan melewati pemetaan yang melahirkannya.
--
-- FK-nya dipindahkan ke REGISTRI: `partner_tenant_id` →
-- `awcms_partners (partner_tenant_id)`. Yang tetap ditegakkan basis data adalah
-- "partner terdaftar"; yang berhenti ditegakkan olehnya adalah "kemitraan masih
-- ada", karena itu memang bukan invarian abadi.
--
-- ## Invarian saat PENULISAN tetap di basis data, bukan pindah ke TypeScript
--
-- "Tidak ada grant tanpa kemitraan hidup" tetap benar SAAT DIBUAT, dan tetap
-- ditegakkan basis data — `approveDelegatedAccess` menulis lewat
-- `INSERT … SELECT … WHERE EXISTS (kemitraan)`, sehingga tidak adanya kemitraan
-- menghasilkan NOL BARIS alih-alih baris yang salah. Pemeriksaan di TypeScript
-- yang mendahului INSERT akan menjadi TOCTOU; predikat di dalam statement yang
-- sama tidak bisa.

BEGIN;

ALTER TABLE awcms_delegated_access_grants
  DROP CONSTRAINT IF EXISTS awcms_delegated_access_grants_engagement_fkey;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'awcms_delegated_access_grants_partner_fkey'
  ) THEN
    ALTER TABLE awcms_delegated_access_grants
      ADD CONSTRAINT awcms_delegated_access_grants_partner_fkey
      FOREIGN KEY (partner_tenant_id)
      REFERENCES awcms_partners (partner_tenant_id);
  END IF;
END $$;

COMMENT ON COLUMN awcms_delegated_access_grants.partner_tenant_id IS
  'Partner yang grant ini berikan aksesnya. FK ke REGISTRI (awcms_partners), bukan ke baris kemitraan: sebuah grant adalah SEJARAH dan harus bertahan melewati pemutusan kemitraan, karena "siapa yang pernah bisa melihat data kami" justru paling ditanyakan setelah vendornya diberhentikan. sql/117 mengikatnya ke kemitraan dan akibatnya membuat pemutusan MUSTAHIL bagi pelanggan yang partnernya pernah benar-benar masuk. Invarian "tidak ada grant tanpa kemitraan hidup" tetap ditegakkan basis data saat PENULISAN, lewat INSERT … SELECT … WHERE EXISTS.';

COMMIT;
