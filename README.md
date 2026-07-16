# AWCMS — Basis Platform untuk ERP & Solusi Bisnis

> **AWCMS bukan sebuah ERP.** Ia adalah **basis/fondasi modular monolith** tempat aplikasi ERP & solusi bisnis dibangun di atasnya (di repo ekstensi/turunan terpisah). Tidak ada chart of accounts, general ledger, jurnal, AR/AP, valuasi inventori, payroll, atau perhitungan pajak di repo ini — dan tidak akan pernah ada; base hanya menyediakan modul fondasi reusable + **kontrak netral** kesiapan ERP. Lihat [ADR-0013](docs/adr/0013-extension-layers-and-boundary-model.md), [ADR-0020](docs/adr/0020-erp-extension-readiness-contracts.md), [ADR-0022](docs/adr/0022-erp-modules-live-in-extension-repos.md), dan [`docs/awcms/erp-extension-contracts.md`](docs/awcms/erp-extension-contracts.md).

> **Status: fondasi ulang (rebuild).** File kode legacy di repo ini sudah dihapus (lihat commit `chore(foundation): remove legacy repository files`). Repo ini **dikembangkan ulang dari nol** di atas standar teknis modular monolith (Bun + Astro 7 + PostgreSQL/RLS), sebagai **basis** yang menjadi fondasi pengembangan ERP dan solusi bisnis (bukan sekadar CMS/base generik, dan bukan pula sebuah ERP jadi).

## Kenapa repo ini dibangun ulang

AWCMS versi lama dibangun di atas kombinasi Node.js, Vite/React (admin & public), dan Supabase. Sepanjang siklus migrasi (ADR-013 s/d ADR-023), setiap komponen dipindah bertahap ke runtime dan arsitektur baru:

- `chore(mcp): migrasi awcms-mcp ke runtime Bun (ADR-019, #113)`
- `chore(public): migrasi awcms-public ke Bun (ADR-019, #113)`
- `chore(admin): migrasi awcms admin (Vite/React) ke Bun (ADR-019, #113)`
- `docs: referensi keputusan arsitektur kanonik (ADR-013…023 per produk)`
- `docs(readme): add architecture update note (PostgreSQL-only, RLS wajib, EmDash optional)`
- `docs: inventaris pemakaian Supabase (audit off-Supabase, #108)`

Setelah seluruh komponen (mcp, public, admin) selesai dipindah dan Supabase tidak lagi dipakai, file-file legacy di repo ini dihapus (`chore(foundation): remove legacy repository files`) — bukan untuk memensiunkan repo, melainkan untuk membersihkan lahan agar AWCMS bisa dibangun ulang di atas fondasi standar yang baru, dengan skop bisnis yang jauh lebih luas dari sebelumnya.

## Arah pengembangan: basis teknologi awcms-mini, skop fondasi ERP

Repo ini **mengadopsi stack dan standar teknis dari [awcms-mini](https://github.com/ahliweb/awcms-mini)** — _modular monolith standard_ AhliWeb — sebagai basis teknologi, namun **bukan sekadar turunan/derivatif base generik**. Fokus pengembangan di repo ini adalah **menyediakan fondasi**, bukan membangun ERP-nya sendiri:

- **Modul fondasi reusable** — tenant, identity/access (RBAC/ABAC/RLS), central profile, sync/outbox, workflow, reporting, observability, dsb. — dipakai apa adanya oleh setiap aplikasi turunan.
- **Kontrak netral kesiapan ERP** — bentuk data pasif, capability port, dan skema payload event (business transaction, posting, period-lock, item/currency/UoM, inventory movement, reporting projection — [ADR-0020](docs/adr/0020-erp-extension-readiness-contracts.md)) yang **diimplementasikan/dikonsumsi oleh ekstensi ERP di repo terpisah**, bukan diisi logikanya di sini.
- **Kerangka integrasi solusi bisnis** — pola outbox/queue offline-first-safe + provider adapter (mis. payment gateway, marketplace, pajak/Coretax, logistik) yang menjadi titik pasang bagi konektor domain di aplikasi turunan.
- **Skala multi-tenant/multi-entitas** — RBAC/ABAC/RLS + batas tenant/legal-entity/organization-unit ([ADR-0013](docs/adr/0013-extension-layers-and-boundary-model.md)) yang dipakai ulang oleh banyak aplikasi turunan.

Modul domain ERP sesungguhnya (finance/GL, inventory/warehouse, procurement, manufaktur, HR/payroll) dan vertikal bisnis (POS, portal sekolah, dsb.) **dibangun di repo ekstensi/turunan terpisah di atas base ini** — lihat [`docs/awcms/derived-application-guide.md`](docs/awcms/derived-application-guide.md).

Basis teknologi yang diadopsi dari awcms-mini:

| Aspek         | Sebelumnya (repo lama)                 | Sekarang (basis awcms-mini)                                                                                                                       |
| ------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Runtime       | Node.js                                | **Bun** (Bun-only, lihat ADR-0002)                                                                                                                |
| Web framework | Vite + React (admin/public terpisah)   | **Astro 7** (SSR di atas Bun, satu shell modular monolith)                                                                                        |
| Database      | Supabase (Postgres terkelola)          | **PostgreSQL** dengan **RLS wajib** (ADR-0003)                                                                                                    |
| Arsitektur    | Aplikasi terpisah (mcp, public, admin) | **Modular monolith, microservice-ready** (ADR-0001), modul base reusable (Tenant, Identity, Profile, Access/RBAC-ABAC, Sync, Workflow, Reporting) |
| Mode operasi  | Online-dependent                       | **Offline-first / LAN-first** dengan sync outbox HMAC-signed (ADR-0006)                                                                           |
| Kontrak API   | Ad-hoc                                 | OpenAPI/AsyncAPI tervalidasi, response helper standar                                                                                             |

Modul base reusable (Tenant, Identity, Profile, Access/RBAC-ABAC, Sync, Workflow, Reporting) dari awcms-mini dipakai apa adanya sebagai fondasi; modul domain ERP dan integrasi bisnis dikembangkan **di atas fondasi tersebut, di repo ekstensi/turunan terpisah** — bukan di dalam base ini ([ADR-0022](docs/adr/0022-erp-modules-live-in-extension-repos.md)).

## Referensi & titik mulai

- Baca `AGENTS.md` untuk konvensi wajib (struktur modul, RLS, ABAC, idempotency, audit, dsb.) sebelum menambah modul fondasi.
- Membangun aplikasi ERP/vertikal di atas base ini: [`docs/awcms/derived-application-guide.md`](docs/awcms/derived-application-guide.md) + kontrak [`docs/awcms/erp-extension-contracts.md`](docs/awcms/erp-extension-contracts.md).
- Keputusan arsitektural repo ini: [`docs/adr/`](docs/adr/README.md) — mulai dari [ADR-0001](docs/adr/0001-rebuild-on-awcms-foundation-erp-scope.md) (rebuild), diperbarui oleh [ADR-0013](docs/adr/0013-extension-layers-and-boundary-model.md) (lapisan ekstensi) dan [ADR-0022](docs/adr/0022-erp-modules-live-in-extension-repos.md) (ERP di repo terpisah).
- Referensi standar dasar (Bun-only, RLS, offline-first) selengkapnya ada di ADR [awcms-mini](https://github.com/ahliweb/awcms-mini/blob/main/docs/adr/README.md) (ADR-0001 modular monolith, ADR-0002 Bun-only runtime, ADR-0003 PostgreSQL + RLS, ADR-0006 offline-first sync).
- Riwayat migrasi platform lama: histori git ADR-013..023 (Bun migration, off-Supabase).

Repo `awcms` ini adalah **pengembangan aktif** — bukan arsip — sebagai **basis/fondasi** tempat ERP dan solusi bisnis dibangun di atasnya, bukan sebuah ERP jadi.
