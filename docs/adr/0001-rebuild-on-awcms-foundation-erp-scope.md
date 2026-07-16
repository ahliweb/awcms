# ADR-0001 — Rebuild AWCMS sebagai platform ERP di atas standar modular monolith

- **Status:** Accepted (poin 3 & satu alternatif di-amend oleh [ADR-0022](0022-erp-modules-live-in-extension-repos.md))
- **Tanggal:** 2026-07-14
- **Terkait:** riwayat migrasi ADR-013..023 (repo lama, migrasi Bun & off-Supabase); [ADR-0013](0013-extension-layers-and-boundary-model.md), [ADR-0020](0020-erp-extension-readiness-contracts.md), [ADR-0022](0022-erp-modules-live-in-extension-repos.md)

> **Amandemen (ADR-0022, 2026-07-16).** Poin 3 di bawah — "modul domain ERP … dikembangkan sebagai modul di `src/modules/`" — **tidak lagi berlaku**. Sejak epic #738 (`platform-evolution`, ADR-0013/0020), modul domain ERP hidup di **repo ekstensi/turunan terpisah** (lapisan _ERP Extension_/_Derived Application_), bukan di dalam base ini; base hanya menyediakan modul fondasi reusable + kontrak netral kesiapan ERP. Alternatif "mengembangkan ERP di repo terpisah" yang dahulu ditolak (lihat §Alternatif) **kini menjadi arah yang diadopsi**. Poin 1, 2, 4 dan seluruh standar teknis fondasi tetap berlaku. Lihat [ADR-0022](0022-erp-modules-live-in-extension-repos.md).

## Konteks

Repo `awcms` sebelumnya berisi platform CMS berbasis Node.js, Vite/React (admin & public terpisah), dan Supabase. Sepanjang migrasi bertahap (ADR-013..023), seluruh komponen (mcp, public, admin) dipindah ke runtime Bun dan lepas dari Supabase. Setelah migrasi selesai, file legacy dihapus sepenuhnya (`chore(foundation): remove legacy repository files`), menyisakan repo tanpa kode aktif.

Kebutuhan bisnis saat ini lebih besar dari sekadar CMS/base generik: platform **ERP** (keuangan, inventori, procurement, manufaktur, HR/payroll) serta **integrasi dengan solusi bisnis lain** (payment gateway, marketplace, sistem pajak/Coretax, logistik), dengan skala multi-tenant/multi-entitas.

## Keputusan

Kami memutuskan:

1. Repo `awcms` **tidak diarsipkan** — dibangun ulang sebagai platform ERP modular monolith dengan standar teknis: Bun (runtime, Bun-only), Astro 7 (SSR), PostgreSQL + RLS wajib, RBAC/ABAC default-deny, offline-first/LAN-first dengan sync outbox HMAC-signed, kontrak OpenAPI/AsyncAPI, idempotency pada mutation high-risk, dan audit trail dengan redaksi.
2. Standar teknis dasar tersebut dicatat sebagai ADR di `docs/adr/` repo ini (menyusul ADR-0002 dst.) dan menjadi baseline yang mengikat untuk seluruh modul.
3. ~~Modul domain ERP (finance, inventory, procurement, manufacturing, hr-payroll) dan modul integrasi bisnis eksternal dikembangkan sebagai modul di `src/modules/`, mengikuti struktur modular monolith yang sama (module.ts + domain/application/infrastructure/api).~~ **(Di-amend oleh [ADR-0022](0022-erp-modules-live-in-extension-repos.md): modul domain ERP hidup di repo ekstensi/turunan terpisah, bukan di `src/modules/` base; base hanya menyediakan modul fondasi reusable + kontrak netral kesiapan ERP.)**
4. Setiap penyesuaian standar untuk kebutuhan spesifik ERP (mis. kebutuhan performa/skala tertentu) wajib dicatat sebagai ADR terpisah dengan alasan eksplisit, bukan penyimpangan diam-diam.

## Konsekuensi

- **Positif:** fondasi teknis (RLS, ABAC, offline-first, kontrak API) sudah terbukti dan tidak perlu didesain ulang dari nol; riwayat git migrasi sebelumnya tetap relevan sebagai konteks historis; satu repo, satu standar, mengurangi biaya koordinasi lintas repo.
- **Trade-off:** repo ini menanggung sendiri keseluruhan beban maintenance fondasi + modul ERP (tidak ada pembagian dengan base terpisah); disiplin ADR diperlukan agar modul ERP tidak diam-diam melanggar standar dasar.
- **Netral:** repo ini memiliki `AGENTS.md`, `docs/adr/`, dan dokumen governance sendiri yang menaungi baik standar fondasi maupun kebutuhan ERP.

## Alternatif yang dipertimbangkan

- **Mengarsipkan repo dan mengembangkan ERP di repo/base terpisah** — ~~ditolak: memecah standar dan kode menjadi dua repo menambah overhead sinkronisasi tanpa manfaat jelas untuk skala tim saat ini.~~ **(Di-amend oleh [ADR-0022](0022-erp-modules-live-in-extension-repos.md): mengembangkan ERP di repo terpisah — di atas base ini, bukan mengarsipkannya — kini justru menjadi arah yang diadopsi. Epic #738 menyediakan komposisi modul build-time, manifest kompatibilitas, dan kontrak port/event berversi yang menghilangkan overhead sinkronisasi yang dahulu jadi dasar penolakan.)**
- **Mempertahankan platform lama (Node/Vite/React/Supabase)** — ditolak: bertentangan dengan arah migrasi Bun yang sudah diselesaikan (ADR-019) dan menambah biaya pemeliharaan stack yang sudah usang.
- **Membangun ERP dari nol tanpa standar modular monolith yang jelas** — ditolak: berisiko mengulang masalah base non-modular (sulit dipisah, potensi jadi big ball of mud) yang sudah dihindari lewat pengalaman migrasi sebelumnya.
