# Branch Protection — Required Status Checks

> **Document status.** Repo `awcms` is at the foundation-rebuild stage
> ([ADR-0001](../adr/0001-rebuild-on-awcms-foundation-erp-scope.md)) —
> Sprint 1–2 modul fondasi sudah ada (lihat `../ARCHITECTURE.md`), belum
> ada modul domain ERP. `.github/workflows/ci.yml`, `codeql.yml`, dan
> `changesets.yml` **sudah ada** di repo ini (diadaptasi dari awcms-mini),
> dipangkas ke apa yang benar-benar berjalan hari ini: belum ada test
> integrasi yang butuh Postgres hidup, belum ada E2E/Playwright, dan belum
> ada `docker-compose*.yml` untuk divalidasi — job `e2e-smoke` dan validasi
> compose file **tidak** ada di sini (beda dari base awcms-mini), akan
> ditambah begitu infrastrukturnya dibangun.

Acceptance criterion this document exists to satisfy: "Branch protection
documentation identifies required checks." This document is that
reference — it does **not** itself configure GitHub. As of this writing,
verify current protection state with `gh api
repos/ahliweb/awcms/branches/main/protection` before assuming any of the
below is already enabled. Enabling branch protection is a repo-admin,
shared-state change (affects every contributor's merge flow) and is
deliberately left to a maintainer to apply explicitly, not done
automatically by this doc or by CI itself.

## Required status checks (recommended)

Nama check di bawah adalah yang benar-benar dilaporkan oleh
`.github/workflows/ci.yml`, `codeql.yml`, dan `changesets.yml` di repo ini
hari ini — sebuah branch protection rule's "required status checks" harus
mereferensikan nama ini verbatim (GitHub mencocokkan `name:` job, bukan id
internalnya):

| Check name (verbatim)                                          | Workflow / job                    | What it gates                                                                                                                                                                                                      |
| -------------------------------------------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `Quality (lint + docs + contracts + typecheck + test + build)` | `ci.yml` / `quality`              | Prettier, `check:docs` (mermaid/tautan/penamaan), `api:spec:check` (OpenAPI/AsyncAPI + route parity + public-operation allow-list), `modules:dag:check`, `logging:lint:check`, typecheck, `bun test` (unit), build |
| `Repo hygiene (Bun-only + no secrets)`                         | `ci.yml` / `hygiene`              | Konvensi tooling Bun-only, tidak ada `.env` ter-commit                                                                                                                                                             |
| `Analyze (actions)`                                            | `codeql.yml` / `analyze`          | CodeQL static analysis atas berkas workflow GitHub Actions                                                                                                                                                         |
| `Analyze (javascript-typescript)`                              | `codeql.yml` / `analyze`          | CodeQL static analysis (query security-extended + security-and-quality) atas source TypeScript/Astro                                                                                                               |
| `Changeset required for behavior changes`                      | `changesets.yml` / `policy-check` | Menolak PR yang menyentuh file non-docs/non-agent-tooling tanpa `.changeset/*.md` baru — lihat `scripts/changeset-policy-check.ts`                                                                                 |

`GitGuardian Security Checks` (GitHub App check, bukan workflow file di
repo ini) sebaiknya juga masuk daftar wajib begitu integrasi GitGuardian
organisasi diaktifkan untuk repo ini; tidak dikonfigurasi oleh apa pun di
`.github/workflows/`, jadi tidak diitemisasi di atas.

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

Via the GitHub UI: **Settings → Branches → Add branch protection rule**,
pattern `main`, enable **Require status checks to pass before merging**,
then search for and add each check name from the table above (GitHub only
offers checks that have reported at least once — merge/re-run a PR first
if a check is missing from the picker). Recommended alongside it,
consistent with a PR-based workflow (every merge should go through a PR,
never a direct push):
**Require a pull request before merging**, **Require branches to be up to
date before merging**.

Equivalent `gh api` command (run by a repo admin, adjust `required_status_checks.contexts`
if the check list above has since changed):

```bash
gh api -X PUT repos/ahliweb/awcms/branches/main/protection \
  -H "Accept: application/vnd.github+json" \
  -f required_status_checks.strict=true \
  -f 'required_status_checks.contexts[]=Quality (lint + docs + contracts + typecheck + test + build)' \
  -f 'required_status_checks.contexts[]=Repo hygiene (Bun-only + no secrets)' \
  -f 'required_status_checks.contexts[]=Analyze (actions)' \
  -f 'required_status_checks.contexts[]=Analyze (javascript-typescript)' \
  -f 'required_status_checks.contexts[]=Changeset required for behavior changes' \
  -f enforce_admins=true \
  -f required_pull_request_reviews=null \
  -f restrictions=null
```

(`required_pull_request_reviews=null`/`restrictions=null` here mean "don't
additionally require review approvals / don't restrict who can push" —
tighten those separately if desired; they're independent of the status
check requirement this doc is about.)

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

- **`E2E smoke (Playwright)`** — butuh `playwright.config.ts` + suite E2E
  nyata; belum ada di repo ini.
- **Validasi `docker-compose*.yml`** (bagian dari job `hygiene` di
  awcms-mini) — repo ini belum punya `docker-compose.yml`/`Dockerfile.production`.
- **`release.yml`** (build image + SBOM + cosign sign + attestation +
  GitHub Release) — butuh Dockerfile/image publish yang belum ada; lihat
  [`release-process.md`](release-process.md) untuk kapan ini relevan.

Ketiganya diadaptasi begitu prasyaratnya ada — lihat
[`scripts/README.md`](../../scripts/README.md) untuk pola yang sama pada
script tooling.

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
