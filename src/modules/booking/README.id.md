🇮🇩 Bahasa Indonesia · 🇬🇧 [English (source)](README.md)

<!-- i18n-source-hash: sha256:5a4e9938cb22f6eeeb0ff9f619b6b2e2928d698c4ebe8a26adbdbb1a0c94f549 -->

<!-- i18n-source-hash: sha256:pending -->

# `booking`

**Resource, unit kapasitas, jadwal, dan reservasi** generik untuk apa pun yang
menyewakan waktu, ruang, atau kapasitas, termasuk menginap per malam (Issue #937,
[ADR-0131](../../../docs/adr/0131-generic-booking-module-admission.md), diubah oleh
[ADR-0135](../../../docs/adr/0135-day-granularity-stays-admitted-into-booking-v1.md)).
Paket desain lengkapnya adalah [`docs/awcms/booking.md`](../../../docs/awcms/booking.md);
berkas ini adalah peta kodenya.

## Irisan yang sudah ada

Fondasi (Issue #937): descriptor (`experimental`), skema (`sql/180`), katalog izin
(`sql/181`), mesin status reservasi murni, literal guard, dan nama audit event.

Ketersediaan (Issue #938): jadwal, penutupan, dan pengecualian, malam yang
diblokir (`sql/186`), kalkulasi ketersediaan murni, dan route di
`/api/v1/booking/` (`availability`, `schedules`, `schedule-exceptions`).

Allocator (Issue #939, `sql/200`): allocator slot, hold dengan kedaluwarsa,
layanan klaim `placeHold`, dan rekonsiliasi read-only, ditambah job
`booking:holds:expire`, yang berjalan sebagai `awcms_worker` lewat sapuan
SECURITY DEFINER sempit `sql/200` (worker tak memegang privilege pada tabel
booking).

Stay dan blok (Issue #940, `sql/204`): stay diklaim lewat allocator dan
`placeHold` yang sama (`stay: { checkInDate, checkOutDate }`, exclusion
constraint kedua atas tanggal), malam terblokir adalah baris allocation milik
satu baris `resource_blocks` (`createBlock` / `releaseBlock`, `BLOCK_CONFLICT`),
dan reklamasi malas serta rekonsiliasi memahami keduanya. **Belum ada:** route
reservasi dan transisi setelah pembuatan (`confirm`, `cancel`, `reschedule`,
...), route blok, channel AsyncAPI, layar admin, dan proyeksi reporting
(Issue #941 dan #942).

## Allocator, di satu tempat

- **Jaminannya adalah exclusion constraint**, bukan kode ini. Allocator
  (`application/booking-allocator.ts`) mengklaim satu unit dengan `INSERT ... ON
CONFLICT DO NOTHING RETURNING id`: PostgreSQL menunggu baris konkuren yang
  belum pasti lalu menyerap konflik (pihak yang kalah tidak mendapat baris,
  transaksi tetap bisa dipakai) atau meloloskan klaim bila penulis lain
  di-rollback. Ia membaca unit bebas lebih dulu sebagai **petunjuk** (hanya
  baris yang sudah commit) dalam urutan deterministik, mengklaim unit yang
  dipilih bersama dalam urutan `(resource_id, ordinal)` supaya dua penulis tidak
  saling menunggu melingkar, dan semua-atau-tidak-sama-sekali untuk `k` unit:
  `placeHold` menjalankan seluruh klaim dalam savepoint, sehingga penolakan
  meng-rollback reservasi, item, dan unit yang sudah dimenangkan.
- **Penolakan adalah nilai** (`SLOT_UNAVAILABLE`, `HOLD_LIMIT_EXCEEDED`, ...),
  bukan error, dan penolakan tidak menulis apa pun. Deadlock sisa (`40P01`)
  diulang paling banyak tiga kali dengan jitter, lalu `CONTENTION_RETRY`.
- **Hold kedaluwarsa lewat dua cara yang bekerja sama**
  (`application/booking-hold-expiry.ts`). **Reklamasi malas** mengakhiri, di
  dalam transaksi klaim itu sendiri dan di bawah kunci baris reservasi, hold
  yang sudah berakhir dan menempati unit yang diklaim. **Reaper**
  (`bun run booking:holds:expire`, tiap menit) mengakhiri sisanya. Kebenaran
  hanya bergantung pada yang pertama: dengan reaper berhenti, klaim yang
  terlambat tetap menemukan unit bebas, dan keterlambatan reaper terlihat sebagai
  `hold_overdue_unswept` di `runReconciliation`.
- **`placeHold` adalah klaim, bukan handler pembuatan.** Jam buka, lead time,
  horizon, dan `reservations.override` milik handler (Issue #941) dan berjalan
  sebelumnya. Ia tak pernah melihat nama pelanggan: pelanggan adalah
  `externalCustomerRef` yang opak, dijauhkan dari baris audit dan detail event.

## Stay dan blok, di satu tempat

- **Stay adalah tanggal.** `placeHold` menerima `stay: { checkInDate,
checkOutDate }` (`YYYY-MM-DD` lokal pada zona resource, setengah-terbuka)
  sebagai ganti instan. `deriveStay` (`domain/booking-stay.ts`) memvalidasinya
  dengan pemeriksaan `evaluateStay`, menghitung malam sebagai aritmetika tanggal,
  dan menurunkan instan kedatangan dan keberangkatan dari jam check-in dan
  check-out resource; tanggal, malam, zona, jam lokal, dan instan
  **disnapshot ke item** dan menjadi fakta sesudahnya. Stay mengambil satu unit
  untuk semua malamnya; `quantity` adalah jumlah kamar.
- **Allocator-nya loop yang sama** (`UnitClaim` `kind: "stay"`): petunjuk unit
  bebas memeriksa overlap `daterange`, insert-nya `ON CONFLICT DO NOTHING`, dan
  exclusion constraint kedua adalah otoritasnya. Resource slot dan resource stay
  tak pernah berebut (trigger membuat granularitas allocation sama dengan mode
  resource-nya).
- **Blok adalah baris allocation tanpa reservasi** (`UnitClaim` `kind: "block"`,
  `application/booking-block-service.ts`): satu baris per unit yang dicakup,
  disisipkan dalam urutan `(resource_id, ordinal)` di dalam savepoint,
  semua-atau-tidak-sama-sekali, di bawah constraint stay yang SAMA, sehingga blok
  dan booking yang berebut satu malam diputuskan database dan tak ada override
  yang mengangkat blok. Di atas stay hidup, blok adalah `BLOCK_CONFLICT` dan tak
  membatalkan apa pun. Melepas blok melepas barisnya dalam statement yang sama
  (trigger), dan replay tidak menulis apa pun.
- **Kedaluwarsa tak perlu diubah.** Hold stay berakhir pada kolom yang sama dan
  dilepas lewat join item yang sama dengan hold slot, sehingga `sql/200` dan
  reaper tidak tersentuh; reklamasi malas memeriksa `daterange` untuk stay dan blok.

## Semantik waktu, di satu tempat

- Setiap instan berupa UTC dan setiap interval setengah-terbuka `[start, end)`;
  instan request tanpa offset adalah 400.
- Jadwal ditulis dalam waktu dinding lokal pada zona IANA. `resolveLocalInstant`
  (`domain/booking-time.ts`) adalah SATU fungsi gap/fold (RFC 5545 bagian 3.3.5):
  waktu lokal yang tidak ada memakai offset sebelum gap, yang ambigu memakai
  kemunculan pertamanya.
- Sebuah stay adalah interval tanggal lokal; malam adalah `check_out - check_in`
  dalam tanggal. Jam check-in dan check-out hanya menurunkan instan tampilan dan
  tidak pernah masuk uji tumpang-tindih atau hitungan malam. Pergantian di hari
  yang sama diizinkan.
- Blok adalah pengecualian keras (tidak ada yang menimpanya); pengecualian
  `closed` adalah penutupan lunak (`OUTSIDE_SCHEDULE`, dapat ditimpa).
  Ketersediaan tidak mengklaim apa pun: exclusion constraint allocator, bukan
  pembacaan ini, yang mencegah double booking.

## Aturan yang dipegang database

- **Double-booking tak bisa direpresentasikan.** Dua exclusion constraint GiST
  parsial pada `awcms_booking_resource_allocations`, satu atas instan (mode slot)
  dan satu atas tanggal (mode stay), keduanya hanya atas baris yang masih hidup.
  Membutuhkan ekstensi tepercaya `btree_gist` (booking.md bagian 8.2).
- **Mesin status adalah trigger.** `awcms_booking_reservations_update_guard`
  hanya mengizinkan transisi yang sah dan, per transisi, hanya kolom yang boleh
  berubah. `domain/booking-reservation-state.ts` adalah tabel yang sama sebagai
  fungsi murni; tes integrasi memastikan keduanya sepakat untuk setiap pasangan status.
- **Riwayat bersifat append-only.** Event dan item reservasi menolak UPDATE dan
  DELETE lewat trigger dan privilege yang dicabut; tidak ada yang pernah dihapus.
- **Tanpa uang, tanpa id produk, tanpa nama pelanggan** di tabel mana pun
  (booking.md bagian 10.2); sebuah tes membaca `information_schema` untuk menjaganya.
- **RLS `ENABLE` + `FORCE`** dan foreign key komposit `(tenant_id, id)` pada setiap tabel.

## Tata letak

| Path                                     | Isinya                                                                                      |
| ---------------------------------------- | ------------------------------------------------------------------------------------------- |
| `module.ts`                              | Descriptor: 32 izin, `dataLifecycle` dan `subjectData` untuk tabel-tabelnya                 |
| `domain/booking-reservation-state.ts`    | Mesin status reservasi sebagai fungsi murni (tanpa I/O, pemanggil memberi jam database)     |
| `domain/booking-permissions.ts`          | Objek guard literal untuk `authorizeInTransaction` (dipakai mulai Issue #938)               |
| `domain/booking-audit.ts`                | Nama dan severity audit event                                                               |
| `domain/booking-time.ts`                 | Zona, aritmetika tanggal, dan resolusi gap/fold RFC 5545 yang murni                         |
| `domain/booking-schedule.ts`             | Skema rules tertutup, pemilihan jadwal, ekspansi ke jendela UTC, penutupan (murni)          |
| `domain/booking-availability.ts`         | Ketersediaan slot dan evaluasi stay yang murni (tanpa I/O, tanpa jam)                       |
| `domain/booking-validation.ts`           | Validasi request ketat (RFC 3339 beroffset, zona IANA)                                      |
| `domain/booking-staff-availability.ts`   | Seam StaffAvailabilityConsumer no-op yang dihubungkan Issue #949                            |
| `application/*-directory.ts`             | Satu-satunya kode yang membaca atau menulis baris (jam database, per tenant, savepoint)     |
| `domain/booking-allocation.ts`           | Umur hold, jendela slot, urutan unit, klasifikasi SQLSTATE, backoff retry (murni)           |
| `application/booking-allocator.ts`       | `claimUnits`: unit dari satu item, semua-atau-tidak, di bawah exclusion constraint          |
| `application/booking-hold-expiry.ts`     | Reklamasi malas dan satu putaran reaper: satu statement per kedaluwarsa                     |
| `application/booking-hold-service.ts`    | `placeHold`: reservasi, snapshot item, allocation, riwayat, audit, dalam satu savepoint     |
| `application/booking-hold-expiry-job.ts` | Sapuan per tenant di balik `scripts/booking-holds-expire.ts`                                |
| `application/booking-reconciliation.ts`  | Bukti read-only bahwa reservasi, allocation, dan blok sepakat; keterlambatan reaper         |
| `domain/booking-stay.ts`                 | Tanggal stay, batas malam, syarat pool, dan validasi blok yang murni (tanpa I/O/jam)        |
| `application/booking-block-service.ts`   | `createBlock` / `releaseBlock`: malam terblokir sebagai allocation, `BLOCK_CONFLICT`, audit |

Belum ada di skema dan dicatat sebagai tindak lanjut: `service_requirements` dan
`staff_assignments` (booking.md bagian 4). `resource_blocks` hadir bersama
Issue #938, dan baris allocation serta penulisnya bersama Issue #940 (`sql/204`);
route HTTP untuk blok (`blocks.read` / `.create` / `.release`, di-seed oleh
`sql/181`) hadir bersama irisan route (#941, #942). Blok seluruh resource
mencakup unit yang ada saat dipasang; unit yang ditambahkan kemudian dilaporkan
rekonsiliasi (`block_missing_allocation`), tidak tercakup.

Tindak lanjut yang dicatat audit keamanan fondasi: handler transisi pada #941
wajib menulis tepat satu event riwayat per transisi (database belum mengikat
perubahan status ke baris event; putaran kedaluwarsa #939 melakukannya dalam
satu statement), dan tabel append-only sebaiknya juga
menolak TRUNCATE lewat trigger (kini hanya privilege yang dicabut yang
menahan role runtime).
