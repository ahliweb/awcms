🇮🇩 Bahasa Indonesia · 🇬🇧 [English (source)](booking.md)

<!-- i18n-source-hash: sha256:0baa2258e6949d05a554885bfcfae3a1abc0fb2ffbce29957e76182dd41d44b9 -->

<!-- i18n-source-hash: sha256:pending -->

# Booking — resource, jadwal, dan reservasi (paket dokumen modul)

> **Status:** diterima lewat [ADR-0131](../adr/0131-generic-booking-module-admission.id.md)
> (Issue #915). **Hanya desain: belum ada kode modul, migrasi, path OpenAPI,
> maupun channel AsyncAPI**, dan tak satu pun boleh ditulis sampai paket ini
> diterima di hilir (`ahliweb/awcms-one` Wave A) dan pertanyaan terbuka yang
> memengaruhi skema di §11 dijawab. PRD-lite, state machine, ERD dan kamus
> data, hold dan idempotensi, matriks izin/RLS, pelaporan dan event, strategi
> double-booking beserta tes regresi wajibnya, catatan ancaman dan privasi,
> kontrak adapter/port, dan pertanyaan terbuka ada dalam satu tempat. Keputusan
> dan alternatif yang ditolak ada di ADR. Bentuknya mengikuti
> [`inventory-ledger.md`](inventory-ledger.id.md),
> [`procurement.md`](procurement.id.md) dan [`tax-calculation.md`](tax-calculation.id.md).
> Nama event di sini **provisional**; channel AsyncAPI ditambahkan saat modul
> dibangun. Menginap berbasis hari (per malam) menjadi bagian v1 lewat [ADR-0135](../adr/0135-day-granularity-stays-admitted-into-booking-v1.id.md) (§2.5, §3.1).

## 1. PRD-lite

**Masalah.** Apa pun yang menyewakan waktu, ruang, atau kapasitas — kamar, kursi
perawatan, lapangan, mobil pinjam, bay bengkel, kursi kelas — membutuhkan hal
yang sama: klaim atas resource terbatas selama satu interval, yang tak bisa
dimenangkan dua pelanggan sekaligus. Dibangun per konsumen, masing-masing
berbeda cara salahnya: balapan check-then-insert, grid slot yang tak bisa
menyatakan durasi variabel atau buffer, datetime tanpa zona, hold yang tak
pernah kedaluwarsa, flag pembayaran yang disalin ke reservasi.

**Tujuan.** Satu modul generik yang memodelkan resource, kapasitas, offering,
jadwal dengan zona waktu eksplisit, hold dengan kedaluwarsa, dan siklus hidup
reservasi dengan riwayat append-only, dan yang membuat double-booking mustahil
**di database** — tanpa dependensi pada toko, penyedia pembayaran, atau tabel
payroll.

**Pengguna (provisional — O1).** Resepsionis atau penjadwal (membuat,
me-reschedule, check-in), manajer (override, kebijakan), pemilik resource
(memelihara resource dan jadwal), pelanggan yang bertindak lewat kanal hilir
(tak pernah langsung: endpoint publik adalah urusan BFF hilir), adapter
(integrasi commerce atau portal yang memanggil port), auditor (riwayat,
rekonsiliasi).

**Kriteria penerimaan (dari Issue #915) dan di mana masing-masing dipenuhi**

| Kriteria                                                                                               | Di mana                                                         |
| ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------- |
| Resource / ResourcePool / kapasitas; ServiceOffering                                                   | §4 `resources`, `resource_units`, `resource_pools`, `service_*` |
| Schedule + ScheduleException, zona IANA eksplisit, instant UTC, batas interval, buffer                 | §2, §4 `schedules`, `schedule_exceptions`                       |
| Rekurensi deterministik (semantik RFC 5545)                                                            | §2.4: himpunan bagian terstruktur tertutup                      |
| Reservation, ReservationItem, ResourceAllocation, StaffAssignment, ReservationEvent append-only        | §4                                                              |
| held → confirmed → checked_in → completed, cancelled, rescheduled, no_show; status bayar tidak di sini | §3                                                              |
| Hold dengan kedaluwarsa; create/reschedule idempoten; reschedule menjaga riwayat                       | §5                                                              |
| Pencegahan double-booking terbukti + tes slot-terakhir konkuren                                        | §8                                                              |
| Menginap berbasis hari (per malam) dan malam terblokir (keputusan pemilik O2, ADR-0135)                | §2.5, §3.1, §4, §8.1 aturan 7, §8.3 T9–T13                      |
| Matriks izin + RLS (FORCE)                                                                             | §6                                                              |
| Catatan ancaman dan privasi                                                                            | §9                                                              |
| Tanpa dependensi `commerce`; kontrak adapter/port                                                      | §10                                                             |
| Ketersediaan staf lewat port ketersediaan tenaga kerja, tak pernah tabel payroll                       | §10.3                                                           |
| Proyeksi occupancy / utilization di `reporting`, dimiliki modul ini                                    | §7.2                                                            |
| Pertanyaan terbuka dicantumkan eksplisit                                                               | §11                                                             |

**Non-tujuan (dicatat, tidak dilupakan).** Harga, pembayaran, deposit, refund,
faktur atau struk (lapisan commerce mana pun); master pelanggan atau staf;
pengiriman notifikasi atau pengingat (kapabilitas delivery generik, #918);
endpoint publik anonim; sinkronisasi kalender dengan kalender eksternal;
waitlist; harga dinamis; optimasi best-fit multi-resource; kapasitas terhitung
tanpa baris unit; turnaround bersama antar booking berurutan; akuntansi.

## 2. Semantik waktu

### 2.1 Instant dan interval

- Setiap instant adalah `timestamptz` UTC; API berbicara RFC 3339 dengan offset
  eksplisit atau `Z`. Request tanpa offset adalah `400`, tak pernah "lokal server".
- **Setiap interval setengah-terbuka `[start, end)`**: awal inklusif, akhir
  eksklusif. Booking 10:00–11:00 dan 11:00–12:00 berbagi batas dan tidak
  tumpang tindih. `start < end` dan `end − start ≤ 366 hari` adalah CHECK (menginap membatasi 366 yang sama dalam tanggal, §2.5).
- Ekspresi rentang di database selalu `tstzrange(a, b, '[)')`.

### 2.2 Zona waktu

- Sebuah `schedule`, dan karenanya resource, membawa nama **zona waktu IANA**
  (`Asia/Pontianak`). Offset seperti `+07:00`, singkatan (`WIB`), dan "lokal"
  tanpa zona ditolak. Divalidasi terhadap basis data tz runtime dan terhadap
  `pg_timezone_names`.
- Jadwal ditulis dalam **waktu dinding lokal** ("Sen–Jum 09:00–17:00") dan
  diekspansi menjadi instant UTC oleh satu fungsi murni. Gap dan fold mengikuti
  RFC 5545 §3.3.5: waktu lokal yang tak ada (spring forward) ditafsirkan dengan
  offset yang berlaku **sebelum** gap; yang ambigu (fall back) mengambil
  kemunculan **pertama**. Zona Indonesia tak punya daylight saving; aturan itu
  ada karena modul ini generik dan kode tak boleh mengasumsikannya.
- **Instant UTC alokasi tersimpan adalah fakta.** Edit jadwal atau pembaruan
  basis data tz hanya mengubah ketersediaan mendatang; tak pernah menggeser
  reservasi terkonfirmasi. Perubahan jadwal yang kini bentrok dengan reservasi
  terkonfirmasi menghasilkan laporan konflik read-only (§7.3); ia tak
  membatalkan apa pun.

### 2.3 Buffer

Offering membawa `setup_seconds` dan `cleanup_seconds`. **Interval layanan**
`[starts_at, ends_at)` adalah yang dilihat pelanggan. **Rentang occupied**
`[starts_at − setup, ends_at + cleanup)` adalah yang diuji constraint eksklusi.
Keduanya disnapshot ke alokasi, sehingga mengedit offering tak pernah menulis
ulang booking yang ada. Buffer konservatif: clean-up satu booking dan setup
berikutnya tak boleh tumpang tindih (turnaround bersama adalah non-tujuan).

### 2.4 Rekurensi — himpunan bagiannya

RFC 5545 adalah kosakata, bukan parser. Rekurensi adalah **objek terstruktur**,
divalidasi terhadap skema tertutup, tak pernah string RRULE dari klien:

| Bagian              | Didukung                                                                                                  | Tidak didukung (ditolak dengan `RECURRENCE_UNSUPPORTED`)         |
| ------------------- | --------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `DTSTART`           | tanggal-waktu lokal **plus** zona IANA (tak pernah mengambang)                                            | awal mengambang atau hanya-UTC untuk aturan waktu dinding        |
| `FREQ`              | `DAILY`, `WEEKLY`                                                                                         | `MONTHLY`/`YEARLY` di v1 (terbuka: O2), `HOURLY` dan lebih halus |
| `INTERVAL`          | 1–52                                                                                                      | lebih besar                                                      |
| `BYDAY`             | hari kerja, untuk `WEEKLY` (tanpa prefiks ordinal seperti `1MO`)                                          | `BYSETPOS`, `BYWEEKNO`, `BYYEARDAY`, `BYMONTH`, `BYMONTHDAY`     |
| `UNTIL` xor `COUNT` | tepat satu, `UNTIL` sebagai tanggal lokal; `COUNT` ≤ 52 untuk seri reservasi, ≤ 1000 untuk horizon jadwal | keduanya, atau tak satu pun (tak terbatas)                       |
| `EXDATE` / `RDATE`  | sebagai baris `schedule_exceptions` (hari tutup, hari tambahan) — tanggal dalam zona jadwal               | pengecualian jam-hari di dalam kemunculan yang sudah diekspansi  |

Ekspansi deterministik: masukan sama dan versi basis data tz sama → instant
sama, berurutan menaik, dibatasi (horizon ekspansi jadwal ≤ 366 hari per
panggilan; seri ≤ 52 kemunculan). Seri yang dipesan **dimaterialisasi** menjadi
N reservasi independen yang berbagi `series_id`, dibuat semua-atau-tidak-sama-sekali
dalam satu transaksi (bentrok pada kemunculan ke-7 menolak seri dan menyebut
kemunculannya; mode terima-sebagian adalah tindak lanjut). Tiap kemunculan
dibatalkan atau di-reschedule sendiri-sendiri.

### 2.5 Menginap (stay) — booking berbasis hari (per malam)

([ADR-0135](../adr/0135-day-granularity-stays-admitted-into-booking-v1.id.md), menjawab keputusan pemilik O2: vertikal pertama adalah hotel / vila / rental.) Resource dengan `booking_mode = 'stay'` dipesan menurut **tanggal, bukan instant**; semua di §2.1–§2.4 tetap mengatur resource bermode `slot`, dan kedua mode tak pernah berbagi satu unit.

- **Stay adalah interval tanggal lokal setengah-terbuka `[check_in_date, check_out_date)`**: dua tanggal kalender (`YYYY-MM-DD`) pada zona IANA resource (aturan §2.2: nama zona, tak pernah offset atau singkatan). **Malam**-nya persis tanggal-tanggal dalam interval, sehingga `nights = check_out_date − check_in_date` adalah aritmetika tanggal dan tak pernah bergantung pada panjang sebuah hari. `check_in_date < check_out_date`; `nights ≤ 366` adalah CHECK; `min_nights` / `max_nights` offering mempersempitnya (`MIN_STAY_VIOLATION`, `MAX_STAY_EXCEEDED`, keduanya `409`). Tanggal cacat, berbentuk instant, atau berurutan salah adalah `400 STAY_DATES_INVALID`; instant tak pernah diterima untuk stay.
- **Satuan hunian adalah (unit, malam).** Satu stay mengklaim satu unit untuk setiap malam dalam intervalnya. Di v1 satu stay tetap pada **satu** unit selama semua malamnya (tanpa pindah kamar di dalam stay; terbuka, §11).
- **Pergantian tamu di hari yang sama diizinkan secara konstruksi.** `[tgl 10, tgl 12)` dan `[tgl 12, tgl 14)` tidak tumpang tindih: tanggal 12 adalah tanggal check-out yang satu dan tanggal check-in yang lain. Apakah unit siap secara fisik antara jam check-out dan jam check-in adalah urusan operasional dan tidak ditegakkan (turnaround bersama adalah non-tujuan); operator yang butuh hari pembersihan membuat blok.
- **Jam check-in dan check-out adalah konfigurasi, bukan hunian.** `stay_check_in_time` dan `stay_check_out_time` adalah jam lokal pada zona resource (default tenant di `settings`; modul tidak menetapkan nilai apa pun). Keduanya menurunkan **instant** kedatangan dan kepergian: `starts_at` = `check_in_date` pada jam check-in, `ends_at` = `check_out_date` pada jam check-out, dikonversi dengan aturan gap dan fold §2.2. Zona, kedua jam lokal, dan kedua instant **disnapshot ke item** saat dibuat dan menjadi fakta sesudahnya. Instant melayani tampilan, jendela kedatangan, lead time dan horizon, batas pembatalan terlambat, grace no-show, dan payload event. **Keduanya tak pernah masuk uji tumpang-tindih atau hitungan malam.**
- **Zona waktu properti adalah `timezone` resource.** v1 tidak punya entitas properti terpisah (terbuka, §11). "Hari ini" untuk stay adalah tanggal lokal jam database pada zona itu, `(clock_timestamp() AT TIME ZONE timezone)::date`: `check_in_date` sebelum itu adalah `STAY_DATES_INVALID`; tiba terlambat pada tanggal check-in diizinkan; lead time dan horizon lalu diterapkan pada instant kedatangan turunan.
- **Daylight saving dan kasus tepi zona.** (1) Tumpang tindih dan hitungan malam hanya memakai tanggal, sehingga hari 23 atau 25 jam, atau jam lokal yang terlewat atau berulang, tidak mengubah apa pun. (2) Jam terkonfigurasi di dalam gap spring-forward memakai offset sebelum gap, dan jam berulang (fall back) memakai kemunculan pertamanya (§2.2); snapshot item mencatat hasilnya. (3) Untuk stay melintasi transisi, `ends_at − starts_at` bukan kelipatan 24 jam, dan tak ada yang membaca selisih itu. (4) Pembaruan tzdata tak pernah menggeser stay tersimpan: tanggal dan instant yang disnapshot adalah fakta (§2.2). (5) Tanggal lokal yang tidak ada di zona (lompatan hari kalender) ditolak sebagai `STAY_DATES_INVALID`. (6) `timezone` resource tidak bisa berubah selama ia punya alokasi stay hidup (`TIMEZONE_IN_USE`): tanggal hanya bermakna di zonanya.
- **Minimum menginap per offering dan tidak lebih halus.** Minimum bergantung tanggal, pembatasan hari kedatangan, dan rate plan di luar v1 (terbuka, §11). Jendela mingguan jadwal diabaikan untuk resource stay; hanya pengecualian jadwal `closed` yang berlaku, sebagai **penutupan lunak** — stay yang menyentuh tanggal tertutup ditolak `OUTSIDE_SCHEDULE`, `reservations.override` mengangkatnya, dan reservasi yang ada tak pernah disentuh (laporan konflik §7.3 mendaftarkannya).
- **Malam terblokir adalah eksklusi keras.** Pemeliharaan, dipakai pemilik, atau alasan apa pun yang mengeluarkan unit dari penjualan untuk satu rentang tanggal adalah baris `resource_blocks` (§4) yang baris alokasinya berada di bawah constraint eksklusi **yang sama** dengan stay, sehingga blok tak pernah bisa di-double-book terhadap tamu dan tak ada override yang mengangkatnya. Membuat blok tak pernah membatalkan reservasi: ia ditolak `BLOCK_CONFLICT` dan menyebut reservasi yang bentrok (kepada pemegang `reservations.read`) agar operator memindahkan atau membatalkannya lebih dulu.
- **Tanpa staf, tanpa buffer, tanpa seri.** Offering stay punya `staff_required = false`, `setup_seconds` / `cleanup_seconds` / `duration_seconds` / `slot_step_seconds` NULL (CHECK dua arah), dan menolak rekurensi (`RECURRENCE_UNSUPPORTED`).

## 3. State machine reservasi

```
          ┌── expire (job / lazy reclaim) ──> expired
held ─────┤
          ├── confirm ──> confirmed ──check_in──> checked_in ──complete──> completed
          │                  │  │
          │                  │  ├── reschedule ──> rescheduled (terminal; reservasi BARU dibuat)
          │                  │  └── tandai no_show (setelah start + grace) ──> no_show
          └── cancel ────────┴── cancel ──> cancelled
```

`create` menghasilkan `held` atau, bila `confirmation_mode = immediate` pada
offering, `confirmed` dalam transaksi yang sama (event `held` dilewati; `created`
dan `confirmed` keduanya dikeluarkan).

| Transisi                         | Izin                        | Alokasi                                                     | Idem. | Audit    |
| -------------------------------- | --------------------------- | ----------------------------------------------------------- | ----- | -------- |
| (create) → held / confirmed      | `reservations.create`       | **disisipkan** di bawah constraint eksklusi                 | ya    | info     |
| held → confirmed                 | `reservations.confirm`      | dipertahankan; kedaluwarsa hold dihapus                     | ya    | info     |
| held → expired                   | sistem (job) / lazy reclaim | **dilepas** (`released_reason = expired`)                   | n/a   | info     |
| held / confirmed → cancelled     | `reservations.cancel`       | **dilepas**                                                 | ya    | warning  |
| confirmed → rescheduled (+ baru) | `reservations.reschedule`   | lama dilepas, baru disisipkan, satu transaksi               | ya    | warning  |
| confirmed → checked_in           | `reservations.check_in`     | dipertahankan                                               | ya    | info     |
| checked_in → completed           | `reservations.complete`     | dipertahankan (interval terpesan tidak dipendekkan)         | ya    | info     |
| confirmed → no_show              | `reservations.no_show`      | dipertahankan (slot dihitung terpakai)                      | ya    | warning  |
| create / reschedule di luar jam  | `reservations.override`     | seperti di atas; **tak pernah** menimpa constraint eksklusi | ya    | critical |

Aturan yang ditegakkan database (trigger `awcms_booking_reservations_update_guard`),
bukan hanya handler: hanya transisi ini; per transisi hanya kolom yang boleh
diubahnya; `expired`, `cancelled`, `rescheduled`, `completed`, dan `no_show`
terminal; `confirmed` mensyaratkan `hold_expires_at IS NULL` atau kedaluwarsa
yang belum lewat pada saat transisi; interval, item, atau lineage tak pernah
berubah setelah dibuat. Setiap baris `awcms_booking_reservation_events`
ditambahkan dalam transaksi yang sama dengan transisinya.

**Status pembayaran tidak disimpan.** Tidak ada kolom `paid`, `deposit`,
`amount`, `balance`, atau `payment_*` di tabel mana pun modul ini, dan body yang
menyebut salah satunya adalah `400` yang menyebut field itu. Adapter commerce
mencatat referensi ordernya di `external_ref_*` (§4) dan memutuskan _kapan_
meminta confirm.

Penolakan dan kodenya: `INVALID_STATE` (409), `SLOT_UNAVAILABLE` (409: bentrok
eksklusi atau tak ada unit kosong), `OUTSIDE_SCHEDULE` (409, `override`
mengangkatnya), `HOLD_EXPIRED` (409), `HOLD_LIMIT_EXCEEDED` (429),
`LEAD_TIME_VIOLATION`, `HORIZON_EXCEEDED`, `PARTY_SIZE_OUT_OF_RANGE`,
`STAFF_UNAVAILABLE` (409), `RECURRENCE_UNSUPPORTED`, `TIMEZONE_INVALID`,
`IDEMPOTENCY_REQUIRED` (400), `IDEMPOTENCY_CONFLICT` (409),
`PAYMENT_FIELD_NOT_ACCEPTED` (400).

**Pembatalan terlambat.** `cancellation_cutoff_seconds` pada offering membuat
pembatalan di dalam batas membawa `late_cancellation = true` pada event dan
reservasi. Modul mencatat faktanya; **biaya apa pun adalah keputusan commerce**.

**No-show.** Ditandai oleh orang, setelah `starts_at + no_show_grace_seconds`
(kebijakan). Job no-show otomatis mati secara default dan merupakan pertanyaan
terbuka (O2/O3).

### 3.1 Stay pada state machine

State, transisi, izin, idempotensi, dan level audit di atas **tidak berubah** untuk item stay; tidak ada state dan tidak ada event yang ditambahkan. Satu reservasi boleh memuat item stay dan item slot bersama (kamar plus perawatan); keduanya diklaim semua-atau-tidak-sama-sekali, masing-masing di bawah constraint-nya sendiri. Arti setiap langkah untuk stay:

| Transisi                         | Untuk stay                                                                                                                                                                                        |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| (create) → held / confirmed      | mengklaim satu unit untuk setiap malam di bawah constraint eksklusi stay (§4); hold menempati malam persis seperti menempati slot (§5.1), dan reklamasi malas berlaku pada baris stay unit target |
| held → expired                   | melepas malam                                                                                                                                                                                     |
| held / confirmed → cancelled     | melepas malam; batas pembatalan terlambat diukur terhadap instant kedatangan `starts_at`                                                                                                          |
| confirmed → rescheduled (+ baru) | tanggal baru (mungkin unit lain) sebagai reservasi baru; malam lama dilepas lebih dulu, sehingga memindah atau memperpanjang di atas malamnya sendiri tidak bentrok dengan dirinya (§5.3, T5a)    |
| confirmed → checked_in           | kedatangan tamu (`reservations.check_in`); ditolak sebelum `check_in_date` pada zona resource, tanpa pemeriksaan jam (kedatangan lebih awal adalah keputusan resepsionis)                         |
| checked_in → completed           | kepergian tamu, "check-out" di UI (`reservations.complete`); malam terpesan **tidak** diperpendek oleh kepergian lebih awal, seperti slot — melepas malam yang tak terpakai masih terbuka (§11)   |
| confirmed → no_show              | diukur dari instant kedatangan ditambah grace; setiap malam tetap terpakai. Apakah grace per offering adalah pertanyaan terbuka yang sudah ada, dibuat konkret oleh stay (§11)                    |

**Event.** Sembilan nama provisional §7.4 tidak berubah. Reservasi dengan item stay menambahkan, pada payload setiap event, array aditif `stays` (`resourceId`, `checkInDate`, `checkOutDate`, `nights`, `timezone`); `startsAt` / `endsAt` adalah instant kedatangan paling awal dan kepergian paling akhir. Tidak ada yang baru dipancarkan untuk blok di v1 (hanya baris audit; event channel-manager terbuka, §11).

## 4. ERD dan kamus data

```
(tanpa tautan ke awcms_profiles di v1: pelanggan adalah external_customer_ref buram, commerce adalah otoritasnya - O12)
resource_pools 1──0..n resources 1──1..n resource_units
resources 1──0..n resource_blocks 1──1..n resource_allocations   (blok mengklaim unit seperti item; hanya stay)
service_offerings 1──0..n service_requirements ──> (resource_pools | resources)
resources 0..n──0..n schedules (resource_id NULL = default tenant) 1──0..n schedule_exceptions
reservations 1──1..n reservation_items 1──1..n resource_allocations ──> resource_units
                                       1──0..n staff_assignments
reservations 1──1..n reservation_events (append-only)
reservations ──superseded_by / rescheduled_from──> reservations (lineage_id)
tenant_booking_settings (satu baris per tenant)
```

Semua tabel `awcms_booking_<nama>` dan membawa `tenant_id uuid NOT NULL`, dengan
RLS `ENABLE`+`FORCE`. Setiap referensi adalah foreign key komposit
`(tenant_id, id)`. Uang tidak ada di modul ini; kuantitas adalah integer (detik,
unit, ukuran rombongan). Daftar kolom di bawah adalah **kontrak desain**; tipe
final, nama boleh disesuaikan oleh review migrasi.

| Tabel                  | Memuat                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Hak `awcms_app`                                             |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `settings`             | `default_hold_seconds`, `max_hold_seconds`, `max_active_holds_per_customer`, `max_active_holds_per_tenant`, `min_lead_seconds`, `max_horizon_days`, `no_show_grace_seconds`, `default_timezone`, `default_check_in_time`, `default_check_out_time` (jam lokal untuk resource stay, §2.5); `NULL` = default modul                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | SELECT, INSERT, UPDATE                                      |
| `resources`            | `code` (unik per tenant di antara yang hidup), `name`, `kind` (kode pendek, mis. `room`, `chair`, `court`, `vehicle`), `status` (`active`/`inactive`), `capacity int 1..500`, `pool_id` (nullable), `timezone` (IANA; immutable selama alokasi stay hidup ada), `booking_mode` (`slot` default / `stay`; immutable selama resource punya alokasi hidup, trigger), `stay_check_in_time` / `stay_check_out_time` (`time` lokal pada `timezone`; wajib bila `stay`, NULL bila `slot`), `sort_order`, stempel soft-delete                                                                                                                                                                                                                                                            | SELECT, INSERT, UPDATE (tanpa DELETE)                       |
| `resource_units`       | `resource_id`, `ordinal 1..capacity`, `label`, `status` (`active`/`inactive`); tepat `capacity` baris, dibuat bersama resource; **jangkar constraint eksklusi** (unik `(resource_id, ordinal)`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | SELECT, INSERT, UPDATE (tanpa DELETE)                       |
| `resource_pools`       | `code`, `name`, `allocation_policy` (`first_free` menurut `sort_order, ordinal`; v1 hanya ini), stempel soft-delete. Pool adalah himpunan resource yang dapat dipertukarkan (tiga ruang perawatan)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | SELECT, INSERT, UPDATE (tanpa DELETE)                       |
| `service_offerings`    | `code`, `name`, `duration_seconds`, `setup_seconds`, `cleanup_seconds`, `slot_step_seconds` (keempatnya NULL untuk offering stay), `granularity` (`time` / `stay`; harus sama dengan `booking_mode` setiap resource yang dipersyaratkannya), `min_nights` / `max_nights` (hanya stay, NULL untuk offering waktu; CHECK dua arah), `min_party`, `max_party`, `confirmation_mode` (`immediate`/`hold_then_confirm`), `cancellation_cutoff_seconds`, override `min_lead_seconds`/`max_horizon_days`, `status`, stempel soft-delete. **Tanpa harga, tanpa id produk**                                                                                                                                                                                                                | SELECT, INSERT, UPDATE (tanpa DELETE)                       |
| `service_requirements` | `offering_id`, `pool_id` xor `resource_id` (CHECK), `unit_count ≥ 1` (per anggota rombongan atau per booking: `unit_basis`), `staff_required bool`, `staff_role` (kode pendek)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | SELECT, INSERT, UPDATE, DELETE (konfigurasi)                |
| `schedules`            | `resource_id` (NULL = default tenant), `timezone`, `effective_from`/`effective_to` (tanggal lokal, setengah-terbuka), `rules` jsonb (skema tertutup: hari kerja → daftar jendela lokal `[from,to)`, plus rekurensi §2.4), `status`. Jendela efektif baru **menggantikan**, tidak mengedit (trigger tumpang-tindih seperti ADR-0127)                                                                                                                                                                                                                                                                                                                                                                                                                                              | SELECT, INSERT, UPDATE (tanpa DELETE)                       |
| `schedule_exceptions`  | `schedule_id` atau `resource_id`, `local_from`/`local_to` (tanggal, setengah-terbuka, dalam zona jadwal), `kind` (`closed`/`override_hours`), `windows` jsonb untuk `override_hours`, `reason_code` (kode pendek, tanpa teks bebas); untuk resource `stay` hanya `closed` yang berlaku, sebagai penutupan lunak (§2.5)                                                                                                                                                                                                                                                                                                                                                                                                                                                           | SELECT, INSERT, UPDATE, DELETE (konfigurasi)                |
| `reservations`         | `reservation_no` (kode acak buatan server, unik per tenant), `lineage_id`, `rescheduled_from_id`, `superseded_by_id`, `series_id`, `status`, `external_customer_ref` (buram, nullable; otoritas pelanggan adalah commerce - O12 terjawab 2026-10-10, jadi tanpa `customer_profile_id` dan tanpa tautan `profile_identity` di v1), `party_size`, `starts_at`/`ends_at` (selubung item-nya), `hold_expires_at`, `source`, `external_ref_type`/`external_ref` (satu pasangan buram), `customer_note` (**di-redact**, ≤ 500 karakter), `late_cancellation`, `cancel_reason_code`, kolom aktor dan stempel per transisi                                                                                                                                                               | SELECT, INSERT, UPDATE (**tanpa DELETE**)                   |
| `reservation_items`    | `reservation_id`, `line_no`, `offering_id`, snapshot offering (`code`, `name`, `duration_seconds`, `setup_seconds`, `cleanup_seconds`), `granularity` (`time` / `stay`), `starts_at`, `ends_at` (instant; untuk stay kedatangan dan kepergian turunan), `check_in_date` / `check_out_date` / `nights`, `check_in_local_time` / `check_out_local_time` / `timezone` (snapshot stay, §2.5; semua NULL untuk item waktu, semua terisi untuk stay, CHECK), `quantity` (unit diminta). Immutable setelah insert                                                                                                                                                                                                                                                                       | SELECT, INSERT (**tanpa UPDATE/DELETE**)                    |
| `resource_allocations` | `item_id` (NULL untuk baris blok), `block_id` (NULL untuk baris reservasi; CHECK tepat satu dari keduanya), `granularity` (`time` / `stay`; trigger mensyaratkan sama dengan `booking_mode` resource), `resource_unit_id`, `resource_id`, `starts_at`, `ends_at` (instant; NULL untuk baris blok), `occupied_from`, `occupied_to` (baris waktu: CHECK `occupied_from ≤ starts_at < ends_at ≤ occupied_to`, dan trigger memverifikasi buffer sama dengan snapshot item; NULL untuk baris stay), `stay_from`, `stay_to` (tanggal; hanya baris stay, sama dengan tanggal item atau blok lewat trigger, CHECK `stay_from < stay_to`; NULL untuk baris waktu), `released_at`, `released_reason` (`cancelled`/`expired`/`rescheduled`/`block_released`), **kedua constraint eksklusi** | SELECT, INSERT, UPDATE hanya `released_*`, sekali (trigger) |
| `resource_blocks`      | `resource_id`, `resource_unit_id` (NULL = setiap unit resource), `block_from` / `block_to` (tanggal lokal, setengah-terbuka, pada zona resource; ≤ 366 malam), `reason_code` (daftar kode pendek tertutup, misalnya `maintenance`, `owner_use`, `other`; tanpa teks bebas), `status` (`active` / `released`), kolom aktor dan stempel. Membuatnya menyisipkan satu baris alokasi per unit terdampak (§8.1 aturan 7); melepasnya mengisi `released_*` pada baris itu. Hanya resource stay                                                                                                                                                                                                                                                                                         | SELECT, INSERT, UPDATE hanya `released_*`, sekali (trigger) |
| `staff_assignments`    | `item_id`, `staff_ref` (teks buram ≤ 128, hanya diselesaikan port tenaga kerja), `staff_role`, `occupied_from`/`occupied_to`, `released_at`/`released_reason`, **constraint eksklusi yang sama berkunci `staff_ref`**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | SELECT, INSERT, UPDATE hanya `released_*`, sekali (trigger) |
| `reservation_events`   | `reservation_id`, `seq` (per reservasi), `kind`, `from_status`, `to_status`, `actor_user_id`, `correlation_id`, `reason_code`, `detail` jsonb (kunci tertutup: id, instant, hitungan — **tanpa teks bebas, tanpa data pribadi**), `occurred_at` (jam DB); unik `(reservation_id, kind)` untuk jenis sekali-saja; kolom `kind` ter-generate untuk proyeksi                                                                                                                                                                                                                                                                                                                                                                                                                        | SELECT, INSERT (**tanpa UPDATE/DELETE**)                    |

`awcms_worker` memegang `SELECT` hanya pada `awcms_booking_reservation_events`
(engine reporting membaca sumber proyeksi sebagai peran itu). Job kedaluwarsa
hold berjalan sebagai peran aplikasi dengan konteks per-tenant, seperti
`email:dispatch`.

**Constraint eksklusi** (pada `resource_allocations`; constraint staf identik
pada `staff_ref`):

```sql
EXCLUDE USING gist (
  resource_unit_id WITH =,
  tstzrange(occupied_from, occupied_to, '[)') WITH &&
) WHERE (released_at IS NULL)
```

Membutuhkan `CREATE EXTENSION IF NOT EXISTS btree_gist` (§8.2). Id unit unik
global, sehingga constraint tak butuh suku `tenant_id`, dan pemeriksaan
constraint tidak tunduk pada RLS, sehingga isolasi tenant tak bisa
melemahkannya.

**Constraint stay** (tabel sama; ADR-0135) berdampingan dengan yang pertama dan menguji tanggal, bukan instant:

```sql
EXCLUDE USING gist (
  resource_unit_id WITH =,
  daterange(stay_from, stay_to, '[)') WITH &&
) WHERE (released_at IS NULL AND granularity = 'stay')
```

Constraint pertama juga dibatasi pada `granularity = 'time'`. Karena trigger memaksa granularitas alokasi sama dengan `booking_mode` resource-nya, kedua constraint mempartisi ruang unit dan tak pernah perlu direkonsiliasi. `daterange` bersifat diskret, sehingga `[tgl 10, tgl 12)` dan `[tgl 12, tgl 14)` bersebelahan, bukan tumpang tindih. **Mengapa constraint rentang dan bukan buku besar unit-malam** (satu baris per `(unit, malam)` di bawah indeks unik biasa): bentuk rentang adalah mekanisme yang sama dengan slot (satu bentuk tes, satu alokator, satu penanganan `23P01`), berbiaya satu baris dan satu probe GiST per klaim alih-alih hingga 366 baris untuk disisipkan, dilepas, dan dijadwal ulang, dan tidak butuh invariant kedua untuk menjaga baris sama dengan tanggal item; keunggulan buku besar, agregat per malam, dipenuhi `generate_series` atas stay atau counter §7.2. Keduanya deklaratif dan tak terpengaruh RLS; pilihan dibuat atas konsistensi dan biaya tulis (ADR-0135 §4).

**Jawaban subjek data (ADR-0094).** `reservations.external_customer_ref` mengidentifikasi seseorang (nilainya buram; otoritas pelanggan adalah commerce di hilir, O12); `customer_note` mungkin memuatnya; aktor adalah pengguna tenant. Saat penghapusan atau anonimisasi pelanggan di otoritasnya, modul memutus `external_customer_ref` dan men-null `customer_note`, dan mempertahankan fakta non-pribadi (resource, interval,
status) sebagai catatan operasional tenant. `reservation_events.detail` tidak
membawa data pribadi secara konstruksi. Item, alokasi, dan penugasan staf tak
membawa data pelanggan (`staff_ref` adalah referensi tenaga kerja, diatur
kapabilitas itu).

## 5. Hold, idempotensi, dan reschedule

### 5.1 Hold

- Hold adalah reservasi `held` dengan `hold_expires_at = clock_timestamp() +
ttl`, di mana `ttl` = `holdSeconds` request yang dijepit ke
  `[60, max_hold_seconds]` (default 900, maks 86 400). **Jam database** adalah
  satu-satunya jam: `now()` adalah awal transaksi dan jam klien dikendalikan
  penyerang.
- Hold **menempati**: alokasinya baris hidup di bawah constraint. Apakah hold
  dihitung dalam _occupancy_ (sebuah KPI) adalah pertanyaan terpisah (O8, terjawab 2026-10-10: tidak, §7.2);
  apakah ia memblokir _ketersediaan_ bukan — ia memblokir.
- `POST …/extend` memperpanjang sekali per hold, paling banyak
  `default_hold_seconds`, tak pernah melewati `max_hold_seconds` sejak dibuat;
  butuh `reservations.create`.
- **Kedaluwarsa punya dua bagian yang bekerja sama**, karena constraint eksklusi
  tak bisa membaca jam: (1) job `booking:holds:expire` (tiap menit, per tenant,
  `FOR UPDATE SKIP LOCKED`, batch terbatas) menetapkan `expired`, melepas
  alokasi, dan mengeluarkan `expired`; (2) **lazy reclaim**: setiap penulisan
  yang menyisipkan alokasi lebih dulu melepas hold kedaluwarsa-tapi-belum-disapu
  pada unit target, di bawah kunci baris reservasi, dalam transaksi yang sama.
  Kebenaran jadi tak bergantung pada kesehatan job.
- `confirm` memeriksa ulang `hold_expires_at > clock_timestamp()` di bawah
  `FOR UPDATE`; hold kedaluwarsa adalah `409 HOLD_EXPIRED` meski job belum
  berjalan; confirm yang berbalapan dengan job berserialisasi pada kunci baris
  dan satu menang, yang lain mengambil jalur replay atau penolakan.

### 5.2 Idempotensi (tiga lapis, seperti ADR-0128 §5)

1. **`Idempotency-Key`** (komponen bersama, ADR-0129) wajib pada create, extend,
   confirm, cancel, reschedule, check-in, complete, no-show, dan override.
   Pengguna yang bertindak menjadi bagian hash request; key yang sama terhadap
   target berbeda adalah `409 IDEMPOTENCY_CONFLICT`.
2. **Pemeriksaan status.** Meng-confirm reservasi `confirmed` mengembalikannya
   dengan `replayed: true` dan tak menulis apa pun; begitu pula kata kerja lain
   pada status targetnya, dengan key sama, key berbeda, atau tanpa key.
3. **Constraint.** Bahkan bila dua lapis di atas terlewati, klaim kedua untuk
   unit dan interval yang sama tak bisa commit. Pengaman natural-key
   `(tenant, external_ref_type, external_ref)` unik-parsial di antara reservasi
   hidup memungkinkan adapter me-retry dengan key baru tanpa duplikasi.

Penolakan yang dihasilkan di dalam aplikasi (409 yang _dikembalikan_)
dikonversi menjadi throw di dalam savepoint dan kembali menjadi nilai di
luarnya: handler yang mengembalikan 4xx kalau tidak akan MEM-COMMIT apa pun yang
sudah ditulisnya (jebakan yang sama dengan ADR-0128 §5).

### 5.3 Reschedule menjaga riwayat

Satu transaksi: kunci reservasi lama `FOR UPDATE` dan periksa ulang masih
`confirmed`; **lepas alokasi lama** (`released_reason = rescheduled`); sisipkan
reservasi baru (`lineage_id` sama, `rescheduled_from_id`), item, dan alokasi di
bawah constraint (sehingga pemindahan ke waktu yang tumpang tindih tidak bentrok
dengan dirinya sendiri); tandai yang lama `rescheduled` dengan
`superseded_by_id`; tambahkan event pada keduanya. Penolakan (bentrok, jam, lead
time) me-rollback seluruh transaksi ke aslinya yang tak tersentuh. Interval tak
pernah diedit di tempat. `external_ref` adapter pindah ke reservasi baru; lineage
adalah pegangan stabil untuk "booking pelanggan ini" melintasi reschedule.

## 6. Matriks izin dan RLS

Semua route adalah `defineTenantRoute`, mengotorisasi lewat
`authorizeInTransaction` (ADR-0063), dan default-deny. Migrasi men-seed katalog
dan **tidak** memberikan apa pun ke peran mana pun; tenant yang ada memakai
`bun run identity-access:permissions:backfill`. Kode izin adalah
`booking.<activity>.<action>` (module key `booking`, seperti `procurement.documents.read`).

| Izin                                                               | Mencakup                                                                         | Risiko                     |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------------- | -------------------------- |
| `resources.read` / `.create` / `.update` / `.delete` / `.restore`  | resource, unit, pool                                                             |                            |
| `offerings.read` / `.create` / `.update` / `.delete` / `.restore`  | offering dan requirement                                                         |                            |
| `schedules.read` / `.create` / `.update` / `.delete`               | jadwal dan pengecualian                                                          |                            |
| `blocks.read` / `.create` / `.release`                             | malam terblokir (resource stay); `.create` mengeluarkan inventori dari penjualan | `.create` berdampak tinggi |
| `availability.read`                                                | pencarian ketersediaan, quote (tanpa persistensi)                                | dibatasi rate              |
| `reservations.read`                                                | daftar, detail, event (catatan dikecualikan)                                     |                            |
| `reservation_notes.read`                                           | `customer_note` yang di-redact                                                   | baca teraudit              |
| `reservations.create` / `.confirm` / `.cancel`                     | hold/create, confirm, cancel                                                     |                            |
| `reservations.reschedule` / `.check_in` / `.complete` / `.no_show` | transisi lain (anggota `AccessAction` baru)                                      |                            |
| `reservations.override`                                            | booking atau reschedule di luar jam jadwal atau lead time                        | **tinggi** (baru)          |
| `reservations.reconcile`                                           | rekonsiliasi read-only                                                           |                            |
| `policy.read` / `policy.configure`                                 | pengaturan (hold, lead time, horizon, grace)                                     | berdampak tinggi           |
| `reports.read`                                                     | laporan occupancy / utilization / reservasi                                      |                            |

Anggota `AccessAction` baru: `confirm`, `reschedule`, `check_in`, `complete`,
`no_show` (tak satu pun berisiko tinggi: masing-masing dapat dibalik dengan
cancel atau dikompensasi event) dan `override` BERISIKO TINGGI (ia mengangkat
aturan bisnis; pemeriksaan SoD saat-aksi menjadi tersedia untuknya). `cancel`
dan `restore` dipakai ulang. Setiap penjaga berisiko tinggi diuji dua arah:
setiap izin lain tak bisa melakukannya, hanya izin itu yang bisa. Resource atau
offering soft-deleted hanya terdaftar dengan `includeDeleted=true` **dan**
`.restore` (aturan ADR-0128).

**Row-level security.** Setiap tabel: `tenant_id`, `ENABLE`+`FORCE`, kebijakan
dengan `USING` dan `WITH CHECK`; diverifikasi sebagai peran runtime
(`awcms_app`), termasuk bahwa ia tak bisa membaca atau menulis baris tenant lain
dan bahwa FK-komposit ke resource atau profil tenant lain tak dapat
direpresentasikan. Event, item, alokasi (selain `released_*`) lampau immutable
oleh trigger **dan** oleh ketiadaan hak akses.

**Akses ber-scope.** v1 tak punya ABAC ber-scope lokasi atau resource: pemegang
`reservations.cancel` dapat membatalkan reservasi tenant mana pun. Dimensi
business-scope untuk "resource cabang ini" adalah tindak lanjut yang sama dengan
ADR-0128 L5 dan merupakan batas yang tercatat, bukan tersembunyi. Memisahkan
`create` dari `confirm` atau `override` adalah kewajiban operator yang dinyatakan
sebagai aturan SoD atas aksi berisiko tinggi.

## 7. Rekonsiliasi, pelaporan, dan event

### 7.1 Rekonsiliasi

`GET /booking/reservations/reconciliation` (read-only, ber-scope tenant,
`reservations.reconcile`) membuktikan, per reservasi hidup, bahwa alokasinya
persis unit dan interval item-nya; mendaftar alokasi hidup yang reservasinya
terminal atau terlepas, reservasi `held` yang melewati kedaluwarsanya lebih dari
grace (job macet), alokasi dengan buffer tak cocok, reservasi dengan rantai
`lineage_id` putus, dan reservasi tanpa event `created`. Untuk stay ia juga mendaftar alokasi stay hidup yang `[stay_from, stay_to)`-nya berbeda dari `[check_in_date, check_out_date)` item-nya, alokasi blok tanpa blok aktif (dan sebaliknya), dan alokasi yang granularitasnya berbeda dari `booking_mode` resource-nya. Ia tidak memperbaiki
apa pun; cacat dikoreksi dengan transisi kompensasi, tak pernah edit.

### 7.2 Proyeksi occupancy dan utilization (engine reporting, dimiliki di sini)

Proyeksi menumpang engine `reporting` yang ada sebagai **counter monotonik** atas
tabel event append-only (engine menjepit decrement di nol, sehingga setiap
metrik adalah counter yang hanya naik, seperti ADR-0126/0128):

| Proyeksi               | Counter                                                                                                                                     |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `booking.reservations` | created, held, confirmed, cancelled, late_cancelled, rescheduled, expired, checked_in, completed, no_show                                   |
| `booking.time`         | `booked_seconds` (+ saat confirmed / pada pengganti), `released_seconds` (+ saat cancel / reschedule-pergi dari reservasi terkonfirmasi)    |
| `booking.nights`       | `booked_nights` (+ saat confirmed / pada pengganti item stay), `released_nights` (+ saat cancel / reschedule-pergi dari stay terkonfirmasi) |

Waktu terpesan bersih adalah `booked − released`, dihitung saat baca, sehingga
rebuild menghasilkan angka yang sama; **malam** terpesan bersih dihitung dengan cara yang sama dari `booking.nights`. Unit-malam terblokir dibaca langsung dari `resource_blocks`: ia masukan bagi penyebut apa pun yang dipilih pemilik (terbuka di bawah O8), bukan counter. **Utilization** = detik terpesan bersih ÷
detik _tersedia_, di mana detik tersedia adalah fungsi murni dari ekspansi jadwal
(§2), bukan event, sehingga penyebut dihitung langsung oleh
`GET /booking/reports/utilization`. **Occupancy** (unit terpakai pada satu instant ÷ unit) adalah query langsung.
**Keputusan pemilik O8 (dijawab 2026-10-10, tercatat di DoR awcms-one)
menetapkan tiga hal yang mengikat paket ini:** (1) **occupancy tidak
menghitung hold** — hanya unit di bawah alokasi `confirmed` atau `checked_in`
yang dihitung terpakai, dan hold dilaporkan sebagai angka _pipeline_ terpisah
(counter `held` dan query langsung unit tertahan), tidak pernah ditambahkan ke
occupancy; utilization tetap metrik terpisah dari occupancy; (2) **jendela
retensi pelanggan adalah 90 hari** (pembelian atau booking ulang dalam 90 hari
sejak yang pertama) — KPI analitik lintas-domain atas order commerce dan
reservasi booking yang digabung pada `external_customer_ref`, dihitung oleh
analitik konsumen, **bukan** di dalam booking dan **bukan** periode retensi data
(retensi reservasi tidak berubah, §9); (3) **net revenue adalah angka utama
pendapatan** (bruto, lalu diskon, lalu refund, lalu neto) — booking tidak
memegang harga (§1), sehingga pendapatan dihitung oleh lapisan commerce dan
analitik, dan booking hanya menyuplai fakta (event dan counter di atas).
**Tidak tercakup jawaban yang tercatat dan masih terbuka:** apakah penyebut
utilization mengecualikan penutupan pemeliharaan, dan waktu terpesan versus
aktual (`checked_in`→`completed`); counter di atas tetap masukan setiap definisi
kandidat. Detail (resource mana, hari mana) adalah
laporan langsung yang diotorisasi ulang; proyeksi hanya angka dashboard.

### 7.3 Laporan konflik jadwal

`GET /booking/schedules/{id}/conflicts?candidate=…` mendaftar reservasi
terkonfirmasi yang jatuh di luar jadwal yang diusulkan (atau di dalam penutupan
yang diusulkan) tanpa mengubah apa pun. Hal yang sama berlaku untuk perubahan
ketersediaan staf yang dilaporkan kapabilitas tenaga kerja.

### 7.4 Event (provisional)

Konvensi (seperti `awcms.procurement.document.finalised`): channel
`awcms.<modul>.<entitas>.<kata-kerja>`, satu envelope `DomainEvent` bersama,
diterbitkan lewat outbox domain-event **dalam transaksi yang sama** dengan
transisi; panggilan yang ditolak atau di-replay tidak menerbitkan apa pun.
Singkatan di issue `booking.reservation.*` karenanya muncul di kawat dengan
prefiks `awcms.`.

| Event                                   | Kapan                                                                                    |
| --------------------------------------- | ---------------------------------------------------------------------------------------- |
| `awcms.booking.reservation.created`     | reservasi ada (held atau confirmed)                                                      |
| `awcms.booking.reservation.held`        | hold ditempatkan (tidak dikeluarkan untuk konfirmasi `immediate`)                        |
| `awcms.booking.reservation.confirmed`   | held → confirmed (atau dibuat confirmed)                                                 |
| `awcms.booking.reservation.rescheduled` | reservasi lama digantikan; payload menyebut kedua id                                     |
| `awcms.booking.reservation.cancelled`   | held/confirmed → cancelled (membawa `lateCancellation`)                                  |
| `awcms.booking.reservation.checked_in`  | confirmed → checked_in                                                                   |
| `awcms.booking.reservation.completed`   | checked_in → completed                                                                   |
| `awcms.booking.reservation.no_show`     | confirmed → no_show                                                                      |
| `awcms.booking.reservation.expired`     | hold kedaluwarsa (nama kesembilan di luar daftar issue; adapter ADR-0040 membutuhkannya) |

Payload: `reservationId`, `reservationNo`, `lineageId`, `status`,
`previousStatus`, `startsAt`/`endsAt` (RFC 3339 UTC), `resourceIds`,
`offeringIds`, `partySize`, `externalRefType`/`externalRef` (pasangan buram
milik adapter sendiri), `occurredAt`, `correlationId`; untuk reservasi dengan item stay juga `stays` (`resourceId`, `checkInDate`, `checkOutDate`, `nights`, `timezone`; aditif, tidak ada bila bukan, tanpa event baru, §3.1). **Tak pernah** nama,
kontak, catatan, atau teks alasan pelanggan. Konsumen menghilangkan duplikat
pada event id envelope; pengiriman at-least-once.

## 8. Pencegahan double-booking dan tes regresi wajib

### 8.1 Strateginya

1. **Resource eksklusif** (kapasitas 1): satu baris unit; constraint eksklusi
   pada alokasi melarang dua rentang occupied hidup yang tumpang tindih
   untuknya. INSERT konkuren kedua **terblokir** pada baris pertama yang belum
   di-commit; saat yang pertama commit, yang kedua gagal dengan `23P01
exclusion_violation`; saat yang pertama rollback, yang kedua berhasil. Ini
   perilaku PostgreSQL sendiri untuk constraint eksklusi dan tak butuh kunci
   aplikasi.
2. **Kapasitas N > 1**: N baris unit, **masing-masing di bawah constraint yang
   sama**. Pengalokasi memilih unit dengan urutan `(resource.sort_order,
unit.ordinal)` dan menyisipkan dengan `INSERT … ON CONFLICT DO NOTHING
RETURNING id` (pelanggaran eksklusi adalah konflik yang diserap `DO NOTHING`,
   jadi tak perlu savepoint per percobaan); tak ada baris kembali → coba unit
   berikutnya; tak ada tersisa → `SLOT_UNAVAILABLE`. (Bahwa `DO NOTHING` itu
   menunggu baris konflik konkuren yang belum pasti lalu melewatinya adalah
   perilaku yang dibuktikan T3 saat implementasi; bila tidak berlaku, cadangannya
   savepoint per percobaan yang menangkap `23P01`.) Rombongan atau requirement
   _k_ unit menyisipkan _k_ baris dalam satu transaksi, semua-atau-tidak-sama-sekali.
   N dibatasi (500) karena _k_ insert adalah _k_ probe.
3. **Reservasi multi-item dan multi-resource** menyisipkan dalam urutan global
   tetap (`resource_id` menaik per byte, lalu `ordinal`, lalu `occupied_from`)
   agar dua penulis mengambil dalam urutan yang sama. Deadlock sisa (`40P01`)
   ditangkap (`errno`, bukan `code`, di Bun.SQL) dan di-retry paling banyak 3 kali
   dengan jitter, lalu `409 CONTENTION_RETRY`. Tak pernah berputar tanpa batas.
4. **Di mana kapasitas dihitung** (batas konkurensi per-offering, batas seluruh
   pool, maksimum harian — agregat yang tak dinyatakan constraint eksklusi):
   ambil `SELECT … FOR UPDATE` pada baris pool atau offering pemilik, dalam
   urutan global, baca ulang agregat di bawah kunci, lalu tulis. READ COMMITTED
   dengan kunci itu cukup; SERIALIZABLE tidak dipakai. Invarian baru apa pun
   yang berupa jumlah, bukan non-overlap, **harus** memakai aturan ini dan
   menambah tesnya sendiri dengan bentuk yang sama.
5. **Staf** diklaim dengan mekanisme yang sama pada `staff_ref` (§4); pembacaan
   ketersediaan tenaga kerja (§10.3) adalah masukan penasihat, constraint adalah
   otoritasnya.
6. **Kedaluwarsa hold** tak pernah melemahkan ini: hold kedaluwarsa yang belum
   disapu direklamasi secara lazy di bawah kunci baris (§5.1), sehingga
   constraint hanya pernah memblokir baris yang benar-benar hidup.
7. **Stay dan blok** (ADR-0135). Alokasi stay adalah satu baris per unit di bawah constraint kedua §4 (`daterange(stay_from, stay_to, '[)')` per unit, hanya baris hidup). Alokator, urutan kunci, penyerapan `ON CONFLICT DO NOTHING`, reklamasi malas, dan retry deadlock terbatas dari aturan 1–6 berlaku tanpa perubahan. **Blok** adalah baris alokasi dengan `block_id` terisi dan tanpa `item_id`, sehingga blok dan stay berebut satu constraint: siapa yang commit lebih dulu menang dan yang lain menerima `23P01`, dipetakan ke `SLOT_UNAVAILABLE` untuk booking dan `BLOCK_CONFLICT` untuk blok. Blok atas beberapa unit menyisipkan barisnya dalam urutan global aturan 3, semua-atau-tidak-sama-sekali. Membuat blok tak pernah membatalkan reservasi. Trigger menolak alokasi yang granularitasnya berbeda dari `booking_mode` resource-nya, sehingga constraint waktu dan stay tak pernah berlaku bersama pada satu unit.

### 8.2 Biaya ekstensi dan deployment

Constraint membutuhkan `btree_gist` (kesamaan uuid di indeks GiST). Diperiksa
terhadap repo ini: tak ada migrasi yang membuat `btree_gist` hari ini; `sql/001`
(`pgcrypto`) dan `sql/064` (`pg_trgm`) sudah menjalankan `CREATE EXTENSION IF NOT
EXISTS`; ketiganya **ekstensi trusted** di PostgreSQL 13+ (pemilik database
dengan `CREATE` pada database bisa membuatnya tanpa superuser); profil
deployment mem-pin `postgres:18.4`. Biaya: satu `CREATE EXTENSION IF NOT EXISTS
btree_gist;` di migrasi booking, satu baris pra-pemeriksaan operator di runbook
deploy, dan satu mode kegagalan yang diketahui — database terkelola yang peran
migrasinya tak bisa membuat ekstensi trusted menggagalkan migrasi sebelum tabel
apa pun ada. Profil offline/LAN (`postgres:18.4`) tak terpengaruh. ADR-0127 §4
menolak ekstensi untuk jendela pajak; alasannya (hak istimewa) tidak berlaku untuk
ekstensi trusted, dan kalimat basi di `sql/171` adalah komentar historis di
migrasi terapan, yang immutable dan dibiarkan. (Bila deployment target benar-benar
tak bisa membuat ekstensi, cadangannya adalah pola ADR-0127 — advisory lock plus
trigger pemeriksa — dengan hilangnya jaminan setiap-penulis dinyatakan; itu
pengecualian tingkat operator yang dicatat, bukan default.)

### 8.3 Tes regresi wajib (spesifikasi)

Modul **tidak boleh dikirim tanpa** ini, di
`tests/integration/booking-concurrency.integration.test.ts`, dijalankan terhadap
PostgreSQL nyata sebagai peran runtime `awcms_app` (FORCE RLS berlaku), pada
koneksi terpisah (bukan satu transaksi ter-pool). Pakai helper penolakan repo,
bukan `expect(...).rejects` (yang menggantung dengan Bun.SQL).

**T1 — tingkat database, interleaving terbukti.** Fixture: satu resource,
kapasitas 1, satu unit; jendela `[10:00, 11:00)`.

1. Koneksi A: `BEGIN; INSERT` alokasi untuk unit `[10:00,11:00)` (belum commit).
2. Koneksi B: `BEGIN; INSERT` unit yang sama `[10:30,11:30)` (tumpang tindih). Mulai tanpa di-await.
3. Pastikan B **terblokir**: polling `pg_stat_activity` untuk backend B dengan
   `wait_event_type = 'Lock'` dalam 2 dtk (ini membuktikan konkurensi sungguhan,
   bukan eksekusi berurutan).
4. A: `COMMIT`. Pastikan INSERT B ditolak dengan SQLSTATE `23P01` (`errno`).
5. Varian: ulangi dengan A `ROLLBACK`; pastikan INSERT B berhasil.
6. Varian: rentang bersebelahan `[10:00,11:00)` dan `[11:00,12:00)` keduanya
   commit (batas setengah-terbuka); dengan `cleanup_seconds = 900` pada yang
   pertama, yang kedua bentrok (buffer menempati).

**T2 — tingkat aplikasi, slot terakhir, banyak pesaing.** Fixture: kapasitas 1,
satu slot terbuka. `Promise.all` **20** `POST /booking/reservations` dengan 20
`Idempotency-Key` **berbeda** dan pelanggan berbeda, masing-masing pada
koneksinya sendiri. Pastikan: tepat **satu** `201`, sembilan belas `409
SLOT_UNAVAILABLE`, tak ada `5xx`, dan `SELECT count(*) FROM allocations WHERE
resource_unit_id = $1 AND released_at IS NULL` sama dengan **1**. Ulangi seluruh
tes **50 kali** dengan fixture baru (balapan yang lolos satu putaran jarang lolos
lima puluh).

**T3 — kapasitas N, unit terakhir.** Pool/resource dengan 3 unit, 10 pesaing
untuk interval yang sama, satu unit masing-masing: tepat **3** berhasil pada **3
unit berbeda**, 7 `409`. Pesaing yang butuh 2 unit saat tersisa 1 mendapat `409`
dan **tidak** meninggalkan alokasi parsial (semua-atau-tidak-sama-sekali).

**T4 — idempotensi di bawah konkurensi.** Lima request paralel dengan
`Idempotency-Key` **sama** menghasilkan satu reservasi dan satu respons
tersimpan (empat replay); key sama dengan body berbeda adalah `409
IDEMPOTENCY_CONFLICT`.

**T5 — balapan reschedule.** (a) Me-reschedule ke waktu yang tumpang tindih
dengan slotnya sendiri berhasil (lepas-lalu-sisip). (b) Dua reservasi
me-reschedule ke slot satu sama lain secara konkuren: tidak menggantung (timeout
tes 10 dtk), paling banyak satu selesai, yang lain `409`, dan kedua aslinya
tetap utuh bila ditolak. (c) Reschedule yang ditolak membiarkan aslinya
`confirmed` dengan alokasi hidup.

**T6 — balapan kedaluwarsa hold.** (a) Hold kedaluwarsa yang belum disapu tidak
menghalangi klaim baru pada unit yang sama (lazy reclaim) dan dibiarkan
`expired`. (b) Confirm berbalapan dengan job kedaluwarsa pada satu hold: tepat
satu hasil, tak pernah baris `confirmed` tanpa alokasi hidup. Waktu digerakkan
oleh jam database (atur `hold_expires_at` ke masa lalu lewat SQL tes), bukan
tidur.

**T7 — tes mendeteksi cacatnya.** Pemeriksaan mutasi: pada skema scratch yang
constraint eksklusinya dijatuhkan, T1 langkah 4 dan T2 **gagal**. Tes
konkurensi yang lolos tanpa constraint tidak membuktikan apa pun.

**T8 — staf.** Bentuk slot-terakhir yang sama pada `staff_ref`: dua reservasi
paralel yang membutuhkan orang yang sama, satu menang.

**T9 — stay, tingkat database (interleaving terbukti seperti T1).** Fixture: satu resource `stay`, kapasitas 1, satu unit. (a) Koneksi A menyisipkan stay `[tgl 10, tgl 12)` belum commit; B menyisipkan `[tgl 11, tgl 13)`; pastikan B terblokir pada kunci; A `COMMIT` → B gagal `23P01`; varian A `ROLLBACK` → B berhasil. (b) `[tgl 10, tgl 12)` dan `[tgl 12, tgl 14)` yang bersebelahan keduanya commit (pergantian tamu di hari yang sama). (c) `[tgl 10, tgl 12)` dan `[tgl 11, tgl 12)` bentrok (malam 11). (d) Stay yang sudah dilepas tak lagi memblokir.

**T10 — stay, kamar terakhir, banyak pesaing.** 20 `POST /booking/reservations` paralel untuk `[d, d+2)` yang sama dengan 20 `Idempotency-Key` berbeda pada satu kamar: tepat **satu** `201`, sembilan belas `409 SLOT_UNAVAILABLE`, satu baris alokasi hidup; ulangi **50 kali**. Varian kapasitas 3 dengan 10 pesaing: tepat 3 berhasil pada 3 unit berbeda, dan tak ada stay yang pernah terbelah lintas unit.

**T11 — blok melawan booking.** (a) Blok dan booking berebut malam yang sama: tepat satu commit. (b) Blok di atas stay terkonfirmasi yang ada adalah `409 BLOCK_CONFLICT`, tidak menulis dan tidak membatalkan apa pun. (c) Blok yang dilepas membebaskan malamnya. (d) Hold kedaluwarsa yang belum disapu pada unit target tidak menolak blok (reklamasi malas). (e) Blok atas beberapa unit adalah semua-atau-tidak-sama-sekali.

**T12 — DST dan zona.** Pada fixture zona ber-DST (misalnya `Europe/Berlin`) dan zona tanpa DST (`Asia/Pontianak`): stay yang melintasi tanggal spring-forward dan yang melintasi tanggal fall-back masing-masing punya `nights = check_out_date − check_in_date` (hari 23 jam dan 25 jam dihitung satu malam); stay bersebelahan pada tanggal transisi tidak bentrok; jam check-in di dalam gap dan di dalam fold menghasilkan instant §2.2, tersimpan di snapshot item; mengubah `timezone` resource saat stay hidup ada adalah `TIMEZONE_IN_USE`; tanggal lokal yang tidak ada adalah `STAY_DATES_INVALID`.

**T13 — tes mendeteksi cacat, dan guard granularitas.** Pada skema scratch tanpa constraint stay, T9 dan T10 **gagal**. Alokasi slot pada resource stay, dan sebaliknya, ditolak trigger.

## 9. Catatan ancaman dan privasi

**Aset.** Integritas klaim (tanpa double-booking, tanpa booking hantu),
ketersediaan jadwal (tak ada yang menyandera), dan data pribadi orang yang
memesan (referensi pelanggan, catatan teks bebas, dan di beberapa vertikal apa
yang diungkap catatan itu).

| Ancaman                                                                                    | Mitigasi                                                                                                                                                                                                                                                      |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Balapan ke slot terakhir (double-booking)                                                  | §8: constraint eksklusi deklaratif; tes regresi wajib                                                                                                                                                                                                         |
| **Banjir hold** — aktor menahan setiap slot untuk memblokir penjualan atau pesaing         | hold dibatasi per pelanggan dan per tenant (`max_active_holds_*`), kedaluwarsa (TTL maks), `extend` dibatasi, membuat hold butuh `reservations.create` (kanal publik hilir mengautentikasi pelanggannya dan membatasi rate di edge); kedaluwarsa melepas      |
| Enumerasi ketersediaan (pesaing meng-scrape occupancy, atau jam janji seseorang)           | `availability.read` adalah izin, jendela pencarian ≤ 31 hari dan terbatas halaman, batas rate per-principal, hasil tak pernah memuat identitas pelanggan lain; **tak pernah edge-cache** (per-tenant dan per-request); proyeksi publik adalah keputusan hilir |
| Baca atau tulis lintas tenant                                                              | `tenant_id` + FORCE RLS pada setiap tabel, FK komposit, tes sebagai `awcms_app`                                                                                                                                                                               |
| IDOR pada id reservasi                                                                     | setiap handler mengotorisasi lewat `authorizeInTransaction`; akses bergaya-kepemilikan untuk pelanggan adalah grant hilir (ADR-0063), tidak diasumsikan                                                                                                       |
| Replay / double submit                                                                     | §5.2 tiga lapis                                                                                                                                                                                                                                               |
| Klien menegaskan status, interval, harga, atau pembayaran                                  | server memiliki status, interval (diturunkan dari offering dan awal request), buffer, kedaluwarsa; field pembayaran ditolak dengan namanya                                                                                                                    |
| Manipulasi zona waktu / DST untuk memesan waktu mustahil                                   | zona IANA eksplisit, aturan gap dan fold RFC 5545, `start < end`, pemeriksaan lead-time dan horizon pada instant UTC                                                                                                                                          |
| Rekurensi / ekspansi tak terbatas (denial CPU)                                             | skema tertutup, batas keras (§2.4), horizon ekspansi ≤ 366 hari, ≤ 52 kemunculan per seri                                                                                                                                                                     |
| Staf kelebihan pesan atau shift diabaikan                                                  | constraint eksklusi staf + pembacaan penasihat port tenaga kerja; perubahan shift kemudian dilaporkan (§7.3), tak pernah diterapkan diam-diam                                                                                                                 |
| Kebocoran catatan teks bebas (log, ekspor, event, audit)                                   | `customer_note` diklasifikasikan, ≤ 500 karakter, di `redactedColumns`, tidak ada di event/audit/log, dibaca di balik `reservation_notes.read` (teraudit), di-null saat penghapusan                                                                           |
| Penyalahgunaan override (booking di luar jam)                                              | `override` BERISIKO TINGGI, `Idempotency-Key`, diaudit `critical`; tak pernah bisa menimpa constraint eksklusi                                                                                                                                                |
| Tanggal stay dikirim sebagai instant, pada zona salah, atau untuk hari yang dilompati zona | hanya tanggal (`YYYY-MM-DD`), dibaca pada zona resource; instant ditolak untuk stay; tanggal lokal yang tidak ada adalah `STAY_DATES_INVALID`; zona immutable selama stay hidup ada                                                                           |
| Blok dipakai menyembunyikan inventori atau menolak penjualan                               | `blocks.create` izin tersendiri berdampak tinggi, `Idempotency-Key`, diaudit `warning`; blok tak bisa menimpa atau membatalkan reservasi yang ada; blok aktif didaftar dan dapat dilepas (`blocks.release`) serta direkonsiliasi (§7.1)                       |
| Panggilan provider di dalam transaksi                                                      | tidak ada; notifikasi atau pembayaran apa pun ada di hilir, lewat outbox                                                                                                                                                                                      |

**Privasi (UU PDP 27/2022) — masukan untuk analisis privasi, bukan kesimpulan
hukum.** Peran hukum operator (pengendali, prosesor, atau keduanya) adalah
keputusan pemilik O5 pada DoR hilir dan tidak diasumsikan di sini. Pilihan
desain yang berlaku dalam kedua kasus: _minimisasi data_ — pelanggan adalah
referensi, bukan nama, alamat, atau nomor telepon yang disalin; _tujuan_ —
catatan bersifat operasional, pendek, dan digerbangi kebijakan; _data spesifik_
— pada klinik atau vertikal serupa, catatan atau nama offering dapat
mengungkap informasi kesehatan, yang diperlakukan UU sebagai data pribadi
spesifik; modul karenanya dikirim dengan catatan **mati secara default untuk
tenant yang menyatakan vertikal kesehatan (O2)** dan tanpa field khusus
kesehatan; _hak subjek_ — setiap tabel menjawab pertanyaan subjek data (§4), dan
akses/penghapusan dijawab per tenant (ADR-0094) menurut referensi pelanggan;
_retensi_ — reservasi dipertahankan selama umur tenant di v1 dan jendela retensi per-tenant dengan archive-then-purge adalah tindak lanjut tercatat yang butuh ADR sendiri ("jendela retensi" 90 hari pada O8 adalah KPI retensi pelanggan, §7.2, bukan periode retensi data ini); _keamanan_ — masking/redaksi di log, ekspor, baris audit, dan
event; _kebocoran_ — modul tidak menambah penyimpanan rahasia baru, dan tak ada
kredensial, token, atau kunci di dalamnya.

## 10. Kontrak adapter dan port

### 10.1 Yang diberikan modul

`BookingPort` di `src/modules/_shared/ports/booking-port.ts` (ADR-0011: konsumen
bergantung pada port netral, tak pernah pada kode modul). Ia _mengembalikan_
penolakan sebagai nilai; ia melempar hanya untuk cacat. Bentuk provisional:

```ts
interface BookingPort {
  /** Non-binding: is this claim possible now? No row is written. */
  quote(input: { tenantId; offeringId; startsAt; partySize; resourceId?; staffRef?; correlationId }):
    Promise<{ ok: true; endsAt; occupiedFrom; occupiedTo; unitsNeeded }
           | { ok: false; reason: "SLOT_UNAVAILABLE" | "OUTSIDE_SCHEDULE" | "LEAD_TIME_VIOLATION" | … }>;
  /** Claim the slot as a hold (or confirmed when the offering is `immediate`). Idempotent on idempotencyKey. */
  hold(input: { …quote input; externalCustomerRef?; holdSeconds?; externalRef?: { type; id }; idempotencyKey }):
    Promise<{ ok: true; reservationId; status; holdExpiresAt; replayed } | { ok: false; reason }>;
  confirm(input: { tenantId; reservationId; idempotencyKey; correlationId }): Promise<…>;
  cancel(input: { tenantId; reservationId; reasonCode; idempotencyKey; correlationId }): Promise<…>;
  reschedule(input: { tenantId; reservationId; startsAt; idempotencyKey; correlationId }): Promise<…>;
}
```

Kewajiban konsumen, seperti untuk `InventoryLedgerPort`: **route mengotorisasi
sebelum port berjalan**; port ber-scope tenant; correlation id diteruskan ke
setiap baris audit dan event sehingga kedua separuh satu aksi bergabung. `quote`
bukan janji — hanya `hold` atau `confirm` yang janji.

**Stay (ekstensi provisional).** `quote` dan `hold` menerima, sebagai ganti `startsAt`, `stay: { checkInDate, checkOutDate }` (tanggal lokal `YYYY-MM-DD` pada zona resource) dan mengembalikan `nights` serta instant turunan `checkInAt` / `checkOutAt`; `reschedule` menerima `stay` yang sama. Alasan penolakan bertambah `MIN_STAY_VIOLATION`, `MAX_STAY_EXCEEDED`, `STAY_DATES_INVALID`, `BLOCK_CONFLICT` (panggilan blok), dan `TIMEZONE_IN_USE`. Blok dibuat dan dilepas lewat API admin modul sendiri, bukan lewat port.

### 10.2 Yang tak pernah dilakukan modul (tanpa dependensi `commerce`)

Ia tidak meng-import, memanggil, atau mendeklarasikan dependensi pada `commerce`.
Tenant tanpa toko mengaktifkan `booking` dan memakainya lewat layar admin dan API
miliknya sendiri. Berikut adalah milik **adapter hilir** (di `commerce`
`awcms-one`, menurut ADR-0040-nya), dijelaskan agar port berbentuk benar, bukan
dispesifikasikan di sini:

- tautan offering ↔ produk (baris produk yang menyebut `offeringId`);
- hold → order: buat order pending, simpan id-nya di `external_ref`;
- observasi pembayaran → `confirm`; event `expired` hold → batalkan order;
- deposit sebagai pembayaran parsial pada order; koordinasi refund pada `cancelled`;
- struk dan faktur dari order. Booking tak pernah menerbitkan dokumen bernomor.

Adapter mengonsumsi event lewat mekanisme registrasi konsumen generik yang masih
harus dibangun hilir (ADR-0040 "known mechanism gap"); modul ini hanya
mengeluarkan lewat outbox dan tak butuh registry konsumen sendiri.

### 10.3 Port ketersediaan staf (dikonsumsi; didefinisikan `hr_payroll`, #916)

Booking **membaca** ketersediaan staf lewat `StaffAvailabilityPort`, yang
didefinisikan oleh penerimaan `hr_payroll`
([ADR-0132](../adr/0132-hr-payroll-module-family-admission.md), Issue #916;
kontrak lengkap di [`hr-payroll.md`](hr-payroll.md) §5) — tak pernah tabel
payroll, kehadiran, atau karyawan. Booking mengonsumsinya apa adanya dan tidak
menambah persyaratan sendiri:

```ts
interface StaffAvailabilityPort {
  getAvailability(
    tx: TenantTx,
    query: {
      staffRefs: readonly string[]; // buram, 1..200
      fromUtc: string; // inklusif
      toUtc: string; // eksklusif, rentang <= 35 hari
      officeId?: string;
    }
  ): Promise<{
    asOf: string;
    staff: ReadonlyArray<{
      staffRef: string;
      status: "resolved" | "unknown";
      intervals: ReadonlyArray<{ startUtc: string; endUtc: string }>; // [start, end)
    }>;
  }>;
}
```

Diklasifikasikan kapabilitas `consumes` **opsional** (doc 21 §5). Tanpanya
(`hr_payroll` tak aktif, atau tenant tak melacak shift) penugasan staf hanya
dibatasi aturan eksklusi booking sendiri dan respons menyatakan
`staffAvailability: "unchecked"`. Dengan port, pembacaan bersifat **advisory**:
point-in-time dan tanpa kunci, sehingga shift yang diedit di antara pembacaan dan
commit tidak tertangkap di sini; perubahan kemudian dimunculkan laporan konflik
§7.3, bukan dengan membatalkan. `unknown` **tidak dapat dibooking** (fail
closed): `STAFF_UNAVAILABLE`. `staffRef` buram bagi booking dan hanya
diselesaikan oleh port.

### 10.4 Registrasi modul (desain)

`type: "domain"`; `dependencies`: hanya tenant-admin / identity-access;
`capabilities.consumes`: ketersediaan tenaga kerja (opsional) (tanpa `profile_identity`: commerce adalah otoritas pelanggan, O12), `reporting` (proyeksi),
`domain_event_runtime` (outbox); status `experimental` sampai layar admin
pertamanya (registry navigasi mensyaratkan halaman nyata). Kelas kompatibilitas:
offline-lan-safe.

## 11. Pertanyaan terbuka (keputusan pemilik — dicatat, TIDAK diputuskan di sini)

Dipetakan ke tracker hilir
[`aw-business-platform-dor.md`](https://github.com/ahliweb/awcms-one/blob/main/docs/aw-business-platform-dor.md).
ADR-0040 hanya menetapkan penempatan. Pemilik menjawab O1–O12 pada 2026-10-10 (tercatat di hilir pada DoR awcms-one); baris di bawah menyatakan jawaban mana yang tercatat di sini (**Terjawab**) dan mana yang masih terbuka di sini (O1, O3, O5, dan O9 dijawab di hilir pada hari yang sama tetapi tidak mengubah apa pun di paket ini dan belum direkonsiliasi ke dalamnya; O2 ditangani Issue #931). "Memblokir"
menyatakan apa di paket ini yang tak bisa difinalkan sampai jawabannya dicatat.

| #       | Pertanyaan                                                                                                                                    | Yang diasumsikan paket ini sementara                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Memblokir                                                                       |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| **O1**  | Persona dalam cakupan                                                                                                                         | Daftar provisional di §1 (resepsionis, manajer, pemilik resource, adapter, auditor)                                                                                                                                                                                                                                                                                                                                                                                                                  | Bundel peran §6 dan seed grant; UAT                                             |
| **O2**  | Vertikal mana yang pertama (hotel/vila, salon, klinik, rental, fasilitas, bengkel, pelatihan), dan apakah konsumen membangun lokal lebih dulu | **Terjawab 2026-10-10 (DoR awcms-one):** vertikal pertama hotel / vila / rental; tak ada repositori konsumen yang ada. Pemilik menyelesaikan konflik dengan asumsi paket ini sebelumnya dengan meminta perubahan cakupan di upstream: **menginap berbasis hari masuk v1** (ADR-0135, §2.5, §3.1). Tetap generik: tanpa field vertikal. Rekurensi `MONTHLY` tetap di luar v1 (tidak diminta). Kebijakan catatan kesehatan tetap defaultnya (mati untuk tenant yang menyatakan vertikal kesehatan, §9) | Layar admin pertama (bentuk akhir migrasi); sub-pertanyaan di bawah             |
| **O3**  | MoSCoW lintas CRM, Booking, Workforce, Payroll, Notification, Analytics                                                                       | Booking Wave A/B; job no-show otomatis dan waitlist tetap _Could_                                                                                                                                                                                                                                                                                                                                                                                                                                    | Hanya urutan; tanpa skema                                                       |
| **O5**  | Peran hukum operator (pengendali/prosesor/keduanya)                                                                                           | Tak satu pun ditegaskan; desain netral (§9)                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Teks analisis privasi, bukan skema                                              |
| **O8**  | Occupancy vs utilization, **apakah hold dihitung**, waktu terpesan vs aktual, aturan penyebut                                                 | **Terjawab 2026-10-10 (DoR awcms-one):** occupancy tidak menghitung hold (hold adalah angka pipeline terpisah); utilization metrik terpisah; jendela retensi pelanggan 90 hari (KPI lintas-domain, bukan periode retensi data); net revenue angka utama (§7.2). **Masih terbuka:** apakah penyebut mengecualikan penutupan pemeliharaan; waktu terpesan vs aktual                                                                                                                                    | Hanya _definisi_ yang tersisa; tanpa tabel                                      |
| **O9**  | Non-tujuan eksplisit                                                                                                                          | Daftar §1                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Redaksi cakupan                                                                 |
| **O12** | Identitas pelanggan: commerce tetap otoritas pelanggan, atau harmonisasi `profile_identity`                                                   | **Terjawab 2026-10-10 (DoR awcms-one): commerce tetap otoritas pelanggan.** `reservations` v1 hanya membawa `external_customer_ref` yang buram dan nullable (null = walk-in); tanpa `customer_profile_id`, tanpa dependensi `profile_identity`. Harmonisasi, bila pernah diinginkan, adalah kolom tambahan di bawah ADR sendiri                                                                                                                                                                      | Tidak ada: kolom pelanggan dan jalur penghapusan (§4) sudah tetap untuk migrasi |

**Sub-pertanyaan terbuka yang diangkat desain stay** (belum dijawab pemilik; dicatat, tidak diputuskan; diusulkan untuk tracker hilir):

- **O2a — arti "rental".** Hotel dan vila bersifat per malam. Rental bisa per hari (dicakup resource `stay`, pengambilan = check-in, pengembalian = check-out) atau per jam (dicakup resource `slot`). Keduanya didukung; konfirmasikan mana yang dibutuhkan konsumen rental pertama, dan apakah jam pengambilan/pengembalian berbeda dari default penginapan.
- **O2b — entitas `property`.** v1 mengambil zona waktu dan jam check-in / check-out dari setiap resource (dan default tenant). Apakah beberapa tipe kamar satu properti harus berbagi semuanya lewat entitas `property` (dan apakah pool harus membawanya) belum diputuskan.
- **O2c — default jam check-in / check-out.** Modul tidak menetapkan apa pun; pemilik atau konsumen pertama menetapkan default tenant.
- **O2d — mengubah stay di tempat.** Memperpanjang atau memperpendek stay yang `checked_in` (kepergian lebih awal melepas malam tak terpakai, perpanjangan mengambil malam berikutnya bila bebas) tidak dispesifikasikan; v1 hanya mendukung reschedule sebelum check-in (§3.1).
- **O2e — pindah kamar di dalam stay** dan best-fit packing stay lintas unit (jawaban "penuh" yang sebenarnya bisa dihindari dengan pindah) di luar v1.
- **O2f — aturan bergantung tanggal.** Tarif per malam dan rate plan, minimum menginap bergantung tanggal, pembatasan hari kedatangan atau keberangkatan di luar v1 (minimum per offering, §2.5).
- **O2g — no-show untuk stay.** Apakah grace per offering (dan apakah no-show melepas sisa malam setelah yang pertama) — pertanyaan terbuka yang sudah ada, kini konkret.
- **O2h — event blok.** Apakah hilir (channel manager) butuh event `awcms.booking.block.*`; v1 tidak memancarkan apa pun.

Juga terbuka dan _tidak_ ada di tracker hilir (diusulkan untuknya): angka
default dan maksimum TTL hold serta batas hold per pelanggan (§5.1 adalah
placeholder); apakah seri boleh diterima sebagian; apakah grace no-show per
offering, bukan per tenant; apakah `reservation_notes.read` sebaiknya izin
terpisah dari `reservations.read` (diasumsikan ya). Tak satu pun di atas
diputuskan oleh dokumen ini.

## 12. Rollback, operasi, dan tindak lanjut

**Rollback.** Forward-only seperti setiap migrasi di sini. Untuk berhenti
memakai modul: berhenti memanggilnya dan (opsional) nonaktifkan per tenant;
tabel inert dan order hilir tetap valid dengan sendirinya. Menjatuhkan tabel
adalah keputusan kelas restore. Setelah restore apa pun jalankan rekonsiliasi
booking (§7.1): reservasi dan alokasi harus kembali dari titik waktu yang sama.
Untuk memberi tenant yang ada izin baru jalankan
`bun run identity-access:permissions:backfill`.

**Operasi.** Kesehatan job kedaluwarsa dapat diamati (hold macet muncul di
rekonsiliasi, §7.1); kebenaran tidak bergantung padanya (§5.1). Pra-pemeriksaan
`btree_gist` masuk runbook deploy (§8.2). Baris alokasi tumbuh menurut booking,
bukan lalu lintas; indeks GiST parsial atas baris hidup menjaga probe murah, dan
baris lampau adalah tindak lanjut archive-then-purge (tanpa purge di v1;
didaftarkan ke `data_lifecycle` sebagai `delegated` dengan alasan yang
dinyatakan, ADR-0126 §7).

**Tindak lanjut tercatat (bukan v1).** Layar admin (modul `experimental` sampai
yang pertama); ABAC ber-scope lokasi/resource; kapasitas terhitung tanpa baris
unit (memakai aturan §8.1 butir 4); seri terima-sebagian; turnaround bersama;
waitlist; ekspor iCal; no-show otomatis; jendela retensi dengan archive-then-purge; harmonisasi `profile_identity` atas referensi pelanggan (ADR sendiri; O12 mempertahankan commerce sebagai otoritas); rekurensi `MONTHLY` (O2); tindak lanjut stay O2a–O2h (§11); memperbarui payload AsyncAPI provisional dan `cross-domain-contracts.md` dengan field aditif `stays` saat event hidup; keyed hashing dan enkripsi at-rest tidak berlaku (tak ada identifier yang
disimpan).
