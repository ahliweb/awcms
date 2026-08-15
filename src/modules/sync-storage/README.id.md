🇮🇩 Bahasa Indonesia · 🇬🇧 [English (source)](README.md)

<!-- i18n-source-hash: sha256:4b28514bbccc1abf2f5d580cc9317a414e5256a35a0c9421055a3a3c34bc9390 -->

# Sync Storage

Fondasi sinkronisasi offline-first yang diport dari modul `sync-storage` awcms-mini
yang sudah terbukti. Menyediakan pertukaran event node-ke-node ber-autentikasi HMAC
(outbox/inbox), pelacakan konflik optimistic-concurrency, dan antrean unggah object
sync dengan dispatcher internal. Lihat skill `awcms-sync-hmac` dan dokumen
`08_sop_operasional_user_guide.md` / `10_template_kode_coding_standard.md`.

## Cakupan — Outbox/Inbox

- `awcms_sync_nodes` — registrasi node sync per tenant (`node_code` unik per
  tenant), status active/inactive, checkpoint (`last_pull_sequence`),
  `last_pushed_at`/`last_pulled_at`. Node meregistrasi diri otomatis saat kontak
  pertama.
- ~~`awcms_sync_outbox`~~ — **DIPENSIUNKAN** oleh
  [ADR-0077](../../../docs/adr/0077-one-outbox-sync-pull-reads-domain-events.md)
  (`sql/099`). Ia tidak pernah punya produsen, dan pertanyaan yang diangkatnya
  bukan bagaimana mengisinya melainkan apakah outbox kedua perlu ada sama sekali
  ketika `awcms_domain_events` sudah menjadi satu. `POST /api/v1/sync/pull` kini
  membaca `awcms_domain_events`, disaring oleh allow-list eksplisit berisi tipe
  event yang dapat direplikasi (`domain/sync-replication.ts`) yang **dirilis
  kosong** — jadi endpoint-nya tetap menjawab dengan daftar kosong, tetapi kini
  karena kebijakan yang ditulis di satu tempat, bukan karena kabel yang hilang.
- `awcms_sync_inbox` — event yang diterima dari node lain lewat push, disimpan
  dengan status `received` (fondasi ini tidak punya modul domain untuk benar-benar
  "menerapkan" event-nya — aplikasi turunan yang memprosesnya).
- `awcms_sync_push_batches` — ledger idempotensi berkunci
  `(tenant_id, node_id, batch_id)`; push yang diulang dengan `batch_id` yang sama
  diperlakukan sebagai sukses tanpa memproses ulang event-nya.
- Endpoint `POST /api/v1/sync/push`, `POST /api/v1/sync/pull` (**kosong sampai
  sebuah tipe event dideklarasikan dapat direplikasi** — lihat di atas),
  `GET /api/v1/sync/status`.

Skema: `sql/010_awcms_sync_storage_outbox_inbox_schema.sql`.

## Cakupan — Pelacakan konflik

- `awcms_sync_aggregate_versions` — versi terakhir yang diketahui server per
  `(aggregate_type, aggregate_id)`, dipakai oleh evaluator konflik
  optimistic-concurrency generik (tanpa pengetahuan domain tentang apa yang
  diwakili agregat itu).
- `awcms_sync_conflicts` — catatan konflik yang immutable (fakta intinya — node,
  batch, agregat, tipe konflik, payload — tidak pernah berubah setelah dibuat;
  hanya kolom resolusi yang diisi satu kali, saat penyelesaian). Dua tipe konflik
  generik:
  - `missing_base_version` — agregatnya sudah punya versi
    (`current_version > 0`) tetapi event yang di-push tidak membawa `baseVersion`.
  - `version_mismatch` — `baseVersion` yang dikirim berbeda dari versi terkini di
    server.
- `POST /sync/push` mencatat event yang berkonflik ke `sync_conflicts` (bukan
  `sync_inbox`) dan **tidak** memajukan versi agregat; responsnya menambahkan
  hitungan `conflicted`.
- `GET /sync/conflicts` (filter `?status=open|resolved`) dan
  `POST /sync/conflicts/{id}/resolve` — berbeda dari endpoint sync lainnya, keduanya
  **ber-autentikasi sesi** (bearer token atau cookie SSR), bukan HMAC,
  karena penyelesaian konflik adalah keputusan manusia, bukan aksi node.
  Digerbangi oleh `sync_storage.conflict_resolution.read`/`.approve`. Menyelesaikan
  konflik yang sudah `resolved` ditolak dengan `409`. Penyelesaiannya diaudit.

Skema: `sql/011_awcms_sync_storage_conflict_schema.sql`.

## Cakupan — Antrean object sync

- `awcms_object_sync_queue` — antrean objek lokal (mis. berkas struk/lampiran)
  yang menunggu unggahan ke object storage. Unik
  `(tenant_id, node_id, object_key)` — meng-enqueue ulang `objectKey` yang sama
  melakukan upsert (bukan duplikasi): `local_path`, `checksum_sha256`,
  `byte_size`, `requires_upload` diperbarui dan barisnya direset ke
  `status='pending'`.
- `requires_upload` diisi dari `R2_ENABLED` saat enqueue. Enqueue itu sendiri tidak
  pernah memanggil provider — ia adalah flag data, bukan pemicu jaringan
  (ADR-0006). Driver default adalah lokal (`STORAGE_DRIVER=local`,
  `LOCAL_STORAGE_PATH`); R2 bersifat opsional dan tidak pernah wajib.
- Endpoint `POST /api/v1/sync/objects` — body
  `{ objects: [{ objectKey, localPath, checksumSha256, byteSize }] }`, upsert
  per objek, respons `{ queued: <count> }`.
- Endpoint `GET /api/v1/sync/objects/status` — entri non-`sent` milik node
  pemanggil (pending+failed), limit 100.
- Logika domain murni di `domain/object-queue.ts`: `verifyObjectChecksum`
  (kesetaraan string biasa — checksum bukan rahasia), `evaluateObjectRetry`
  (backoff eksponensial `2^retryCount` menit, dibatasi
  `OBJECT_SYNC_MAX_RETRY_DELAY_MINUTES=60`, tak lagi memenuhi syarat begitu
  `retryCount >= OBJECT_SYNC_MAX_RETRIES=5`), dan
  `validateObjectSyncEnqueueRequestBody`.

Skema: `sql/012_awcms_object_sync_queue_schema.sql`.

## Autentikasinya berbeda dari endpoint lain

Endpoint node-ke-node (`/sync/push`, `/sync/pull`, `/sync/status`,
`/sync/objects`, `/sync/objects/status`) bersifat mesin-ke-mesin dan **tidak**
memakai bearer token/sesi. Semuanya berautentikasi lewat header HMAC
(`X-AWCMS-Node-ID`, `X-AWCMS-Timestamp`, `X-AWCMS-Signature`,
`X-AWCMS-Signature-Version`) dengan satu secret se-deployment dari
environment (`AWCMS_SYNC_HMAC_SECRET`), diverifikasi dengan perbandingan
timing-safe terhadap skew maksimum (`AWCMS_SYNC_MAX_SKEW_SEC`, default 300 detik)
demi anti-replay. `X-AWCMS-Tenant-ID` wajib demi isolasi tenant.

### Versi tanda tangan (advisory keamanan GHSA-c972-3q5p-g3h4)

- **v2 (kanonik)** — `HMAC-SHA256("v2:<tenantId>:<nodeCode>:<timestamp>:<body>")`.
  Tenant dan node berada **di dalam** materi yang ditandatangani, sehingga tanda
  tangan yang dicetak untuk satu tenant tidak lagi terverifikasi ketika
  `X-AWCMS-Tenant-ID` ditukar ke tenant lain. Node mengirim
  `X-AWCMS-Signature-Version: 2`. Inilah skema kanonik, dicerminkan di awcms,
  awcms-mini, dan skill `awcms-sync-hmac`. `tenantId` **wajib berupa UUID** dan hal
  ini ditegakkan di batas v2 (temuan audit L1): karena `nodeCode` boleh mengandung
  `:` (skema `node_code text`), `tenantId` non-UUID akan membuat batas tenant/node
  menjadi ambigu (`v2:A:x:y:…` cocok untuk `tenantId="A", nodeCode="x:y"` maupun
  `tenantId="A:x", nodeCode="y"`). UUID berpanjang tetap 36 karakter tanpa `:`,
  jadi batasnya tidak ambigu; `computeSyncSignatureV2` melempar dan
  `verifySyncSignatureV2` gagal tertutup pada tenant non-UUID. Format materinya
  tidak berubah (`nodeCode` tidak dibatasi), jadi ini transparan bagi node yang
  sudah ada.
- **v1 (legacy, RENTAN)** — `HMAC-SHA256("<timestamp>.<body>")`, dipakai ketika
  header `X-AWCMS-Signature-Version` tidak dikirim. Baik tenant maupun node tidak
  diikat, sehingga ia **dapat dipalsukan lintas-tenant** dan dipertahankan hanya
  agar node yang sudah ter-deploy tetap bekerja selama migrasi. Ia diterima selama
  `SYNC_HMAC_ALLOW_LEGACY` tidak bernilai `false` (env, default mengizinkan).
  **Set `SYNC_HMAC_ALLOW_LEGACY=false` begitu setiap node sudah pindah ke v2 untuk
  menolak v1 dan menutup lubang lintas-tenant sepenuhnya.** Advisory itu baru
  tertutup penuh ketika legacy dinonaktifkan DAN setiap node berada di v2.

Endpoint mengembalikan `403` ketika `AWCMS_SYNC_ENABLED` bukan `true`, dan `403`
untuk node mana pun yang statusnya bukan `active`. Node kontak-pertama kini
meregistrasi diri otomatis sebagai `inactive` (advisory GHSA-c972-3q5p-g3h4) —
admin wajib menyetujuinya lewat `PATCH /api/v1/sync/nodes/{id}`
(`status: "active"`) sebelum ia bisa push/pull. Ini mengarantina id node
kontak-pertama yang dipalsukan untuk tenant lain. Node yang sudah `active` tidak
terpengaruh; menonaktifkan node lewat endpoint admin berlaku seketika di
push/pull/status/objects.

## Permukaan admin (ber-autentikasi sesi)

- `GET /api/v1/sync/nodes` + `PATCH /api/v1/sync/nodes/{id}` — mendaftar node dan
  mengaktifkan/menonaktifkan/mengganti nama (digerbangi
  `sync_storage.node_management.*`, diaudit).
- `GET /api/v1/sync/object-queue` (filter `?status=`, paginasi keyset
  `?cursor=`/`nextCursor`) — tampilan admin se-tenant untuk semua node, berbeda
  dari `GET /sync/objects/status` HMAC yang ber-scope node. Digerbangi
  `sync_storage.object_queue.read`.
- `POST /api/v1/sync/object-queue/{id}/retry` — override manual atas jadwal
  backoff otomatis: mereset entri `failed` kembali ke `pending`
  (`pending`/`sent` ditolak dengan `409`). Digerbangi
  `sync_storage.object_queue.retry`; diaudit. Ia adalah dorongan pada jadwal
  otomatis, bukan aksi destruktif, sehingga `isHighRiskAction("retry")` bernilai
  false.

### UI admin (`/admin/sync`)

`src/pages/admin/sync.astro` (ADR-0051) — konsol operator untuk ketiga
permukaan di atas: daftar node dengan aktifkan/nonaktifkan, daftar konflik dengan
ketiga resolusinya, dan antrean objek dengan retry pada entri `failed`.
Keenam izin modul ini digerakkan dari satu halaman ini. Pembacaan melewati
`application/sync-directory.ts` di dalam satu `withTenantOrThrow` — persis
"halaman SSR `/admin/sync` masa depan" yang selalu disebut komentar header berkas
itu sendiri.

`fetchSyncConflicts` ditambahkan di sana dalam perubahan yang sama dan `GET
/api/v1/sync/conflicts` kini ikut memanggilnya; kuerinya dulu inline di rute
itu, yang tidak masalah selama ia satu-satunya pembaca.

**Tidak satu pun dari ketiga mutasi mengirim `Idempotency-Key`**, karena tidak ada
endpoint yang menuntutnya: ketiganya adalah transisi state yang idempoten secara
alami, bukan request yang mengerjakan pekerjaan baru tiap panggilan.
`tests/admin-sync-page-contract.test.ts`
memakukan itu di kedua arah, sehingga endpoint yang belakangan mulai menuntut kunci
membuat kontrak layar ini memerah alih-alih gagal senyap saat runtime.

Protokol node HMAC (`push`/`pull`/`objects`/`status`) **tidak punya kendali di
halaman ini dan tidak akan mendapatkannya** — protokol itu mengautentikasi node
lewat tanda tangan, bukan administrator lewat sesi, jadi tombol untuknya akan
menjadi kendali yang tidak bisa dipakai peramban mana pun secara sah.

## Dispatcher

`application/object-dispatch.ts` — `dispatchObjectSyncQueue(sql, tenantId,
options?)`, worker internal (bukan endpoint HTTP) yang dipanggil oleh
`scripts/object-sync-dispatch.ts` (`bun run sync:objects:dispatch`), satu tenant
pada satu waktu. Pola tiga fase yang dituntut ADR-0006 (jangan pernah memanggil
provider di dalam transaksi):

1. **CLAIM** — satu transaksi pendek membalik baris yang memenuhi syarat dan sudah
   jatuh tempo ke status transien `sending` (`FOR UPDATE SKIP LOCKED`), memakai
   ulang `next_retry_at` sebagai kedaluwarsa lease klaim (tanpa kolom baru).
   Langsung commit.
2. **UPLOAD** — di luar transaksi mana pun, memanggil `ObjectUploader` yang
   diresolusi dari `requires_upload` baris itu
   (`infrastructure/object-storage-uploader.ts`): `createNoopObjectUploader`
   (requires_upload=false — R2 mati / `STORAGE_DRIVER=local`, tanpa jaringan/I/O,
   selalu sukses) atau `createR2ObjectUploader` (requires_upload=true — unggahan
   nyata lewat `Bun.S3Client` native milik Bun, tanpa SDK npm; memverifikasi sha256
   sebenarnya dari berkas lokal terhadap checksum yang tercatat sebelum mengunggah).
3. **FINALIZE** — transaksi pendek kedua per baris membalik `sending` menjadi
   `sent`, atau kembali ke `pending` dengan backoff (`evaluateObjectRetry`), atau
   menjadi `failed` begitu retry habis.

Idempoten secara alami: baris `sent`/`failed` tidak pernah diklaim ulang, dan
`objectKey` tujuan itu sendiri adalah kunci dedup (PUT S3/R2 ke kunci yang sama
adalah penimpaan). Circuit breaker per-provider
(`getProviderCircuitBreaker("object-storage")`) melewatkan pengklaiman baris
`requires_upload=true` selama ia terbuka; baris `requires_upload=false` tetap
berjalan (mereka tidak pernah menyentuh provider). Setiap unggahan dibatasi
timeout (`OBJECT_SYNC_UPLOAD_TIMEOUT_MS`, default 10000). Tidak ada kontrak
OpenAPI/AsyncAPI baru — dispatcher-nya murni internal.

## Belum tersedia

- **Replikasi server → node** — issue #477 / ADR-0077. Outbox kedua sudah
  dipensiunkan dan `/sync/pull` kini membaca `awcms_domain_events`, tetapi
  `SYNC_REPLICABLE_EVENT_TYPES` dirilis **kosong** dan dua hal memblokir entri
  pertamanya, keduanya pekerjaan desain bukan sekadar mengetik:
  1. **proyeksi payload** — node ber-autentikasi HMAC, bukan sesi, jadi tiap
     tipe event yang dapat direplikasi menuntut modul pemiliknya mendeklarasikan
     field mana yang ikut berjalan. `redactEventPayloadForResponse` tidak bisa
     dipakai ulang: ia menutupi `email`/`phone`/`nik`/`npwp`, yaitu persis apa
     yang dibutuhkan replika;
  2. **visibilitas commit** — `event_sequence` diberikan saat `INSERT` dan
     terlihat saat `COMMIT`, sehingga cursor `event_sequence > checkpoint` bisa
     melewatkan event yang transaksinya commit belakangan. `appendDomainEvent`
     sudah menyelesaikan ini dengan benar bagi konsumen dengan menulis baris
     pengiriman di transaksi yang sama; replikasi seharusnya menumpang itu, bukan
     mengulang cursor.
- Penerapan otomatis event `awcms_sync_inbox` ke tabel domain (fondasi ini tidak
  punya modul domain untuk menerapkannya — event tetap `received`; aplikasi
  turunan yang memprosesnya).
