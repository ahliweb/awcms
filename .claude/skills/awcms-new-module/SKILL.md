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
  type: "domain", // base | system | domain | integration — modul domain baru (bukan infrastruktur generik) pakai "domain"
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
tetap harus lolos pohon keputusan admission doc 21 §3 sebelum ditambahkan.

**ADR-0034 menghapus jalur aplikasi-turunan.** Tidak ada lagi repo turunan,
`src/modules/application-registry.ts`, command `extension:check`,
`extension.manifest.json`, maupun namespace migrasi terpisah `900+` — semuanya
sudah dihapus (ADR-0034 men-supersede ADR-0014/0015/0025). Keluarga AWCMS
(awcms-mini / awcms / awcms-micro) kini adalah TIGA template SEJAJAR yang
dipakai LANGSUNG ("template dipakai-langsung"), bukan basis untuk repo
derivatif. Konsekuensinya untuk modul domain/website baru: modul itu hidup
LANGSUNG di `src/modules/` repo ini dan didaftar di `src/modules/index.ts`
(langkah 1 di atas), persis seperti modul base lain — `type: "domain"`,
struktur `module.ts` + `domain/application/infrastructure` yang sama, dan
migrasi memakai penomoran base berurutan (bukan namespace terpisah). Bukti
nyata: modul `theming` (ADR-0034 Fase 3, skill `awcms-theming`) adalah modul
website pertama yang di-port LANGSUNG ke base ini. Detail governance: skill
`awcms-module-management` §Komposisi modul build-time dan
`docs/adr/0034-awcms-family-direct-use-templates-and-derived-pathway-removal.md`
(men-supersede ADR-0014/0015/0025).

Verifikasi seam komposisi (registry-base saja, tanpa jalur turunan):
`bun run modules:compose:check` dan
`bun run modules:composition:inventory:check` (regenerate inventory lewat
`bun run modules:composition:inventory:generate`) — **dua** command, keduanya
bagian dari `bun run check`. Tidak ada `bun run extension:check`: command itu
dihapus bersama jalur aplikasi-turunan (ADR-0034), jangan rujuk lagi.

## Verifikasi

- `bun run build` pass.
- Modul terdaftar di registry base `src/modules/index.ts`, lalu
  `bun run modules:compose:check` hijau (tidak ada registry turunan — ADR-0034).
- README modul terisi.
