# Sejarah repo AWCMS

> Catatan sejarah, dipindahkan keluar dari `README.md` pada 13 Agustus 2026.
>
> Ia ada di sini karena README seharusnya menjawab **"ini apa, sekarang"**, dan
> sejarah yang menumpuk di bagian depan pelan-pelan mengubur jawaban itu. Tidak
> ada satu pun klaim di halaman ini yang mengikat keadaan repo hari ini —
> untuk itu, baca [`../ARCHITECTURE.md`](../ARCHITECTURE.md) dan
> [`../PROJECT_STATE.md`](../PROJECT_STATE.md).

## Kenapa repo ini dibangun ulang

AWCMS versi lama dibangun di atas kombinasi Node.js, Vite/React (admin & public), dan Supabase. Sepanjang siklus migrasi (ADR-013 s/d ADR-023), setiap komponen dipindah bertahap ke runtime dan arsitektur baru:

- `chore(mcp): migrasi awcms-mcp ke runtime Bun (ADR-019, #113)`
- `chore(public): migrasi awcms-public ke Bun (ADR-019, #113)`
- `chore(admin): migrasi awcms admin (Vite/React) ke Bun (ADR-019, #113)`
- `docs: referensi keputusan arsitektur kanonik (ADR-013…023 per produk)`
- `docs(readme): add architecture update note (PostgreSQL-only, RLS wajib, EmDash optional)`
- `docs: inventaris pemakaian Supabase (audit off-Supabase, #108)`

Setelah seluruh komponen (mcp, public, admin) selesai dipindah dan Supabase tidak lagi dipakai, file-file legacy di repo ini dihapus (`chore(foundation): remove legacy repository files`) — bukan untuk memensiunkan repo, melainkan untuk membersihkan lahan agar AWCMS bisa dibangun ulang di atas fondasi standar yang baru, dengan skop bisnis yang jauh lebih luas dari sebelumnya.

## Basis teknologi yang diadopsi dari awcms-mini

| Aspek         | Sebelumnya (repo lama)                 | Sekarang (basis awcms-mini)                                                                                                                       |
| ------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Runtime       | Node.js                                | **Bun** (Bun-only, lihat ADR-0002)                                                                                                                |
| Web framework | Vite + React (admin/public terpisah)   | **Astro 7** (SSR di atas Bun, satu shell modular monolith)                                                                                        |
| Database      | Supabase (Postgres terkelola)          | **PostgreSQL** dengan **RLS wajib** (ADR-0003)                                                                                                    |
| Arsitektur    | Aplikasi terpisah (mcp, public, admin) | **Modular monolith, microservice-ready** (ADR-0001), modul base reusable (Tenant, Identity, Profile, Access/RBAC-ABAC, Sync, Workflow, Reporting) |
| Mode operasi  | Online-dependent                       | **Hybrid online-first** (online jalur utama; offline/LAN sebagai mode ketahanan dengan sync outbox HMAC-signed, ADR-0006)                         |
| Kontrak API   | Ad-hoc                                 | OpenAPI/AsyncAPI tervalidasi, response helper standar                                                                                             |

## Padanan Inggris, sebagaimana pernah tampil di README

## Why this repo was rebuilt

The old version of AWCMS was built on a combination of Node.js, Vite/React (admin & public), and Supabase. Throughout the migration cycle (ADR-013 through ADR-023), every component was moved in stages to a new runtime and architecture:

- `chore(mcp): migrasi awcms-mcp ke runtime Bun (ADR-019, #113)`
- `chore(public): migrasi awcms-public ke Bun (ADR-019, #113)`
- `chore(admin): migrasi awcms admin (Vite/React) ke Bun (ADR-019, #113)`
- `docs: referensi keputusan arsitektur kanonik (ADR-013…023 per produk)`
- `docs(readme): add architecture update note (PostgreSQL-only, RLS wajib, EmDash optional)`
- `docs: inventaris pemakaian Supabase (audit off-Supabase, #108)`

Once every component (mcp, public, admin) had finished moving and Supabase was no longer used, the legacy files in this repo were removed (`chore(foundation): remove legacy repository files`) — not to retire the repo, but to clear the ground so AWCMS could be rebuilt on the new standard foundation, with a much broader business scope than before.

Technology base adopted from awcms-mini:

| Aspect         | Before (old repo)                    | Now (awcms-mini base)                                                                                                                               |
| -------------- | ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Runtime        | Node.js                              | **Bun** (Bun-only, see ADR-0002)                                                                                                                    |
| Web framework  | Vite + React (separate admin/public) | **Astro 7** (SSR on Bun, single modular-monolith shell)                                                                                             |
| Database       | Supabase (managed Postgres)          | **PostgreSQL** with **mandatory RLS** (ADR-0003)                                                                                                    |
| Architecture   | Separate apps (mcp, public, admin)   | **Modular monolith, microservice-ready** (ADR-0001), reusable base modules (Tenant, Identity, Profile, Access/RBAC-ABAC, Sync, Workflow, Reporting) |
| Operating mode | Online-dependent                     | **Hybrid online-first** (online is the primary path; offline/LAN is the resilience mode with HMAC-signed sync outbox, ADR-0006)                     |
| API contract   | Ad-hoc                               | Validated OpenAPI/AsyncAPI, standard response helper                                                                                                |
