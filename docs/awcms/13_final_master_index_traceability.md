# Bagian 13 — Final Master Index dan Traceability Matrix

> **Contoh domain (ilustratif).** Dokumen ini memakai domain retail/POS sebagai contoh berjalan. **Pola & standar**-nya reusable untuk template AWCMS; **entitas, endpoint, layar, dan istilah domain** (produk, POS, gudang, pajak, CRM, AI, dsb.) adalah ilustrasi. Modul domain nyata (ERP, website/e-commerce, konten) ditambahkan **langsung di `src/modules/`** template ini ([ADR-0034](../adr/0034-awcms-family-direct-use-templates-and-derived-pathway-removal.md)/[ADR-0035](../adr/0035-awcms-online-first-erp-saas-superset-repositioning.md)). Lihat [README paket dokumen](README.md).

## Tujuan

Dokumen ini menjadi master index final untuk seluruh paket dokumen AWCMS, sekaligus traceability matrix dari kebutuhan bisnis sampai implementasi, test, security, SOP, dan production readiness.

## Master index dokumen

| Bagian | File                                                                                                                | Fungsi                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| -----: | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
|      1 | `01_canvas_induk.md`                                                                                                | Canvas arsitektur dan fase pengembangan                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
|      2 | `02_prd_detail_per_modul.md`                                                                                        | Kebutuhan produk per modul                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
|      3 | `03_srs_detail_per_modul.md`                                                                                        | Spesifikasi teknis per modul                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
|      4 | `04_erd_data_dictionary.md`                                                                                         | ERD, data dictionary, RLS, index                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
|      5 | `05_openapi_asyncapi_detail.md`                                                                                     | API contract dan event contract                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
|      6 | `06_github_issues_detail.md`                                                                                        | Issue atomic siap copy-paste                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
|      7 | `07_sprint_testing_production_readiness.md`                                                                         | Sprint, testing, go-live                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
|      8 | `08_sop_operasional_user_guide.md`                                                                                  | SOP operasional dan user guide                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
|      9 | `09_roadmap_repository_commit.md`                                                                                   | Roadmap repo, branch, commit, release                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
|     10 | `10_template_kode_coding_standard.md`                                                                               | Template kode dan coding standard                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
|     11 | `11_implementation_blueprint.md`                                                                                    | Skeleton dan blueprint per sprint                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
|     12 | `12_generator_prompt.md`                                                                                            | Prompt eksekusi coding agent                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
|     13 | `13_final_master_index_traceability.md`                                                                             | Master index dan traceability                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
|     14 | `14_ui_ux_design_system.md`                                                                                         | Design system, token, komponen, layar, a11y, i18n                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
|     15 | `15_frontend_architecture_integration.md`                                                                           | Arsitektur frontend, API client, auth, hybrid online-first                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
|     16 | `16_backend_data_access_integration.md`                                                                             | Data access, pooling, RLS, transaction, outbox                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
|     17 | `17_default_seed_rbac_abac.md`                                                                                      | Role default, permission matrix, ABAC policy, seed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
|     18 | `18_configuration_env_reference.md`                                                                                 | Referensi env, feature flag, topologi deployment                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
|     19 | `19_glossary_terminology.md`                                                                                        | Glossary & terminologi lintas dokumen                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
|     20 | `20_threat_model_security_architecture.md`                                                                          | Threat model (STRIDE), trust boundary, kontrol keamanan berlapis (dokumen base)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
|     21 | `21_module_admission_governance.md`                                                                                 | Kategori modul, pohon keputusan admission, pemetaan registry, trusted registry policy                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
|    ADR | `../adr/README.md`                                                                                                  | Architecture Decision Records (keputusan base + alasan) — termasuk `../adr/0013-extension-layers-and-boundary-model.md` (Issue #739, epic #738 `platform-evolution`): lapisan ekstensi Core/System Foundation/Official Optional Business Foundation/SaaS Control Plane/ERP Extension/Derived Application (lapisan _ERP Extension_/_Derived Application_ kini **historis/disupersede** oleh [ADR-0034](../adr/0034-awcms-family-direct-use-templates-and-derived-pathway-removal.md)/[ADR-0035](../adr/0035-awcms-online-first-erp-saas-superset-repositioning.md) — modul domain hidup langsung di `src/modules/`), batas tenant vs legal entity vs organization unit, data-ownership matrix, dan kriteria evidence-based ekstraksi layanan; `../adr/0014-deterministic-build-time-module-composition.md` (Issue #740, epic #738): titik ekstensi `application-registry.ts`, taksonomi kegagalan komposisi, dan konvensi namespace migration; dan `../adr/0020-erp-extension-readiness-contracts.md` (Issue #755, epic #738 Wave 4): kontrak business transaction/posting/period-lock/item/currency/UoM/inventory-movement/reconciliation/report-projection untuk ekstensi ERP, tanpa modul/tabel ERP baru di base |
|   Gov. | `../../GOVERNANCE.md`, `../../CONTRIBUTING.md`, `../../SECURITY.md`, `../../CODE_OF_CONDUCT.md`, `../../SUPPORT.md` | Tata kelola, kontribusi, keamanan, komunitas                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
|     CI | `../../.github/workflows/`                                                                                          | CodeQL + CI: lint, docs-check, typecheck, unit test, hygiene (Bun-only, no-`.env`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
|  Tools | `../../scripts/`, `../../tests/`                                                                                    | Pemeriksa docs Bun-native (`scripts/lib/docs-checks.mjs`) + unit/integration test (`bun test`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| GitHub | `github/README.md`                                                                                                  | Snapshot issue aktual, label, milestone, dan proses refresh                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |

## Executive summary final

AWCMS adalah standar modular monolith berbasis AWCMS dengan stack final:

```text
Bun-only backend + Astro 7 + PostgreSQL + Modular Monolith + Hybrid online-first (offline/LAN sebagai mode ketahanan)
```

Keputusan teknis:

1. PostgreSQL sebagai database utama.
2. Bun sebagai runtime dan backend platform; Node.js hanya boleh lewat pengecualian tertulis bila Bun belum mendukung capability yang diperlukan.
3. Astro 7 sebagai web framework.
4. Modular monolith, microservice-ready.
5. Hybrid online + offline, prioritas online-first (offline/LAN = mode ketahanan).
6. Optional online sync.
7. Optional Cloudflare R2.
8. Optional StarSender/Mailketing.
9. Optional AI analyst via safe views.
10. RBAC + ABAC + RLS + Audit Log.
11. Coretax-ready via staging/XML/checksum/approval/audit.
12. Soft delete tenant-safe untuk master/config/draft; posted/append-only entity tetap immutable.

## Rantai traceability

```mermaid
flowchart LR
  BN[Business Need] --> PRD[PRD 02]
  PRD --> SRS[SRS 03]
  SRS --> ERD[ERD 04]
  ERD --> API[OpenAPI/AsyncAPI 05]
  API --> ISS[Issues 06]
  ISS --> SPR[Sprint 07]
  SPR --> TST[Test 07]
  TST --> SOP[SOP 08]
  SOP --> DONE([Traceable & Auditable])
```

## Traceability — Business Need ke Modul

| Business Need            | Modul                 | Output                             |
| ------------------------ | --------------------- | ---------------------------------- |
| Multi tenant toko/cabang | Tenant Admin          | Tenant, office, physical location  |
| User login dan role      | Identity & Access     | Identity, tenant user, role        |
| Hak akses fleksibel      | Identity & Access     | RBAC, ABAC, decision log           |
| Profil terpusat          | Central Profile       | Profile, identifier, entity link   |
| Master produk            | Catalog Inventory     | Product, category, unit, price     |
| Arsip master data aman   | Semua modul master    | Soft delete, restore, purge policy |
| Stok toko/gudang         | Catalog Inventory     | Balance, movement                  |
| Transaksi operasional    | Sales POS             | Checkout, payment, sales document  |
| Posting aman             | Sales POS + Inventory | Idempotency, stock lock, audit     |
| Shared stock             | Shared Stock Routing  | Pool, routing rule, decision       |
| Multi gudang             | Warehouse             | Warehouse, bin, lot, transfer      |
| Receipt digital          | CRM                   | PDF, WA/email outbox, portal       |
| Offline sync             | Sync Storage          | Outbox, inbox, conflict            |
| Data pajak               | Accounting Tax        | Tax profile, NITKU, VAT invoice    |
| Coretax-ready            | Accounting Tax        | XML batch, checksum, approval      |
| Dashboard                | Reporting             | Sales/stock/tax/sync reports       |
| AI insight               | AI Analyst            | Safe read-only tools               |
| UI admin/operator        | UI Experience         | Admin shell, POS screen            |
| Audit/troubleshooting    | Observability         | Logs, audit, security events       |
| DB reliability           | DB Connectivity       | Pool, queue, circuit breaker       |
| Approval high-risk       | Workflow              | Workflow instance/task/decision    |
| Go-live aman             | Production Security   | Readiness, findings, gates         |

## Traceability — PRD → SRS → ERD → API → Issue → Sprint → Test

| Need               | SRS Area              | Tabel                                    | API                                | Issue            | Sprint | Test                 |
| ------------------ | --------------------- | ---------------------------------------- | ---------------------------------- | ---------------- | -----: | -------------------- |
| Setup tenant       | Tenant Admin          | `awcms_tenants`, `awcms_offices`         | `/setup/initialize`                | 12.1             |    1–2 | setup test           |
| Login              | Identity              | `awcms_identities`, `awcms_tenant_users` | `/auth/login`                      | 2.3              |      2 | login test           |
| Access control     | ABAC                  | `awcms_roles`, `awcms_abac_policies`     | `/access/evaluate`                 | 2.4              |      3 | default deny         |
| Customer profile   | Profile               | `awcms_profiles`, identifiers            | `/profiles/resolve`                | 2.2              |      2 | resolver             |
| Product            | Inventory             | `awcms_products`                         | `/inventory/products`              | 3.1              |      4 | CRUD/search          |
| Soft delete master | Shared + modul domain | `deleted_at`, `deleted_by`               | `DELETE/restore/includeDeleted`    | 0.1/0.3 + domain |    1–4 | archive/restore      |
| Stock              | Inventory             | `awcms_stock_balances`, movements        | `/inventory/stock-balances`        | 3.2              |      4 | movement             |
| Checkout           | Sales                 | `awcms_checkout_sessions`                | `/sales/checkout-sessions`         | 3.3              |      5 | checkout             |
| Posting            | Sales                 | `awcms_sales_documents`, idempotency     | `/sales/.../post`                  | 3.4              |      5 | idempotency/rollback |
| Receipt            | CRM                   | `awcms_receipt_pdfs`                     | `/crm/receipts/{id}/send`          | 5.1              |      7 | PDF                  |
| WA/email           | CRM                   | `awcms_message_outbox`                   | `/crm/receipts/{id}/send`          | 5.2/5.3          |      7 | provider mock        |
| Sync               | Sync                  | `awcms_sync_outbox`, inbox               | `/sync/push`                       | 6.1              |      8 | HMAC                 |
| Conflict           | Sync                  | `awcms_sync_conflicts`                   | `/sync/conflicts/{id}/resolve`     | 6.2              |      8 | conflict             |
| Warehouse          | WMS                   | `awcms_warehouses`, bins                 | `/warehouses`                      | 4.1              |      9 | location             |
| Transfer           | WMS                   | transfer tables                          | `/warehouse-transfers`             | 4.3              |      9 | transfer             |
| Cycle count        | WMS                   | cycle count tables                       | `/cycle-counts`                    | 4.4              |      9 | variance             |
| VAT invoice        | Tax                   | `awcms_vat_invoices`                     | `/tax/vat-invoices/generate`       | 7.3              |     10 | validation           |
| Coretax            | Tax                   | `awcms_coretax_batches`                  | `/tax/coretax/batches`             | 7.4              |     10 | XML/checksum         |
| UI                 | UI                    | UI registry                              | `/ui/navigation`                   | 8.1/8.2          |     11 | render               |
| Reports            | Reporting             | report views                             | `/reports/sales/daily`             | 9.1              |     11 | tenant-aware         |
| AI                 | AI                    | `awcms_ai_tool_calls`                    | `/ai/business-analyst/chat`        | 9.2              |     11 | no PII/SQL           |
| Logs               | Observability         | `awcms_log_events`                       | `/logs/recent`                     | 10.1             |      6 | redaction            |
| Pooling            | DB                    | `awcms_db_pool_*`                        | `/database/pool/health`            | 10.2             |      6 | health/load          |
| Workflow           | Workflow              | `awcms_workflow_*`                       | `/workflow/tasks/{id}/decision`    | 11.1             |     12 | approval             |
| Security           | Security              | `awcms_security_*`                       | `/security/go-live-gates/evaluate` | 10.3             |     12 | go-live gate         |

## Matrix Modul vs Migration

Sumber: `docs/awcms/repo-inventory.md` §Migrations dan
`src/modules/index.ts`, keduanya dibaca ulang saat menulis tabel ini.
`repo-inventory.md` saat ini **hand-maintained** (bukan hasil generate
nyata) — `bun run repo:inventory:generate` dan
`scripts/repo-inventory-generate.ts` belum ada di repo ini; lihat
disclaimer di puncak `repo-inventory.md` sendiri untuk statusnya. **45 file migration nyata** di
`sql/` (`001`..`045`), dipetakan ke **13 modul terdaftar** (urutan
`src/modules/index.ts`: `logging`, `tenant-admin`, `profile-identity`,
`identity-access`, `module-management`, `domain-event-runtime`,
`sync-storage`, `workflow-approval`, `email`, `reporting`, `theming`,
`blog-content`, `news-portal`). Tabel ini
menggantikan versi sebelumnya yang mengutip nama file fiktif (mis.
`003_awcms_catalog_inventory_schema.sql`,
`004_awcms_sales_pos_schema.sql`) dari sebuah sistem POS/retail yang
tidak pernah dibangun di repo base ini — berbeda dari tabel-tabel lain di
dokumen ini yang sengaja memakai domain retail/POS **ilustratif** (lihat
banner di puncak dokumen), tabel ini secara spesifik mendokumentasikan
struktur repo NYATA, sehingga mengikuti data real, bukan ilustrasi.

| Modul (`key`)                | Migration                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| _(Foundation, lintas-modul)_ | `001_awcms_foundation_schema.sql`, `017_awcms_enforce_rls_force.sql`, `019_awcms_db_role_separation.sql`, `021_awcms_db_role_grants_narrow.sql`                                                                                                                                                                                                                                                                                         |
| `tenant_admin`               | `002_awcms_tenant_office_schema.sql`, `006_awcms_setup_wizard_schema.sql`, `015_awcms_tenant_settings_management_permission_schema.sql`, `016_awcms_tenant_default_locale_english_schema.sql`                                                                                                                                                                                                                                           |
| `profile_identity`           | `003_awcms_central_profile_management_schema.sql`                                                                                                                                                                                                                                                                                                                                                                                       |
| `identity_access`            | `004_awcms_identity_login_schema.sql`, `005_awcms_abac_access_control_schema.sql`, `022_awcms_password_reset_schema.sql`, `034_awcms_mfa_totp_schema.sql`, `035_awcms_google_oidc_schema.sql`, `036_awcms_tenant_oidc_sso_schema.sql`, `037_awcms_tenant_oidc_sso_permissions.sql`                                                                                                                                                      |
| `sync_storage`               | `007_awcms_sync_storage_outbox_inbox_schema.sql`, `008_awcms_sync_storage_conflict_schema.sql`, `009_awcms_object_sync_queue_schema.sql`, `014_awcms_sync_node_management_permission_schema.sql`, `017_awcms_sync_queue_conflict_performance_indexes.sql`, `018_awcms_object_sync_queue_dispatcher_schema.sql`                                                                                                                          |
| `reporting`                  | `010_awcms_management_reporting_permission_schema.sql`                                                                                                                                                                                                                                                                                                                                                                                  |
| `logging`                    | `011_awcms_audit_logging_schema.sql`, `047_awcms_observability_metrics_permission.sql`                                                                                                                                                                                                                                                                                                                                                  |
| `workflow`                   | `012_awcms_workflow_approval_schema.sql`                                                                                                                                                                                                                                                                                                                                                                                                |
| `form_drafts`                | `019_awcms_form_drafts_schema.sql`                                                                                                                                                                                                                                                                                                                                                                                                      |
| `email`                      | `020_awcms_email_schema.sql`, `021_awcms_email_template_i18n_schema.sql`, `023_awcms_email_announcement_permission_schema.sql`, `024_awcms_email_message_cancel_permission_schema.sql`                                                                                                                                                                                                                                                  |
| `module_management`          | `025_awcms_module_management_schema.sql` (epic #510, Issue #511-#521)                                                                                                                                                                                                                                                                                                                                                                   |
| `blog_content`               | `026_awcms_blog_content_schema.sql`, `027_awcms_blog_content_permissions.sql`, `028_awcms_blog_content_search_vector.sql`, `029_awcms_blog_content_presentation_schema.sql`, `030_awcms_blog_content_presentation_permissions.sql`, `050_awcms_blog_posts_seo_image.sql`, `051_awcms_blog_content_internal_tag_links_schema.sql`, `052_awcms_blog_content_internal_tag_links_permissions.sql` (epic #536, Issue #537-#543 + follow-ups) |
| `tenant_domain`              | `031_awcms_tenant_domain_schema.sql`, `032_awcms_tenant_domain_permissions.sql`, `033_awcms_tenant_domain_lookup_function.sql`                                                                                                                                                                                                                                                                                                          |
| `visitor_analytics`          | `038_awcms_visitor_analytics_permissions.sql`, `039_awcms_visitor_analytics_schema.sql`, `040_awcms_visitor_analytics_session_lookup_index.sql`                                                                                                                                                                                                                                                                                         |
| `news_portal`                | `041_awcms_news_media_object_registry_schema.sql`, `042_awcms_news_media_permissions.sql`, `043_awcms_news_portal_tenant_state_schema.sql`, `044_awcms_news_portal_homepage_sections_schema.sql`, `046_awcms_news_media_orphan_lifecycle.sql`, `049_awcms_news_portal_ad_placements_schema.sql`                                                                                                                                         |
| `idn_admin_regions`          | `048_awcms_idn_admin_regions_permissions.sql`, `054_awcms_idn_admin_regions_schema.sql`                                                                                                                                                                                                                                                                                                                                                 |
| `social_publishing`          | `053_awcms_social_publishing_schema.sql`, `055_awcms_social_publishing_verify_permission.sql`                                                                                                                                                                                                                                                                                                                                           |

Tiga migration di baris "Foundation, lintas-modul" tidak dipetakan ke
satu modul karena sifatnya benar-benar lintas-modul: `001` adalah
bootstrap murni (ledger migrasi + extension Postgres, sebelum modul
apa pun terdaftar); `017`, `019`, dan `021` adalah hardening keamanan
lintas-tabel (RLS `FORCE` di 23 tabel, lalu role runtime `awcms_app`
least-privilege + default GUC fail-closed, lalu penyempitan grant `awcms_app`
pada tabel global RLS-free — Issue #160) yang menyentuh tabel banyak
modul sekaligus, bukan schema satu modul — lihat
`docs/awcms/20_threat_model_security_architecture.md` dan
`docs/awcms/18_configuration_env_reference.md` §Model role database.

> **Peringatan akurasi (Issue #155).** Baris `001`/`017`/`019`/`021` di atas sudah
> dicocokkan dengan `sql/` nyata. **Baris modul lain di tabel ini belum**:
> sebagian besar masih memakai penomoran/penamaan awcms-mini (mis.
> `045_awcms_db_role_separation.sql` yang dulu tercantum di baris Foundation
> tidak pernah ada di repo ini — `sql/` sekarang berhenti di `023`), sehingga nomor
> yang tercantum di baris lain bisa menunjuk file yang tidak ada. Sumber
> kebenaran migration adalah isi direktori `sql/` dan
> `docs/awcms/repo-inventory.md`, bukan tabel ini, sampai rekonsiliasi
> menyeluruh dikerjakan.

## Matrix Modul vs Security Control

| Control               | Modul                                                          |
| --------------------- | -------------------------------------------------------------- |
| No hardcoded secrets  | Semua                                                          |
| Password hashing      | Identity                                                       |
| Tenant isolation      | Semua tenant-scoped                                            |
| RBAC/ABAC             | Identity Access                                                |
| RLS                   | Semua tenant-scoped                                            |
| Audit log             | Observability + semua high-risk                                |
| Idempotency           | POS, Warehouse, Tax, CRM, Sync, Workflow                       |
| Soft delete           | Master/config/draft tenant-scoped; restore/purge by permission |
| Input validation      | Semua API                                                      |
| Sensitive masking     | Profile, CRM, Tax, Logs, AI                                    |
| Stock lock            | Inventory, POS, Warehouse                                      |
| Immutable transaction | Sales POS                                                      |
| Sync HMAC             | Sync                                                           |
| File checksum         | Sync/R2, Tax export                                            |
| Consent               | CRM                                                            |
| AI read-only          | AI Analyst                                                     |
| Tax export approval   | Tax + Workflow                                                 |
| Go-live gate          | Production Security                                            |
| Backup/restore        | Deployment/Ops                                                 |

## Matrix Security Control vs Skill

| Control                                      | Skill penegak                                                                      |
| -------------------------------------------- | ---------------------------------------------------------------------------------- |
| Tenant isolation + RBAC/ABAC + RLS           | `awcms-abac-guard`                                                                 |
| Idempotency high-risk                        | `awcms-idempotency`                                                                |
| Audit log high-risk                          | `awcms-audit-log`                                                                  |
| Sensitive masking                            | `awcms-sensitive-data`                                                             |
| Sync HMAC + file checksum                    | `awcms-sync-hmac`                                                                  |
| Migration aman (RLS/index)                   | `awcms-new-migration`                                                              |
| Soft delete policy                           | `awcms-new-migration`, `awcms-new-endpoint`, `awcms-abac-guard`, `awcms-audit-log` |
| API/event contract                           | `awcms-new-endpoint`, `awcms-new-event`                                            |
| Testing berlapis                             | `awcms-testing`                                                                    |
| Review keamanan                              | `awcms-security-review` + agent `awcms-security-auditor`                           |
| Triase CodeQL code scanning                  | `awcms-codeql-triage`                                                              |
| Review PR / DoD                              | `awcms-pr-review` + agent `awcms-reviewer`                                         |
| Go-live gate                                 | `awcms-production-preflight`                                                       |
| Profil deployment (LAN-first/Coolify)        | `awcms-deploy`                                                                     |
| UI/design system/a11y                        | `awcms-ui-screen`                                                                  |
| Form multi-step (wizard)                     | `awcms-wizard-form`                                                                |
| Server-side draft persistence                | `awcms-form-drafts`                                                                |
| Kirim email transaksional                    | `awcms-email`                                                                      |
| Kelola sistem Module Management              | `awcms-module-management` (+ `awcms-new-module` untuk scaffold field descriptor)   |
| Kerjakan epic blog_content (Issue #537-#543) | `awcms-blog-content`                                                               |
| Rilis/CHANGELOG                              | `awcms-release`                                                                    |
| Legacy migration                             | `awcms-legacy-migration`                                                           |
| Implementasi issue                           | skill `awcms-implement-issue` + agent `awcms-coder`                                |
| Snapshot docs GitHub                         | `awcms-github-snapshot`                                                            |

## Matrix Modul vs SOP

| SOP                   | Modul utama                    |
| --------------------- | ------------------------------ |
| Instalasi awal        | Deployment/Foundation          |
| Setup tenant          | Tenant Admin                   |
| Tambah user/role      | Identity + Profile             |
| Input produk          | Inventory                      |
| Input stok awal       | Inventory/Warehouse            |
| Transaksi operasional | Sales POS                      |
| Cancel/retur          | Sales POS + Workflow           |
| Warehouse transfer    | Warehouse                      |
| Cycle count           | Warehouse                      |
| Stock adjustment      | Inventory/Warehouse + Workflow |
| Receipt WA/email      | CRM                            |
| Customer portal       | CRM/UI                         |
| Offline sync          | Sync                           |
| Pajak/Coretax         | Accounting Tax                 |
| Reporting             | Reporting                      |
| AI Analyst            | AI                             |
| Backup/restore        | Deployment/Database            |
| Troubleshooting       | Observability/DB               |
| Manajemen modul       | Module Management (epic #510)  |
| Blog/konten           | Blog Content (epic #536)       |
| Handover              | Semua                          |

## Matrix kesiapan implementasi

Kelengkapan dokumen per kebutuhan implementasi. "Design/spec ready" = cukup untuk mulai koding; DDL penuh & schema OpenAPI penuh sengaja diproduksi per-migration/per-endpoint saat implementasi (bukan pra-tulis).

| Kebutuhan                                      | Dokumen           | Status                                    |
| ---------------------------------------------- | ----------------- | ----------------------------------------- |
| Arsitektur & fase                              | 01                | Ready                                     |
| Kebutuhan produk & teknis                      | 02, 03            | Ready                                     |
| ERD & data dictionary                          | 04                | Ready (ringkas; DDL penuh per-migration)  |
| Kontrak API/event                              | 05                | Ready (daftar; schema penuh per-endpoint) |
| Issue, sprint, testing                         | 06, 07            | Ready                                     |
| SOP operasional                                | 08                | Ready                                     |
| Roadmap, coding standard, blueprint, prompt    | 09–12             | Ready                                     |
| **UI/UX design system & layar**                | 14                | Ready                                     |
| **Frontend & integrasi (hybrid online-first)** | 15                | Ready                                     |
| **Backend data access & DB integrasi**         | 16                | Ready                                     |
| **Seed, RBAC, ABAC policy**                    | 17                | Ready                                     |
| **Konfigurasi & environment**                  | 18                | Ready                                     |
| Skill proyek                                   | `.claude/skills/` | Ready                                     |

Diproduksi saat implementasi (bukan pra-tulis): DDL lengkap tiap tabel (via migration), schema request/response penuh tiap endpoint (via OpenAPI), string i18n aktual, dan aset UI final.

## Implementation start recommendation

Urutan coding paling aman:

1. Issue 0.1 — Repository skeleton.
2. Issue 0.2 — SQL migration runner.
3. Issue 0.3 — OpenAPI/AsyncAPI baseline.
4. Issue 12.1 — Initial setup wizard API.
5. Issue 2.1 — Tenant and office schema.
6. Issue 2.2 — Central profile schema.
7. Issue 2.3 — Identity login.
8. Issue 2.4 — RBAC/ABAC.
9. Issue 3.1 — Product catalog.
10. Issue 3.2 — Stock balance/movement.
11. Issue 3.3 — Checkout/cart.
12. Issue 3.4 — Atomic transaction posting.

Alasan:

- Aplikasi domain tidak aman tanpa tenant/auth/profile/access.
- Transaksi tidak boleh sebelum idempotency dan stock lock.
- Provider eksternal tidak boleh didahulukan.
- AI menunggu reporting safe views.
- Coretax menunggu sales posted dan tax profile.

## Minimal MVP Boundary

| Area               | Minimum                                        |
| ------------------ | ---------------------------------------------- |
| Tenant             | tenant, office, setup locked                   |
| Auth               | owner/admin/operator login                     |
| Access             | role dasar, ABAC default deny                  |
| Profile            | customer profile resolver                      |
| Product            | create/list/search product                     |
| Stock              | balance, movement                              |
| POS                | checkout, cart, payment, post                  |
| Transaction safety | idempotency, stock lock, rollback              |
| Receipt            | PDF local                                      |
| Audit              | transaction audit                              |
| Backup             | pg_dump + restore tested                       |
| Docs               | admin/operator SOP basic                       |
| Soft delete        | master data hidden by default, restore audited |

## Production-ready Boundary

- MVP usable selesai.
- RLS aktif dan diuji.
- ABAC default deny diuji.
- Audit high-risk aktif.
- Soft delete/restore/purge policy aktif untuk resource deletable.
- No critical security finding.
- Backup restore tested.
- Pool health OK.
- POS concurrent test OK.
- Receipt token aman.
- Sync conflict policy tested jika hybrid.
- Tax masking aktif jika modul tax aktif.
- CRM opt-out respected jika CRM aktif.
- AI read-only jika AI aktif.
- SOP dan handover selesai.

## Repository artifact checklist

### Root

- `AGENTS.md`
- `README.md`
- `CHANGELOG.md` + `.changeset/` (versioning via Changesets)
- `.claude/skills/` (39 skill proyek + katalog README)
- `.claude/agents/` (3 subagent: coder, reviewer, security-auditor)
- `package.json`
- `astro.config.mjs`
- `tsconfig.json`
- `.env.example`
- `.gitignore`
- `docker-compose.yml`

### Folder standar

Tiap folder standar menyertakan `README.md` sebagai kontrak isi/aturan folder:

- `src/lib/README.md` — helper lintas-modul (`auth/`, `database/`, `errors/`, `files/`, `logging/`).
- `src/modules/_shared/README.md` — module contract, API response envelope, konvensi soft delete.
- `openapi/README.md` — kontrak OpenAPI publik dan kewajiban `api:spec:check`.
- `asyncapi/README.md` — kontrak AsyncAPI domain-event dan kewajiban pendaftaran channel.
- `deploy/README.md` — deployment profile (systemd, container, PgBouncer, backup) — Bun-only.
- `fixtures/README.md` — data uji sintetis; larangan data customer/dump/secret asli.

### Source modules

23 modul terdaftar nyata di `src/modules/index.ts` (`ls -d src/modules/*/`,
dikonfirmasi `bun run modules:dag:check` — "23 registered modules"),
menggantikan daftar fiktif sebelumnya (`catalog-inventory`, `sales-pos`,
`warehouse-management`, `accounting-tax`, `crm-communication`,
`ai-analyst`, `observability-logging`, `database-connectivity`,
`ui-experience`, `production-security-readiness` — tidak satu pun folder
ini pernah ada di repo base):

- `_shared` (bukan modul terdaftar — kontrak/helper lintas-modul)
- blog-content
- data-exchange
- data-lifecycle
- document-infrastructure
- domain-event-runtime
- email
- form-drafts
- identity-access
- idn-admin-regions
- integration-hub
- logging
- module-management
- news-portal
- organization-structure
- profile-identity
- reference-data
- reporting
- social-publishing
- sync-storage
- tenant-admin
- tenant-domain
- visitor-analytics
- workflow-approval

### Docs

Semua file `docs/awcms/01` sampai `19` harus menjadi acuan sebelum coding. Dokumen `14`–`18` (UI/UX, frontend, backend/DB, seed/RBAC/ABAC, konfigurasi) melengkapi kesiapan implementasi; `19` adalah glossary rujukan istilah. Snapshot issue GitHub aktual ada di `docs/awcms/github/` dan wajib direfresh bila state issue berubah.

## Final coding instruction

> **Catatan status (base selesai, v0.23.5).** Urutan bootstrap di bawah adalah rencana asli membangun base generik dari nol dan seluruhnya sudah tuntas (18 issue backlog doc 06 + peningkatan M9) — arsip, bukan pekerjaan baru. Untuk kontribusi baru lihat [`../../AGENTS.md`](../../AGENTS.md) §Mulai dari sini dan [`README.md`](README.md) §Langkah berikutnya.

```text
Mulai dari Issue 0.1.
Jangan lompat ke POS sebelum foundation, tenant, profile, auth, dan ABAC selesai.
Jangan integrasi provider eksternal sebelum core POS aman.
Jangan integrasi AI sebelum reporting safe views siap.
Jangan mengaktifkan production sebelum security readiness pass.
Jangan commit secret, dump database, data customer asli, atau .env.
```

## Penutup

Rantai implementasi AWCMS lengkap:

```text
Business Need
→ PRD
→ SRS
→ ERD/Data Dictionary
→ OpenAPI/AsyncAPI
→ GitHub Issues
→ GitHub Snapshot
→ Sprint Plan
→ SOP/User Guide
→ Repository Roadmap
→ Coding Standard
→ Implementation Blueprint
→ Generator Prompt
→ Traceability Matrix
→ Ready for Coding
```

```mermaid
flowchart TB
  BN[Business Need] --> PRD[PRD] --> SRS[SRS] --> ERD[ERD/Data Dictionary]
  ERD --> API[OpenAPI/AsyncAPI] --> ISS[GitHub Issues] --> GHS[GitHub Snapshot] --> SPR[Sprint Plan]
  SPR --> SOP[SOP/User Guide] --> RR[Repository Roadmap] --> CS[Coding Standard]
  CS --> BP[Implementation Blueprint] --> GP[Generator Prompt] --> TM[Traceability Matrix]
  TM --> RC([Ready for Coding])
```
