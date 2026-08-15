🇮🇩 Bahasa Indonesia · 🇬🇧 [English (source)](README.md)

<!-- i18n-source-hash: sha256:55c5a7d2b15a17c389f17b18b5417c09294c11c9a3d6ba6ba813fee1182cc4e3 -->

# Module Management

Registry modul berbasis basis data yang sadar-tenant. Infrastruktur generik untuk
mengelola setiap modul terdaftar lainnya — bukan fitur spesifik domain.
Diport dan diadaptasi dari modul module-management awcms-mini.

## Apa yang dikerjakannya

- **Sinkronisasi deskriptor** (`application/descriptor-sync.ts`) — membaca
  registry kode dalam-proses yang tepercaya (`listModules()`,
  `src/modules/index.ts`) lalu meng-upsert-nya ke registry basis data
  (`awcms_modules` +
  `awcms_module_dependencies`/`_navigation`/`_jobs`, migrasi 008). Idempoten
  secara alami. Menolak menulis bila registry gagal validasi graf dependensi
  (`_shared/module-dependency-graph.ts`).
- **Katalog modul** (`application/module-catalog.ts`) — menggabungkan metadata
  statis tiap deskriptor yang selalu mutakhir dengan state siklus hidup yang
  dilacak basis data. `GET /api/v1/modules`, `GET /api/v1/modules/{moduleKey}`.
- **Siklus hidup modul per tenant** (`application/tenant-module-lifecycle.ts`) —
  enable/disable per tenant, tervalidasi dependensi. Baris
  `awcms_tenant_modules` yang tidak ada berarti "aktif secara bawaan"
  (kompatibel mundur). Modul `isCore` tidak bisa dinonaktifkan (mencegah admin
  terkunci di luar). Hanya menulis `awcms_tenant_modules`, tidak pernah
  melepas-muat kode.
- **Pengaturan modul** (`application/module-settings.ts`) — preferensi
  operasional yang sadar-tenant dan **bukan rahasia**. `PATCH` melakukan
  shallow-merge. Kunci berbentuk-rahasia dan nilai berbentuk-rahasia ditolak
  saat request (tidak pernah disimpan), memakai ulang
  `findSensitiveKeys`/`findSecretShapedValues` dari `_shared/redaction.ts`.
- **Sinkronisasi/status izin** (`application/permission-sync.ts`) — laporan
  baca-saja `synced`/`missing`/`orphaned`/`mismatched_description` terhadap
  `awcms_permissions`. Tidak pernah menulis ke katalog.
- **Registry navigasi** (`application/navigation-registry.ts`) — menyaring entri
  navigasi yang dideklarasikan modul berdasarkan status modul, keaktifan tenant,
  dan izin yang dibutuhkan, sebagai daftar datar untuk `GET /api/v1/modules`.
  Penyaringan navigasi **bukan** otorisasi.
- **Model sidebar** (`domain/sidebar-menu.ts`) — deklarasi yang sama,
  dikelompokkan ke dalam pohon `type -> module -> entries` milik shell admin.
  `src/layouts/AdminLayout.astro` merender dari sini; sebelumnya ia menyimpan
  array tulisan-tangannya sendiri, yang sudah melenceng menjadi tiga entri
  menunjuk halaman yang tidak ada dan delapan halaman yang tak pernah didengar
  registry. `tests/admin-navigation-registry.test.ts` mengikat deklarasi ke
  sistem berkas dalam dua arah.

  Diport dari `domain/sidebar-menu.ts` milik awcms-micro **dikurangi lapisan
  override per tenant** — tabel `sidebar_menu_types`/`sidebar_menu_items` dan
  editor admin di sana membolehkan tenant mengurutkan ulang, menyembunyikan,
  melabel ulang, dan memindah-kelompokkan entri. Itu butuh migrasi dan merupakan
  inkremen terpisah; model di sini adalah bawaan yang di atasnya override
  tersebut diterapkan, jadi ia datang tanpa kerja ulang.

- **Preset modul** (`domain/module-presets.ts`, `application/module-presets.ts`)
  — profil bernama (`minimal`, `website`, `news_portal`, `back_office`) yang
  sebuah tenant bisa dibawa KE sana dalam satu aksi. Sebuah preset MENGAKTIFKAN
  apa yang didaftarnya dan MENONAKTIFKAN setiap modul yang aktif, tak terdaftar,
  dan tak terlindungi; enable-saja akan membuat preset tak berguna sebagai cara
  mencapai sebuah profil. Dijalankan lewat primitif
  `enableTenantModule`/`disableTenantModule` yang sudah ada, satu panggilan per
  perubahan yang direncanakan, sehingga sebuah perubahan tetap bisa ditolak dan
  dilaporkan alih-alih ditelan (`complete: false` dengan alasan per modul).

  "Terlindungi" bukan `isCore`: hanya `module_management` yang menyetel flag itu,
  dan sisanya terlindungi secara tidak langsung oleh pemeriksaan dependensi
  balik. `resolveProtectedModuleKeys` membuatnya eksplisit untuk perencanaan.

  Tanpa izin baru: sebuah apply ADALAH deretan enable dan disable, jadi
  `POST .../presets/{name}/apply` menggerbangi pada
  `module_management.tenant_modules.disable` — yang lebih kuat di antara dua izin
  yang memang sudah dibutuhkan panggilan di bawahnya. Aksi baru akan butuh
  migrasi seed, dan aksi yang tak ter-seed men-deny bahkan sang owner.

- **Matriks tenant-modul** (`application/module-matrix.ts`) — setiap modul ×
  apa yang penting bagi tenant ini, dalam DUA kueri (katalog + entri tenant;
  sisanya murni). Menambahkan dua peringatan siklus hidup dengan menjalankan
  ulang `evaluateModuleEnable`/`evaluateModuleDisable` yang SESUNGGUHNYA terhadap
  state aktual tiap modul, bukan penurunan ulang di sisi UI yang bisa melenceng
  dari endpoint-nya.

  Satu arah dengan sengaja: `dependencyWarning` hanya untuk modul yang
  DINONAKTIFKAN, `reverseDependencyWarning` hanya untuk yang AKTIF. Dua kombinasi
  lainnya tidak mungkin muncul, dan menanyakan `evaluateModuleEnable` tentang
  modul yang sudah aktif akan korsleting ke `MODULE_ALREADY_ENABLED` — jawaban
  yang tampak seperti pemeriksaan padahal bukan.

  **Tanpa kolom health.** Matriks awcms-micro punya satu, disuapi pembaca health
  ter-BATCH yang basis ini tidak punya; `fetchModuleHealthReport` per baris akan
  menjadi 21 pembacaan dalam satu transaksi. Health tetap di
  `GET /api/v1/modules/{moduleKey}/health` sampai pembaca ter-batch ada.

- **Ringkasan audit modul** (`application/module-audit-summary.ts`) — aktivitas
  terkini yang tercatat terhadap satu kunci modul (`tenant_module`,
  `module_settings`, `module_health`, `module_preset`). Digerbangi
  `logging.audit_trail.read`, bukan izin module-management: baris-baris ini
  adalah baris audit-log, dan siapa pun yang tidak boleh membaca audit log tidak
  boleh mendapat tampilan tersaringnya lewat pintu lain. `module_registry`
  dikecualikan — `resource_id` milik sinkronisasi deskriptor bukan kunci modul,
  jadi ia takkan cocok apa pun sambil menyiratkan ia mungkin cocok.

- **Penataan sidebar** (paruh override `domain/sidebar-menu.ts`,
  `application/sidebar-menu-config.ts`, `sql/071`/`sql/072`) — pengurutan ulang,
  penyembunyian, pelabelan ulang, pemindahan antar seksi, dan seksi kustom per
  tenant, diterapkan di atas bawaan yang diturunkan dari kode.

  Disimpan sebagai DELTA, tidak pernah sebagai snapshot. Tenant tanpa baris apa
  pun merender persis bawaan kode, dan itulah yang membuat entri navigasi modul
  yang baru ditambahkan muncul di mana-mana tanpa migrasi data; snapshot akan
  membekukan sidebar tiap tenant pada momen mereka pertama kali menyentuhnya.

  **Tenant bisa meng-override, tidak pernah menyuntik.** Setiap baris tersimpan
  diresolusi BERDASARKAN KUNCI terhadap `buildDefaultSidebarModel`, dan yang tidak
  cocok apa pun diabaikan — tidak ada jalur kode dari badan request ke tautan
  menu baru. Override juga diterapkan SEBELUM `composeSidebarSections`, sehingga
  melabel ulang atau memindahkan sebuah entri tidak pernah bisa membawanya
  melewati `requiredPermission` atau modul yang dinonaktifkan.

  `module_management.navigation.configure` (`sql/072`) menggerbangi mutasinya;
  pembacaannya memakai ulang `navigation.read` yang sudah ada. Tenant yang sudah
  ada TIDAK otomatis memperoleh izin baru itu — lihat catatan operator pada
  migrasinya.

- **Registry job** (`application/job-registry.ts`) — metadata khusus dokumentasi
  tentang perintah operasional tiap modul. Tidak pernah menjadi permukaan
  eksekusi.
- **Health/kesiapan** (`application/health-registry.ts`) — sinyal murah dan
  terbatas (registry tersinkron, migrasi terterapkan, izin tersinkron,
  pengaturan valid, job terdokumentasi, OpenAPI/AsyncAPI terdokumentasi).
  `GET .../health` adalah pembacaan pasif; `POST .../health/check` mencatat
  riwayat dan menjalankan pemeriksaan provider langsung apa pun (belum ada di
  basis ini).

## "Sinkron dulu"

`awcms_tenant_modules`, `awcms_module_settings`, dan
`awcms_module_health_checks` semuanya punya foreign key ke
`awcms_modules.module_key`. Mendaftarkan sebuah modul di `src/modules/index.ts`
**tidak** otomatis membuat baris registry-nya. Setiap mutasi bercakupan tenant
yang butuh baris registry itu ada (`enableTenantModule`, `disableTenantModule`,
`updateModuleSettings`, `runModuleHealthCheck`) memanggil `syncModuleDescriptors(tx)`
sendiri terlebih dahulu — jangan mengandaikan seorang operator sudah menjalankan
`POST /api/v1/modules/sync` sebelumnya.

## Komposisi module-registry (Issue #178, ADR-0025; ADR-0034 §3)

Berbeda dari siklus hidup tenant di atas: **modul mana yang ada di dalam kode**
ditentukan saat build/kompilasi, bukan saat runtime dan tidak pernah dari masukan
tenant. ADR-0034 §3 menghapus jalur aplikasi turunan — mesin komposisi kini
memvalidasi registry **base** yang sudah ditinjau (bentuk yang sama dengan yang
dihasilkan modul domain baru yang ditambahkan langsung ke `src/modules/`).

- **`domain/module-composition.ts`** — mesin validasi murni.
  `composeModuleRegistry(registry)` / `validateComposedModuleRegistry(registry)`
  menolak: kunci modul duplikat, dependensi hilang/siklik (memakai ulang
  `_shared/module-dependency-graph.ts`), konflik/ketiadaan penyedia kapabilitas
  (`ModuleCapabilityContract`), ketidakcocokan profil deployment, konflik jalur
  navigasi, dan deskriptor job tidak valid (memakai ulang
  `domain/job-registry.ts`). Ia tinggal di sini — bukan `_shared/` — supaya kedua
  validator yang dipakai ulang diimpor secara bersih (DAG turun dari `_shared/`,
  job-registry sebagai saudara sejajar); lihat header berkasnya dan ADR-0025
  untuk alasan penempatannya.
- **`buildComposedModuleInventory()`** — snapshot deterministik, terurut
  berdasarkan kunci, bebas timestamp untuk bukti CI/rilis
  (`docs/awcms/module-composition-inventory.json`).
- **Gerbang** (semuanya di `bun run check` + CI): `modules:compose:check`,
  `modules:composition:inventory:generate`/`:check`.
- Fixture: `tests/fixtures/example-domain-modules/` (contoh modul domain
  pendukung pengujian), dijalankan oleh `tests/module-composition-fixture.test.ts`.

## Permukaan API

| Metode + Path                                       | Izin                                       |
| --------------------------------------------------- | ------------------------------------------ |
| `GET /api/v1/modules`                               | `module_management.modules.read`           |
| `GET /api/v1/modules/{moduleKey}`                   | `module_management.modules.read`           |
| `POST /api/v1/modules/sync`                         | `module_management.modules.sync`           |
| `GET /api/v1/modules/{moduleKey}/health`            | `module_management.health.read`            |
| `POST /api/v1/modules/{moduleKey}/health/check`     | `module_management.health.check`           |
| `GET /api/v1/modules/{moduleKey}/jobs`              | `module_management.jobs.read`              |
| `GET /api/v1/modules/{moduleKey}/permissions`       | `module_management.permissions.read`       |
| `GET /api/v1/tenant/modules`                        | `module_management.tenant_modules.read`    |
| `POST /api/v1/tenant/modules/{moduleKey}/enable`    | `module_management.tenant_modules.enable`  |
| `POST /api/v1/tenant/modules/{moduleKey}/disable`   | `module_management.tenant_modules.disable` |
| `GET /api/v1/tenant/modules/{moduleKey}/settings`   | `module_management.settings.read`          |
| `PATCH /api/v1/tenant/modules/{moduleKey}/settings` | `module_management.settings.update`        |
| `GET /api/v1/access/modules`                        | `identity_access.access_control.read`      |

Semua mutasi berisiko tinggi (sync, enable, disable, pembaruan pengaturan,
pemeriksaan health) menulis peristiwa audit ke `awcms_audit_events` dengan
`module_key = 'module_management'`.

## Diadaptasi untuk basis ini

Relatif terhadap sumber awcms-mini, komposisi module-registry MEMANG ada
(Issue #178 — `modules:compose:check`, `modules:composition:inventory:*`; lihat
seksi di atas). ADR-0034 §3 menghapus jalur aplikasi turunan (sambungan
`application-registry.ts`, namespace migrasi 900-999, dan gerbang
`extension:check`) — awcms adalah template yang dipakai langsung, jadi semua itu
tidak lagi ada. Berikut ini tetap dengan sengaja **tidak** diport (mereka
bergantung pada toolchain/UI yang tidak ada di repo ini, atau dijadwalkan
terpisah): preset modul tenant, matriks tenant-modul, ringkasan audit modul (UI
admin), dan pemeriksaan health provider email secara langsung. Registry inti,
siklus hidup, pengaturan, sinkronisasi izin, navigasi, job, health, dan layanan
komposisi semuanya ada.
