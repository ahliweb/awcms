# AWCMS — Project State & Continuation

> **Untuk apa dokumen ini.** Ringkasan **state proyek yang tahan-lama** + cara
> melanjutkan pekerjaan — dirancang sebagai **titik-lanjut ter-versioning** (alternatif
> catatan sesi privat/worktree yang tidak ikut ter-commit). Baca ini **lebih dulu** saat
> memulai/melanjutkan pekerjaan besar. Ia **melengkapi**, bukan menggantikan:
>
> - [`ARCHITECTURE.md`](ARCHITECTURE.md) — apa yang **ada di kode** (teknis, per-subsistem).
> - [`AGENTS.md`](../AGENTS.md) — **kontrak kerja** (aturan wajib, guardrail, alur task).
> - `docs/adr/` — **keputusan** arsitektural (kenapa).
>
> Sumber kebenaran state tetap **kode + `sql/` + `bun run check`**. Bila dokumen ini
> berbeda dari kode, kode yang benar — perbarui dokumen ini.

## 1. Model tata kelola saat ini (WAJIB dipahami)

Sejak [ADR-0034](adr/0034-awcms-family-direct-use-templates-and-derived-pathway-removal.md)
(men-supersede ADR-0013/0014/0015/0022/0025): **`awcms-mini`, `awcms`, `awcms-micro` =
tiga template keluarga AWCMS yang dipakai LANGSUNG**, bukan hierarki base-dan-turunan.
`awcms` = template lini **ERP/back-office**.

- Modul domain — **termasuk ERP dan modul website/konten** — **ditambahkan langsung di
  `src/modules/`** template ini saat dipakai, lalu didaftarkan di `src/modules/index.ts`.
- **Jalur aplikasi-turunan DIHAPUS**: tidak ada lagi `src/modules/application-registry.ts`,
  command `extension:check`, namespace migrasi `900+`, manifest kompatibilitas turunan.
  `ModuleType` valid = `base | system | domain | integration` (tidak ada `derived`).
- Dokumen/skill yang masih menyebut "repo turunan / derived" sebagai jalur aktif adalah
  **usang** — perlakukan sebagai catatan historis (banyak sudah bertanda DEPRECATED).

## 2. Inventori ringkas

| Aspek      | Nilai (per commit ini)                   | Sumber kebenaran                          |
| ---------- | ---------------------------------------- | ----------------------------------------- |
| Modul base | **11** (lihat daftar di ARCHITECTURE.md) | `src/modules/index.ts`                    |
| Migrasi    | **34** (`sql/001`–`034`)                 | `ls sql/`                                 |
| ADR        | **35**                                   | `docs/adr/README.id.md` (indeks ter-gate) |
| Kontrak    | OpenAPI modular per-modul + AsyncAPI     | `openapi/`, `asyncapi/`                   |

Modul: `tenant-admin`, `identity-access`, `profile-identity`, `logging`,
`module-management`, `sync-storage`, `workflow-approval`, `reporting`, `email`,
`domain-event-runtime`, `theming`.

> Catatan: generator `repo:inventory` **belum diport** dari `awcms-mini`, jadi
> [`awcms/repo-inventory.md`](awcms/repo-inventory.md) adalah placeholder — jangan
> jadikan sumber angka. Gunakan ARCHITECTURE.md / registry / `sql/`.

## 3. Yang sudah selesai (jangan dibangun ulang)

- **Fondasi 11 modul** aktif dengan RLS `FORCE`, pemisahan role DB
  (`awcms_app`/`awcms_worker`/`awcms_setup`), admin SSR read+write (Issue #166/#171).
- **Auth lanjutan**: MFA TOTP + session-assurance/step-up (`sql/024`), OIDC/SSO
  tenant-aware + SSRF guard + break-glass (`sql/025`/`026`), Turnstile bot protection
  sadar-profil (LAN/offline exempt). Lihat [`awcms/mfa-totp-step-up.md`](awcms/mfa-totp-step-up.md),
  [`awcms/oidc-sso.md`](awcms/oidc-sso.md), [`awcms/turnstile-bot-protection.md`](awcms/turnstile-bot-protection.md).
- **Authorization**: ABAC dinamis berbasis DSL (`sql/031`/`032`), business-scope hierarchy
  (`sql/027`/`028`), SoD conflict enforcement (`sql/029`/`030`).
- **`theming`** — modul website pertama di base (`sql/033`/`034`, ADR-0034 Fase 3).
- **Kontrak OpenAPI modular** per-modul + bundler deterministik (ADR-0026), **family
  compatibility manifest + CI conformance** (ADR-0032).

## 4. Backlog / langkah berikutnya

- **Port modul `awcms-mini` yang belum ada** (via skill `awcms-port-from-mini`,
  alur mini-first): `blog-content`, `news-portal`, `social-publishing`,
  `visitor-analytics`, `tenant-domain` routing, `data-lifecycle`,
  `document-infrastructure`, `form-drafts`, `integration-hub`, `idn-admin-regions`.
  Skill masing-masing (`BACAAN SAJA`) = spesifikasi target.
- **Follow-up `theming`**: port `media_library` (asset), adopsi public-route, domain events.
- **Port generator `repo:inventory`** dari mini agar `repo-inventory.md` jadi ter-generate.
- **Seam yang menunggu penyedia**: business-scope resolver base masih NO-OP fail-closed;
  SoD base ship 0 rule (rule ilustratif di fixture).

## 5. Kontrak alur kerja (ringkas)

1. **Mini-first**: fitur fondasi diuji di `awcms-mini` dulu, lalu **diport** ke sini
   (rename prefix `awcms_mini_` → `awcms_`, penomoran migrasi lanjut). Lihat
   [`awcms/alur-pengembangan-mini-first.md`](awcms/alur-pengembangan-mini-first.md).
2. **Branch dulu** (jangan commit ke `main`); satu PR = satu perubahan atomic.
3. **`bun run check` PENUH** sebelum PR (lint + docs + kontrak + typecheck + test + build;
   `bun run format` dulu bila perlu). Changeset wajib untuk perubahan perilaku.
4. Migration/OpenAPI/AsyncAPI disinkronkan setiap perubahan schema/API/event.

## 6. Jebakan yang tak terlihat dari kode (baca sebelum menyentuh area terkait)

- **Migration terapan itu immutable**: edit `sql/NNN` yang sudah jalan (bahkan komentar)
  memblokir `db:migrate` di deployment jalan — koreksi lewat migration baru.
- **RLS `ENABLE` tanpa `FORCE` itu inert** untuk table owner; wajib `FORCE` +
  role non-owner (`awcms_app`). Uji RLS di bawah role `awcms_app` LOGIN, bukan superuser.
- **4xx yang di-`return` dari dalam `withTenant` itu COMMIT** — bukan rollback.
- **Keyset cursor**: timestamptz mikrodetik vs `Date` JS milidetik → bawa `created_at`
  sebagai teks presisi penuh, jangan re-parse ke `Date`.
- **Snapshot OpenAPI beku**: test subset add-only — jangan edit snapshot; evolusi via
  `INTENTIONALLY_EVOLVED_PATHS` allow-list.
- **Postgres lokal**: host bisa rusak; pakai `docker run postgres:18.4 -p 5433:5432`
  untuk menjalankan dua suite DB-gated saat isu security.
- **CI**: GitGuardian & CodeQL adalah required check; CodeQL run kadang orphan di antrean →
  picu ulang dengan empty commit; flake Postgres CI → `gh run rerun --failed`.
- **Subagent di working tree bersama** bisa memindahkan HEAD → verifikasi
  `git branch --show-current` sebelum commit.

Detail lebih dalam ada di skill terkait (`awcms-new-migration`, `awcms-abac-guard`,
`awcms-testing`, `awcms-sync-hmac`, dst.) dan di ADR.

## 7. Cara melanjutkan

- Mulai unit kerja: skill `awcms-implement-issue` (orkestrator) → `awcms-new-module` /
  `awcms-new-migration` / `awcms-new-endpoint` / `awcms-new-event`.
- Port dari mini: skill `awcms-port-from-mini`.
- Review/keamanan: skill `awcms-pr-review`, `awcms-security-review`, subagent
  `awcms-reviewer` / `awcms-security-auditor`.
- Perbarui **dokumen ini** setiap ada perubahan state besar (modul/migrasi baru, keputusan
  tata kelola, backlog selesai) agar tetap jadi titik-lanjut yang akurat.
