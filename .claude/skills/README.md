# AWCMS Project Skills

Skill Claude Code tingkat-proyek untuk AWCMS. Setiap skill meng-encode standar dari `docs/awcms/` sehingga coding agent menerapkannya secara konsisten. Skill dipanggil otomatis oleh model saat relevan, atau manual via `/<nama-skill>`.

> Baca [`../../AGENTS.md`](../../AGENTS.md) lebih dulu untuk aturan wajib & alur kerja.

> **Asal & status.** Skill-skill ini diadaptasi dari repo acuan
> [`ahliweb/awcms-mini`](https://github.com/ahliweb/awcms-mini) (basis teknis
> modular monolith yang sama) dan menjadi **playbook pengembangan** AWCMS —
> mereka mendeskripsikan pola _target_ standar, bukan klaim bahwa semua modul
> sudah ada. Implementasi AWCMS saat ini baru fondasi Sprint 1–2 (`logging`,
> `tenant-admin`, `profile-identity`, `identity-access` — lihat
> [`docs/ARCHITECTURE.md`](../../docs/ARCHITECTURE.md)). Referensi nomor issue
> (`#NNN`) dan modul CMS (blog, news portal, dsb.) menunjuk ke pola/epik di
> repo acuan sebagai contoh; padankan ke peta sprint ERP di
> [`docs/awcms/11_implementation_blueprint.md`](../../docs/awcms/11_implementation_blueprint.md)
> saat mengerjakan modul AWCMS yang setara.

> **Command `bun run <x>` di dalam skill adalah target.** Banyak skill merujuk
> script (mis. `repo:inventory:check`, `openapi:bundle`, `extension:check`,
> `data-lifecycle:*`, `reporting:*`) yang **belum diimplementasikan** di repo ini —
> hanya ~23 script yang benar-benar terdaftar di `package.json`. Sebelum
> menjalankan sebuah command dari skill, **verifikasi keberadaannya di
> `package.json`**; bila belum ada, itu bagian standar yang masih perlu di-port
> dari awcms-mini (lihat
> [`docs/awcms/alur-pengembangan-mini-first.md`](../../docs/awcms/alur-pengembangan-mini-first.md)),
> bukan perintah yang bisa langsung dieksekusi.

## Katalog

| Skill                                        | Kapan dipakai                                                                                                                                                                            | Sumber docs                                                  |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `awcms-implement-issue`                      | Orkestrator: kerjakan satu issue/sprint atomic end-to-end                                                                                                                                | 06, 11, 12                                                   |
| `awcms-new-module`                           | Scaffold modul baru di `src/modules/`                                                                                                                                                    | 10, 11                                                       |
| `awcms-port-from-mini`                       | Port modul matang dari awcms-mini ke awcms (rename prefix, konsolidasi migrasi, drop dep/toolchain absen, DoD, commit atomic)                                                            | alur-pengembangan-mini-first.md                              |
| `awcms-module-management`                    | Kelola/konsumsi sistem Module Management (registry, lifecycle, settings, health)                                                                                                         | module-management/README.md                                  |
| `awcms-new-migration`                        | Buat/ubah migration SQL (tabel, index, RLS)                                                                                                                                              | 04, 10                                                       |
| `awcms-new-endpoint`                         | Tambah/ubah endpoint REST + OpenAPI                                                                                                                                                      | 05, 10                                                       |
| `awcms-new-event`                            | Tambah/ubah domain event + AsyncAPI                                                                                                                                                      | 05                                                           |
| `awcms-idempotency`                          | Mutation high-risk anti double-submit                                                                                                                                                    | 10                                                           |
| `awcms-abac-guard`                           | Kontrol akses default-deny + RLS                                                                                                                                                         | 03, 10                                                       |
| `awcms-audit-log`                            | Audit aksi high-risk + redaction                                                                                                                                                         | 03, 10                                                       |
| `awcms-observability`                        | Correlation ID otomatis, retensi/purge audit log, extension point log/audit                                                                                                              | 10, 16, 20                                                   |
| `awcms-new-migration` + `awcms-new-endpoint` | Soft delete/restore/purge resource deletable                                                                                                                                             | 04, 05, 10, 16                                               |
| `awcms-sensitive-data`                       | Normalize/hash/mask identifier sensitif                                                                                                                                                  | 04                                                           |
| `awcms-sync-hmac`                            | Sync push/pull bertanda HMAC + anti-replay                                                                                                                                               | 08, 10                                                       |
| `awcms-security-review`                      | Review keamanan modul                                                                                                                                                                    | 12, 13                                                       |
| `awcms-codeql-triage`                        | Triase & perbaiki temuan CodeQL code scanning (termasuk katalog false-positive)                                                                                                          | 20                                                           |
| `awcms-pr-review`                            | Review pull request terhadap DoD                                                                                                                                                         | 09, 10, 12                                                   |
| `awcms-testing`                              | Tulis test berlapis (unit→security)                                                                                                                                                      | 07                                                           |
| `awcms-browser-test`                         | E2E browser sungguhan (Playwright + Bun) — puncak piramida testing                                                                                                                       | 07, browser-test/SKILL.md                                    |
| `awcms-production-preflight`                 | Preflight & go-live readiness                                                                                                                                                            | 07, 12                                                       |
| `awcms-deploy`                               | Pilih & jalankan profil deployment (LAN-first vs registry/Coolify)                                                                                                                       | 18, deploy-coolify.md                                        |
| `awcms-ui-screen`                            | Implementasi layar/komponen UI sesuai design system                                                                                                                                      | 14, 15                                                       |
| `awcms-wizard-form`                          | Form multi-step (reusable wizard pattern)                                                                                                                                                | wizard-form-pattern.md                                       |
| `awcms-form-drafts`                          | Server-side draft persistence (resume lintas sesi/perangkat)                                                                                                                             | form-drafts/README.md                                        |
| `awcms-email`                                | Kirim email transaksional (provider-neutral, template management, outbox)                                                                                                                | email/README.md                                              |
| `awcms-i18n`                                 | String UI `.po` gettext & konten multi-bahasa                                                                                                                                            | 14, 04, 19                                                   |
| `awcms-release`                              | Rilis versi via Changesets (bump, CHANGELOG, tag)                                                                                                                                        | 09                                                           |
| `awcms-legacy-migration`                     | Migrasi data legacy aman (dry-run, backfill)                                                                                                                                             | 07, 06                                                       |
| `awcms-blog-content`                         | Kerjakan bagian mana pun epic blog_content (Issue #537-#543)                                                                                                                             | blog-content/README.md                                       |
| `awcms-tenant-domain-routing`                | Kerjakan bagian mana pun epic online public routing & tenant domain (Issue #556-#567)                                                                                                    | tenant-domain-routing/SKILL.md                               |
| `awcms-auth-online-hardening`                | Kerjakan bagian mana pun epic full-online auth security hardening (Issue #587-#593)                                                                                                      | auth-online-hardening/SKILL.md                               |
| `awcms-visitor-analytics`                    | Kerjakan bagian mana pun epic visitor analytics (Issue #617-#624)                                                                                                                        | visitor-analytics/SKILL.md                                   |
| `awcms-news-portal`                          | Kerjakan bagian mana pun epic news_portal full-online R2-only media (Issue #631-#642, #649)                                                                                              | news-portal/SKILL.md                                         |
| `awcms-idn-admin-regions`                    | Kerjakan bagian mana pun epic master data wilayah administratif Indonesia (Issue #655-#664)                                                                                              | idn-admin-regions/SKILL.md                                   |
| `awcms-social-publishing`                    | Kerjakan bagian mana pun epic social_publishing auto-posting outbox foundation (Issue #643-#647)                                                                                         | social-publishing/SKILL.md                                   |
| `awcms-data-lifecycle`                       | Daftarkan tabel bervolume tinggi ke registry retensi/partisi/arsip/legal hold/purge (Issue #745)                                                                                         | data-lifecycle/README.md, data-lifecycle.md                  |
| `awcms-erp-extension-readiness`              | Konsumsi/evolusikan kontrak kesiapan ekstensi ERP — business transaction, posting, period-lock, item/currency/UoM, inventory movement, reconciliation, reporting projection (Issue #755) | erp-extension-readiness/SKILL.md, erp-extension-contracts.md |
| `awcms-document-infrastructure`              | Kerjakan bagian mana pun modul document_infrastructure — registry dokumen generik, versioning, classification, numbering (Issue #751)                                                    | document-infrastructure/SKILL.md                             |
| `awcms-integration-hub`                      | Kerjakan bagian mana pun modul integration_hub — inbound webhook, outbound subscription, adapter health, SSRF guard (Issue #754)                                                         | integration-hub/SKILL.md                                     |
| `awcms-workflow-approval`                    | Kerjakan bagian mana pun modul workflow_approval — graph engine, quorum, delegation, escalation (Issue 11.1, evolved #747)                                                               | workflow-approval/SKILL.md                                   |
| `awcms-profile-identity`                     | Kerjakan bagian mana pun modul profile_identity — party CRUD, dedup, merge workflow, cross-tenant guard (Issue 2.2, dilengkapi #748)                                                     | profile-identity/SKILL.md                                    |

## Katalog peningkatan (improvement/hardening)

Skill di bawah bersifat **peningkatan** — menilai & menaikkan mutu artefak yang sudah ada, bukan membangunnya dari nol. Pakai setelah fitur jalan, saat audit, atau menjelang go-live.

| Skill                      | Kapan dipakai                                                           | Sumber docs |
| -------------------------- | ----------------------------------------------------------------------- | ----------- |
| `awcms-ux-review`          | Audit & naikkan mutu UI/UX yang sudah ada (usability, a11y AA, i18n)    | 14, 15, 19  |
| `awcms-performance`        | Tuning performa aplikasi & database (query, index, pagination, pool)    | 16, 07      |
| `awcms-integration`        | Kerasan backend & integrasi eksternal (outbox, retry, webhook, kontrak) | 16, 05, 10  |
| `awcms-security-hardening` | Audit keamanan berbasis standar (OWASP Top 10, ASVS, ISO 27001)         | 20, 10, 13  |

## Katalog maintenance/tooling

Skill di bawah bukan build fitur maupun audit — murni menjaga artefak
mekanis (docs snapshot, dsb.) tetap sinkron dengan state eksternal.

| Skill                   | Kapan dipakai                                                                               | Sumber docs             |
| ----------------------- | ------------------------------------------------------------------------------------------- | ----------------------- |
| `awcms-github-snapshot` | Refresh `docs/awcms/github/` setelah issue/label/milestone/security alert berubah di GitHub | github/README.md        |
| `awcms-repo-inventory`  | Regenerate `docs/awcms/repo-inventory.md` setelah menambah modul/migration/tabel/test/route | repo-inventory/SKILL.md |

## Peta pemakaian

```mermaid
flowchart TD
  II[awcms-implement-issue] --> NM[awcms-new-module]
  NM --> MM[awcms-module-management]
  MM --> ABAC
  II --> MIG[awcms-new-migration]
  II --> EP[awcms-new-endpoint]
  II --> EV[awcms-new-event]
  II --> TST[awcms-testing]
  TST --> BRT[awcms-browser-test]
  EP --> ABAC[awcms-abac-guard]
  EP --> IDEM[awcms-idempotency]
  ABAC --> AUD[awcms-audit-log]
  AUD --> OBS[awcms-observability]
  EP --> OBS
  EP --> SD[awcms-sensitive-data]
  EV --> SYNC[awcms-sync-hmac]
  II --> UI[awcms-ui-screen]
  UI --> I18N[awcms-i18n]
  UI --> WIZ[awcms-wizard-form]
  WIZ --> IDEM
  WIZ --> I18N
  WIZ --> DRAFT[awcms-form-drafts]
  DRAFT --> IDEM
  DRAFT --> ABAC
  II --> LEG[awcms-legacy-migration]
  II --> BLOG[awcms-blog-content]
  BLOG --> EP
  BLOG --> MIG
  II --> TDR[awcms-tenant-domain-routing]
  TDR --> EP
  TDR --> MIG
  TDR --> NM
  TDR --> BLOG
  TDR --> MM[awcms-module-management]
  II --> AOH[awcms-auth-online-hardening]
  AOH --> EP
  AOH --> IDEM
  AOH --> ABAC
  AOH --> AUD
  AOH --> SD
  II --> VA[awcms-visitor-analytics]
  VA --> MIG
  VA --> NM
  VA --> EP
  VA --> UI
  VA --> SD
  II --> PR[awcms-pr-review]
  PR --> SEC[awcms-security-review]
  PR --> CQ[awcms-codeql-triage]
  SEC --> PF[awcms-production-preflight]
  PF --> DEP[awcms-deploy]
  DEP --> REL[awcms-release]

  UI --> UXR[awcms-ux-review]
  EP --> PERF[awcms-performance]
  EP --> INT[awcms-integration]
  INT --> OBS
  SEC --> HARD[awcms-security-hardening]
  HARD --> OBS
  PERF --> PF
  HARD --> PF
  EP --> EMAIL[awcms-email]
  EMAIL --> INT
  EMAIL --> SD
  II --> DL[awcms-data-lifecycle]
  DL --> MIG
  DL --> NM
  DL --> EP
  DL --> ABAC
  DL --> AUD
  DL --> IDEM
  II --> ERPX[awcms-erp-extension-readiness]
  ERPX --> IDEM
  ERPX --> EV
  II --> DOCI[awcms-document-infrastructure]
  DOCI --> MIG
  DOCI --> EP
  DOCI --> ABAC
  DOCI --> AUD
  DOCI --> IDEM
  II --> IH[awcms-integration-hub]
  IH --> MIG
  IH --> EP
  IH --> ABAC
  IH --> AUD
  IH --> INT
  II --> WF[awcms-workflow-approval]
  WF --> MIG
  WF --> EP
  WF --> ABAC
  WF --> AUD
  WF --> IDEM
  WF --> EV
  II --> PI[awcms-profile-identity]
  PI --> MIG
  PI --> EP
  PI --> ABAC
  PI --> AUD
  PI --> SD
```

## Subagents (`.claude/agents/`)

Selain skill, tersedia **subagent** untuk delegasi kerja penuh:

| Agent                    | Peran                                               | Tools     |
| ------------------------ | --------------------------------------------------- | --------- |
| `awcms-coder`            | Implementasi issue end-to-end (Prompt Induk doc 12) | Semua     |
| `awcms-reviewer`         | Review PR/diff terhadap DoD (read-only)             | Read-only |
| `awcms-security-auditor` | Audit keamanan modul, verdict go-live (read-only)   | Read-only |

Pola pakai: `awcms-coder` mengerjakan issue → `awcms-reviewer` mereview → modul sensitif diaudit `awcms-security-auditor`.

## Konvensi

- Nama skill: `awcms-<area>`; folder `<nama>/SKILL.md`.
- Frontmatter `description` memuat pemicu (kapan dipakai) agar model memilih dengan tepat.
- Skill merujuk ke `docs/awcms/*` sebagai sumber kebenaran, bukan menduplikasi seluruh isinya.
