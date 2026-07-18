---
name: awcms-new-module
description: Scaffold modul baru pada modular monolith AWCMS. Gunakan saat membuat modul domain baru di src/modules/ (mis. warehouse-management, accounting-tax) atau saat memerlukan struktur module.ts + domain/application/infrastructure/api + README. Ikuti struktur standar doc 10 & 11.
---

# AWCMS — New Module Scaffold

Buat modul mengikuti struktur standar di `docs/awcms/10_template_kode_coding_standard.md` dan `docs/awcms/11_implementation_blueprint.md`.

## Struktur wajib

```text
src/modules/<module-kebab>/
├── module.ts            # ModuleDescriptor
├── domain/               # entities.ts, value-objects.ts, events.ts
├── application/          # services.ts, commands.ts, queries.ts
├── infrastructure/       # repository.ts, mappers.ts
└── README.md             # design doc lengkap: tujuan, tabel, endpoint, event, dependency, invariant keamanan (lihat README modul lain — 94-854 baris, bukan ringkasan singkat)
```

Route API **tidak** hidup di dalam folder modul — tidak ada modul mana pun
yang punya folder `api/` (`find src/modules -maxdepth 2 -type d -name api`
kosong). Route nyata selalu di `src/pages/api/v1/<resource>/...` (Astro
file-based routing), meng-import service/repository dari
`application`/`infrastructure` modul terkait. Lihat `awcms-new-endpoint`.

## Module descriptor (`module.ts`)

```ts
import { defineModule } from "../_shared/module-contract";

export const <camelCase>Module = defineModule({
  key: "<snake_case>",
  name: "<Nama Modul>",
  version: "0.1.0",
  status: "active", // active | experimental | deprecated | maintenance | disabled
  description: "...",
  dependencies: ["tenant_admin", "identity_access", "observability_logging"],
  type: "domain", // base | system | domain | integration | derived — modul domain baru (bukan infrastruktur generik) pakai "domain"
  // Kontrak OpenAPI dipecah per modul (Issue #182, ADR-0026): modul ini MEMILIKI
  // fragmentnya sendiri; `openApiPath` menunjuk fragment, bukan bundle GENERATED.
  // Setelah edit fragment: `bun run openapi:bundle` + `bun run api:docs:generate`.
  api: { openApiPath: "openapi/modules/<module>.openapi.yaml", basePath: "/api/v1" },
  events: {
    // awcms memakai SATU berkas AsyncAPI (belum dipecah per modul seperti OpenAPI).
    asyncApiPath: "asyncapi/awcms-domain-events.asyncapi.yaml",
    publishes: [],
    subscribes: []
  }
  // Field opsional lain (Issue #511, epic #510 — Module Management):
  // isCore, permissions, navigation, settings, jobs, health,
  // compatibility, maintainers. Deklarasikan hanya setelah fitur
  // sungguhan yang bersangkutan ADA di modul ini — jangan klaim
  // kapabilitas yang belum diimplementasi (lihat contoh nyata:
  // `src/modules/module-management/module.ts` menambah `navigation`
  // baru setelah Issue #518 selesai, `jobs` setelah #519, satu-satu).
});
```

## Aturan

1. Daftarkan modul di `src/modules/index.ts` (`modules[]`).
2. `key` = `snake_case`; folder = `kebab-case`; type = `PascalCase`.
3. Route tipis → guard → validasi → service → repository (lihat `awcms-abac-guard`).
4. Sertakan TODO jelas; jangan klaim production-ready.
5. Jika modul punya tabel → `awcms-new-migration`. Jika ada API → `awcms-new-endpoint`. Jika ada event → `awcms-new-event`.
6. **Sync descriptor ke database registry wajib** (Issue #513, epic #510) — mendaftarkan modul di `src/modules/index.ts` saja **tidak otomatis** membuat baris `awcms_modules`/`_dependencies`/`_navigation`/`_jobs`. Jalankan `POST /api/v1/modules/sync` (atau `bun run modules:sync` bila skrip CLI tersedia) minimal sekali setelah modul terdaftar — atau andalkan sinkronisasi otomatis yang sudah terpasang di beberapa mutasi tenant-scoped modul lain yang punya FK ke `awcms_modules` (`enableTenantModule`/`disableTenantModule`/`updateModuleSettings`/`runModuleHealthCheck` semua memanggil `syncModuleDescriptors(tx)` sendiri) — **jangan asumsikan** operator sudah sync manual sebelum modul barumu dipakai lewat jalur itu.
7. Jika modul mendeklarasikan `permissions` di descriptor, verifikasi juga migration seed permission-nya konsisten (`GET /api/v1/modules/{moduleKey}/permissions`, Issue #517, akan melaporkan `missing`/`mismatched_description` kalau tidak sinkron).

## Nama modul valid

Domain retail/POS contoh (aspirational, belum tentu ada di base generik ini): `tenant-admin`, `identity-access`, `profile-identity`, `catalog-inventory`, `sales-pos`, `shared-stock-routing`, `warehouse-management`, `accounting-tax`, `crm-communication`, `sync-storage`, `ai-analyst`, `localization-ui`, `observability-logging`, `database-connectivity`, `workflow-approval`, `management-reporting`, `ui-experience`, `production-security-readiness`.

Modul base generik yang **sudah nyata terdaftar** di repo ini (`src/modules/index.ts`, 23 modul): `tenant-admin`, `profile-identity`, `identity-access`, `sync-storage`, `reporting`, `logging`, `workflow-approval`, `form-drafts`, `email`, `module-management`, `blog-content`, `tenant-domain`, `visitor-analytics`, `news-portal`, `social-publishing`, `idn-admin-regions`, plus 7 modul platform-evolution epic #738: `data-exchange`, `data-lifecycle`, `document-infrastructure`, `domain-event-runtime`, `integration-hub`, `organization-structure`, `reference-data`.

## Sebelum scaffold modul baru: cek kebijakan admission

Sebelum membuat modul baru di repo base ini (bukan sekadar mengubah modul
yang sudah ada), baca `docs/awcms/21_module_admission_governance.md`
(kategori Core/System/Official Optional Module/Derived Application/
External Integration, pohon keputusan admission, kriteria dependency &
security review) dan isi
`docs/awcms/templates/module-proposal-template.md` di issue GitHub
terkait. Modul spesifik satu domain bisnis (POS, gudang, pajak, CRM, dll.)
**tidak masuk repo ini** — lihat pohon keputusan di doc 21 §3.

**Modul di REPO BASE ini** (langkah 1 di atas) vs **modul di REPO TURUNAN**
(Issue #178, ADR-0025 — mengimplementasikan ADR-0014) adalah dua alur
berbeda: bila modulmu memang spesifik satu domain bisnis dan pohon keputusan
doc 21 §3 mengarahkan ke "bukan untuk repo base ini", **jangan** daftarkan di
`src/modules/index.ts` repo ini — buat repo turunan sendiri lalu daftarkan
modulnya di `src/modules/application-registry.ts` MILIK REPO TURUNAN itu
(satu-satunya file yang perlu diedit; ganti nilai `undefined` dengan
`ApplicationModuleRegistry` = `{ id, modules, migrationNamespace? }`; struktur
`module.ts` + `domain/application/infrastructure/api` di atas tetap sama
persis). `composeModuleRegistry()`
(`module-management/domain/module-composition.ts`) menggabungkan registry base
dengan registry turunan saat build dan memvalidasi key ganda, override key
base, DAG dependency, capability binding, overlap namespace migration (base
`1-899`, turunan mulai `900`), deployment profile, navigation path, dan job
descriptor. Detail: skill `awcms-module-management` §Komposisi modul
build-time, `docs/awcms/derived-application-guide.md`, dan
`docs/adr/0025-implement-deterministic-build-time-module-composition.md`.

Verifikasi seam: `bun run modules:compose:check`, `bun run extension:check`,
dan `bun run modules:composition:inventory:check` (regenerate inventory lewat
`bun run modules:composition:inventory:generate`) — ketiganya bagian dari
`bun run check`.

> Manifest kompatibilitas aplikasi turunan (`extension.manifest.json` —
> range SemVer base, checksum migration historis, versi capability; ADR-0015)
> adalah lapisan TERPISAH yang **belum diimplementasikan** di awcms (rencana
> Issue #183). Saat ini `extension:check` memvalidasi extension seam/komposisi
> saja, bukan manifest — jangan rujuk `extension.manifest.json` sebagai sudah
> ada.

## Verifikasi

- `bun run build` pass.
- Modul terdaftar di registry (base: `src/modules/index.ts`; turunan:
  `src/modules/application-registry.ts` milik repo turunan sendiri, lalu
  `bun run modules:compose:check` hijau).
- README modul terisi.
