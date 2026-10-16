🇮🇩 Bahasa Indonesia · 🇬🇧 [English (source)](README.md)

<!-- i18n-source-hash: sha256:6f48b1d00e8657ae84026b151e2d52f19e858bceae2df4e4908dafda9339d3da -->

<!-- i18n-source-hash: sha256:pending -->

# `booking`

**Resource, unit kapasitas, jadwal, dan reservasi** generik untuk apa pun yang
menyewakan waktu, ruang, atau kapasitas, termasuk menginap per malam (Issue #937,
[ADR-0131](../../../docs/adr/0131-generic-booking-module-admission.md), diubah oleh
[ADR-0135](../../../docs/adr/0135-day-granularity-stays-admitted-into-booking-v1.md)).
Paket desain lengkapnya adalah [`docs/awcms/booking.md`](../../../docs/awcms/booking.md);
berkas ini adalah peta kodenya.

## Irisan yang sudah ada

Fondasi (Issue #937): descriptor (`experimental` sampai Issue #942; kini `active`), skema (`sql/180`), katalog izin
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
dan reklamasi malas serta rekonsiliasi memahami keduanya.

Reservasi (Issue #941, `sql/208`, `sql/209`): route `POST/GET /reservations`,
`GET /reservations/{id}` dan transisi `confirm`, `cancel`, `reschedule`,
`check-in`, `check-out` dan `no-show`
(`application/booking-reservation-service.ts`), `Idempotency-Key` lewat
komponen bersama, `BookingPort` (`application/booking-port-adapter.ts`), sembilan
event reservasi di dokumen AsyncAPI live, dan default aman untuk batas hold.
Route blok (Issue #1012: `POST/GET /blocks`, `GET /blocks/{id}`,
`POST /blocks/{id}/release`) memakai `Idempotency-Key` dengan replay dan tidak
menerbitkan event. **Belum ada:** route rekonsiliasi.

Pengingat (Issue #943, `sql/284`, `sql/285`): **intent** konfirmasi dan
pengingat (`awcms_booking_reminder_intents`, sekali per reservasi, kind, dan
occurrence), dibuat dan diserahkan ke satu antrean WhatsApp lewat
`WhatsappDeliveryPort` oleh job `booking:reminders:dispatch`
(`application/booking-reminder-dispatch.ts`, `booking-reminder-job.ts`). Jalur
reservasi tidak berubah; booking tidak menyimpan kontak, kredensial, antrean, atau
panggilan provider. Pelanggan di-resolve ke penerima oleh
`BookingReminderRecipientPort` yang didaftarkan deployment
(`registerBookingReminderRecipients`); tanpa itu, job inert. Lihat
[`booking.md` §7.5](../../../docs/awcms/booking.id.md).

Layar admin (Issue #942, tanpa migrasi, tanpa perubahan API; modul `active`): enam
layar -- `/admin/booking/reservations` (daftar, hold dan
kedaluwarsanya; `?id=` adalah satu reservasi dengan riwayat dan aksi confirm /
cancel / check-in / complete / no-show), `/admin/booking/resources` (dengan unit dan pool), `/admin/booking/offerings`,
`/admin/booking/schedules` (jam buka dan penutupan), `/admin/booking/blocks`, dan `/admin/booking/policy` --
masing-masing satu entri `navigation` yang izinnya di-seed dan ditegakkan.
Mereka hanya memanggil route di atas, mengirim setiap mutasi lewat satu pengirim
bersama (`src/lib/ui/booking-admin-client.ts`) dengan `Idempotency-Key`,
menampilkan penolakan sebagai kalimat terjemahan
(`src/lib/booking-admin-messages.ts`, `locales/`), dan tanpa dialog browser.
Membuat, menjadwalkan ulang, dan meng-override reservasi tidak ada di layar mana
pun; lihat [`booking.md` §3.0.3](../../../docs/awcms/booking.id.md).
Konfigurasi admin (Issue #1030, tanpa migrasi; prasyarat #942): resource beserta unit
dan keanggotaan pool-nya, pool resource, offering layanan dan kebijakan tenant, di
bawah `/api/v1/booking/` (`resources`, `resource-pools`, `offerings`, `policy`).
Setiap tulis memakai `Idempotency-Key` dengan replay dan berjalan di bawah
savepoint, sehingga guard database (`BOOKING_MODE_IN_USE`, `TIMEZONE_IN_USE`,
`SCHEDULE_TIMEZONE_MISMATCH`, kode ganda) menjadi 409 bernama, bukan 500. Delete
bersifat soft dan ditolak selama resource dipakai; kapasitas hanya bertambah;
`PUT /policy` mengganti seluruh kebijakan (`null` = default modul) dan diaudit
`critical`. Kode: `application/booking-resource-admin.ts`,
`booking-offering-admin.ts`, `booking-policy-admin.ts`, `booking-admin-routes.ts`,
`booking-admin-support.ts`, `domain/booking-admin-validation.ts`; lihat
[`booking.md` §3.0.2](../../../docs/awcms/booking.id.md).

Pelaporan (Issue #944, `sql/244`): tiga proyeksi pada engine `reporting` yang ada
dan tiga route laporan langsung; lihat "Pelaporan, di satu tempat".

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
  horizon, dan `reservations.override` milik handler pembuatan
  (`createReservation`, Issue #941) dan berjalan sebelumnya. Ia tak pernah
  melihat nama pelanggan: pelanggan adalah `externalCustomerRef` yang opak,
  dijauhkan dari baris audit dan event.
- **Batas hold selalu berlaku.** `NULL` di settings berarti default modul (5 hold
  hidup per pelanggan, 500 per tenant, `domain/booking-policy.ts`), bukan tanpa
  batas. Hitungan diambil di bawah advisory lock per tenant, sehingga hold satu
  tenant diserialkan selama transaksi klaim.

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

## Reservasi, di satu tempat

- **Transisi adalah satu transaksi** (`transitionReservation`): kunci reservasi
  `FOR UPDATE`, baca jam DATABASE dalam statement yang sama, putuskan dengan mesin
  status murni, tolak sebagai nilai SEBELUM menulis apa pun (`withTenant`
  meng-commit 4xx yang dikembalikan), lalu tulis reservasi, lepas allocation bila
  kata kerjanya demikian, tambahkan TEPAT SATU baris riwayat, satu baris audit,
  dan satu event outbox. Meminta status yang sudah dimiliki reservasi adalah replay
  (`replayed: true`) dan tidak menulis apa pun, dengan `Idempotency-Key` apa pun.
- **Route** mengotorisasi izin kata kerjanya lebih dulu (default tolak),
  memvalidasi body secara ketat (field pembayaran adalah
  `PAYMENT_FIELD_NOT_ACCEPTED` yang menyebut namanya, key tak dikenal lain adalah
  `VALIDATION_ERROR`), lalu `runIdempotent` (respons tersimpan untuk key, user, dan
  request yang sama dikembalikan apa adanya; key yang dipakai ulang dengan request
  lain adalah `IDEMPOTENCY_CONFLICT`). Penolakan tak pernah disimpan. Not-found
  adalah satu 404 netral untuk id tak dikenal dan id tenant lain.
- **`overridePolicy` adalah pemeriksaan kedua yang independen.** Mengangkat jam
  buka, lead time, dan horizon membutuhkan `reservations.override` selain izin
  kata kerjanya sendiri, diperiksa lebih dulu lewat `authorizeInTransaction`
  (aksi berisiko tinggi, sehingga separation-of-duties saat aksi berlaku) dan
  diaudit `critical`. Ia tak pernah mengangkat konflik allocation. Port tak punya
  override.
- **Reschedule** (`rescheduleReservation` + `placeHold` dengan `replaces`) adalah
  satu savepoint: lepas allocation lama, tandai reservasi lama `rescheduled`,
  sisipkan pengganti dengan lineage yang sama, klaim interval baru. Baris lama
  digantikan SEBELUM penggantinya ada, itulah sebabnya `sql/208` menjadikan satu
  foreign key itu ditangguhkan; penolakan di mana pun meng-rollback seluruh
  pemindahan.
- **Event** berasal dari satu fungsi database,
  `awcms_booking_reservation_event_facts` (`sql/209`): daftar-izin fakta non-pribadi,
  sehingga transisi request, reklamasi malas, dan sapuan (yang mengembalikan fakta
  yang dikedaluwarsakannya, karena worker tak boleh membaca tabel) membawa field
  yang sama. `expired` diterbitkan oleh kedua cara hold berakhir.
- **Ownership grant: tidak ada.** `ownershipGrant` hanya bisa memperluas
  pembacaan, dan pelanggan adalah token opak di otoritas commerce, bukan tenant
  user; pembuat reservasi tidak berhak membacanya hanya karena membuatnya.

## Pelaporan, di satu tempat

- **Tanpa engine analitik kedua.** `domain/booking-reporting.ts` mendeklarasikan
  tiga `ProjectionDescriptor` (`booking.reservations`, `booking.time`,
  `booking.nights`) pada `reportingProjections` di `module.ts`; worker, rebuild,
  dan rekonsiliasi modul `reporting` yang menjalankannya. Izin baca
  `booking.reports.read`.
- **Sumbernya tabel event append-only, bukan event domain live.** Rebuild selalu
  re-scan tabel, sehingga keadaan tunak dan rebuild adalah scan yang sama
  (trade-off di header `domain/booking-reporting.ts`). `sql/244` menaruh kuantitas
  pada baris saat tulis: detik terpesan/terlepas (interval layanan, buffer
  dikecualikan) dan unit-malam terpesan/terlepas (satu per unit dan malam), plus
  `projection_kind` ter-generate (`late_cancelled` subset `cancelled`). Setiap
  metrik hanya naik; neto adalah `booked - released`.
- **Laporan langsung dan berjendela:** `GET /booking/reports/occupancy` (stay,
  per unit-malam), `/utilization` (slot, terpesan atas detik terbuka), dan
  `/reservations` (pipeline hold, lead time, pembatalan, no-show), semuanya dengan
  jendela hari Asia/Jakarta. Aturan murni di `domain/booking-report.ts`, satu-satunya
  SQL di `application/booking-report-directory.ts`.
- **Keputusan pemilik O8:** occupancy tidak menghitung hold (hold adalah
  `heldUnitNights` dan pipeline, di samping rate, tak pernah di dalamnya);
  utilization laporan terpisah.
- **Tanpa pendapatan, tanpa orang.** Booking tidak memegang harga; tak ada
  proyeksi atau laporan yang membaca referensi pelanggan, catatan, alasan, atau
  aktor. Rasio atas kurang dari 5 reservasi ditahan (hitungan tidak dianonimkan:
  pembaca memegang `booking.reports.read` atas tenant itu).

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

| Path                                                 | Isinya                                                                                          |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `module.ts`                                          | Descriptor: 32 izin, `dataLifecycle` dan `subjectData` untuk tabel-tabelnya                     |
| `domain/booking-reservation-state.ts`                | Mesin status reservasi sebagai fungsi murni (tanpa I/O, pemanggil memberi jam database)         |
| `domain/booking-permissions.ts`                      | Objek guard literal untuk `authorizeInTransaction` (dipakai mulai Issue #938)                   |
| `domain/booking-audit.ts`                            | Nama dan severity audit event                                                                   |
| `domain/booking-time.ts`                             | Zona, aritmetika tanggal, dan resolusi gap/fold RFC 5545 yang murni                             |
| `domain/booking-schedule.ts`                         | Skema rules tertutup, pemilihan jadwal, ekspansi ke jendela UTC, penutupan (murni)              |
| `domain/booking-availability.ts`                     | Ketersediaan slot dan evaluasi stay yang murni (tanpa I/O, tanpa jam)                           |
| `domain/booking-validation.ts`                       | Validasi request ketat (RFC 3339 beroffset, zona IANA)                                          |
| `domain/booking-staff-availability.ts`               | Seam StaffAvailabilityConsumer, no-op-nya, dan aturan staf murni (Issue #949)                   |
| `application/booking-staff-availability-consumer.ts` | Consumer di atas port hr_workforce, dan satu keputusan hidup/mati                               |
| `application/booking-staff-claim.ts`                 | Separuh staf dari klaim slot: satu orang dimenangkan di bawah exclusion constraint staf         |
| `application/*-directory.ts`                         | Satu-satunya kode yang membaca atau menulis baris (jam database, per tenant, savepoint)         |
| `domain/booking-allocation.ts`                       | Umur hold, jendela slot, urutan unit, klasifikasi SQLSTATE, backoff retry (murni)               |
| `application/booking-allocator.ts`                   | `claimUnits`: unit dari satu item, semua-atau-tidak, di bawah exclusion constraint              |
| `application/booking-hold-expiry.ts`                 | Reklamasi malas dan satu putaran reaper: satu statement per kedaluwarsa                         |
| `application/booking-hold-service.ts`                | `placeHold`: reservasi, snapshot item, allocation, riwayat, audit, dalam satu savepoint         |
| `application/booking-hold-expiry-job.ts`             | Sapuan per tenant di balik `scripts/booking-holds-expire.ts`                                    |
| `application/booking-reconciliation.ts`              | Bukti read-only bahwa reservasi, allocation, dan blok sepakat; keterlambatan reaper             |
| `domain/booking-stay.ts`                             | Tanggal stay, batas malam, syarat pool, dan validasi blok yang murni (tanpa I/O/jam)            |
| `application/booking-block-service.ts`               | `createBlock` / `releaseBlock`: malam terblokir sebagai allocation, `BLOCK_CONFLICT`, audit     |
| `domain/booking-policy.ts`                           | Kebijakan murni: jam/lead/horizon slot, pembatalan terlambat, grace no-show, batas hold default |
| `domain/booking-reporting.ts`                        | Tiga deskriptor proyeksi reporting dan alasan tabel event menjadi sumbernya                     |
| `domain/booking-report.ts`                           | Aturan laporan murni: jendela hari Jakarta, pemotongan, status O8, penahanan kelompok kecil     |
| `application/booking-report-directory.ts`            | Satu-satunya SQL route laporan: hanya agregat, tenant-scoped, tanpa orang                       |
| `domain/booking-reservation-events.ts`               | Sembilan tipe event dan pembangun payload tertutup (tanpa orang, alasan, atau jumlah)           |
| `domain/booking-reservation-validation.ts`           | Body reservasi ketat; field pembayaran ditolak dengan menyebut namanya                          |
| `application/booking-reservation-service.ts`         | `createReservation`, `transitionReservation`, `rescheduleReservation`                           |
| `application/booking-reservation-policy.ts`          | Jam, lead time, dan horizon untuk klaim, dari mesin yang sama dengan ketersediaan               |
| `application/booking-reservation-directory.ts`       | Daftar, detail, dan riwayat reservasi (catatan tak pernah dibaca)                               |
| `application/booking-event-emit.ts`                  | Event outbox dari satu fungsi fakta, dalam transaksi transisi                                   |
| `application/booking-port-adapter.ts`                | `BookingPort` (`_shared/ports/booking-port.ts`): quote, hold, confirm, cancel, reschedule       |
| `application/booking-transition-route.ts`            | Badan handler yang dipakai bersama lima route transisi di tempat                                |
| `application/booking-block-routes.ts`                | Badan handler create / release blok: `runIdempotent`, lalu layanan blok                         |
| `application/booking-block-directory.ts`             | Pembacaan blok untuk route: detail dan daftar keyset                                            |

Belum ada di skema dan dicatat sebagai tindak lanjut: `service_requirements`
(booking.md bagian 4). `staff_assignments` hadir bersama Issue #949 (`sql/305`,
booking.md bagian 10.3). `resource_blocks` hadir bersama
Issue #938, dan baris allocation serta penulisnya bersama Issue #940 (`sql/204`);
route HTTP untuk blok (`blocks.read` / `.create` / `.release`, di-seed oleh
`sql/181`) hadir bersama Issue #1012; layarnya #942. Blok seluruh resource
mencakup setiap unit resource, termasuk unit yang ditambahkan kemudian (`sql/240`:
trigger AFTER INSERT pada `resource_units` ditambah kunci resource di
`readBlockUnits`); rekonsiliasi (`block_missing_allocation`) tetap menjadi
pendeteksi untuk tulisan yang melewati trigger. Blok dan barisnya berbagi satu
instant rilis (`sql/241`).

Tindak lanjut yang dicatat audit keamanan fondasi: database masih belum
mengikat perubahan status ke baris event (putaran kedaluwarsa dan layanan
transisi masing-masing menulis tepat satu baris riwayat per transisi, dalam
transaksi yang sama, dan sebuah tes menghitungnya; trigger yang menegakkannya
belum dibangun), dan tabel append-only sebaiknya juga menolak TRUNCATE lewat
trigger (kini hanya privilege yang dicabut yang menahan role runtime).
