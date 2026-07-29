---
name: awcms-jualanku-porting
description: "RENCANA — porting Jualanku.info (direktori merchant + portal penjual + portal affiliate) ke keluarga AWCMS, diputuskan [ADR-0045](../../../docs/adr/0045-jualanku-porting-awcms-system-of-record-astro-bff.md) di repo ini + ADR-0014/0015 di `awcms-astro`. BELUM ADA KODE: tidak ada modul/tabel/migrasi/rute/permission `jualanku_*`, dan registry tetap 20 modul. Gunakan saat mengerjakan bagian mana pun dari Jualanku — ia memuat keputusan yang TIDAK bisa disimpulkan dari kode: merchant dimodelkan sebagai BUSINESS SCOPE (bukan atribut ABAC baru — allow-list ABAC TERTUTUP), RLS memisahkan tenant BUKAN merchant, browser tidak pernah memanggil awcms langsung (BFF di awcms-astro), lima bounded context bukan tujuh, dan gap sesi yang sebenarnya adalah introspeksi lintas-origin bukan dukungan cookie. Rancangan lengkap: `docs/awcms/jualanku/`."
---

# AWCMS — Porting Jualanku.info (rencana, belum ada kode)

> **STATUS — P0, NOL KODE.** Per skill ini ditulis (2026-07-29): tidak ada
> `src/modules/jualanku-*`, tidak ada tabel `awcms_jualanku_*`, tidak ada migrasi,
> rute, atau permission Jualanku. `listModules()` mengembalikan **20** modul.
> Verifikasi sendiri sebelum percaya kalimat mana pun di sini —
> `ls src/modules` dan `ls sql/` adalah sumber kebenaran, bukan skill ini.

## Kapan pakai skill ini

Saat mengerjakan bagian mana pun dari Jualanku.info: model data, otorisasi,
endpoint, layar admin, atau portal. Ia menahan keputusan yang **tidak bisa
disimpulkan dari kode** dan yang salah-tebaknya mahal.

Rancangan penuh ada di [`docs/awcms/jualanku/`](../../../docs/awcms/jualanku/README.md)
(9 dokumen). Skill ini hanya ringkasan yang mengikat + jebakan.

## Lima keputusan yang mengikat

1. **Merchant = business scope, BUKAN atribut ABAC baru.**
   `ABAC_ATTRIBUTES` (`identity-access/domain/abac-policy.ts`) adalah allow-list
   **tertutup**: atribut tak dikenal = invalid saat authoring, deny saat
   evaluasi. `subject.merchantIds`/`resource.merchantId` **tidak ada di sana**
   dan **tidak boleh ditambahkan** — melebarkannya untuk satu produk menghapus
   properti yang membuatnya bernilai. Yang dipakai: `resource.businessScopeId`
   (sudah ada) + port hierarki scope ADR-0030 yang base-nya mengembalikan
   `resolved: false` **fail-closed**. `jualanku_directory` yang mengisinya.
2. **RLS memisahkan tenant, bukan merchant.** Satu tenant penyelenggara
   (`JUALANKU_MAIN`), banyak merchant. Isolasi merchant butuh TIGA lapis: RLS
   tenant + grant scope ber-effective-dating + **predikat kepemilikan di setiap
   query**. Jangan pernah menyimpulkan isolasi dari `FORCE` RLS saja — dan
   ujilah sebagai role `awcms_app`, karena pada PaaS ber-superuser RLS bisa
   inert sementara migrasi tetap hijau.
3. **Browser tidak pernah memanggil `awcms` langsung.** `awcms-astro` adalah
   satu-satunya BFF. BFF boleh orkestrasi + proyeksi; ia **tidak** memutuskan
   kepemilikan, entitlement, atau transisi status. Kalau sebuah cek hanya ada di
   BFF, cek itu tidak ada.
4. **Lima bounded context, bukan tujuh**: `jualanku_directory`,
   `jualanku_catalog_growth`, `jualanku_affiliate`, `jualanku_commercial`,
   `jualanku_trust_operations`. Batas mengikuti invariant dan kepemilikan data,
   bukan struktur menu.
5. **Gap sesi bukan "cookie belum didukung".** `resolveAuthInputs()` sudah
   menerima header **atau** cookie httpOnly — begitulah admin SSR bekerja hari
   ini. Yang hilang: kontrak introspeksi sesi untuk **origin berbeda**
   (`/api/v1/auth/me` memang bearer-only).

## Jebakan yang sudah diketahui

- **Permission hanya boleh memakai `AccessAction` yang ADA.** Tidak ada
  `submit`/`verify`/`payout`. Memakai action di luar union menghasilkan
  permission yang tidak pernah ter-seed dan deny senyap terhadap pemilik tenant,
  hijau di CI karena tidak ada yang mengujinya. Pemetaan yang dipakai ada di
  [`02-model-tenant-merchant-otorisasi.md`](../../../docs/awcms/jualanku/02-model-tenant-merchant-otorisasi.md) §5.
- **Descriptor `permissions` TIDAK memberi permission ke tenant yang sudah ada.**
  Setiap modul wajib membawa migrasi seed sendiri; deploy ke tenant lama butuh
  backfill `awcms_role_permissions`, atau mereka 403 tanpa sebab yang terlihat.
- **FK lintas tabel tenant-scoped harus komposit `(tenant_id, id)`.** FK biasa
  melewati RLS.
- **Jangan menulis nomor `sql/NNN` untuk migrasi yang belum ada** di dokumen mana
  pun: `bun run check:docs` menggagalkan rujukan migrasi hantu.
- **Setiap modul domain baru butuh ADR admission** sesuai
  [`docs/awcms/21_module_admission_governance.md`](../../../docs/awcms/21_module_admission_governance.md) —
  ADR-0045 memutuskan arsitekturnya, bukan admission tiap modul.

## Yang dipakai ulang (jangan bangun ulang)

`blog_content` (artikel, halaman legal ber-versi), `seo_distribution`,
`site_search` (deklarasikan `searchSources`), `media_library` (upload presigned;
portal tidak pernah mengirim URL gambar bebas), `theming`, `tenant_domain`,
`visitor_analytics`, `comments`, `data_lifecycle`, `email`,
`workflow_approval` + `sodRules` untuk maker-checker payout, `form_drafts`.

## Urutan kerja

P0 (ADR + kontrak sesi + model data + descriptor) → P1 fondasi domain → P2
publik → P3 portal penjual → P4 portal affiliate → P5 pilot. Satu bounded
context per PR, masing-masing membawa migrasi, seed permission, fragmen OpenAPI,
test negatif, dokumen, dan changeset. Rincian gate/KPI/regulasi:
[`07-roadmap-gates-kepatuhan.md`](../../../docs/awcms/jualanku/07-roadmap-gates-kepatuhan.md).
