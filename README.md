# AWCMS — ERP & Business Solutions Platform

> **Status: fondasi ulang (rebuild).** File kode legacy di repo ini sudah dihapus (lihat commit `chore(foundation): remove legacy repository files`). Repo ini **dikembangkan ulang dari nol** di atas standar teknis modular monolith (Bun + Astro 7 + PostgreSQL/RLS), dengan **fokus bisnis yang lebih besar**: platform ERP dan integrasi solusi bisnis lainnya (bukan sekadar CMS/base generik).

## Kenapa repo ini dibangun ulang

AWCMS versi lama dibangun di atas kombinasi Node.js, Vite/React (admin & public), dan Supabase. Sepanjang siklus migrasi (ADR-013 s/d ADR-023), setiap komponen dipindah bertahap ke runtime dan arsitektur baru:

- `chore(mcp): migrasi awcms-mcp ke runtime Bun (ADR-019, #113)`
- `chore(public): migrasi awcms-public ke Bun (ADR-019, #113)`
- `chore(admin): migrasi awcms admin (Vite/React) ke Bun (ADR-019, #113)`
- `docs: referensi keputusan arsitektur kanonik (ADR-013…023 per produk)`
- `docs(readme): add architecture update note (PostgreSQL-only, RLS wajib, EmDash optional)`
- `docs: inventaris pemakaian Supabase (audit off-Supabase, #108)`

Setelah seluruh komponen (mcp, public, admin) selesai dipindah dan Supabase tidak lagi dipakai, file-file legacy di repo ini dihapus (`chore(foundation): remove legacy repository files`) — bukan untuk memensiunkan repo, melainkan untuk membersihkan lahan agar AWCMS bisa dibangun ulang di atas fondasi standar yang baru, dengan skop bisnis yang jauh lebih luas dari sebelumnya.

## Arah baru: berbasis teknologi awcms-mini, skop bisnis ERP

Repo ini **mengadopsi stack dan standar teknis dari [awcms-mini](https://github.com/ahliweb/awcms-mini)** — *modular monolith standard* AhliWeb — sebagai basis teknologi, namun **bukan sekadar turunan/derivatif base generik**. Fokus pengembangan di repo ini:

- **ERP** — modul keuangan/akuntansi, inventori/warehouse, procurement, manufaktur, HR/payroll, dsb., masing-masing sebagai modul domain dalam satu modular monolith.
- **Integrasi solusi bisnis lain** — konektor/adapter ke sistem eksternal (mis. e-commerce, payment gateway, marketplace, sistem pajak/Coretax, layanan logistik), memakai pola outbox/queue yang sama seperti sync di awcms-mini agar tetap offline-first-safe.
- **Skala multi-tenant/multi-entitas** — memanfaatkan RBAC/ABAC/RLS bawaan basis teknologi untuk mengelola banyak unit bisnis/tenant sekaligus dalam satu platform ERP.

Basis teknologi yang diadopsi dari awcms-mini:

| Aspek | Sebelumnya (repo lama) | Sekarang (basis awcms-mini) |
|---|---|---|
| Runtime | Node.js | **Bun** (Bun-only, lihat ADR-0002) |
| Web framework | Vite + React (admin/public terpisah) | **Astro 7** (SSR di atas Bun, satu shell modular monolith) |
| Database | Supabase (Postgres terkelola) | **PostgreSQL** dengan **RLS wajib** (ADR-0003) |
| Arsitektur | Aplikasi terpisah (mcp, public, admin) | **Modular monolith, microservice-ready** (ADR-0001), modul base reusable (Tenant, Identity, Profile, Access/RBAC-ABAC, Sync, Workflow, Reporting) |
| Mode operasi | Online-dependent | **Offline-first / LAN-first** dengan sync outbox HMAC-signed (ADR-0006) |
| Kontrak API | Ad-hoc | OpenAPI/AsyncAPI tervalidasi, response helper standar |

Modul base reusable (Tenant, Identity, Profile, Access/RBAC-ABAC, Sync, Workflow, Reporting) dari awcms-mini dipakai apa adanya sebagai fondasi; modul domain ERP dan integrasi bisnis dikembangkan **di atas fondasi tersebut, dalam repo ini (awcms)**.

## Referensi & titik mulai

- Baca `AGENTS.md` untuk konvensi wajib (struktur modul, RLS, ABAC, idempotency, audit, dsb.) sebelum menambah modul ERP.
- Keputusan arsitektural repo ini: [`docs/adr/`](docs/adr/README.md) — mulai dari [ADR-0001](docs/adr/0001-rebuild-on-awcms-foundation-erp-scope.md) (rebuild & skop ERP).
- Referensi standar dasar (Bun-only, RLS, offline-first) selengkapnya ada di ADR [awcms-mini](https://github.com/ahliweb/awcms-mini/blob/main/docs/adr/README.md) (ADR-0001 modular monolith, ADR-0002 Bun-only runtime, ADR-0003 PostgreSQL + RLS, ADR-0006 offline-first sync).
- Riwayat migrasi platform lama: histori git ADR-013..023 (Bun migration, off-Supabase).

Repo `awcms` ini adalah **pengembangan aktif** — bukan arsip — dengan skop bisnis ERP dan integrasi solusi bisnis yang lebih luas dari base generik sebelumnya.
