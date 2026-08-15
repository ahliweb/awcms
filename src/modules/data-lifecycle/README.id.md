🇮🇩 Bahasa Indonesia · 🇬🇧 [English (source)](README.md)

<!-- i18n-source-hash: sha256:4da7816b20e41caf9b9718d010fe9769292304388289567f921d85c77058bf86 -->

# Data Lifecycle

Di-port dari awcms-micro Issue #745 (ADR-0037). `type: "system"` — modul System
Foundation selapis dengan `logging`/`sync_storage`/
`visitor_analytics`: infrastruktur tata kelola platform yang mekanismenya dipakai
bersama setiap tenant, bukan fitur bisnis yang menghadap tenant.

## Kenapa modul ini ada

Base ini sudah punya beberapa job retensi/purge spesifik-sumber-daya
(`logs:audit:purge`, `analytics:purge`, ...), masing-masing merakit sendiri
semantik retensi, batching, dan jejak auditnya. Semakin banyak tabel bervolume
tinggi menumpuk, pola itu tidak berskala — setiap modul menurunkan ulang
pertanyaan tata kelola yang sama (berapa lama data disimpan, apakah diarsipkan
sebelum dihapus, bagaimana legal hold berinteraksi dengan purge, bagaimana
membatch dengan aman) dengan cara yang sedikit berbeda-beda.

Modul ini menambahkan **registry yang dikontribusikan modul** (kontrak statis,
kode-saja, yang dideklarasikan tiap modul pemilik tentang tabel bervolume
tingginya sendiri) plus **engine lifecycle yang aman** (perencanaan dry-run,
archive/purge terbatas, legal hold) yang bekerja di atas kontrak itu — tidak
pernah langsung di atas schema modul lain.

## Yang TIDAK dilakukan modul ini

- **Memiliki tabel modul lain.** Sesuai ADR-0013 §6 ("no shared-table write"),
  `data_lifecycle` tidak pernah menulis ke `awcms_audit_events`,
  `awcms_visit_events`, atau tabel modul lain mana pun secara langsung. Ia
  memiliki tepat empat tabel miliknya sendiri (di bawah).
- **Menduplikasi mekanisme purge yang sudah ada.** Tabel dengan deskriptor
  `executionMode:
"delegated"` (mis. `logging.audit_events`) tetap memakai job yang sudah ada
  (`bun run logs:audit:purge`) sebagai satu-satunya pemutasi — modul ini hanya
  membacanya untuk visibilitas backlog dry-run. Tetapi fungsi purge MILIK
  adopter delegated itu sendirilah titik penegakan legal-hold yang sebenarnya
  (lihat Legal hold di bawah).
- **Menetapkan satu periode retensi legal universal.** Setiap deskriptor
  mendeklarasikan `retentionClass`/batasnya sendiri.
- **Mengotomasi partisi.** `partition.eligible` semata metadata
  panduan/runbook — tidak ada deskriptor yang memicu migrasi
  `CREATE TABLE ... PARTITION OF` sungguhan.

## Kontrak deskriptor (`HighVolumeTableDescriptor`)

Didefinisikan di `src/modules/_shared/module-contract.ts` (berdampingan dengan
`ModulePermissionDescriptor`/`ProjectionDescriptor`/dst. — bentuk "modul
mendeklarasikan array-nya sendiri, satu agregator terpusat membaca
`listModules()`" yang sama). Sebuah modul mengontribusikan satu entri per tabel
bervolume tinggi di array `dataLifecycle` pada `module.ts` miliknya:

```ts
dataLifecycle: [
  {
    key: "logging.audit_events", // "<ownerModuleKey>.<tableShortName>", unik
    tableName: "awcms_audit_events",
    ownerModuleKey: "logging", // wajib sama dengan key modul ini sendiri
    scope: "tenant", // "tenant" | "global"
    cursorColumn: "created_at", // kolom batching/pengurutan
    retentionClass: "audit_security",
    retentionMinDays: 365,
    retentionMaxDays: 1825,
    defaultRetentionDays: 730,
    partition: { eligible: true, granularity: "monthly", rationale: "..." },
    archive: { archivable: false, rationale: "..." },
    deletion: { mode: "hard_delete", rationale: "..." },
    legalHold: { applicable: true, precedence: "overrides_retention" },
    requiredIndexes: [{ columns: ["tenant_id", "created_at"], purpose: "..." }],
    batchLimit: 5000,
    backupRestoreNotes: "...",
    executionMode: "delegated",
    existingAdopter: {
      jobCommand: "bun run logs:audit:purge",
      purgeFunctionRef:
        "src/modules/logging/application/audit-purge.ts#purgeExpiredAuditEvents",
      description: "..."
    }
  }
];
```

Ini adalah **metadata tepercaya yang hanya hidup di kode** — tidak pernah
dikendalikan tenant/request, tidak pernah diduplikasi ke tabel setelan yang bisa
diubah.

### `executionMode`: `"delegated"` vs `"generic"`

- **`"delegated"`** — modul pemilik sudah punya fungsi/job purge rakitan
  tangannya sendiri. Engine `data_lifecycle` boleh MEMBACA tabel itu untuk
  penghitungan dry-run (aman, baca-saja) tetapi tidak pernah memutasinya. Wajib
  ber-`existingAdopter`.
- **`"generic"`** — belum ada mekanisme; modul pemilik meng-opt-in-kan tabelnya
  ke eksekusi archive/purge terbatas milik `data_lifecycle`, memakai HANYA
  metadata yang dideklarasikan di sini (nama tabel/tenant/kolom cursor, batas
  batch). TIDAK BOLEH sekaligus mendeklarasikan `existingAdopter`.

**Satu-satunya adopter `"generic"` adalah tabel riwayat jalannya `data_lifecycle`
sendiri** (`data_lifecycle.data_lifecycle_runs`, dideklarasikan di `module.ts`
modul ini sendiri) — modul ini memakan makanan anjingnya sendiri dengan
menjalankan engine generik-nya di atas data yang sepenuhnya ia miliki,
satu-satunya cara membuktikan eksekusi archive/purge sungguhan (non-delegated)
tanpa menjangkau schema modul lain. Dua tabel yang sudah ada terdaftar sebagai
adopter `"delegated"`: `logging.audit_events` dan
`visitor_analytics.visit_events`.

## Gerbang validasi registry

`validateLifecycleRegistry` di `domain/lifecycle-registry.ts` — kode murni, tanpa
I/O — memeriksa setiap deskriptor yang dikontribusikan: `key`/`tableName` unik,
`ownerModuleKey` cocok dengan modul yang mendeklarasikan, `scope`/`retentionClass`
valid, `retentionMinDays
<= defaultRetentionDays <= retentionMaxDays`, kebijakan
partition/archive/deletion/legalHold hadir dan konsisten secara internal
(khususnya: `legalHold.applicable:
true` WAJIB berpasangan dengan `precedence: "overrides_retention"` — ini tidak
bisa dideklarasikan-hilang), minimal satu indeks wajib (komposit tenant+cursor
khusus untuk deskriptor `"generic"`), `batchLimit` yang masuk akal, serta
konsistensi `executionMode`/`existingAdopter`.

Terpasang ke `bun run check` lewat `bun run data-lifecycle:registry:check`
(`scripts/data-lifecycle-registry-check.ts`). Diperiksa ulang juga oleh
`checkDataLifecycleRegistryValid` milik `security:readiness` (pertahanan
berlapis: terlihat dari checklist go-live juga, bukan hanya CI).

## Legal hold

`domain/legal-hold.ts` (aturan murni) + `application/legal-hold-service.ts`
(persistensi + audit). Sebuah rekaman legal hold — scope (key deskriptor
tertentu, atau `null` untuk seluruh tenant), alasan, referensi otoritas,
mulai/selesai, persetujuan, audit — **mengalahkan retensi/purge biasa** kapan pun
ia berlaku, diperiksa SEBELUM apa pun yang bisa melaporkan sebuah baris layak
di-purge.

**Tidak bisa dilewati diam-diam**: `legalHold.applicable` pada deskriptor semata
dokumentasi/panduan, dan sengaja TIDAK dikonsultasikan oleh jalur penegakan
(`evaluateLegalHoldForDescriptor`) — rekaman hold sungguhan yang menyasar `key`
sebuah deskriptor (atau seluruh tenant) selalu berlaku, tak peduli apa yang
diklaim metadata deskriptor itu sendiri. `retentionDaysOverride` pun tidak bisa
melebarkan kelayakan di sekitar sebuah hold — pemeriksaan hold berjalan lebih
dulu dan tanpa syarat.

**Penegakan lintas batas modul** (`_shared/ports/legal-hold-guard-port.ts`):
fungsi purge MILIK adopter `"delegated"` sendirilah titik penegakan sebenarnya
untuk tabelnya sendiri, karena engine `data_lifecycle` tidak pernah memutasi
tabel delegated. Tiap fungsi purge semacam itu menerima `LegalHoldGuardPort` dan
melewati DELETE yang dicakup deskriptornya ketika deskriptor tersebut sedang
di-hold. Adapter konkretnya
(`application/legal-hold-guard-port-adapter.ts`) dipasang di composition root
(`scripts/audit-log-purge.ts`, `scripts/visitor-analytics-purge.ts`,
`src/pages/api/v1/analytics/retention/purge.ts`) — tidak pernah diimpor langsung
dari dalam pohon `application`/`domain` milik `logging`/`visitor_analytics`, yang
akan menciptakan impor melingkar terlarang (ADR-0011).

**Pelepasan default-deny**: `legal_hold.create` dan `legal_hold.release` adalah
permission terpisah — role yang memegang `create` tidak otomatis memegang
`release`. Aturan SoD `data_lifecycle.legal_hold_maker_checker` (`module.ts`)
menegakkan ini sebagai konflik maker/checker sungguhan. Keduanya wajib beralasan,
digerbangi permission, wajib ber-`Idempotency-Key`, dan diaudit `critical`.
`release` adalah `AccessAction` high-risk
(`identity-access/domain/access-control.ts`).

## Perencanaan lifecycle dry-run

`planLifecycleDryRun` di `application/dry-run-planner.ts` — generik untuk
deskriptor `scope: "tenant"` mana pun, seluruhnya pernyataan `SELECT count(*)`,
nol mutasi. Melaporkan
`eligibleCount`/`heldCount`/`archivedCount`/`purgeableCount`/
`blockedCount`. Sesuai permintaan lewat `POST /api/v1/data-lifecycle/dry-run`
(nol persistensi, tak butuh `Idempotency-Key` — benar-benar nol efek samping)
atau sebagai bagian job terjadwal (yang MEMANG mempersistenkan satu baris riwayat
jalan per deskriptor per tenant per pemanggilan).

## Engine archive/purge terbatas

`runDataLifecycleArchivePurge` di `application/archive-purge-job.ts`, dibungkus
`scripts/data-lifecycle-archive-purge.ts` (`bun run data-lifecycle:archive-purge`)
memakai worker runner bersama (`src/lib/jobs/*`) — advisory lock, timeout,
pembatalan yang sadar SIGTERM/SIGINT, telemetri JSON.

- Iterasi tenant-dahulu; legal hold diambil ulang segar tiap lintasan batch
  (hold yang dibuat di tengah backlog berlaku pada lintasan berikutnya persis).
- Deskriptor `"generic"`: lintasan archive terbatas (SELECT batch -> tulis lewat
  port archive DI LUAR transaksi DB mana pun -> catat manifest + majukan cursor
  di transaksi baru), lalu lintasan purge terbatas (`DELETE ... RETURNING`
  terbatas dalam satu transaksi, hanya mem-purge baris yang sudah dicakup sebuah
  manifest archive bila `archive.archivable`). Hanya
  `deletion.mode === "hard_delete"` yang dieksekusi.
- Deskriptor `"delegated"`: hanya snapshot dry-run, dicatat ke
  `awcms_data_lifecycle_runs` — tidak pernah dimutasi.

### Presisi timestamp (baca sebelum menyentuh perbandingan cursor)

Setiap perbandingan batas-cursor diberi bantalan
`CURSOR_BOUNDARY_SAFETY_MARGIN_MS` (1ms, `domain/cursor-boundary.ts`). Ini BUKAN
hiasan — `timestamptz` beresolusi mikrodetik tetapi nilai yang dibaca balik lewat
Bun.SQL sebagai `Date` JS hanya beresolusi milidetik, diam-diam memangkas nilai
sebenarnya KE BAWAH. Versi kode ini yang lebih awal membandingkan nilai terpangkas
tanpa bantalan secara langsung, yang secara permanen mengecualikan baris batas
(kurang satu baris tiap siklus archive) dan membuat resume archive berputar pada
baris terakhir yang sama. Bila Anda menyentuh logika batas ini, jalankan ulang
`tests/unit/data-lifecycle-cursor-boundary.test.ts` dan test integrasi yang
digerbangi DB.

## Port archive netral-provider

`domain/archive-port.ts` (antarmuka) +
`infrastructure/local-archive-adapter.ts` (adapter DEFAULT, satu-satunya yang
diimplementasikan): artefak JSONL/CSV di filesystem di bawah
`DATA_LIFECYCLE_ARCHIVE_ROOT_PATH` (doc 18), ber-checksum SHA-256, satu baris
manifest per artefak (`awcms_data_lifecycle_archive_manifests`).
`external_object_storage` adalah nilai `archive.port` valid yang boleh
dideklarasikan sebuah deskriptor (pengetikan kompatibel-ke-depan) tetapi belum
punya adapter konkret.

### Prosedur restore (archive lokal/offline)

`ArchivePort.read()` membaca balik sebuah artefak untuk
rekonsiliasi/pengujian; ia sengaja tidak pernah menulis balik ke tabel sumbernya.
Restore sungguhan ke tabel yang hidup adalah prosedur operator manual yang
terdokumentasi: (1) temukan artefaknya lewat baris
`awcms_data_lifecycle_archive_manifests` miliknya (`artifact_location`,
`checksum_hex`); (2) verifikasi checksum-nya dengan `ArchivePort.verify(location,
expectedHex)`; (3) baca barisnya dengan `ArchivePort.read(location)` — nilainya
kembali sebagai tipe native JSON/CSV (kolom `timestamptz` pulang-pergi sebagai
string ISO, bukan `Date`), jadi cast ulang per kolom sebelum INSERT; (4) INSERT
ke tabel modul PEMILIKNYA lewat kode modul itu sendiri (jangan pernah menulis
lintas-modul), di dalam transaksi `withTenant` untuk tenant milik artefak itu.
Batas "no shared-table write" yang sama (ADR-0013 §6) berlaku selama restore.

## Schema (migrasi `055_awcms_data_lifecycle_schema.sql`)

Empat tabel ber-scope tenant (`ENABLE`+`FORCE ROW LEVEL SECURITY`, kebijakan
`tenant_isolation`) — modul ini memiliki tepat tabel-tabel ini:

- **`awcms_data_lifecycle_legal_holds`** — satu-satunya override
  runtime/tenant sungguhan yang dibutuhkan sistem ini.
- **`awcms_data_lifecycle_cursors`** — state jeda/lanjut job terbatas per
  (tenant, deskriptor, fase).
- **`awcms_data_lifecycle_archive_manifests`** — bukti artefak archive.
- **`awcms_data_lifecycle_runs`** — riwayat eksekusi dry-run/archive/purge, hanya
  hitungan AGREGAT terkategori. Sekaligus deskriptor `"generic"` terdaftar
  miliknya sendiri.

Grant `awcms_worker` (sql/022) sempit dan eksplisit: `SELECT` SAJA pada legal
hold (worker membaca hold, tidak pernah membuat/melepasnya — itu tetap aksi
admin/API), `SELECT,INSERT,UPDATE` pada cursor/manifest, `SELECT,INSERT,
DELETE` pada runs. `awcms_app` tidak butuh grant eksplisit — keempat tabel
ber-scope tenant dan RLS-FORCE, sudah tercakup `ALTER DEFAULT
PRIVILEGES` menyeluruh dari sql/019.

## Seed permission (migrasi `056_awcms_data_lifecycle_permissions.sql`)

Cocok kata-per-kata dengan `DATA_LIFECYCLE_PERMISSIONS` di
`domain/data-lifecycle-permissions.ts`:

| Kunci permission                    | Aksi      | Catatan                                                |
| ----------------------------------- | --------- | ------------------------------------------------------ |
| `data_lifecycle.registry.read`      | `read`    | Hanya metadata yang dideklarasikan di kode             |
| `data_lifecycle.legal_hold.read`    | `read`    |                                                        |
| `data_lifecycle.legal_hold.create`  | `create`  | Tidak menyiratkan pelepasan                            |
| `data_lifecycle.legal_hold.release` | `release` | `AccessAction` baru; default-deny terpisah dari create |
| `data_lifecycle.plan.analyze`       | `analyze` | Pemicu dry-run sesuai permintaan                       |
| `data_lifecycle.runs.read`          | `read`    | Hanya hitungan teragregasi                             |

## API (`src/pages/api/v1/data-lifecycle/*`)

- `GET /api/v1/data-lifecycle/registry` — daftar deskriptor (hanya metadata).
- `POST /api/v1/data-lifecycle/dry-run` — rencana sesuai permintaan untuk satu deskriptor.
- `GET /api/v1/data-lifecycle/runs` — riwayat jalan.
- `GET`/`POST /api/v1/data-lifecycle/legal-holds` — daftar/buat.
- `POST /api/v1/data-lifecycle/legal-holds/{id}/release` — lepaskan.

Eksekusi archive/purge sungguhan sengaja **tidak** dipaparkan lewat HTTP — ia
operasi pemeliharaan tanpa penjaga, bukan aksi pengguna.

## Konfigurasi

Satu env var baru: `DATA_LIFECYCLE_ARCHIVE_ROOT_PATH` (doc 18) — root filesystem
adapter archive lokal/offline. Selebihnya (hari retensi, batas batch) dimiliki
tiap deskriptor di kode, atau oleh env var milik adopter delegated sendiri yang
sudah ada (mis. `AUDIT_LOG_RETENTION_DAYS`) — tidak pernah dideklarasikan ulang
di sini.

## Keterbatasan yang diketahui

- **Eksekusi lintas-tenant/ber-scope global**: deskriptor `scope: "global"`
  diterima oleh validator registry (pengetikan kompatibel-ke-depan) tetapi
  perencana dry-run dan engine archive/purge hanya mengimplementasikan jalur
  `scope: "tenant"` ujung-ke-ujung — deskriptor ber-scope global dilewati, bukan
  diam-diam dieksekusi keliru. Tidak ada deskriptor terdaftar hari ini yang
  mendeklarasikan `scope: "global"`.
- **Seri/nyaris-seri cursor dalam 1ms**: lihat "Presisi timestamp" di atas —
  kasus tepi sempit yang terdokumentasi, tidak terlatih oleh pola tulis nyata
  deskriptor terdaftar mana pun.
- **Adapter archive object-storage eksternal**: belum diimplementasikan — hanya
  `local_offline`.
- ~~**Belum ada layar admin UI khusus**~~ — sudah mendarat:
  `/admin/data-lifecycle` merender registry, ledger legal-hold (memasang dan
  melepas), perencana dry-run sesuai permintaan, dan riwayat jalan, dan modul ini
  kini mendeklarasikan entri `navigation`-nya. Layar itu tidak pernah menulis:
  pembacaan memakai ulang fungsi application milik modul ini sendiri di dalam
  satu transaksi `withTenantOrThrow`, dan setiap mutasi menuju endpoint
  `/api/v1/data-lifecycle/*` yang terjaga. `legal_hold.create` dan
  `.release` digerbangi TERPISAH di sana, karena aturan SoD di bawah menjadikan
  pemegangan keduanya sebagai konflik `critical`. Archive/purge sungguhan tetap
  job-saja — layar itu tak punya kendali untuknya karena tidak ada permukaan HTTP
  yang bisa dipanggil.
- **Partisi semata panduan**: tanpa otomasi.
- **Adopter**: `form_drafts` dan `comments` SUDAH terdaftar di sini — keduanya
  mendeklarasikan deskriptor `dataLifecycle` sungguhan (`form-drafts/module.ts`,
  `comments/module.ts`). Butir ini dulu berbunyi "belum di-port di base ini …
  tidak terdaftar sebagai adopter", kalimat yang persis sama dengan yang
  `tests/module-absence-claims.test.ts` dibangun untuk menangkap di skill; ia
  duduk satu direktori di luar korpus gerbang itu sampai korpusnya dilebarkan ke
  `src/modules/**`. `newsletter` satu-satunya yang masih absen, dan di bawah
  ADR-0055 ia DIBANGUN di sini dengan admission ADR-nya sendiri, bukan di-port.
