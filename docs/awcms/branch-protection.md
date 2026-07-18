# Branch Protection — Required Status Checks

> **Document status.** Repo `awcms` adalah base modular monolith reusable
> ([ADR-0001](../adr/0001-rebuild-on-awcms-foundation-erp-scope.md), amended
> by [ADR-0022](../adr/0022-erp-modules-live-in-extension-repos.md)) — 10
> modul fondasi sudah ada (lihat `../ARCHITECTURE.md`), modul domain ERP
> hidup di repo ekstensi/turunan terpisah, tidak pernah di repo ini.
> `.github/workflows/ci.yml`, `codeql.yml`, dan `changesets.yml` **sudah
> ada** di repo ini (diadaptasi dari awcms-mini). Sejak Issue #166, `ci.yml`
> juga punya job `e2e-smoke` (Playwright + Bun) yang berjalan pada **setiap
> push/PR** — lihat tabel di bawah untuk detail dan untuk statusnya (belum
> di-required). `ci.yml` juga sudah punya job `integration-tests`
> (`Integration tests (RLS + DB role separation)`) yang menyalakan Postgres
> ephemeral live per-job dan menjalankan, dalam step terpisah, `bun test tests/integration/`
> (suite harness-based) lalu `bun test` atas 9 berkas ad-hoc legacy — dua
> `bun test` process terpisah, bukan satu bare `bun test`, karena kedua
> suite itu bentrok bila dijalankan bersamaan dalam satu proses (lihat
> komentar step-nya) — lihat catatan statusnya di bawah (juga belum
> di-required). Belum ada
> `docker-compose*.yml` untuk divalidasi, jadi validasi compose file
> **tidak** ada di sini (beda dari base awcms-mini) — akan ditambah begitu
> infrastrukturnya dibangun.

Acceptance criterion this document exists to satisfy: "Branch protection
documentation identifies required checks." This document is that
reference — it does **not** itself configure GitHub.

**Penting: protection repo ini hidup sebagai Repository Ruleset, bukan
classic branch protection.** Endpoint klasik yang dulu direkomendasikan
dokumen ini (`gh api repos/ahliweb/awcms/branches/main/protection`)
**404** di repo ini (`{"message":"Branch not protected", ...}`) — bukan
karena protection tidak aktif, tapi karena konfigurasinya sekarang hidup
di GitHub Rulesets (fitur yang menggantikan/berdampingan dengan classic
branch protection), yang punya endpoint API sendiri. Verifikasi state
sebenarnya dengan:

```bash
# 1. List ruleset di repo ini (cari ruleset bertarget branch `main`):
gh api repos/ahliweb/awcms/rulesets

# 2. Detail ruleset itu (ganti <id> dengan id dari langkah 1):
gh api repos/ahliweb/awcms/rulesets/<id>
```

Sebagai referensi, per penulisan dokumen ini repo memiliki satu ruleset
aktif: id `11653326`, nama **"main only"**, `target: branch`,
`enforcement: active`, berlaku untuk `~DEFAULT_BRANCH` (yaitu `main`).
Jangan asumsikan apa pun dari dokumen ini sudah berlaku tanpa menjalankan
langkah di atas dulu — konfigurasi ruleset bisa berubah kapan saja oleh
repo admin lewat UI atau API, independen dari commit ke dokumen ini.
Enabling/mengubah ruleset adalah repo-admin, shared-state change
(mempengaruhi merge flow setiap kontributor) dan deliberately left to a
maintainer to apply explicitly, not done automatically by this doc or by
CI itself.

## Required status checks (current, as configured in ruleset `11653326`)

Nama check di bawah adalah `required_status_checks` yang benar-benar
terpasang di ruleset `11653326` per penulisan dokumen ini (dikonfirmasi
lewat `gh api repos/ahliweb/awcms/rulesets/11653326`) — sebuah check
direferensikan lewat `context` (nama job/check run) plus `integration_id`
(App yang melaporkannya), bukan hanya nama:

| Check name (verbatim)                                          | Integration (App)                                                | Workflow / job                                           | What it gates                                                                                                                                                                                                      |
| -------------------------------------------------------------- | ---------------------------------------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `Quality (lint + docs + contracts + typecheck + test + build)` | GitHub Actions (`integration_id: 15368`)                         | `ci.yml` / `quality`                                     | Prettier, `check:docs` (mermaid/tautan/penamaan), `api:spec:check` (OpenAPI/AsyncAPI + route parity + public-operation allow-list), `modules:dag:check`, `logging:lint:check`, typecheck, `bun test` (unit), build |
| `Repo hygiene (Bun-only + no secrets)`                         | GitHub Actions (`integration_id: 15368`)                         | `ci.yml` / `hygiene`                                     | Konvensi tooling Bun-only, tidak ada `.env` ter-commit                                                                                                                                                             |
| `Changeset required for behavior changes`                      | GitHub Actions (`integration_id: 15368`)                         | `changesets.yml` / `policy-check`                        | Menolak PR yang menyentuh file non-docs/non-agent-tooling tanpa `.changeset/*.md` baru — lihat `scripts/changeset-policy-check.ts`                                                                                 |
| `Analyze (actions)`                                            | GitHub Actions (`integration_id: 15368`)                         | `codeql.yml` / `analyze`                                 | CodeQL static analysis atas berkas workflow GitHub Actions                                                                                                                                                         |
| `Analyze (javascript-typescript)`                              | GitHub Actions (`integration_id: 15368`)                         | `codeql.yml` / `analyze`                                 | CodeQL static analysis (query security-extended + security-and-quality) atas source TypeScript/Astro                                                                                                               |
| `CodeQL`                                                       | **CodeQL app** (`integration_id: 57789`) — beda dari App di atas | Code scanning umbrella check (bukan job di `codeql.yml`) | Check ringkasan tingkat-App dari GitHub Code Scanning atas hasil `codeql.yml`; terpisah dari kedua `Analyze (...)` per-bahasa di atas — App yang melaporkannya berbeda meski sumber datanya sama analisis CodeQL   |
| `GitGuardian Security Checks`                                  | **GitGuardian app** (`integration_id: 46505`)                    | GitHub App eksternal (bukan workflow file di repo ini)   | Secret-scanning oleh integrasi GitGuardian organisasi — **sudah aktif dan terkonfigurasi live** di repo ini (bukan aspirational)                                                                                   |

`GitGuardian Security Checks` sebelumnya didokumentasikan di sini sebagai
"belum dikonfigurasi apa pun di repo ini, tambahkan begitu diaktifkan" —
itu sudah tidak akurat: integrasinya **sudah aktif** dan sudah menjadi
salah satu `required_status_checks` di ruleset `11653326` per penulisan
ulang dokumen ini.

### `E2E smoke (Playwright)` — ada dan berjalan, tapi belum required

Job `e2e-smoke` di `ci.yml` **sudah ada** (sejak Issue #166) dan berjalan
pada setiap `push`/`pull_request` ke `main`, sama seperti `quality` dan
`hygiene` — bukan lagi sesuatu yang "belum dibangun". Namun per penulisan
dokumen ini, `E2E smoke (Playwright)` **tidak** ada di daftar
`required_status_checks` ruleset `11653326` di atas. Ini bisa dibaca dua
cara — dokumen ini tidak memutuskan yang mana:

- **Pilihan sengaja**: E2E smoke lebih lambat dan (secara desain) menguji
  jalur yang lebih sempit (login → session → SSR render) daripada
  `quality`, sehingga repo admin mungkin memilih untuk tidak memblokir
  merge di atasnya untuk sekarang.
- **Kandidat untuk ditambahkan**: karena job-nya sudah stabil dan berjalan
  di setiap PR, menambahkannya ke `required_status_checks` adalah opsi
  yang masuk akal untuk dipertimbangkan repo admin ke depan.

Menambahkan/tidak menambahkan `E2E smoke (Playwright)` sebagai required
check adalah keputusan operasional repo-admin (lihat perintah `gh api`
di bagian "Applying this" untuk caranya), bukan sesuatu yang dokumen ini
menetapkan.

### `Integration tests (RLS + DB role separation)` — ada dan berjalan, informational only

`ci.yml` juga punya job `integration-tests` (nama check:
`Integration tests (RLS + DB role separation)`) yang menyalakan Postgres
ephemeral sendiri (terpisah dari punya `e2e-smoke`), migrasi terhadapnya,
lalu menjalankan DUA step `bun test` terpisah: `bun test tests/integration/`
(suite harness-based, `tests/integration/*.integration.test.ts` — yang skip
bersih di job `quality`, karena job itu sengaja jalan tanpa `DATABASE_URL`)
dan `bun test <9 berkas ad-hoc legacy>` (`office-directory-postgres`,
`workflow-approval-concurrency`, dst.). Keduanya dipisah ke proses `bun
test` sendiri-sendiri, bukan satu bare `bun test`, karena kedua suite
terbukti bentrok (data collision/ordering) bila dijalankan bersamaan dalam
satu proses — lihat komentar step-nya di `ci.yml` dan
`tests/integration/harness.ts`. `release.yml`'s `validate` job memakai pola
step yang sama. RLS dan pemisahan role database diverifikasi nyata, bukan
cuma unit test dengan mock. Sama seperti `E2E smoke (Playwright)`, per
penulisan dokumen ini check ini **tidak** ada di daftar
`required_status_checks` ruleset `11653326` di atas — menambahkannya
sebagai required check adalah keputusan operasional repo-admin
tersendiri (lihat perintah `gh api` di bagian "Applying this"), bukan
sesuatu yang dokumen ini menetapkan atau merekomendasikan satu arah.

### Bypass actor yang terpasang di ruleset ini

Ruleset `11653326` juga mengonfigurasi satu `bypass_actors` entry:
`actor_type: RepositoryRole`, `actor_id: 5`, `bypass_mode: always`. Pada
skema penomoran role bawaan GitHub untuk ruleset bypass actors, id `5`
berkorespondensi dengan role built-in **Admin** (urutan: `1` = Read, `2`
= Triage, `3` = Write, `4` = Maintain, `5` = Admin) — artinya siapa pun
dengan akses Admin ke repo ini bisa melewati **seluruh rule** di ruleset
ini tanpa syarat, termasuk semua required status check dan syarat pull
request di atas (`current_user_can_bypass: "always"` terlihat saat
memanggil endpoint di atas sebagai admin). Ini bukan bug — bypass Admin
"always" adalah default GitHub yang umum dipertahankan supaya repo admin
tidak bisa mengunci diri sendiri keluar saat butuh perbaikan darurat —
tapi catat di sini karena efeknya nyata: admin bisa merge langsung ke
`main` tanpa PR/status check sama sekali, dan dokumen ini sebelumnya tidak
menyebutkannya sama sekali.

**Cloudflare Pages** (bila GitHub App "Cloudflare Workers and Pages"
terpasang di repo ini) **tidak boleh** masuk daftar required checks —
repo ini tidak punya konfigurasi Cloudflare Pages/Wrangler apa pun (tidak
ada `wrangler.toml`, tidak ada build command Pages yang valid untuk
skeleton Astro/Bun saat ini), jadi check itu akan selalu gagal membangun.
Bila muncul sebagai check yang gagal pada commit/PR, itu adalah sisa
instalasi GitHub App Cloudflare dari repo lama (pra-ADR-0001) yang perlu
dilepas dari sisi Cloudflare (dashboard Cloudflare → Workers & Pages →
project terkait → Settings → putuskan koneksi Git, atau hapus project) —
bukan sesuatu yang bisa diperbaiki lewat commit ke repo ini.

## Applying this (maintainer action, not automated)

Via the GitHub UI: **Settings → Rules → Rulesets** (bukan **Settings →
Branches** — itu classic branch protection UI, dan repo ini tidak
memakainya), buka atau buat ruleset bertarget branch `main`, tambahkan
rule **Require status checks to pass**, lalu cari dan tambahkan setiap
check name dari tabel di atas (GitHub hanya menawarkan check yang pernah
dilaporkan minimal sekali — merge/re-run sebuah PR dulu bila sebuah check
belum muncul di picker). Rule lain yang sudah aktif di ruleset
`11653326` dan konsisten dengan alur berbasis-PR (setiap merge harus lewat
PR, tidak pernah direct push): `deletion` (blokir hapus branch),
`non_fast_forward` (blokir force-push), dan `pull_request` (mewajibkan PR
sebelum merge, `required_approving_review_count: 0` — PR wajib ada, tapi
approval eksplisit tidak diwajibkan saat ini).

Equivalent `gh api` command (run by a repo admin; ini **membuat ruleset
baru** — untuk mengubah ruleset `11653326` yang sudah ada, pakai `PUT
repos/ahliweb/awcms/rulesets/11653326` dengan body serupa, atau edit lewat
UI di atas):

```bash
gh api -X POST repos/ahliweb/awcms/rulesets \
  -H "Accept: application/vnd.github+json" \
  --input - <<'JSON'
{
  "name": "main only",
  "target": "branch",
  "enforcement": "active",
  "conditions": {
    "ref_name": { "include": ["~DEFAULT_BRANCH"], "exclude": [] }
  },
  "rules": [
    { "type": "deletion" },
    { "type": "non_fast_forward" },
    { "type": "pull_request", "parameters": { "required_approving_review_count": 0 } },
    {
      "type": "required_status_checks",
      "parameters": {
        "strict_required_status_checks_policy": true,
        "required_status_checks": [
          { "context": "Quality (lint + docs + contracts + typecheck + test + build)" },
          { "context": "Repo hygiene (Bun-only + no secrets)" },
          { "context": "Changeset required for behavior changes" },
          { "context": "Analyze (javascript-typescript)" },
          { "context": "Analyze (actions)" },
          { "context": "CodeQL" },
          { "context": "GitGuardian Security Checks" }
        ]
      }
    }
  ],
  "bypass_actors": [
    { "actor_type": "RepositoryRole", "actor_id": 5, "bypass_mode": "always" }
  ]
}
JSON
```

(Perintah `PUT .../branches/main/protection` yang sebelumnya
didokumentasikan di sini menargetkan classic branch protection — itu
**tidak berlaku** untuk repo ini karena protection-nya sudah dipindah ke
ruleset; menjalankannya tidak akan error, tapi juga tidak akan mengubah
apa pun yang dilihat GitHub sebagai protection aktif untuk `main` di repo
ini.)

## Why `bun run check` and CI must stay the same source of truth

`package.json`'s `check` composite dan `.github/workflows/ci.yml`'s
`quality` job harus tetap lockstep: setiap step yang ditambah ke
`bun run check` butuh step senama yang cocok di `ci.yml`'s `quality` job
pada PR yang sama (atau alasan eksplisit terdokumentasi kenapa itu
release-only). Base awcms-mini pernah menemukan dan menutup drift persis
seperti ini lebih dari sekali (`api:spec:check` dan `modules:dag:check`
sempat hilang dari CI-nya untuk suatu periode) — perlakukan riwayat itu
sebagai peringatan untuk didesain dari awal di `awcms`, bukan masalah yang
ditemukan ulang nanti.

## Deferred (belum diadaptasi — butuh infrastruktur yang belum ada)

- **Validasi `docker-compose*.yml`** (bagian dari job `hygiene` di
  awcms-mini) — repo ini belum punya `docker-compose.yml`/`Dockerfile.production`.
- **`release.yml`** (build image + SBOM + cosign sign + attestation +
  GitHub Release) — butuh Dockerfile/image publish yang belum ada; lihat
  [`release-process.md`](release-process.md) untuk kapan ini relevan.

Keduanya diadaptasi begitu prasyaratnya ada — lihat
[`scripts/README.md`](../../scripts/README.md) untuk pola yang sama pada
script tooling.

(`E2E smoke (Playwright)` **bukan** lagi bagian daftar "deferred" ini —
job-nya sudah ada dan berjalan di setiap push/PR sejak Issue #166; lihat
bagian di atas soal statusnya sebagai required check.)

## See also

- [`07_sprint_testing_production_readiness.md`](07_sprint_testing_production_readiness.md)
  — testing pyramid and production readiness checklist this CI
  orchestration serves.
- `.github/workflows/ci.yml`, `codeql.yml`, `changesets.yml` — definisi
  workflow aktual yang dideskripsikan dokumen ini.
- [`release-process.md`](release-process.md) — `release.yml` (tag-triggered
  build/SBOM/sign/attest/publish pipeline) sekali didokumentasikan untuk
  repo ini, termasuk langkah manual repo-admin-nya sendiri (required
  reviewers GitHub Environment `release`) yang mengikuti pola "dokumentasikan,
  jangan self-apply" yang sama.
