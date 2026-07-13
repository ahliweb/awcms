# ADR-0001 — Rebuild AWCMS sebagai platform ERP di atas standar modular monolith

- **Status:** Accepted
- **Tanggal:** 2026-07-14
- **Terkait:** riwayat migrasi ADR-013..023 (repo lama, migrasi Bun & off-Supabase)

## Konteks

Repo `awcms` sebelumnya berisi platform CMS berbasis Node.js, Vite/React (admin & public terpisah), dan Supabase. Sepanjang migrasi bertahap (ADR-013..023), seluruh komponen (mcp, public, admin) dipindah ke runtime Bun dan lepas dari Supabase. Setelah migrasi selesai, file legacy dihapus sepenuhnya (`chore(foundation): remove legacy repository files`), menyisakan repo tanpa kode aktif.

Kebutuhan bisnis saat ini lebih besar dari sekadar CMS/base generik: platform **ERP** (keuangan, inventori, procurement, manufaktur, HR/payroll) serta **integrasi dengan solusi bisnis lain** (payment gateway, marketplace, sistem pajak/Coretax, logistik), dengan skala multi-tenant/multi-entitas.

## Keputusan

Kami memutuskan:

1. Repo `awcms` **tidak diarsipkan** — dibangun ulang sebagai platform ERP modular monolith dengan standar teknis: Bun (runtime, Bun-only), Astro 7 (SSR), PostgreSQL + RLS wajib, RBAC/ABAC default-deny, offline-first/LAN-first dengan sync outbox HMAC-signed, kontrak OpenAPI/AsyncAPI, idempotency pada mutation high-risk, dan audit trail dengan redaksi.
2. Standar teknis dasar tersebut dicatat sebagai ADR di `docs/adr/` repo ini (menyusul ADR-0002 dst.) dan menjadi baseline yang mengikat untuk seluruh modul.
3. Modul domain ERP (finance, inventory, procurement, manufacturing, hr-payroll) dan modul integrasi bisnis eksternal dikembangkan sebagai modul di `src/modules/`, mengikuti struktur modular monolith yang sama (module.ts + domain/application/infrastructure/api).
4. Setiap penyesuaian standar untuk kebutuhan spesifik ERP (mis. kebutuhan performa/skala tertentu) wajib dicatat sebagai ADR terpisah dengan alasan eksplisit, bukan penyimpangan diam-diam.

## Konsekuensi

- **Positif:** fondasi teknis (RLS, ABAC, offline-first, kontrak API) sudah terbukti dan tidak perlu didesain ulang dari nol; riwayat git migrasi sebelumnya tetap relevan sebagai konteks historis; satu repo, satu standar, mengurangi biaya koordinasi lintas repo.
- **Trade-off:** repo ini menanggung sendiri keseluruhan beban maintenance fondasi + modul ERP (tidak ada pembagian dengan base terpisah); disiplin ADR diperlukan agar modul ERP tidak diam-diam melanggar standar dasar.
- **Netral:** repo ini memiliki `AGENTS.md`, `docs/adr/`, dan dokumen governance sendiri yang menaungi baik standar fondasi maupun kebutuhan ERP.

## Alternatif yang dipertimbangkan

- **Mengarsipkan repo dan mengembangkan ERP di repo/base terpisah** — ditolak: memecah standar dan kode menjadi dua repo menambah overhead sinkronisasi tanpa manfaat jelas untuk skala tim saat ini.
- **Mempertahankan platform lama (Node/Vite/React/Supabase)** — ditolak: bertentangan dengan arah migrasi Bun yang sudah diselesaikan (ADR-019) dan menambah biaya pemeliharaan stack yang sudah usang.
- **Membangun ERP dari nol tanpa standar modular monolith yang jelas** — ditolak: berisiko mengulang masalah base non-modular (sulit dipisah, potensi jadi big ball of mud) yang sudah dihindari lewat pengalaman migrasi sebelumnya.
