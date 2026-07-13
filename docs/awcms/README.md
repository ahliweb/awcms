# Paket Dokumen Teknis AWCMS

Folder ini berisi paket dokumen teknis standar untuk platform ERP AWCMS — diadaptasi dari paket dokumen `docs/awcms-mini/` di repo [awcms-mini](https://github.com/ahliweb/awcms-mini) (basis teknologi: Bun + Astro 7 + PostgreSQL/RLS, modular monolith), disesuaikan untuk skop bisnis yang lebih besar: ERP (keuangan, inventori, procurement, manufaktur, HR/payroll) dan integrasi solusi bisnis eksternal.

## Status

Repo ini baru pada tahap fondasi ulang (lihat [ADR-0001](../adr/0001-rebuild-on-awcms-foundation-erp-scope.md)) — **belum ada modul ERP yang diimplementasikan**. Setiap dokumen di folder ini punya catatan status di bagian atas yang menjelaskan bahwa isinya adalah **rencana/target**, bukan kondisi kode saat ini. Klaim "sudah live/tersedia/terverifikasi" dari dokumen sumber awcms-mini (yang basisnya memang sudah selesai dibangun) direframe sebagai target yang mengikat untuk implementasi mendatang.

Konten yang spesifik untuk produk CMS awcms-mini (news portal, social publishing, visitor analytics) dan riwayat repo awcms-mini sendiri (snapshot issue GitHub) **tidak diadaptasi** — di luar skop ERP repo ini.

## Indeks dokumen

| Dokumen                                                                              | Isi                                                                     |
| --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| [`01_canvas_induk.md`](01_canvas_induk.md)                                                     | Ringkasan produk, arsitektur tingkat tinggi, prinsip utama                |
| [`02_prd_detail_per_modul.md`](02_prd_detail_per_modul.md)                                     | PRD per modul (fondasi + ERP: finance, procurement, inventory, dst.)     |
| [`03_srs_detail_per_modul.md`](03_srs_detail_per_modul.md)                                     | SRS/kebutuhan teknis per modul                                            |
| [`04_erd_data_dictionary.md`](04_erd_data_dictionary.md)                                       | ERD & kamus data per modul                                                |
| [`05_openapi_asyncapi_detail.md`](05_openapi_asyncapi_detail.md)                               | Detail kontrak API/event per modul                                       |
| [`07_sprint_testing_production_readiness.md`](07_sprint_testing_production_readiness.md)       | Strategi test berlapis & kesiapan produksi                               |
| [`10_template_kode_coding_standard.md`](10_template_kode_coding_standard.md)                   | Coding standard (struktur modul, Bun-only, konvensi)                      |
| [`11_implementation_blueprint.md`](11_implementation_blueprint.md)                             | Blueprint implementasi per sprint (14 sprint: foundation → ERP → integrasi) |
| [`12_generator_prompt.md`](12_generator_prompt.md)                                             | Prompt scaffolding modul per sprint                                       |
| [`14_ui_ux_design_system.md`](14_ui_ux_design_system.md)                                       | Design system, token, state pattern, a11y                                |
| [`15_frontend_architecture_integration.md`](15_frontend_architecture_integration.md)           | Arsitektur frontend (Astro SSR, islands, offline-first)                  |
| [`16_backend_data_access_integration.md`](16_backend_data_access_integration.md)               | Arsitektur data access (repository, RLS, outbox, idempotency)            |
| [`17_default_seed_rbac_abac.md`](17_default_seed_rbac_abac.md)                                 | Seed default role & policy RBAC/ABAC                                     |
| [`18_configuration_env_reference.md`](18_configuration_env_reference.md)                       | Referensi variabel environment (fondasi + placeholder ERP)               |
| [`19_glossary_terminology.md`](19_glossary_terminology.md)                                     | Glosarium istilah arsitektur & domain ERP                                |
| [`20_threat_model_security_architecture.md`](20_threat_model_security_architecture.md)         | Threat model & arsitektur keamanan (+ ancaman spesifik ERP)              |
| [`21_module_admission_governance.md`](21_module_admission_governance.md)                       | Tata kelola admission modul baru                                          |
| [`branch-protection.md`](branch-protection.md)                                                 | Kebijakan proteksi branch GitHub                                          |
| [`database-migrations.md`](database-migrations.md)                                             | Konvensi migration SQL                                                   |
| [`database-pooling.md`](database-pooling.md)                                                   | Connection pooling & backpressure                                        |
| [`database-capacity-runbook.md`](database-capacity-runbook.md)                                 | Runbook kapasitas database                                                |
| [`data-lifecycle.md`](data-lifecycle.md)                                                       | Retensi & purge data (termasuk pertimbangan retensi finansial/legal)      |
| [`deployment-profiles.md`](deployment-profiles.md)                                             | Profil deployment offline/LAN & online                                   |
| [`deploy-coolify.md`](deploy-coolify.md)                                                       | Panduan deploy via Coolify                                                |
| [`release-process.md`](release-process.md)                                                     | Proses rilis SemVer + Changesets                                         |
| [`observability-metrics.md`](observability-metrics.md)                                         | Konvensi logging/metrics/observability                                   |
| [`performance-suite.md`](performance-suite.md)                                                 | Suite test performa                                                      |
| [`production-preflight-runbook.md`](production-preflight-runbook.md)                           | Checklist preflight sebelum deploy produksi                              |
| [`production-readiness.md`](production-readiness.md)                                           | Gate kesiapan produksi                                                    |
| [`resilience-dr-verification.md`](resilience-dr-verification.md)                               | Verifikasi disaster recovery                                              |
| [`repo-inventory.md`](repo-inventory.md)                                                       | Tooling inventaris file repo                                             |
| [`extension-compatibility-policy.md`](extension-compatibility-policy.md)                       | Kebijakan kompatibilitas versi kontrak/modul                              |
| [`templates/module-proposal-template.md`](templates/module-proposal-template.md)                | Template proposal modul baru                                              |
| [`templates/module-admission-decision-checklist.md`](templates/module-admission-decision-checklist.md) | Checklist keputusan admission modul                                 |
| [`examples/minimal-domain-module.md`](examples/minimal-domain-module.md)                       | Contoh minimal modul domain ERP (`expense-category`)                     |

Dokumen yang sengaja **tidak diadaptasi** dari awcms-mini (di luar skop ERP repo ini): `06_github_issues_detail.md`, `08_sop_operasional_user_guide.md`, `09_roadmap_repository_commit.md`, `13_final_master_index_traceability.md`, `AUDIT_STANDAR_PENGEMBANGAN_*.md`, `api-reference.md`, `derived-application-guide.md`, `derived-app-pilot-plan.md`, `visitor-analytics.md`, seluruh isi `news-portal/` dan `github/`.

Lihat juga [`AGENTS.md`](../../AGENTS.md) untuk alur kerja wajib setiap task, dan [`docs/adr/`](../adr/README.md) untuk keputusan arsitektural.
