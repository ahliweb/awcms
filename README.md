# AWCMS — ERP & Business Solutions Platform

> **Status: fondasi ulang (rebuild).** File kode legacy di repo ini sudah dihapus (lihat commit `chore(foundation): remove legacy repository files`). Repo ini **dikembangkan ulang dari nol** dengan fondasi teknologi yang sama seperti [**awcms-mini**](https://github.com/ahliweb/awcms-mini), namun dengan **fokus bisnis yang lebih besar**: platform ERP dan integrasi solusi bisnis lainnya (bukan sekadar CMS/base generik).

## Kenapa repo ini dibangun ulang

AWCMS versi lama dibangun di atas kombinasi Node.js, Vite/React (admin & public), dan Supabase. Sepanjang siklus migrasi (ADR-013 s/d ADR-023), setiap komponen dipindah bertahap ke runtime dan arsitektur baru:

- `chore(mcp): migrasi awcms-mcp ke runtime Bun (ADR-019, #113)`
- `chore(public): migrasi awcms-public ke Bun (ADR-019, #113)`
- `chore(admin): migrasi awcms admin (Vite/React) ke Bun (ADR-019, #113)`
- `docs: referensi keputusan arsitektur kanonik (ADR-013…023 per produk)`
- `docs(readme): add architecture update note (PostgreSQL-only, RLS wajib, EmDash optional)`
- `docs: inventaris pemakaian Supabase (audit off-Supabase, #108)`

Setelah seluruh komponen (mcp, public, admin) selesai dipindah dan Supabase tidak lagi dipakai, file-file legacy di repo ini dihapus (`chore(foundation): remove legacy repository files`) — bukan untuk memensiunkan repo, melainkan untuk membersihkan lahan agar AWCMS bisa dibangun ulang di atas fondasi standar yang baru, dengan skop bisnis yang jauh lebih luas dari sebelumnya.

## Arah baru: fondasi teknologi awcms-mini, skop bisnis ERP

Repo ini **mengadopsi stack dan standar teknis** dari **[awcms-mini](https://github.com/ahliweb/awcms-mini)** — *modular monolith standard* AhliWeb — sebagai base, tapi **bukan sekadar turunan/derivatif base generik**. Fokus pengembangan di repo ini adalah:

- **ERP** — modul keuangan/akuntansi, inventori/warehouse, procurement, manufaktur, HR/payroll, dsb., dibangun sebagai modul domain di atas base modular monolith.
- **Integrasi solusi bisnis lain** — konektor/adapter ke sistem eksternal (mis. e-commerce, payment gateway, marketplace, sistem pajak/Coretax, layanan logistik), memakai pola outbox/queue yang sama seperti sync di awcms-mini agar tetap offline-first-safe.
- **Skala multi-tenant/multi-entitas** — memanfaatkan RBAC/ABAC/RLS bawaan base untuk mengelola banyak unit bisnis/tenant sekaligus dalam satu platform ERP.

Stack teknis yang diadopsi dari awcms-mini:

| Aspek | Sebelumnya (repo ini) | Sekarang (awcms-mini) |
|---|---|---|
| Runtime | Node.js | **Bun** (Bun-only, lihat ADR-0002) |
| Web framework | Vite + React (admin/public terpisah) | **Astro 7** (SSR di atas Bun, satu shell modular monolith) |
| Database | Supabase (Postgres terkelola) | **PostgreSQL** dengan **RLS wajib** (ADR-0003) |
| Arsitektur | Aplikasi terpisah (mcp, public, admin) | **Modular monolith, microservice-ready** (ADR-0001), modul base reusable (Tenant, Identity, Profile, Access/RBAC-ABAC, Sync, Workflow, Reporting) |
| Mode operasi | Online-dependent | **Offline-first / LAN-first** dengan sync outbox HMAC-signed (ADR-0006) |
| Kontrak API | Ad-hoc | OpenAPI/AsyncAPI tervalidasi, response helper standar |

Modul base reusable (Tenant, Identity, Profile, Access/RBAC-ABAC, Sync, Workflow, Reporting) dari `awcms-mini` dipakai apa adanya sebagai fondasi; modul domain ERP dan integrasi bisnis dikembangkan **di repo ini**, di atas fondasi tersebut.

## Referensi & titik mulai

- Fondasi teknis/standar: https://github.com/ahliweb/awcms-mini — baca `AGENTS.md` di sana untuk konvensi wajib (struktur modul, RLS, ABAC, idempotency, audit, dsb.) sebelum menambah modul ERP di repo ini.
- Riwayat keputusan arsitektur base: `docs/adr/` di awcms-mini (ADR-0001 modular monolith, ADR-0002 Bun-only runtime, ADR-0003 PostgreSQL + RLS, ADR-0006 offline-first sync).
- Riwayat migrasi platform lama di repo ini: histori git ADR-013..023 (Bun migration, off-Supabase).

Repo `awcms` ini adalah **pengembangan aktif** — bukan arsip — dengan skop bisnis ERP dan integrasi solusi bisnis yang lebih luas dari `awcms-mini`.
