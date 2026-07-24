🇮🇩 Bahasa Indonesia (sumber) · 🇬🇧 [English (default)](README.md)

# Paket Dokumen Teknis AWCMS

Folder ini berisi paket dokumen teknis standar AWCMS — **template lini ERP/back-office keluarga AWCMS yang dipakai LANGSUNG**, kini diposisikan **online-first hybrid, siap ERP + SaaS terintegrasi, dan superset** yang **menyerap** klaster website/e-commerce awcms-micro ([ADR-0034](../adr/0034-awcms-family-direct-use-templates-and-derived-pathway-removal.md), [ADR-0035](../adr/0035-awcms-online-first-erp-saas-superset-repositioning.md)); modul domain (ERP/website/e-commerce/konten) ditambahkan **langsung di `src/modules/`**, bukan repo turunan. Paket ini diadaptasi dari paket dokumen `docs/awcms-mini/` di repo [awcms-mini](https://github.com/ahliweb/awcms-mini) (basis teknologi: Bun + Astro 7 + PostgreSQL/RLS, modular monolith), disesuaikan untuk skop yang lebih besar: kontrak kesiapan ERP (keuangan, inventori, procurement, manufaktur, HR/payroll), kapabilitas website/e-commerce, dan kerangka integrasi solusi bisnis eksternal.

## Status

Repo ini sudah melewati tahap fondasi ulang (lihat [ADR-0001](../adr/0001-rebuild-on-awcms-foundation-erp-scope.md)) — belasan modul fondasi + website/konten sudah live (termasuk `theming`, `blog-content`, `news-portal`; auth lanjutan MFA/OIDC/SSO/business-scope/SoD; lihat [`../ARCHITECTURE.md`](../ARCHITECTURE.md) sebagai sumber kebenaran state kode). Sebagian dokumen di folder ini masih **rencana/target** untuk kapabilitas yang sedang diserap dari awcms-micro (lihat [`absorb-awcms-micro-roadmap.md`](absorb-awcms-micro-roadmap.md)), bukan seluruhnya kondisi kode saat ini. Klaim "sudah live/tersedia/terverifikasi" dari dokumen sumber awcms-mini/awcms-micro dibaca sebagai target yang mengikat untuk implementasi mendatang bila modul terkait belum di-port.

Paket ini sekarang mengadaptasi **seluruh** dokumen teknis dari repo acuan awcms-mini agar AWCMS siap dikembangkan dengan tooling agent yang sama (lihat juga [`.claude/skills/`](../../.claude/skills/README.md) dan [`Pedoman_Penggunaan_Agent_Keluarga_AWCMS_v1.0.pdf`](../Pedoman_Penggunaan_Agent_Keluarga_AWCMS_v1.0.pdf)). Dokumen yang berasal dari klaster website/e-commerce (news portal, social publishing, visitor analytics, comments, newsletter, SEO, dst.) kini menjadi **spesifikasi target penyerapan awcms-micro** ([ADR-0035](../adr/0035-awcms-online-first-erp-saas-superset-repositioning.md), peta di [`absorb-awcms-micro-roadmap.md`](absorb-awcms-micro-roadmap.md)) — modul-modul itu **diserap langsung ke `src/modules/`** template ini, bukan sekadar pola yang dipadankan.

## Indeks dokumen

| Dokumen                                                                                                | Isi                                                                         |
| ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| [`01_canvas_induk.md`](01_canvas_induk.md)                                                             | Ringkasan produk, arsitektur tingkat tinggi, prinsip utama                  |
| [`02_prd_detail_per_modul.md`](02_prd_detail_per_modul.md)                                             | PRD per modul (fondasi + ERP: finance, procurement, inventory, dst.)        |
| [`03_srs_detail_per_modul.md`](03_srs_detail_per_modul.md)                                             | SRS/kebutuhan teknis per modul                                              |
| [`04_erd_data_dictionary.md`](04_erd_data_dictionary.md)                                               | ERD & kamus data per modul                                                  |
| [`05_openapi_asyncapi_detail.md`](05_openapi_asyncapi_detail.md)                                       | Detail kontrak API/event per modul                                          |
| [`06_github_issues_detail.md`](06_github_issues_detail.md)                                             | Pola penataan epic/issue pengembangan (acuan dari repo awcms-mini)          |
| [`07_sprint_testing_production_readiness.md`](07_sprint_testing_production_readiness.md)               | Strategi test berlapis & kesiapan produksi                                  |
| [`08_sop_operasional_user_guide.md`](08_sop_operasional_user_guide.md)                                 | SOP operasional & panduan pengguna (acuan)                                  |
| [`09_roadmap_repository_commit.md`](09_roadmap_repository_commit.md)                                   | Konvensi roadmap, repository, dan commit                                    |
| [`10_template_kode_coding_standard.md`](10_template_kode_coding_standard.md)                           | Coding standard (struktur modul, Bun-only, konvensi)                        |
| [`11_implementation_blueprint.md`](11_implementation_blueprint.md)                                     | Blueprint implementasi per sprint (14 sprint: foundation → ERP → integrasi) |
| [`12_generator_prompt.md`](12_generator_prompt.md)                                                     | Prompt scaffolding modul per sprint                                         |
| [`13_final_master_index_traceability.md`](13_final_master_index_traceability.md)                       | Master index & matriks traceability antar-dokumen                           |
| [`14_ui_ux_design_system.md`](14_ui_ux_design_system.md)                                               | Design system, token, state pattern, a11y                                   |
| [`15_frontend_architecture_integration.md`](15_frontend_architecture_integration.md)                   | Arsitektur frontend (Astro SSR, islands, hybrid online-first)               |
| [`16_backend_data_access_integration.md`](16_backend_data_access_integration.md)                       | Arsitektur data access (repository, RLS, outbox, idempotency)               |
| [`17_default_seed_rbac_abac.md`](17_default_seed_rbac_abac.md)                                         | Seed default role & policy RBAC/ABAC                                        |
| [`18_configuration_env_reference.md`](18_configuration_env_reference.md)                               | Referensi variabel environment (fondasi + placeholder ERP)                  |
| [`19_glossary_terminology.md`](19_glossary_terminology.md)                                             | Glosarium istilah arsitektur & domain ERP                                   |
| [`20_threat_model_security_architecture.md`](20_threat_model_security_architecture.md)                 | Threat model & arsitektur keamanan (+ ancaman spesifik ERP)                 |
| [`21_module_admission_governance.md`](21_module_admission_governance.md)                               | Tata kelola admission modul baru                                            |
| [`branch-protection.md`](branch-protection.md)                                                         | Kebijakan proteksi branch GitHub                                            |
| [`database-migrations.md`](database-migrations.md)                                                     | Konvensi migration SQL                                                      |
| [`database-pooling.md`](database-pooling.md)                                                           | Connection pooling & backpressure                                           |
| [`database-capacity-runbook.md`](database-capacity-runbook.md)                                         | Runbook kapasitas database                                                  |
| [`data-lifecycle.md`](data-lifecycle.md)                                                               | Retensi & purge data (termasuk pertimbangan retensi finansial/legal)        |
| [`deployment-profiles.md`](deployment-profiles.md)                                                     | Profil deployment offline/LAN & online                                      |
| [`deploy-coolify.md`](deploy-coolify.md)                                                               | Panduan deploy via Coolify                                                  |
| [`release-process.md`](release-process.md)                                                             | Proses rilis SemVer + Changesets                                            |
| [`observability-metrics.md`](observability-metrics.md)                                                 | Konvensi logging/metrics/observability                                      |
| [`performance-suite.md`](performance-suite.md)                                                         | Suite test performa                                                         |
| [`production-preflight-runbook.md`](production-preflight-runbook.md)                                   | Checklist preflight sebelum deploy produksi                                 |
| [`production-readiness.md`](production-readiness.md)                                                   | Gate kesiapan produksi                                                      |
| [`resilience-dr-verification.md`](resilience-dr-verification.md)                                       | Verifikasi disaster recovery                                                |
| [`repo-inventory.md`](repo-inventory.md)                                                               | Tooling inventaris file repo                                                |
| [`extension-compatibility-policy.md`](extension-compatibility-policy.md)                               | Kebijakan kompatibilitas versi kontrak/modul                                |
| [`templates/module-proposal-template.md`](templates/module-proposal-template.md)                       | Template proposal modul baru                                                |
| [`templates/module-admission-decision-checklist.md`](templates/module-admission-decision-checklist.md) | Checklist keputusan admission modul                                         |
| [`examples/minimal-domain-module.md`](examples/minimal-domain-module.md)                               | Contoh minimal modul domain ERP (`expense-category`)                        |
| [`api-reference.md`](api-reference.md)                                                                 | Referensi API gabungan (acuan format)                                       |
| [`absorb-awcms-micro-roadmap.md`](absorb-awcms-micro-roadmap.md)                                       | Peta penyerapan klaster website/e-commerce awcms-micro (ADR-0035)           |
| [`derived-application-guide.md`](derived-application-guide.md)                                         | **DEPRECATED** (ADR-0034) — panduan aplikasi turunan (jalur dicabut)        |
| [`derived-app-pilot-plan.md`](derived-app-pilot-plan.md)                                               | **DEPRECATED** (ADR-0034) — rencana pilot aplikasi turunan (jalur dicabut)  |
| [`erp-extension-contracts.md`](erp-extension-contracts.md)                                             | Kontrak kesiapan ekstensi ERP (lihat ADR-0020)                              |
| [`visitor-analytics.md`](visitor-analytics.md)                                                         | Analitik pengunjung (acuan pola, asal produk CMS)                           |
| [`AUDIT_STANDAR_PENGEMBANGAN_2026-07-04.md`](AUDIT_STANDAR_PENGEMBANGAN_2026-07-04.md)                 | Audit kepatuhan standar pengembangan (acuan)                                |
| [`module-composition-inventory.json`](module-composition-inventory.json)                               | Inventaris komposisi modul (artefak, regenerasi via tooling)                |
| [`work-class-registry.generated.json`](work-class-registry.generated.json)                             | Registry work-class (artefak generated)                                     |

Panduan agent keluarga AWCMS (PDF): [`../Pedoman_Penggunaan_Agent_Keluarga_AWCMS_v1.0.pdf`](../Pedoman_Penggunaan_Agent_Keluarga_AWCMS_v1.0.pdf).

Dua JSON di atas (`module-composition-inventory.json`, `work-class-registry.generated.json`) adalah **artefak yang di-generate** di repo acuan; nilainya masih mencerminkan modul awcms-mini dan akan diregenerasi oleh tooling repo ini begitu modul ERP terkait ada. Snapshot GitHub (`docs/awcms/github/`) belum diadaptasi — dihasilkan oleh skill `awcms-github-snapshot` saat dijalankan terhadap tracker repo ini.

Lihat juga [`AGENTS.md`](../../AGENTS.md) untuk alur kerja wajib setiap task, dan [`docs/adr/`](../adr/README.md) untuk keputusan arsitektural.
