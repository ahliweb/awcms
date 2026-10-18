🇮🇩 Bahasa Indonesia · 🇬🇧 [English (source)](booking.md)

<!-- i18n-source-hash: sha256:30981d953f5582b4911a7e2b3d2d7df848fe91c469f598ccd57ca941a4edaeb0 -->

<!-- i18n-source-hash: sha256:pending -->

# Booking — resource, jadwal, dan reservasi (paket dokumen modul)

> **Status:** diterima lewat [ADR-0131](../adr/0131-generic-booking-module-admission.id.md)
> (Issue #915). **Dibangun per irisan: §13 menyebut apa yang sudah ada di kode
> hari ini** (skema, katalog izin, route availability dan jadwal, alokator
> dengan hold dan kedaluwarsa, serta stay dan malam terblokir lewat alokator yang
> sama, serta route reservasi, `BookingPort`, dan sembilan event live), route
> blok (#1012), laporan (#944) dan route konfigurasi admin (#1030: resource dan
> unit, pool, offering, kebijakan); layar admin (#942, §3.0.3) sudah dibangun, modul berstatus
> `active`, dan pertanyaan terbuka di §11 tetap mengatur yang belum. PRD-lite, state machine, ERD dan kamus
> data, hold dan idempotensi, matriks izin/RLS, pelaporan dan event, strategi
> double-booking beserta tes regresi wajibnya, catatan ancaman dan privasi,
> kontrak adapter/port, dan pertanyaan terbuka ada dalam satu tempat. Keputusan
> dan alternatif yang ditolak ada di ADR. Bentuknya mengikuti
> [`inventory-ledger.md`](inventory-ledger.id.md),
> [`procurement.md`](procurement.id.md) dan [`tax-calculation.md`](tax-calculation.id.md).
> Kesembilan event reservasi sudah **live** (Issue #941, §7.4): mereka pindah
> dari dokumen AsyncAPI provisional ke yang live. Menginap berbasis hari (per malam) menjadi bagian v1 lewat [ADR-0135](../adr/0135-day-granularity-stays-admitted-into-booking-v1.id.md) (§2.5, §3.1).

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
  tumpang tindih. `start < end` adalah CHECK, begitu pula `end − start ≤ 368 hari` pada reservasi dan item (`sql/204`). Stay membatasi 366 yang sama dalam TANGGAL (§2.5), tetapi instant stay 366 malam yang jam check-out-nya lebih siang daripada jam check-in-nya, melintasi perubahan daylight saving, bisa membentang sehari dan satu jam lebih dari 366 hari, dan CHECK atas instant tak boleh menolak stay yang diizinkan aturan tanggal; untuk slot batasnya karena itu 368 hari, bukan 366.
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
`LEAD_TIME_VIOLATION`, `HORIZON_EXCEEDED`, `PARTY_SIZE_OUT_OF_RANGE` (409),
`STAFF_UNAVAILABLE` (409), `RECURRENCE_UNSUPPORTED`, `TIMEZONE_INVALID`,
`IDEMPOTENCY_REQUIRED` (400), `IDEMPOTENCY_CONFLICT` (409),
`PAYMENT_FIELD_NOT_ACCEPTED` (400). Klaim (`placeHold`, Issue #939) menambah
penolakan yang hanya bisa dibuatnya: `CONTENTION_RETRY` (409: klaim terus kalah
balapan atau deadlock tiga kali berturut-turut; ulangi), `QUANTITY_EXCEEDS_UNITS`
(422: unit yang diminta lebih banyak daripada yang dimiliki target),
`BOOKING_MODE_MISMATCH` (409: offering waktu pada resource stay, atau
sebaliknya), `EXTERNAL_REF_IN_USE` (409: sudah ada reservasi hidup dengan
`external_ref` itu), `RESOURCE_NOT_FOUND` dan `OFFERING_NOT_FOUND` (404, netral:
id milik tenant lain dijawab sama dengan id yang tak dikenal). Irisan stay (Issue #940) menambah: `STAY_DATES_INVALID` (400: tanggal salah bentuk atau terbalik, instant sebagai ganti tanggal, tanggal yang tidak ada di zona itu, tanggal check-in yang sudah lewat di zonanya), `MIN_STAY_VIOLATION` dan `MAX_STAY_EXCEEDED` (409: batas malam offering), `STAY_POOL_INCONSISTENT` (409: resource stay dalam satu pool tidak berbagi satu zona dan satu pasang jam check-in dan check-out, sehingga tak ada satu snapshot yang bisa diambil), dan, untuk blok, `BLOCK_CONFLICT` (409: stay hidup atau blok lain memegang satu malam dari rentang itu; tak ada yang dibatalkan), `UNIT_NOT_FOUND` dan `BLOCK_NOT_FOUND` (404). Booking yang kehilangan satu malam kepada blok, atau kepada stay lain, adalah `SLOT_UNAVAILABLE`, seperti pada slot.

Route reservasi (Issue #941) menambah penolakan yang hanya bisa dibuatnya:
`NO_SHOW_TOO_EARLY` (409: sebelum waktu mulai ditambah grace),
`CHECK_IN_TOO_EARLY` (409: stay sebelum tanggal check-in pada zona resource),
`RESOURCE_REQUIRED` (400: reschedule reservasi yang mencakup beberapa resource
harus menyebut ke mana ia pindah), `LEAD_TIME_VIOLATION`, `HORIZON_EXCEEDED` dan
`OUTSIDE_SCHEDULE` (semuanya 409, hanya diangkat `reservations.override`), dan
`RESERVATION_NOT_FOUND` yang netral (404: id tak dikenal, id tenant lain, dan id
tersembunyi dijawab sama). `HOLD_EXPIRED` juga jawaban untuk hold yang sudah
dikedaluwarsakan sapuan, bukan hanya yang berakhir dan belum disapu: pembayaran
yang teramati setelah kedaluwarsa tahu bahwa ia terlambat.

**Pembatalan terlambat.** `cancellation_cutoff_seconds` pada offering membuat
pembatalan di dalam batas membawa `late_cancellation = true` pada event dan
reservasi. Modul mencatat faktanya; **biaya apa pun adalah keputusan commerce**.

**No-show.** Ditandai oleh orang, setelah `starts_at + no_show_grace_seconds`
(kebijakan). Job no-show otomatis mati secara default dan merupakan pertanyaan
terbuka (O2/O3).

### 3.0 Route dan layanan transisi (Issue #941)

| Route (semuanya di bawah `/api/v1/booking`)   | Kata kerja | Izin                      | Sukses                                                     |
| --------------------------------------------- | ---------- | ------------------------- | ---------------------------------------------------------- |
| `POST /reservations`                          | create     | `reservations.create`     | `201`, `{ reservation, replayed, policyLifted }`           |
| `POST /reservations/{id}/confirm`             | confirm    | `reservations.confirm`    | `200`, `{ reservation, replayed }`                         |
| `POST /reservations/{id}/cancel`              | cancel     | `reservations.cancel`     | `200`, `{ reservation, replayed }`                         |
| `POST /reservations/{id}/reschedule`          | reschedule | `reservations.reschedule` | `200`, `{ reservation, previous, replayed, policyLifted }` |
| `POST /reservations/{id}/check-in`            | check_in   | `reservations.check_in`   | `200`, `{ reservation, replayed }`                         |
| `POST /reservations/{id}/check-out`           | complete   | `reservations.complete`   | `200`, `{ reservation, replayed }`                         |
| `POST /reservations/{id}/no-show`             | no_show    | `reservations.no_show`    | `200`, `{ reservation, replayed }`                         |
| `GET /reservations`, `GET /reservations/{id}` | read       | `reservations.read`       | daftar (keyset) / detail dengan riwayat                    |

Setiap mutasi mewajibkan `Idempotency-Key` (komponen bersama, ADR-0129) dan
menempuh jalur yang sama: route mengotorisasi izinnya lebih dulu (default tolak),
memvalidasi body secara ketat, lalu `runIdempotent` mengembalikan respons
tersimpan untuk key, user, dan request yang sama atau menjalankan transisi.
Penolakan adalah nilai yang dikembalikan, tak pernah disimpan, dan tidak menulis
apa pun. Layanan (`application/booking-reservation-service.ts`) mengunci
reservasi `FOR UPDATE`, membaca jam database dalam statement yang sama,
memutuskan dengan state machine murni, baru kemudian menulis: reservasi,
alokasi yang dilepas kata kerjanya, **tepat satu** baris riwayat, satu baris
audit, dan satu event outbox, dalam satu transaksi. `BookingPort` (§10.1)
memanggil fungsi yang sama, sehingga transisi lewat port identik dengan lewat
route.

**`overridePolicy` adalah pemeriksaan kedua yang independen.** Jam buka, lead
time, dan horizon ditolak kecuali body menyatakan `overridePolicy: true` DAN
pemanggil juga memegang `reservations.override`, yang diperiksa lebih dulu lewat
`authorizeInTransaction` (aksi berisiko tinggi, sehingga separation-of-duties
saat aksi berlaku), sebelum apa pun dibaca atau ditulis, dan diaudit `critical`.
`create` saja tak bisa mengangkat kebijakan dan `override` saja tak bisa membuat
(keduanya diuji). Ia tak pernah mengangkat konflik alokasi. Pool seketat anggota
paling ketatnya, karena alokator boleh menempatkan booking pada anggota mana pun.

**Kepemilikan.** Tidak ada ownership grant pada route reservasi mana pun: grant
hanya bisa memperluas pembacaan, pelanggan adalah token opak di otoritas commerce
dan bukan tenant user, dan pembuat reservasi tidak berhak membacanya hanya karena
membuatnya. Grant untuk pelanggan adalah keputusan hilir (ADR-0063).

### 3.0.1 Route blok (Issue #1012)

| Route (semua di bawah `/api/v1/booking`) | Kata kerja | Izin             | Sukses                                                          |
| ---------------------------------------- | ---------- | ---------------- | --------------------------------------------------------------- |
| `POST /blocks`                           | create     | `blocks.create`  | `201`, `{ block, replayed: false }`                             |
| `POST /blocks/{id}/release`              | release    | `blocks.release` | `200`, `{ block, replayed, releasedAllocations }`               |
| `GET /blocks`, `GET /blocks/{id}`        | read       | `blocks.read`    | daftar (keyset; filter `resourceId`, `unitId`, `status`) / satu |

`POST /blocks` menerima `{ resourceId, unitId?, fromDate, toDate, reasonCode }`
(body ketat; klien tak bisa menegaskan status atau aktor). `unitId` absen atau
null memblokir setiap unit, **termasuk unit yang ditambahkan kemudian** (lihat
§4). Blok **berdampak tinggi** (menghapus inventori yang bisa dijual):
`blocks.create` adalah izin tersendiri, diaudit `warning`
(`booking.block.created`); rilis diaudit `info` (`booking.block.released`).
Keduanya memakai `Idempotency-Key` dan jalur `runIdempotent` yang sama dengan
route reservasi, sehingga:

- klien yang mengulang setelah commit menerima **respons tersimpan** (blok yang
  sama, `201` yang sama) dan tak pernah `409 BLOCK_CONFLICT` yang menyebut
  bloknya sendiri (temuan N2 review #940). Constraint eksklusi tidak pernah
  menjadi mekanisme retry; ia hanya memutuskan antara pemanggil yang benar-benar
  berbeda;
- request serentak dengan satu key diserialkan oleh advisory lock per-key dan
  membuat satu blok;
- penolakan adalah nilai yang dikembalikan, tak pernah disimpan dan tidak
  menulis apa pun, sehingga key yang sama berhasil setelah penghalangnya hilang;
  key yang dipakai ulang dengan request berbeda atau oleh user lain adalah
  `409 IDEMPOTENCY_CONFLICT`.

`BLOCK_CONFLICT` (`409`) menyebut reservasi yang bentrok (nomor, status,
tanggal; tak pernah referensi pelanggan) dan blok di `error.details.conflicts`
**hanya kepada pemanggil yang juga memegang `reservations.read`**, diputuskan
lewat `authorizeInTransaction` (ABAC berlaku). Tanpanya pemanggil tahu bahwa
malam itu terisi, bukan oleh siapa. Membuat blok tak pernah membatalkan
reservasi. Penolakan lain: `RESOURCE_NOT_FOUND` / `UNIT_NOT_FOUND` (`404`),
`BOOKING_MODE_MISMATCH` (`409`, resource slot), `STAY_DATES_INVALID` (`400`),
`CONTENTION_RETRY` (`409`). Merilis blok yang sudah dirilis adalah `200` dengan
`replayed: true` dan tidak menulis apa pun; id tak dikenal dan id tenant lain
adalah satu `404 BLOCK_NOT_FOUND`.

**Tanpa event domain di v1.** Blok adalah konfigurasi administrator atas apa yang
dijual, bukan fakta yang perlu direspons konsumen kesembilan event reservasi, dan
tak ada yang mengonsumsinya (event channel-manager masih terbuka, §11). Blok
diaudit; event dapat ditambahkan kelak tanpa perubahan yang merusak, lalu
mengikuti aturan AsyncAPI §7.4.

### 3.0.2 Route konfigurasi admin (Issue #1030)

Prasyarat layar admin (#942): layar hanya memanggil ini dan route di atas. Resource beserta unitnya, pool resource, offering layanan, dan kebijakan tenant, semuanya di bawah `/api/v1/booking`, semuanya `defineTenantRoute`, default-deny, tercakup tenant di bawah RLS FORCE.

| Route                                                                                 | Izin                                          | Sukses                                     |
| ------------------------------------------------------------------------------------- | --------------------------------------------- | ------------------------------------------ |
| `GET /resources`, `GET /resources/{id}`                                               | `resources.read`                              | daftar (keyset) / satu dengan `units`      |
| `POST /resources`                                                                     | `resources.create`                            | `201`, `{ resource, replayed: false }`     |
| `PATCH /resources/{id}`                                                               | `resources.update`                            | `200`, `{ resource, replayed }`            |
| `DELETE /resources/{id}`, `POST /resources/{id}/restore`                              | `resources.delete` / `.restore`               | `200`, `{ resource, replayed }`            |
| `GET/POST /resource-pools`, `GET/PATCH/DELETE /resource-pools/{id}`, `POST …/restore` | izin `resources.*`                            | bentuk yang sama, `{ pool, replayed }`     |
| `GET/POST /offerings`, `GET/PATCH/DELETE /offerings/{id}`, `POST …/restore`           | `offerings.read/create/update/delete/restore` | bentuk yang sama, `{ offering, replayed }` |
| `GET /policy`                                                                         | `policy.read`                                 | `{ policy, effective, updatedAt }`         |
| `PUT /policy`                                                                         | `policy.configure` (berisiko tinggi)          | `200`, kebijakan yang kini berlaku         |

**Setiap tulis** memakai `Idempotency-Key` dan jalur `runIdempotent` yang sama dengan route reservasi dan blok (§3.0.1): retry setelah commit menerima **respons tersimpan** (create yang diulang adalah `201` dan body yang sama, tidak pernah `CODE_TAKEN` tentang barisnya sendiri), request serentak dengan satu key membuat satu baris, penolakan adalah nilai kembalian yang tidak pernah disimpan dan tidak menulis apa pun, dan key yang dipakai ulang dengan request lain adalah `409 IDEMPOTENCY_CONFLICT`. Masing-masing berjalan di bawah savepoint, sehingga penolakan database di tengah jalan (unit yang bukan milik resource ini) membatalkan seluruh request. Delete dan restore juga **replay berdasarkan status**: mengulanginya adalah `200` dengan `replayed: true`, tanpa menulis maupun mengaudit. Body ketat (key tak dikenal adalah `400`); tak ada isinya yang berupa harga, status pembayaran, id produk, atau nama pelanggan (§10.2).

**Resource dan unit.** `POST /resources` membuat resource beserta `capacity` unitnya (ordinal 1 sampai `capacity`, berlabel dari `unitLabels` opsional) dalam satu transaksi. Resource stay mengirim `stayCheckInTime` dan `stayCheckOutTime`, resource slot tidak keduanya; `timezone` adalah nama IANA. `PATCH` mengubah `name`, `kind`, `status`, `sortOrder`, `timezone`, `bookingMode`, jam stay, **`poolId` (keanggotaan pool: id pool, atau `null` untuk keluar)**, `capacity` dan `units`. `code` tetap. Kapasitas **hanya bertambah**: unit baru ditambahkan (blok seluruh-resource mencakupnya, §4, `sql/240`) dan tidak pernah menyusut (`409 CAPACITY_REDUCTION_NOT_ALLOWED`), karena unit adalah jangkar exclusion constraint dan `awcms_app` ditolak `DELETE` atasnya; unit diberi label ulang atau dinonaktifkan lewat `units: [{ id, label?, status? }]`. `PATCH` ke `bookingMode: "slot"` mengosongkan jam stay kecuali dikirim.

**Guard database sampai ke pemanggil sebagai penolakan bernama, bukan 500:** `409 BOOKING_MODE_IN_USE` (mode tak dapat berubah selama resource punya alokasi hidup atau blok aktif), `409 TIMEZONE_IN_USE` (sama, untuk zona), `409 SCHEDULE_TIMEZONE_MISMATCH` (jadwal aktif ditulis dalam zona saat ini; nonaktifkan dulu), `409 CODE_TAKEN` (kode unik per tenant, tak peka huruf besar), `400 TIMEZONE_INVALID`, `422 CONSTRAINT_VIOLATED` (CHECK yang tak dinyatakan validator), `404 UNIT_NOT_FOUND`, `404 POOL_NOT_FOUND` (pool tak dikenal atau terhapus), `409 GUARD_REFUSED` (guard database lain, `55000`, yang tak disebut di atas), `409 POOL_DELETED` (me-restore resource yang pool-nya terhapus: restore pool dulu atau pindahkan resource; keanggotaan tidak pernah dikosongkan diam-diam).

**Menonaktifkan bukan menghapus, dan tidak menolak apa pun.** Menandai unit atau resource `inactive` menghentikan alokasi BARU (alokator melewati unit nonaktif; ketersediaan berhenti menawarkannya), tetapi alokasi yang sudah hidup tetap: tak ada penolakan `UNIT_IN_USE`, karena booking yang dipegang pelanggan adalah fakta dan membatalkannya adalah keputusan reservasi (`reservations.cancel`), bukan efek samping konfigurasi. Diuji: stay hidup bertahan pada kedua penonaktifan.

**Pembacaan pool memuat paling banyak 500 anggota hidup** (`members`); `memberCount` adalah hitungan penuh anggota hidup, sehingga pool lebih dari 500 menampilkan 500 pertama menurut `sortOrder`.

**Delete bersifat soft, dan ditolak selama resource dipakai.** `DELETE /resources/{id}` adalah `409 RESOURCE_IN_USE` selama reservasi held, confirmed atau checked-in, atau blok aktif, membutuhkannya (yang `completed` tidak, begitu pula hold yang lewat kedaluwarsanya menurut jam database, yang akan segera direklamasi): hentikan penjualan dengan `status: "inactive"`. Pool dengan anggota hidup adalah `409 POOL_NOT_EMPTY`. Baris terhapus tak dapat diubah (`409 RESOURCE_DELETED`, `POOL_DELETED`, `OFFERING_DELETED`). Mengubah atau menghapus offering hanya mengubah booking **mendatang**: item menyimpan snapshot-nya. Baris soft-delete mengikuti aturan ADR-0128 di §6: `?includeDeleted=true` atau `?onlyDeleted=true` pada daftar ditolak (`403`) tanpa `.restore` area itu juga, dan `GET /…/{id}` baris terhapus adalah `404` netral bagi pemanggil tanpanya.

**Offering.** `code` dan `granularity` tetap. Offering `time` butuh `durationSeconds` dan `slotStepSeconds` (minimal 300) dan boleh memberi buffer; offering `stay` butuh `minNights` dan `maxNights` (maksimal 366); `maxParty` minimal `minParty`. Baris hasil gabungan divalidasi terhadap CHECK bentuk `sql/186`, sehingga `PATCH` tak dapat meninggalkan offering stay dengan durasi.

**Kebijakan.** `GET /policy` mengembalikan `policy` (yang diatur tenant, `null` bila tidak) dan `effective` (yang berlaku). `null` adalah **default modul, bukan "tanpa batas"** (§13: 5 hold hidup per pelanggan, 500 per tenant, hold 15 menit, grace no-show 15 menit, tanpa lead time, horizon 365 hari). `PUT /policy` **mengganti** baris: setiap field harus dikirim (key hilang adalah `400`, sehingga klien parsial tak dapat menghapus batas karena lupa); rentangnya adalah CHECK `sql/180` ditambah batas kewajaran (hold 60 sampai 86400 detik dengan default paling besar sama dengan maksimum, batas minimal 1, horizon 1 sampai 3650 hari, grace no-show 0 sampai 30 hari). Ia hanya mengubah hold dan pencarian **mendatang**. Ia berisiko tinggi (`configure` adalah aksi berisiko tinggi: ia membatasi berapa banyak inventori yang dapat ditahan satu aktor), sehingga baris audit-nya **`critical`** (`booking.policy.configured`, nilai sebelum dan sesudah; angka, nama zona dan jam lokal, tanpa data pribadi). **Tanpa step-up MFA:** [ADR-0141](../adr/0141-permissions-may-require-an-enrolled-mfa-factor.id.md) §6 hanya menandai izin payroll dan menyatakan menandai izin rutin adalah penguncian yang tidak dipilih tenant; tenant yang menginginkannya dapat menambah aturan SoD atas aksi berisiko tinggi itu. `defaultTimezone`, `defaultCheckInTime` dan `defaultCheckOutTime` disimpan agar layar menawarkannya saat membuat resource stay; server tidak menerapkannya.

Audit: pembuatan dan pembaruan resource, pool dan offering adalah `info`, soft delete `warning`, restore `info`; atributnya id, kode dan nama field yang berubah, tidak pernah label unit. **Tanpa domain event** (konfigurasi, seperti blok; §3.0.1).

### 3.0.3 Layar admin (Issue #942)

Enam layar di bawah `/admin/booking/`, masing-masing satu entri `navigation` modul (sehingga `booking` berstatus `active`, bukan `experimental`: kriteria 1 ADR-0021). Mereka hanya memanggil route di §3, §3.0.1 dan §3.0.2; **layar tidak memuat aturan bisnis**, ia memetakan formulir ke body dan penolakan ke kalimat.

| Layar                         | Izin masuk          | Menjalankan                                                                                                                                                      |
| ----------------------------- | ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/admin/booking/reservations` | `reservations.read` | daftar (filter status, keyset), hold dan kedaluwarsanya; `?id=` adalah satu reservasi dengan item, riwayat, dan confirm / cancel / check in / complete / no-show |
| `/admin/booking/resources`    | `resources.read`    | resource beserta unitnya (tampilan ubah memuat unit), dan pool resource (buat, ganti nama, hapus, pulihkan)                                                      |
| `/admin/booking/offerings`    | `offerings.read`    | offering: buat, ubah, hapus, pulihkan                                                                                                                            |
| `/admin/booking/schedules`    | `schedules.read`    | jam buka mingguan (tambah, akhiri pada tanggal, nonaktifkan), penutupan dan jam khusus (tambah, hapus)                                                           |
| `/admin/booking/blocks`       | `blocks.read`       | malam terblokir: blokir, lepaskan                                                                                                                                |
| `/admin/booking/policy`       | `policy.read`       | kebijakan tenant: satu formulir, `PUT` mengganti seluruh baris                                                                                                   |

Cara mereka dibangun, masing-masing keputusan, bukan kebetulan:

- **Pembacaan memakai fungsi route itu sendiri.** Tiap layar membaca lewat `loadAdminScreen` dengan fungsi aplikasi yang sama dengan route JSON-nya (`listOfferings`, `getResource`, `listReservations`, `getPolicy`, ...), sehingga keputusan masuk (`authorizeInTransaction`, ABAC, log keputusan) dan pembacaan berbagi satu transaksi. Kontrol dijaga `can()` pada izin yang ditegakkan endpoint; setiap gerbang hanya untuk UX dan endpoint-lah otoritasnya. Tenant tanpa izin baca mendapat pemberitahuan `*-denied`; penolakan oleh pool atau circuit breaker adalah `*-error`, tidak pernah "tanpa baris".
- **Setiap mutasi membawa `Idempotency-Key`.** Satu pengirim bersama (`src/lib/ui/booking-admin-client.ts`, `bookingMutate`) mengambilnya dari `createIdempotencyKeySource` repo (yang dipakai inventory, tax, dan procurement), berkunci pada method + url + body: menekan request YANG SAMA lagi setelah respons hilang memutar ulang respons tersimpan, bukan mengulang, dan request yang diubah mengambil key baru. Klik ganda dihentikan dengan mengunci kontrol. Memorinya per muat halaman, jadi setelah muat ulang manual route bergaya create menjawab `CODE_TAKEN` atau `BLOCK_CONFLICT` dengan jujur (percobaan pertama memang berhasil); delete, restore, release, dan transisi reservasi juga memutar ulang menurut STATUS (§3.0.1, §3.0.2). Sumber bersama itu memakai cadangan `getRandomValues` bila `crypto.randomUUID` tidak ada (profil offline-LAN memakai http polos). Tes kontrak (`tests/admin-booking-page-contract.test.ts`) gagal bila layar mengirim mutasi dengan cara lain.
- **Penolakan adalah kalimat dalam bahasa pembaca.** Halaman merender pesan terjemahannya sebagai JSON di atribut `data-msgs`, berkunci kode error API (`CODE_TAKEN`, `BOOKING_MODE_IN_USE`, `BLOCK_CONFLICT`, ...); skrip memilih kalimat menurut kode dan tidak pernah mencetak teks server. Tak ada literal Inggris di skrip. Katalognya `locales/en.po` dan `locales/id.po`.
- **Tanpa dialog browser.** Hapus, batalkan, no-show, lepaskan, dan nonaktifkan lewat `<dialog>` native ADR-0125 (`confirmAction`), dioperasikan dengan keyboard seperti kontrol lain; tak ada kontrol yang hanya bisa dengan penunjuk. Tabel adalah wilayah yang dapat digulir dan difokus dengan caption, ditumpuk di bawah lebar tablet; sapuan mencakup 360 px dan axe di kedua tema (`responsive-360.e2e.ts`, `a11y-axe.e2e.ts`), dan `tests/e2e/admin-booking.e2e.ts` menjalankan setiap aksi dengan keyboard.
- **Detail reservasi adalah tampilan halaman daftar (`?id=`), bukan route dinamis.** Route admin dinamis harus dapat dijangkau dari tautan di induknya, dan tenant baru tak punya reservasi untuk ditautkan; sebagai tampilan ia tidak mungkin yatim. Ia menampilkan item, kedaluwarsa hold (hold yang lewat dan belum dilepas sapuan ditandai **Terlambat dilepas**, dinilai pada jam DATABASE, `hold_expires_at <= clock_timestamp()`, seperti `booking-hold-expiry.ts`) dan riwayat append-only sebagai linimasa jenis event tertutup. Ia tidak pernah menampilkan referensi pelanggan maupun catatan (`reservation_notes.read` adalah pembacaan beraudit tersendiri).
- **Satuan waktu di layar adalah menit** (durasi, buffer, pemberitahuan, lama hold, toleransi no-show), dan konversinya TIDAK PERNAH menulis ulang apa yang tidak disentuh operator (`src/lib/booking-admin-format.ts`). API menerima bilangan bulat detik apa pun, sehingga `Math.round(detik / 60)` yang ditampilkan dan `menit * 60` yang dikirim kembali akan mengubah 90 dtk menjadi 120 dtk, langkah slot 330 dtk menjadi 360 dtk (mengubah ketersediaan), membuat durasi 20 dtk tak dapat disimpan, dan menulis ulang kebijakan di bawah baris audit `critical` pada suntingan yang tak berkaitan. Karena itu setiap kontrol membawa teks yang ditampilkan (`data-initial`) dan nilai API asalnya (`data-original`): kontrol yang tak disunting mengirim nilai asli, yang disunting dikonversi; `PATCH` hanya mengirim field yang berubah dan `PUT /policy` mengirim semua field, yang tak disunting identik byte demi byte. Nilai yang bukan menit bulat tampil sebagai menit desimal dengan detik persisnya di sampingnya. Offering tidak memuat harga (§10.2). Waktu ditampilkan dalam UTC dan diberi label.
- **Tanpa pemotongan diam-diam.** Daftar adalah halaman keyset dengan tautan Berikutnya (reservasi, blok, resource, offering, serta tabel jadwal dan penutupan masing-masing berhalaman dengan kursornya sendiri). Pencarian yang dibutuhkan layar untuk menampilkan nama atau mengisi pemilih (resource, pool, unit resource menginap, baris terhapus) membaca setiap halaman hingga batas 50 halaman, dalam satu batch untuk unit, sehingga resource ke-101 tetap punya nama dan tetap bisa dipilih. Petunjuk formulir kebijakan di samping field kosong adalah bawaan MODUL, bukan nilai yang berlaku setelah tenant mengaturnya.
- **Tidak ada di layar mana pun, dengan sengaja:** membuat, menjadwalkan ulang, dan meng-override reservasi (etalase dan kasir yang melakukannya; UI pemilih adalah tindak lanjut epik), pencarian ketersediaan, catatan pelanggan, laporan, dan rekonsiliasi. Izin-izin itu tetap di ledger cakupan layar admin (`scripts/admin-screen-coverage-ledger.ts`, tujuh kunci), yang kini hanya memuat mereka.

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
| `resources`            | `code` (unik per tenant, tak peka huruf besar, **termasuk baris soft-delete**: resource terhapus mempertahankan kodenya, dan restore tak pernah bertabrakan), `name`, `kind` (kode pendek, mis. `room`, `chair`, `court`, `vehicle`), `status` (`active`/`inactive`), `capacity int 1..500`, `pool_id` (nullable), `timezone` (IANA; immutable selama alokasi stay hidup ada), `booking_mode` (`slot` default / `stay`; immutable selama resource punya alokasi hidup, trigger), `stay_check_in_time` / `stay_check_out_time` (`time` lokal pada `timezone`; wajib bila `stay`, NULL bila `slot`), `sort_order`, stempel soft-delete                                                                                                                                             | SELECT, INSERT, UPDATE (tanpa DELETE)                       |
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
| `reservation_events`   | `reservation_id`, `seq` (per reservasi), `kind`, `from_status`, `to_status`, `actor_user_id`, `correlation_id`, `reason_code`, `detail` jsonb (kunci tertutup: id, instant, hitungan — **tanpa teks bebas, tanpa data pribadi**), `occurred_at` (jam DB); unik `(reservation_id, kind)` untuk jenis sekali-saja; kolom ter-generate `projection_kind` dan empat kuantitas integer untuk proyeksi (`sql/244`, §7.2)                                                                                                                                                                                                                                                                                                                                                               | SELECT, INSERT (**tanpa UPDATE/DELETE**)                    |

`awcms_worker` memegang `SELECT` hanya pada `awcms_booking_reservation_events`
(engine reporting membaca sumber proyeksi sebagai peran itu) dan **tidak ada
privilege pada tabel booking lain**. Job kedaluwarsa
hold (`booking:holds:expire`) berjalan sebagai `awcms_worker` dengan konteks
per-tenant dan menjangkau tabel hanya lewat dua fungsi SECURITY DEFINER sempit
dari `sql/200` (pola `sql/142` / ADR-0090): `awcms_booking_expire_due_holds(tenant,
batch)`, yang hanya bisa mengakhiri hold berakhir milik tenant sesi itu sendiri,
dan `awcms_booking_count_due_holds` untuk `--dry-run`. `UPDATE` pada reservasi
yang diberikan ke worker juga akan membuat job cron bisa confirm atau cancel
booking; peran pemilik fungsi (`awcms_booking_expiry`, NOLOGIN, tanpa anggota)
hanya memegang privilege per-kolom yang dibutuhkan literal-literalnya, dan
`EXECUTE` hanya milik worker. Reklamasi malas (§5.1) bukan job ini: ia berjalan
di dalam transaksi klaim sebagai peran aplikasi.

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

**Dibangun (`sql/204`, Issue #940).** `block_id`, dan CHECK bahwa tepat satu dari `item_id` / `block_id` terisi; `starts_at` dan `ends_at` boleh NULL dan NULL pada baris blok; `block_released` adalah alasan rilis, hanya untuk baris blok. Guard insert alokasi punya bentuk blok: baris harus sama dengan resource, unit (bila disebut), dan tanggal blok-nya, dan blok harus aktif; status unit sengaja **tidak** diperiksa, sehingga unit yang dikembalikan beroperasi kelak tetap terblokir. Baris blok dilepas hanya dengan melepas blok-nya, dan trigger AFTER UPDATE pada blok melepas barisnya dalam statement yang sama, sehingga "blok dilepas <=> malamnya dilepas" adalah invarian database. Dua blok yang tumpang tindih pada satu unit bentrok seperti dua baris hidup mana pun pada unit itu (lepas atau persingkat yang pertama). Blok seluruh resource (tanpa `resource_unit_id`) mencakup setiap unit resource, **termasuk unit yang ditambahkan kemudian** (`sql/240`, Issue #1012, temuan N1): trigger AFTER INSERT pada `resource_units` menyisipkan baris blok untuk unit baru bagi setiap blok seluruh-resource yang aktif pada resource-nya, setelah mengambil baris resource `FOR NO KEY UPDATE`; layanan blok membaca daftar unit setelah mengambil baris yang sama `FOR SHARE`. Insert unit dan pemasangan blok karena itu diserialkan pada resource, dan di bawah READ COMMITTED statement sesudah kunci melihat commit pihak lain: siapa pun yang commit lebih dulu, tak ada unit yang tak tercakup (kedua urutan dan balapan diuji). Rekonsiliasi (`block_missing_allocation`) tetap sebagai pendeteksi setelah kejadian untuk tulisan yang melewati trigger. Blok dan barisnya memakai **satu** instant rilis (`sql/241`, temuan N4): trigger menyalin `released_at` blok ke barisnya. Batas instant pada `reservations` dan `reservation_items` adalah 368 hari (§2.1). Perubahan booking_mode di bawah alokasi atau blok hidup adalah `BOOKING_MODE_IN_USE` (perubahan zona waktu, `TIMEZONE_IN_USE`).

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
  butuh `reservations.create`. **Tidak dibangun oleh Issue #941** (tidak ada di
  daftar issue itu): bila dibangun, ia tidak membuat hold tetapi tetap harus
  mengambil kunci batas §13 sebelum menghitung.
- **Batas hold bawaannya 5 hold hidup per pelanggan dan 500 per tenant**
  (Issue #941; `NULL` di settings adalah bawaan modul, bukan tak terbatas). Hold
  tanpa referensi pelanggan hanya dibatasi batas tenant, dan konfirmasi
  `immediate` bukan hold. Angka dan trade-off-nya ada di §13.
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

**Dibangun di Issue #941.** Reservasi lama digantikan SEBELUM penggantinya ada
(alokasinya dilepas, lalu `rescheduled` menyebut id pengganti yang dibuat lebih
dulu), sehingga ia sudah keluar dari himpunan hidup indeks unik `external_ref`
ketika pengganti membawa referensi yang sama; `sql/208` karenanya menjadikan
foreign key `superseded_by_id` `DEFERRABLE INITIALLY DEFERRED` (tetap ditegakkan
saat commit). Pengganti lahir `confirmed` apa pun kata offering-nya, dengan
referensi pelanggan, rombongan, sumber, catatan, dan referensi eksternal lama,
dan mengumumkan dirinya dengan `created` dan `confirmed` (menyebut
`rescheduledFromId`); yang lama mengumumkan `rescheduled` (menyebut
`supersededById`). Mengulang reschedule yang sama terhadap reservasi yang sudah
`rescheduled` adalah replay; pemindahan lain adalah `INVALID_STATE`. Hanya
reservasi dengan satu item yang bisa dipindah (v1 mengklaim satu item per
reservasi).

## 6. Matriks izin dan RLS

Semua route adalah `defineTenantRoute`, mengotorisasi lewat
`authorizeInTransaction` (ADR-0063), dan default-deny. Migrasi men-seed katalog
dan **tidak** memberikan apa pun ke peran mana pun; tenant yang ada memakai
`bun run identity-access:permissions:backfill`. Kode izin adalah
`booking.<activity>.<action>` (module key `booking`, seperti `procurement.documents.read`).

| Izin                                                               | Mencakup                                                                         | Risiko                     |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------------- | -------------------------- |
| `resources.read` / `.create` / `.update` / `.delete` / `.restore`  | resource, unit, pool, dan keanggotaan pool (§3.0.2)                              |                            |
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
| `policy.read` / `policy.configure`                                 | pengaturan (hold, lead time, horizon, grace); `PUT` diaudit `critical`           | berdampak tinggi           |
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
`lineage_id` putus, dan reservasi tanpa event `created`. Untuk stay ia juga mendaftar alokasi stay hidup yang `[stay_from, stay_to)`-nya berbeda dari `[check_in_date, check_out_date)` item-nya, baris blok hidup yang bloknya sudah dilepas (`block_allocation_orphan`), blok aktif yang tidak memiliki tepat satu baris hidup per unit yang dicakupnya (`block_missing_allocation`, yang juga terpicu oleh unit yang ditambahkan ke resource sesudahnya), baris blok yang resource, unit, atau tanggalnya berbeda dari blok-nya (`block_allocation_mismatch`), dan alokasi yang granularitasnya berbeda dari `booking_mode` resource-nya. Ia tidak memperbaiki
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
`GET /booking/reports/utilization`. **Occupancy** (unit terpakai ÷ unit) adalah query langsung: per unit-malam untuk stay, `GET /booking/reports/occupancy`.
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

#### 7.2.1 Dibangun (Issue #944)

**Proyeksi.** `BOOKING_REPORTING_PROJECTIONS` (`domain/booking-reporting.ts`) menyerahkan tiga proyeksi pada tabel di atas ke engine `reporting` yang ada lewat `ModuleDescriptor.reportingProjections` (baca `booking.reports.read`). Tidak ada engine analitik kedua: worker inkremental yang sama (`reporting:projections:refresh`), rebuild terbatas yang sama, dan rekonsiliasi yang sama menjalankannya. Masing-masing membaca tabel append-only `awcms_booking_reservation_events` pada `created_at`.

**Pilihan sumber (trade-off).** Sumbernya tabel, bukan sembilan event domain yang live.

| Mendukung tabel                                                                                                                                              | Melawan                                                                           |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| Rebuild selalu re-scan tabel, sehingga keadaan tunak dan rebuild adalah scan YANG SAMA dan tak bisa berbeda; konsumer event butuh protokol penundaan rebuild | Di-poll, bukan di-push: segar dalam kebijakan freshness (5 menit), tidak seketika |
| Tabel benar-benar append-only (trigger + REVOKE), satu-satunya prasyarat `cursor_table`                                                                      | Butuh satu migrasi (`sql/244`) untuk menaruh kuantitas di baris                   |
| Ditulis dalam transaksi transisi itu sendiri; event baru terlihat setelah dispatcher outbox jalan, sehingga dispatcher yang berhenti menghentikan dashboard  |                                                                                   |

**Kuantitas (`sql/244`).** Hitungan baris tak bisa menjawab "berapa unit-malam". Empat kolom bigint non-negatif pada baris event (`booked_seconds`, `released_seconds`, `booked_nights`, `released_nights`) diisi trigger BEFORE INSERT dari baris alokasi reservasi itu sendiri: event `confirmed` MEMESAN, event `cancelled` / `rescheduled` yang `from_status`-nya `confirmed` MELEPAS, tak ada yang lain membawa kuantitas (hold yang kedaluwarsa tak pernah dipesan; `no_show` mempertahankan pesanannya sampai terpesan-versus-aktual diputuskan). Detik adalah interval LAYANAN, tak pernah buffer setup/cleanup. Malam adalah `stay_to - stay_from` per alokasi, dan satu alokasi adalah satu unit: stay dua malam pada satu unit adalah dua unit-malam, stay yang sama pada tiga unit adalah enam. `projection_kind` adalah kolom ter-generate tersimpan: `kind`, kecuali pembatalan yang dinilai terlambat terbaca `late_cancelled`, sehingga `late_cancelled` subset `cancelled` secara konstruksi. Engine mendapat satu field aturan opsional, `sumColumn` (menjumlah kolom alih-alih menghitung baris; `MODULE_CONTRACT_VERSION` 4.5.0); worker inkremental, rebuild, dan rekonsiliasi semuanya memakainya.

**Batas halaman.** Baris riwayat satu transaksi berbagi `created_at = now()`, dan engine melanjutkan pada `cursor + 1 ms`, sehingga halaman yang berakhir di antara baris `created` dan `held` satu reservasi kehilangan yang kedua. Engine kini tak pernah mengakhiri halaman di tengah satu milidetik: ia membaca satu baris pengintip dan, bila baris itu sebaya milidetiknya dengan baris terakhir halaman, membuang milidetik itu dari halaman (`trimIncompleteTail`, `reporting/domain/cursor-boundary.ts`). Sebuah tes gagal tanpanya.

**Laporan (langsung, berjendela, diotorisasi ulang).** `GET /booking/reports/occupancy`, `/utilization` dan `/reservations`, masing-masing `from` / `to` (tanggal lokal, setengah-terbuka, paling lama 92 hari) dan `resourceId` opsional, dijaga `booking.reports.read`, tak pernah di-cache. Aturannya (`domain/booking-report.ts`):

- **Jendela hari adalah Asia/Jakarta**, `[00:00, 00:00 berikutnya)`, diturunkan lewat aturan zona (masing-masing 24 jam: Jakarta tanpa daylight saving).
- **Occupancy** per unit-malam resource STAY: malam terpakai oleh reservasi `confirmed`, `checked_in`, atau `completed`. Reservasi `held` tak pernah occupancy: malam hidupnya adalah `heldUnitNights`, di samping rate. `no_show` mempertahankan alokasinya tetapi tidak terpakai. `blockedUnitNights` dilaporkan di samping rate (apakah pemeliharaan keluar dari penyebut masih terbuka di bawah O8). Unit adalah yang aktif saat ini.
- **Utilization** laporan tersendiri untuk resource SLOT: detik layanan terpesan bersih dipotong ke tiap hari Jakarta oleh database, dibagi detik terbuka jadwal (`expandOpenWindows`, fungsi yang dipakai availability) dikali unit aktif, dipotong dengan cara sama. Hari tutup tidak punya rasio, bukan nol.
- Laporan **reservations**: PIPELINE hold (dipasang, dikonversi, kedaluwarsa, dibatalkan saat held dalam jendela; hold dan unit terbuka kini), LEAD TIME reservasi yang dikonfirmasi dalam jendela (bucket, rata-rata), dan hasil PEMBATALAN / PEMBATALAN TERLAMBAT / NO-SHOW dari kohort konfirmasi itu. Reservasi yang di-reschedule dikeluarkan dari kohort (penggantinya punya kohort sendiri). Penyebut no-show adalah kedatangan yang sudah terselesaikan (`no_show` + `checked_in` + `completed`).
- **Rasio atas kelompok kecil ditahan.** Rasio atau rata-rata atas kurang dari 5 reservasi adalah `{ suppressed: true, value: null }`. Hitungan (termasuk hitungan bucket lead time) adalah angka operasional tenant sendiri dan tidak dianonimkan: pembaca sudah memegang `booking.reports.read` atas data tenantnya.
- **Tanpa pendapatan.** Booking tidak memegang harga; tak ada yang menghitungnya di sini (pendapatan mengikuti buku besar commerce). Referensi pelanggan, catatan, alasan, atau aktor tak dibaca proyeksi maupun laporan.

Malam dan detik terpesan bersih langsung sama dengan `booked - released` proyeksi bila jendela mencakup setiap reservasi (tes integrasi mengunci ini).

### 7.3 Laporan konflik jadwal

`GET /booking/schedules/{id}/conflicts?candidate=…` mendaftar reservasi
terkonfirmasi yang jatuh di luar jadwal yang diusulkan (atau di dalam penutupan
yang diusulkan) tanpa mengubah apa pun. Hal yang sama berlaku untuk perubahan
ketersediaan staf yang dilaporkan kapabilitas tenaga kerja.

### 7.4 Event (live sejak Issue #941)

Konvensi (seperti `awcms.procurement.document.finalised`): channel
`awcms.<modul>.<entitas>.<kata-kerja>`, satu envelope `DomainEvent` bersama,
diterbitkan lewat outbox domain-event **dalam transaksi yang sama** dengan
transisi; panggilan yang ditolak atau di-replay tidak menerbitkan apa pun.
Singkatan di issue `booking.reservation.*` karenanya muncul di kawat dengan
prefiks `awcms.`. Kesembilan channel ada di
`asyncapi/awcms-domain-events.asyncapi.yaml`, tipenya di
`DOMAIN_EVENT_TYPE_REGISTRY` dan di `events.publishes` modul, semuanya versi
`1.0`.

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

**Siapa menerbitkan apa.** Reservasi baru: `created`, lalu `held` (hold) atau
`confirmed` (offering `immediate`). Pengganti reschedule: yang lama
`rescheduled`, yang baru `created` lalu `confirmed`. `expired` diterbitkan oleh
KEDUA cara hold berakhir: reklamasi malas, dalam transaksi klaim, dan sapuan
`booking:holds:expire`, dalam transaksi tenant-nya sendiri sebagai
`awcms_worker`. Worker boleh memakai outbox tetapi tak boleh membaca tabel
booking, sehingga fungsi SECURITY DEFINER sapuan kini mengembalikan fakta
non-pribadi dari yang dikedaluwarsakannya (`sql/209`); fakta setiap event berasal
dari satu fungsi, `awcms_booking_reservation_event_facts`, sehingga transisi
request, reklamasi malas, dan sapuan tak bisa membawa field berbeda. Kode alasan
pembatalan ada di baris riwayat append-only dan **tidak** ada di event.

Payload: `reservationId`, `reservationNo`, `lineageId`, `status`,
`previousStatus`, `startsAt`/`endsAt` (RFC 3339 UTC), `resourceIds`,
`offeringIds`, `partySize`, `externalRefType`/`externalRef` (pasangan buram
milik adapter sendiri), `occurredAt`, `correlationId`; `lateCancellation` pada
`cancelled`, `supersededById` pada `rescheduled`, `rescheduledFromId` pada event
pengganti; untuk reservasi dengan item stay juga `stays` (`resourceId`, `checkInDate`, `checkOutDate`, `nights`, `timezone`; aditif, tidak ada bila bukan, tanpa event baru, §3.1). **Tak pernah** nama,
kontak, catatan, atau teks alasan pelanggan. Konsumen menghilangkan duplikat
pada event id envelope; pengiriman at-least-once.

### 7.5 Pengingat dan konfirmasi (Issue #943)

Booking memiliki **utang**-nya ("sebuah konfirmasi atau pengingat harus dikirim
untuk reservasi ini"); `whatsapp_delivery` memiliki **pesan**-nya (consent,
templating, provider, antrean;
[ADR-0133](../adr/0133-generic-delivery-capability-whatsapp-promotion.md)
bagian 3 dan 8). Tidak ada antrean, outbox, atau panggilan provider milik booking.

**Alur.** Tidak ada yang berubah di jalur transaksi reservasi: mengonfirmasi atau
membatalkan booking tidak menulis apa pun soal pengingat, sehingga kapabilitas
delivery yang lambat atau rusak tidak pernah memperlambat atau menggagalkan
booking. Job terjadwal `booking:reminders:dispatch` (tiap menit, `awcms_worker`,
per tenant) menjalankan satu pass terbatas per tenant, berurutan:

1. **Sapuan basi.** Intent `pending` yang reservasinya tak lagi confirmed
   di-settle `cancelled` (atau `expired` bila reservasi sudah dimulai). Pada intent
   `enqueued` yang reservasinya dibatalkan, kedaluwarsa, dijadwal ulang, atau
   ditandai no-show, pesan yang masih mengantre dibatalkan lewat
   `WhatsappDeliveryPort.cancelByCorrelation` (no-op bila pesan sudah keluar dari
   antrean, sesuai janji port).
2. **Materialisasi.** Intent dibuat untuk reservasi **confirmed**, sekali per
   `(reservasi, kind, occurrence)` (unique key, `ON CONFLICT DO NOTHING`):
   `confirmation` (occurrence 0) untuk reservasi yang dikonfirmasi dalam 6 jam
   terakhir (menyalakan fitur tidak membanjiri katalog lama), dan `reminder`
   (occurrence 1) begitu jendela lead 24 jam terbuka dan sebelum reservasi mulai.
   Walk-in (tanpa `external_customer_ref`) dan booking yang dikonfirmasi _di dalam_
   jendela lead dibuat langsung ter-settle `skipped` (`no_customer_ref`,
   `booked_inside_lead`): konfirmasi sudah menjadi pemberitahuannya.
3. **Dispatch.** Tiap intent yang jatuh tempo di-resolve ke penerima lalu
   diserahkan ke port; jawabannya men-settle intent (di bawah).

**Idempoten per (reservasi, kind, occurrence), tiga lapis**: unique key
`awcms_booking_reminder_intents` (`sql/284`); sebuah intent meninggalkan `pending`
tepat sekali dan hanya intent `pending` yang sampai ke port (`FOR UPDATE SKIP
LOCKED`); serta unique key `(tenant, idempotency_key)` milik modul delivery,
dengan kunci `booking:{reservationId}:{kind}:{occurrence}` (sekaligus correlation
id). Crash antara enqueue dan settle di-replay sebagai `duplicate` dan men-settle
`enqueued` dengan id pesan asli; dua worker, atau job yang diulang, hanya
mengantrekan satu pesan. (Idempotency key
[ADR-0145](../adr/0145-idempotency-keys-are-scoped-per-actor-and-the-request-hash-is-keyed.md)
bersifat per aktor dan milik route request; job ini tidak punya aktor maupun
route, jadi kunci alami di atas adalah mekanismenya.)

**Reservasi yang dibatalkan tidak mengeluarkan apa pun, dan tidak ada yang
dikirim terlambat.** Pembacaan dispatch hanya mengembalikan reservasi selama
`confirmed` dan menahan share lock sampai transaksi selesai (`FOR SHARE ... SKIP
LOCKED`): pembatalan terjadi sebelumnya (tidak ada yang diantrekan) atau menunggu
sampai pass selesai. Pesan yang diantrekan pass sebelumnya dibatalkan sapuan basi
lewat `cancelByCorrelation`, yang hanya menyentuh pesan `queued` dan
`retry_wait`. Pesan yang sedang di-lease (`sending`) pada saat itu tidak dapat
dibatalkan, dan timeout provider akan memindahkannya ke `retry_wait` lalu
mengirimnya ulang setelah backoff. Karena itu sapuan menandai intent
terekonsiliasi **hanya bila setiap pesan di bawah kuncinya sudah terminal**
(`sent`, `failed`, `cancelled`, `expired`); bila belum, intent dibiarkan dan
diperiksa lagi pada pass berikutnya sampai pesan dibatalkan atau terminal. Sebagai
lapisan kedua, setiap pesan diantrekan dengan kedaluwarsa: waktu mulai reservasi
untuk pengingat, yang lebih awal antara waktu mulai dan jendela kesegaran 6 jam
untuk konfirmasi, sehingga gangguan delivery pun tidak dapat mengirim keduanya
setelah booking dimulai. Sapuan juga memeriksa kembali intent enqueued yang
reservasinya sudah dimulai. Intent pending yang reservasinya sudah dimulai atau
selesai (confirmed, checked in, completed) di-settle `expired`; yang reservasinya
dibatalkan atau dipindah di-settle `cancelled`. Jendela sisa adalah satu interval
job (semenit) antara pembatalan dan pembatalan pesan yang masih mengantre.

**Kerja dan waktu lock yang dibatasi.** Sapuan dan langkah materialisasi
menangani 100 intent per pass, dan job mengulang pass satu tenant sampai habis
(kerja sapuan dihitung sebagai kemajuan), paling lama 45 detik per run, sehingga
pembatalan massal ratusan reservasi selesai dalam satu run. Langkah dispatch
menahan share lock pada setiap reservasi yang dibacanya sampai pass commit, dan
lock itu memblokir pembatalan atau konfirmasi pelanggan; maka ia membaca paling
banyak 25 intent, berhenti mengambil yang baru setelah 5 detik (sisanya tetap
pending, lock dilepas saat commit), dan berjalan dengan `lock_timeout` 2 dtk dan
`statement_timeout` 10 dtk, sehingga lock atau query yang macet menggagalkan pass
alih-alih menahan lock itu. Kegagalan resolver atau enqueue dicatat sebagai
`booking.reminder.dispatch_failed` dengan id intent, kelas error, dan kode, tidak
pernah teks pesan atau kontak apa pun.

**Tidak ada kontak di booking.** Pelanggan tetap hanya `external_customer_ref`
yang opak (commerce otoritasnya, O12). Deployment menyediakan
`BookingReminderRecipientPort` (`_shared/ports/`) yang mengubah referensi menjadi
`WhatsappRecipient` di dalam transaksi job (hanya baca database, tanpa jaringan);
kontak dipakai untuk satu `enqueue` dan tidak pernah disimpan, di-log, atau
dimasukkan ke event. **Tidak ada implementasi di repo ini, sehingga job inert**
(tidak membuat dan tidak mengirim apa pun) sampai deployment mendaftarkannya
dengan `registerBookingReminderRecipients` dari entry point job-nya sendiri. Hanya
dua variabel template yang keluar dari skema booking: nomor reservasi dan waktu
mulai lokal (template `booking.confirmation` dan `booking.reminder`, keduanya
`transactional`, redaksi bahasa Inggris).

**Settlement.** `queued`/`duplicate` menjadi `enqueued`; `suppressed` (opt-out,
hard failure) menjadi `suppressed`; penolakan berupa vonis (`CONSENT_REQUIRED`,
`TEMPLATE_UNKNOWN`, `RECIPIENT_INVALID`, ...) menjadi `refused`; resolver yang tak
bisa menjangkau pelanggan menjadi `skipped` (`recipient_unresolved`). `DISABLED`,
`MISCONFIGURED`, dan `RATE_LIMITED` adalah sifat deployment, bukan pesan: intent
tetap `pending`, pass untuk tenant itu berhenti, dan dicoba lagi menit berikutnya
(rate limit ditinggalkan setelah 30 percobaan). Resolver atau enqueue yang
melempar error hanya menghabiskan satu percobaan intent itu (savepoint per
intent) dan tidak menghentikan yang lain. Consent sepenuhnya milik modul
delivery: pesan `transactional` tidak butuh opt-in marketing dan tetap terkirim
setelah penarikan consent marketing; opt-out menghentikannya; keduanya tidak
menyentuh reservasi.

**Hak akses.** Worker tidak punya hak apa pun atas tabel reservasi. Ia membaca
lewat tiga fungsi `SECURITY DEFINER` yang sempit (`sql/285`, pola `sql/200`, owner
`awcms_booking_reminders`, argumen tenant harus sama dengan tenant sesi, `EXECUTE`
hanya untuk `awcms_worker`) dan men-settle intent dengan `UPDATE` pada
`awcms_booking_reminder_intents` saja. Role runtime hanya boleh membaca; tidak ada
baris yang pernah dihapus (trigger dan hak yang dicabut).

**Operasi.** Pass hanya menyentuh database, sehingga aman di profil offline/LAN.
WhatsApp sendiri mati kecuali `WHATSAPP_ENABLED=true`; `whatsapp:dispatch`
mendaftarkan template booking di prosesnya sendiri (sudah), atau pesan yang
mengantre gagal terminal sebagai `template_unknown`.

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
   perilaku yang dibuktikan T3, dan Issue #939 mengamatinya: INSERT kedua
   terblokir pada baris pertama yang belum commit, lalu diserap bila yang
   pertama commit atau mengambil unit bila ia rollback. `23P01` yang tetap lolos
   dipetakan ke `SLOT_UNAVAILABLE`.) Rombongan atau requirement
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
7. **Stay dan blok** (ADR-0135). Alokasi stay adalah satu baris per unit di bawah constraint kedua §4 (`daterange(stay_from, stay_to, '[)')` per unit, hanya baris hidup). Alokator, urutan kunci, penyerapan `ON CONFLICT DO NOTHING`, reklamasi malas, dan retry deadlock terbatas dari aturan 1–6 berlaku tanpa perubahan. **Blok** adalah baris alokasi dengan `block_id` terisi dan tanpa `item_id`, sehingga blok dan stay berebut satu constraint: siapa yang commit lebih dulu menang dan yang lain menerima `23P01`, dipetakan ke `SLOT_UNAVAILABLE` untuk booking dan `BLOCK_CONFLICT` untuk blok. Blok atas beberapa unit menyisipkan barisnya dalam urutan global aturan 3, semua-atau-tidak-sama-sekali. Membuat blok tak pernah membatalkan reservasi. Trigger menolak alokasi yang granularitasnya berbeda dari `booking_mode` resource-nya, sehingga constraint waktu dan stay tak pernah berlaku bersama pada satu unit. Dua blok yang tumpang tindih bentrok satu sama lain dengan cara yang sama (keduanya baris di bawah constraint yang sama), dan blok atas beberapa unit mencakup unit nonaktif juga, sehingga unit yang diaktifkan kembali kelak tetap terblokir. Blok seluruh resource juga mencakup unit yang **ditambahkan** kemudian (`sql/240`, §4). Reklamasi malas sebelum blok hanya mengedaluwarsakan hold yang sudah lewat pada unit yang dicakup blok: blok satu unit mereklamasi hold unit itu dan membiarkan hold unit lain untuk sapuannya sendiri (Issue #1012, temuan N3); baris audit mengatakannya.

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

**Status (§13).** T1 ada di `booking-database.integration.test.ts` (#937). T2, T3 (beserta interleaving `DO NOTHING` yang menjadi dasarnya), T6 (a) dan balapan reaper pada (b), serta T7 ada di `booking-concurrency.integration.test.ts` (#939), dijalankan lewat `placeHold` pada transaksi konkuren sungguhan. Issue #941 menambah `booking-reservation.integration.test.ts` (lapisan aplikasi pada transaksi sungguhan: T5 (a), (b), dan (c), separuh confirm-melawan-sapuan dari T6 (b), batas bawaan yang berebut, `expired` diterbitkan kedua cara, tak ada data pribadi di event atau baris audit, `BookingPort`) dan `booking-reservation-api.integration.test.ts` (handler route sungguhan: T4 dengan lima request paralel pada satu key, matriks akses §6 dua arah, override dua arah, not-found netral, penolakan field pembayaran). T2 dan T10 tetap memakai `placeHold` langsung: route menambah otorisasi dan penyimpanan idempotensi di depan klaim yang sama dan tidak mengubah apa yang diperebutkan 20 pesaing itu. T9 sampai T13 ada di `booking-stay.integration.test.ts` (#940), dijalankan lewat `placeHold` dan `createBlock` dan bukan lewat `POST /booking/reservations` serta API blok yang baru dibangun di #941 dan #942; mereka pindah ke belakang route itu kelak. T8 butuh `staff_assignments`.

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

**Yang diandalkan batas hold.** Batas per pelanggan menghitung hold menurut
`external_customer_ref`, yang disuplai adapter atau BFF dan tak dapat diverifikasi
modul: hold tanpa referensi (atau dengan referensi baru tiap hold) tidak
dihitung terhadap pelanggan mana pun. Hanya batas **per tenant** yang menjadi
batas keras; batas per pelanggan adalah kontrol keadilan yang sebaik autentikasi
pelanggan oleh pemanggilnya (kanal publik hilir mengautentikasi pelanggannya dan
membatasi laju di tepi).

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
penolakan sebagai nilai; ia melempar hanya untuk cacat. **Dibangun di Issue
#941** bersama adapter-nya `application/booking-port-adapter.ts`. Signature yang
dibangun berbeda dari sketsa di bawah dalam empat hal: setiap metode menerima
transaksi pemanggil lebih dulu (`tx`) dan input membawa `tenantId`; `quote`
menanyakan satu `resourceId` (pool hanya target `hold`); gabungan penolakan
dilengkapi dengan yang bisa diucapkan klaim (`RESERVATION_NOT_FOUND`,
`QUANTITY_EXCEEDS_UNITS`, `BOOKING_MODE_MISMATCH`, `EXTERNAL_REF_IN_USE`,
`CONTENTION_RETRY`, penolakan stay, `VALIDATION_ERROR`); dan port **tidak punya
override** (mengangkat kebijakan adalah tindakan manusia di balik izin berisiko
tinggi). Idempotensi berdasarkan key pada penyimpanan yang sama dengan route di
bawah scope-nya sendiri; hanya sukses yang disimpan. Sketsa:

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

**Kontrak port 1.1.0 (Issue #1108).** Kapabilitas `booking` diberi versi di
`src/modules/_shared/capability-contract-versions.ts` (entri pertama: `1.0.0`
adalah port di atas, `1.1.0` menambahkan yang berikut; tidak ada signature yang
berubah). Consumer yang dibangun di atas port (kebijakan pembatalan, reschedule,
check-in/out POS, dan halaman storefront milik adapter commerce) membutuhkan lebih
dari lima verba:

| Method                                                      | Fungsi                                                                                                                                                                                                       |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `checkIn(tx, Targeted)`                                     | `confirmed -> checked_in`. Stay ditolak sebelum TANGGAL check-in-nya (`CHECK_IN_TOO_EARLY`); tidak ada pemeriksaan jam.                                                                                      |
| `checkOut(tx, Targeted)`                                    | `checked_in -> completed` (`complete` milik modul).                                                                                                                                                          |
| `markNoShow(tx, Targeted)`                                  | `confirmed -> no_show` setelah waktu mulai ditambah grace tenant (`NO_SHOW_TOO_EARLY` sebelumnya). Route membatasinya untuk staf; port tidak mengotorisasi apa pun, sehingga pemeriksaan itu milik CONSUMER. |
| `get(tx, {tenantId, reservationId \| reservationNo})`       | `status`, `startsAt`, `endsAt`, `reservationNo`, `holdExpiresAt`, `lineageId`, `supersededById`, `stays[]`, `externalRef`. **Tanpa** referensi pelanggan, ukuran rombongan, catatan, atau aktor.             |
| `getOffering(tx, {tenantId, offeringId})`                   | Satu offering aktif: `granularity`, `confirmationMode`, `status`, rentang rombongan, `durationSeconds` atau batas malam.                                                                                     |
| `listOfferings(tx, {tenantId, cursor?, limit?})`            | Offering aktif, terbaru dulu, dipaging keyset (limit 1..100, default 50, `status` opsional); `nextCursor: null` berarti akhir. Menggantikan `SELECT` read-only langsung consumer ke tabel booking.           |
| `availability(tx, {tenantId, offeringId, resourceId, ...})` | Pembacaan aman-anonim untuk halaman booking publik: slot (`from`/`to`, paling lama 31 hari, paling banyak 500 slot) atau `{nights, freeUnits, available}` untuk stay. Tanpa aktor, tanpa tulis.              |

Ketiga transisi memiliki kontrak persis seperti `confirm`: aktor, `idempotencyKey`
yang di-namespace per aktor (ADR-0145), reservasi `Targeted`, `transition()` yang
**sama** dengan route HTTP (jadi baris riwayat, baris audit, dan event
`awcms.booking.reservation.*` yang sama), dan penolakan dikembalikan sebagai
`{ ok: false, reason }`. Tiap verba punya scope idempotensinya sendiri
(`booking_port_check_in`, `booking_port_check_out`, `booking_port_no_show`),
sehingga satu key yang dipakai untuk dua verba pada satu reservasi bukan replay.
Union penolakan bertambah `CHECK_IN_TOO_EARLY` dan `NO_SHOW_TOO_EARLY` (adapter
dulu melipat keduanya menjadi `INVALID_STATE`; POS perlu membedakan "state salah"
dari "kembali nanti").

Pembacaan tidak menulis apa pun dan tidak memakai key. Tidak ditemukan adalah NILAI
(`RESERVATION_NOT_FOUND`, `OFFERING_NOT_FOUND`) dan jawabannya sama untuk id yang
tak dikenal dan id milik tenant lain; key atau cursor yang cacat adalah
`VALIDATION_ERROR`. `get` memilih daftar kolom eksplisit
(`application/booking-port-reads.ts`) yang tidak pernah menyebut
`external_customer_ref`, sehingga token pelanggan opak tidak terbaca lewat port,
bahkan oleh consumer yang menaruh hold (ia sudah memilikinya). Instant pada `get`
dirender database dengan mikrodetik (`...00.000000Z`), seperti semua bacaan booking
lain; slot availability memakai bentuk milidetik `toISOString()`. Keduanya RFC 3339
UTC.

**Pembacaan availability anonim.** Port berjalan di dalam transaksi tenant
pemanggil, sehingga polanya sama dengan setiap pembacaan publik di repositori ini:
route publik menyelesaikan tenant dari host, menjalankan `withTenant(tenantId)`
(RLS FORCE lalu membatasi setiap baris; tiap query juga menyebut `tenant_id`), dan
memanggil `availability` tanpa aktor dan tanpa principal. Pemanggil yang menyebut
tenant lain daripada transaksinya tidak membaca apa pun (jawaban netral "tidak ada ketersediaan").
Jawabannya berisi slot (mulai, selesai, unit bebas) atau hitungan stay, tidak
pernah nama resource atau label unit, reservasi, staf yang melayani slot,
kebijakan tenant, atau apakah suatu malam diblokir dan bukan dipesan (keduanya
`SLOT_UNAVAILABLE`). Stay yang tidak tersedia adalah SATU jawaban apa pun
sebabnya (dipesan, diblokir, minimum atau maksimum menginap, lead time, horizon,
jadwal): `available: false`, `freeUnits: 0`, `nights: null`,
`reason: SLOT_UNAVAILABLE`, tidak pernah `MIN_STAY_VIOLATION`,
`MAX_STAY_EXCEEDED`, `LEAD_TIME_VIOLATION`, `HORIZON_EXCEEDED` atau
`OUTSIDE_SCHEDULE`. Kuantitas di atas jumlah unit resource dan `resourceId`
yang tidak dikenal adalah jawaban "tidak ada ketersediaan" yang sama dengan
jendela yang penuh dipesan (`slots` kosong, atau jawaban stay di atas), sehingga
jumlah total unit tidak bisa ditebak dengan pencarian biner. Setiap jawaban tanpa
kapasitas bebas membawa `timezone: "UTC"` tetap; jawaban dengan kapasitas bebas
membawa zona resource itu sendiri. Hanya offering, mode booking, dan tanggal
yang salah bentuk yang tetap menjadi penolakan bernama, dan `tenantId` yang salah
bentuk (pada `get`, `getOffering`, `listOfferings` dan `availability`) adalah
`VALIDATION_ERROR`. Ia menanyakan satu `resourceId` karena offering tidak
menetapkan resource (skema tidak punya tautan offering-ke-resource); halaman sudah
tahu mana yang dijualnya. **Perubahan ini tidak menambah route HTTP:** route
anonim, rate limit-nya (`GET /availability` terautentikasi 120 per menit per
principal; yang publik dikunci pada alamat klien) dan cache CDN-nya milik
consumer, pemilik halamannya. Port membatasi sendiri pekerjaannya (jendela 31
hari, 500 slot, `maxCandidates`). **Route consumer yang mengekspos
`availability` WAJIB membatasi rate dan membatasi cache-nya:** port tidak
menerima aktor dan tidak melakukan pemeriksaan ABAC, memang disengaja (itulah
yang membuatnya anonim), sehingga route adalah satu-satunya penahan terhadap
scraping okupansi. Dan `get` berdasarkan `reservationNo` adalah pencarian tanpa
autentikasi dengan nomor yang bentuknya mudah ditebak: consumer tidak boleh
mengeksposnya ke publik berdasarkan nomor (otorisasi aktor dulu, atau cari lewat
`reservationId` yang tak tertebak yang sudah dipegang consumer).

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
closed): `STAFF_UNAVAILABLE`. `staffRef` buram bagi booking dan hanya diselesaikan oleh port.

**Seperti yang dibangun (Issue #949, `sql/305`).** Port dikonsumsi sebagai
kapabilitas opsional `staff_availability` yang disediakan `hr_workforce` (soft
edge di deskriptor modul, bukan entri `dependencies`; DAG tidak punya siklus).
Adapter diimpor secara lazy hanya di `booking/module.ts`
(`loadStaffAvailabilityPort`, ADR-0011); `application/**` hanya melihat tipe port
dari `_shared/ports` dan sebuah `StaffAvailabilityConsumer`.

- **Kapan resource "membutuhkan staf".** `awcms_booking_resources.required_staff_refs`
  (text[], maksimal 50) menamai referensi buram orang yang dapat melayaninya.
  Kosong (default) berarti resource tidak butuh siapa pun dan tak ada kueri staf
  yang berjalan. Belum ada route atau layar admin untuk kolom ini (tindak lanjut);
  saat ini ditulis lewat migrasi atau operator.
- **Hidup atau mati.** `resolveStaffAvailability(tx, tenantId, loadPort)` memutuskan
  sekali per request: `hr_workforce` aktif untuk tenant DAN adapter dapat dimuat,
  jika tidak `NO_OP_STAFF_AVAILABILITY`: **tanpa batasan staf sama sekali** (baris
  staf pun tidak ditulis), booking seperti sebelum perubahan ini. Loader yang
  melempar error turun ke no-op yang sama. Begitu batasan hidup ia fail closed:
  resource yang semua orangnya `unknown` bagi port (atau cuti, atau di luar
  shift) tidak dapat dibooking, dan galat port adalah 500, bukan dilewati diam-diam.
- **Baca.** `GET /availability` menawarkan slot hanya jika ada orang bernama yang
  bekerja selama seluruh interval layanan (satu interval kerja yang digabung) dan
  belum melayani klaim hidup; jawaban slot membawa `staffAvailability: "checked" |
"unchecked"`.
- **Klaim.** Setelah `claimUnits`, di savepoint yang sama, orang yang layak menurut
  port dicoba berurutan dengan `INSERT ... ON CONFLICT DO NOTHING` ke
  `awcms_booking_staff_assignments`, yang satu exclusion constraint-nya pada
  `(tenant_id, staff_ref, rentang terpakai)` menolak dua penugasan hidup yang
  tumpang tindih untuk satu orang (di antara penugasan yang tercatat; lihat celah
  aktifkan-belakangan di bawah). Tak ada orang bebas melempar error di dalam savepoint,
  yang membatalkan unit, item, dan reservasi: **`SLOT_UNAVAILABLE`, tidak ada
  alokasi parsial**. Satu orang melayani seluruh klaim satu resource berapa pun
  kuantitasnya; interval staf adalah interval layanan, bukan rentang yang diperlebar
  setup/cleanup. Stay tidak membawa staf.
- **Pelepasan.** Trigger pada `awcms_booking_resource_allocations` melepas
  penugasan, dengan alasan yang sama, ketika alokasi hidup terakhir dari (item,
  resource) dilepas, sehingga cancel, kedaluwarsa (lazy dan sweep worker), dan
  reschedule tidak butuh kode staf.
- **Adapter `BookingPort` sadar-staf.** `PlaceHoldContext.staff` wajib (tanpa
  default, jadi "tanpa batasan" harus dieja `NO_OP_STAFF_AVAILABILITY`).
  `createBookingPort(resolveStaff)` menerima resolver; `createComposedBookingPort()`
  di `booking/module.ts` adalah instans yang dirakit (loader disuntikkan,
  `application/**` tidak pernah mengimpor `hr_workforce`). Transisi (confirm,
  cancel) tidak mengklaim apa pun dan sengaja meneruskan no-op.
- **Okupansi tidak bergantung pada reaper.** Pembacaan sibuk mengabaikan penugasan
  yang reservasinya adalah hold kedaluwarsa, dan klaim mereklamasi hold
  kedaluwarsa berdasarkan referensi staf (`reclaimExpiredHoldsForStaff`) sebelum
  berebut orang, sehingga hold yang belum disapu pada satu resource tidak
  menghalangi orang yang sama di resource lain.
- **Celah aktifkan-belakangan (panduan operator).** Baris staf hanya ditulis saat
  `hr_workforce` aktif untuk tenant. Reservasi yang dibuat saat modul MATI tidak
  punya penugasan staf, sehingga setelah diaktifkan orang itu **tidak terlindungi
  terhadapnya**: klaim baru dapat tumpang tindih dengan reservasi lama yang tak
  tercatat milik siapa pun. Sebelum mengaktifkan untuk tenant yang menamai staf
  pada resource, aktifkan modul sebelum menerima booking pada resource itu, atau
  tinjau reservasi mendatang pada resource tersebut dan pindahkan/tugaskan ulang
  yang tumpang tindih dengan orang berjadwal. Tidak ada backfill: booking tak
  pernah tahu siapa yang melayani reservasi yang tak tercatat.
- **Belum tercakup.** Shift yang diubah setelah klaim dimunculkan laporan §7.3,
  tidak diterapkan; `service_requirements.staff_role` masih desain.

Tes: `tests/booking-staff-availability.test.ts` (aturan murni, batas komposisi) dan
`tests/integration/booking-staff-availability.integration.test.ts` (dengan dan tanpa
modul, fail closed, konflik yang tak meninggalkan apa pun, dua belas klaim paralel
untuk satu orang, pelepasan mengikuti alokasi).

### 10.4 Registrasi modul (desain)

`type: "domain"`; `dependencies`: hanya tenant-admin / identity-access;
`capabilities.consumes`: ketersediaan tenaga kerja (opsional) (tanpa `profile_identity`: commerce adalah otoritas pelanggan, O12), `reporting` (proyeksi),
`domain_event_runtime` (outbox); status `experimental` sampai layar admin
pertamanya (registry navigasi mensyaratkan halaman nyata); `active` sejak Issue #942. Kelas kompatibilitas:
offline-lan-safe.

## 11. Pertanyaan terbuka (keputusan pemilik — dicatat, TIDAK diputuskan di sini)

Dipetakan ke tracker hilir
[`aw-business-platform-dor.md`](https://github.com/ahliweb/awcms-one/blob/main/docs/aw-business-platform-dor.md).
ADR-0040 hanya menetapkan penempatan. Pemilik menjawab O1–O12 pada 2026-10-10 (tercatat di hilir pada DoR awcms-one); baris di bawah menyatakan jawaban mana yang tercatat di sini (**Terjawab**) dan mana yang masih terbuka di sini (O1, O3, O5, dan O9 dijawab di hilir pada hari yang sama tetapi tidak mengubah apa pun di paket ini dan belum direkonsiliasi ke dalamnya; O2 ditangani Issue #931). "Memblokir"
menyatakan apa di paket ini yang tak bisa difinalkan sampai jawabannya dicatat.

| #       | Pertanyaan                                                                                                                                    | Yang diasumsikan paket ini sementara                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Memblokir                                                                        |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| **O1**  | Persona dalam cakupan                                                                                                                         | Daftar provisional di §1 (resepsionis, manajer, pemilik resource, adapter, auditor)                                                                                                                                                                                                                                                                                                                                                                                                                  | Bundel peran §6 dan seed grant; UAT                                              |
| **O2**  | Vertikal mana yang pertama (hotel/vila, salon, klinik, rental, fasilitas, bengkel, pelatihan), dan apakah konsumen membangun lokal lebih dulu | **Terjawab 2026-10-10 (DoR awcms-one):** vertikal pertama hotel / vila / rental; tak ada repositori konsumen yang ada. Pemilik menyelesaikan konflik dengan asumsi paket ini sebelumnya dengan meminta perubahan cakupan di upstream: **menginap berbasis hari masuk v1** (ADR-0135, §2.5, §3.1). Tetap generik: tanpa field vertikal. Rekurensi `MONTHLY` tetap di luar v1 (tidak diminta). Kebijakan catatan kesehatan tetap defaultnya (mati untuk tenant yang menyatakan vertikal kesehatan, §9) | Layar admin pertama (skema sudah final sejak `sql/204`); sub-pertanyaan di bawah |
| **O3**  | MoSCoW lintas CRM, Booking, Workforce, Payroll, Notification, Analytics                                                                       | Booking Wave A/B; job no-show otomatis dan waitlist tetap _Could_                                                                                                                                                                                                                                                                                                                                                                                                                                    | Hanya urutan; tanpa skema                                                        |
| **O5**  | Peran hukum operator (pengendali/prosesor/keduanya)                                                                                           | Tak satu pun ditegaskan; desain netral (§9)                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Teks analisis privasi, bukan skema                                               |
| **O8**  | Occupancy vs utilization, **apakah hold dihitung**, waktu terpesan vs aktual, aturan penyebut                                                 | **Terjawab 2026-10-10 (DoR awcms-one):** occupancy tidak menghitung hold (hold adalah angka pipeline terpisah); utilization metrik terpisah; jendela retensi pelanggan 90 hari (KPI lintas-domain, bukan periode retensi data); net revenue angka utama (§7.2). **Masih terbuka:** apakah penyebut mengecualikan penutupan pemeliharaan; waktu terpesan vs aktual                                                                                                                                    | Hanya _definisi_ yang tersisa; tanpa tabel                                       |
| **O9**  | Non-tujuan eksplisit                                                                                                                          | Daftar §1                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Redaksi cakupan                                                                  |
| **O12** | Identitas pelanggan: commerce tetap otoritas pelanggan, atau harmonisasi `profile_identity`                                                   | **Terjawab 2026-10-10 (DoR awcms-one): commerce tetap otoritas pelanggan.** `reservations` v1 hanya membawa `external_customer_ref` yang buram dan nullable (null = walk-in); tanpa `customer_profile_id`, tanpa dependensi `profile_identity`. Harmonisasi, bila pernah diinginkan, adalah kolom tambahan di bawah ADR sendiri                                                                                                                                                                      | Tidak ada: kolom pelanggan dan jalur penghapusan (§4) sudah tetap untuk migrasi  |

**Sub-pertanyaan terbuka yang diangkat desain stay** (belum dijawab pemilik; dicatat, tidak diputuskan; diusulkan untuk tracker hilir):

- **O2a — arti "rental".** Hotel dan vila bersifat per malam. Rental bisa per hari (dicakup resource `stay`, pengambilan = check-in, pengembalian = check-out) atau per jam (dicakup resource `slot`). Keduanya didukung; konfirmasikan mana yang dibutuhkan konsumen rental pertama, dan apakah jam pengambilan/pengembalian berbeda dari default penginapan.
- **O2b — entitas `property`.** v1 mengambil zona waktu dan jam check-in / check-out dari setiap resource (dan default tenant). Apakah beberapa tipe kamar satu properti harus berbagi semuanya lewat entitas `property` (dan apakah pool harus membawanya) belum diputuskan.
- **O2c — default jam check-in / check-out.** Modul tidak menetapkan apa pun; pemilik atau konsumen pertama menetapkan default tenant.
- **O2d — mengubah stay di tempat.** Memperpanjang atau memperpendek stay yang `checked_in` (kepergian lebih awal melepas malam tak terpakai, perpanjangan mengambil malam berikutnya bila bebas) tidak dispesifikasikan; v1 hanya mendukung reschedule sebelum check-in (§3.1).
- **O2e — pindah kamar di dalam stay** dan best-fit packing stay lintas unit (jawaban "penuh" yang sebenarnya bisa dihindari dengan pindah) di luar v1.
- **O2f — aturan bergantung tanggal.** Tarif per malam dan rate plan, minimum menginap bergantung tanggal, pembatasan hari kedatangan atau keberangkatan di luar v1 (minimum per offering, §2.5).
- **O2g — no-show untuk stay.** Apakah grace per offering (dan apakah no-show melepas sisa malam setelah yang pertama) — pertanyaan terbuka yang sudah ada, kini konkret.
- **O2h — event blok.** Apakah hilir (channel manager) butuh event `awcms.booking.block.*`; v1 tidak memancarkan apa pun.
- **O13 — kebijakan pengingat (Issue #943).** Dicatat, belum diputuskan: (a) lead tetap 24 jam dan satu pengingat per reservasi; apakah per tenant (kolom `reminder_lead_seconds` dan field kebijakan) atau per offering, dan apakah ada pengingat kedua; (b) konfirmasi dikirim pada pass job berikutnya setelah `confirm`; apakah tenant boleh mematikan konfirmasi atau pengingat secara terpisah; (c) redaksi berupa bahasa Inggris netral dan hanya memuat nomor reservasi serta waktu mulai lokal; redaksi dan locale per tenant, serta nama template provider yang disetujui Meta, adalah keputusan pemilik; (d) e-mail tidak dirutekan (modul e-mail juga tidak bisa menerima referensi pelanggan yang opak); apakah pelanggan tanpa WhatsApp harus jatuh ke e-mail; (e) adapter hilir mana yang mengimplementasikan `BookingReminderRecipientPort` (commerce, menurut O12).

Juga terbuka dan _tidak_ ada di tracker hilir (diusulkan untuknya): angka
default dan maksimum TTL hold (§5.1, 900 dan 86 400 detik, adalah bawaan modul,
bukan keputusan pemilik); angka BATAS hold diselesaikan Issue #941 sebagai
bawaan aman (§13) dan tetap dapat diatur per tenant; apakah seri boleh diterima sebagian; apakah grace no-show per
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

**Tindak lanjut tercatat (bukan v1).** Layar admin untuk membuat, menjadwalkan ulang, dan meng-override reservasi (enam layar §3.0.3 ada sejak Issue #942 dan modul `active`); ABAC ber-scope lokasi/resource; kapasitas terhitung tanpa baris
unit (memakai aturan §8.1 butir 4); seri terima-sebagian; turnaround bersama;
waitlist; ekspor iCal; no-show otomatis; jendela retensi dengan archive-then-purge; harmonisasi `profile_identity` atas referensi pelanggan (ADR sendiri; O12 mempertahankan commerce sebagai otoritas); rekurensi `MONTHLY` (O2); tindak lanjut stay O2a–O2h (§11); route `extend` §5.1; layar admin blok (#942); keyed hashing dan enkripsi at-rest tidak berlaku (tak ada identifier yang
disimpan).

## 13. Status implementasi

Apa yang sudah dibangun, apa yang baru dispesifikasikan, dan ke mana irisan
berikutnya menempel. Desain di atas adalah kontraknya; bagian ini adalah peta
dari desain ke kode (peta modul:
[`src/modules/booking/README.id.md`](../../src/modules/booking/README.id.md)).

| Irisan                | Issue | Sudah dibangun                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| --------------------- | ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fondasi               | #937  | Skema `sql/180` (RLS FORCE, foreign key komposit, kedua exclusion constraint, state machine sebagai trigger, riwayat append-only), katalog izin `sql/181`, state machine murni. Tes T1 (interleaving tingkat database).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Availability          | #938  | Jadwal, pengecualian, tabel blok (`sql/186`), availability slot dan stay yang murni, `GET /availability`, route jadwal.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| **Alokator, hold**    | #939  | Alokator slot (§8.1 butir 1 sampai 3, 6): `INSERT ... ON CONFLICT DO NOTHING RETURNING`, unit bebas pertama dalam urutan `(sort_order, id, ordinal)`, semua-atau-tidak-sama-sekali untuk beberapa unit, unit yang dipilih bersama disisipkan dalam urutan `(resource_id, ordinal)`, `23P01` dan `40P01` ditangani (retry terbatas dengan jitter). Hold dengan kedaluwarsa (§5.1): reklamasi malas saat menulis ditambah reaper `booking:holds:expire`, kebenaran tidak bergantung pada reaper. `placeHold`, klaim yang akan dipanggil route reservasi. Batas hold (sebuah jumlah, §8.1 butir 4). Rekonsiliasi read-only §7.1. Tes T2, T3 (dan premis `DO NOTHING`-nya), T6 (a, b), T7, di `tests/integration/booking-concurrency.integration.test.ts`. Satu migrasi, `sql/200`, hanya untuk privilege job: sapuan SECURITY DEFINER sempit yang membuat `booking:holds:expire` berjalan sebagai `awcms_worker`; skema `sql/180` sudah memegang setiap invarian yang dibutuhkan alokator.                                                                          |
| **Reservasi**         | #941  | Route §3.0 (`POST/GET /reservations`, `GET /reservations/{id}`, `confirm`, `cancel`, `reschedule`, `check-in`, `check-out`, `no-show`) di atas `application/booking-reservation-service.ts`; `Idempotency-Key` lewat komponen bersama, dengan pemeriksaan status sebagai lapis kedua; kebijakan (`application/booking-reservation-policy.ts`, `domain/booking-policy.ts`) dan jalur `overridePolicy` dengan pemeriksaan berisiko tinggi yang independen; reschedule dengan lineage; `BookingPort` dan adapter-nya; kesembilan event pada dokumen AsyncAPI live dan registri runtime, diterbitkan oleh transisi request, reklamasi malas, dan sapuan; batas hold bawaan yang aman. Migrasi `sql/208` (foreign key `superseded_by_id` ditangguhkan) dan `sql/209` (fungsi fakta event, sapuan yang mengembalikan yang dikedaluwarsakannya). Tes: aturan murni di `tests/booking-policy.test.ts` dan `tests/booking-reservation-validation.test.ts`; `tests/integration/booking-reservation.integration.test.ts` dan `booking-reservation-api.integration.test.ts`. |
| **Stay, blok**        | #940  | Klaim stay lewat `placeHold` (`stay: { checkInDate, checkOutDate }`: tanggal divalidasi pada zona resource, malam sebagai aritmetika tanggal, instant kedatangan dan keberangkatan serta zona dan jam lokal disnapshot ke item, `min_nights` / `max_nights` offering) dan lewat alokator yang sama (`UnitClaim` `kind: "stay"`, probe `daterange`); reklamasi malas untuk hold stay (`ReclaimWindow` `kind: "stay"`); malam terblokir sebagai baris alokasi (`booking-block-service.ts`: `createBlock`, `releaseBlock`, `BLOCK_CONFLICT`, `UnitClaim` `kind: "block"`); tiga pemeriksaan rekonsiliasi blok; tes T9 sampai T13 di `tests/integration/booking-stay.integration.test.ts` dan aturan murninya di `tests/booking-stay.test.ts`. Satu migrasi, `sql/204` (baris blok dan guard-nya, `BOOKING_MODE_IN_USE`, batas instant 368 hari). `sql/200` tidak perlu diubah: hold stay berakhir pada kolom yang sama dan dilepas lewat join item yang sama. Tanpa route HTTP, termasuk route blok: datang bersama #941 (reservasi) dan #1012 (blok).              |
| **Route blok**        | #1012 | `POST /blocks`, `POST /blocks/{id}/release`, `GET /blocks`, `GET /blocks/{id}` (§3.0.1) di atas `booking-block-service.ts`, `booking-block-directory.ts` dan `booking-block-routes.ts`, terikat pada `Idempotency-Key` dengan replay (N2), rincian `BLOCK_CONFLICT` dibatasi `reservations.read`, audit `warning` / `info`, tanpa event. Tindak lanjut #940: blok seluruh-resource mencakup unit yang ditambahkan kemudian (N1, `sql/240`: trigger AFTER INSERT + kunci resource di `readBlockUnits`), reklamasi malas dibatasi pada unit yang dicakup dengan teks audit yang akurat (N3), satu instant rilis (N4, `sql/241`). Tes: `tests/integration/booking-block-api.integration.test.ts`, blok "Issue #1012" di `tests/integration/booking-stay.integration.test.ts` (interleaving dibuktikan lewat `pg_stat_activity`) dan `tests/booking-block-validation.test.ts`.                                                                                                                                                                                       |
| **Pelaporan**         | #944  | Tiga proyeksi pada engine `reporting` (`booking.reservations`, `booking.time`, `booking.nights`; §7.2.1), field aturan `sumColumn` dan batas halaman aman-ikatan di engine, laporan langsung `GET /booking/reports/{occupancy,utilization,reservations}` dengan jendela hari Asia/Jakarta dan penahanan kelompok kecil. Satu migrasi, `sql/244` (kolom kuantitas, `projection_kind`, trigger pengisi, backfill). Tes: `tests/booking-report.test.ts`, `tests/reporting-projection-metric-delta.test.ts`, `tests/integration/booking-reporting.integration.test.ts`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| **Konfigurasi admin** | #1030 | Route §3.0.2 di atas `booking-resource-admin.ts` (resource, unit, pool), `booking-offering-admin.ts`, `booking-policy-admin.ts` dan `booking-admin-routes.ts` / `booking-admin-support.ts` bersama (savepoint yang memetakan guard database ke 409, halaman keyset, pembungkus mutasi idempoten) dengan aturan murni di `domain/booking-admin-validation.ts`; event audit `booking.pool.*` dan `booking.offering.restored`, serta `booking.policy.configured` dinaikkan ke `critical`. Tanpa migrasi: setiap invarian yang dipakainya ada di `sql/180`, `186`, `204` dan `240`. Tes: `tests/booking-admin-validation.test.ts` dan `tests/integration/booking-admin-api.integration.test.ts` (matriks akses dua arah, replay, penolakan guard, soft delete, isolasi tenant).                                                                                                                                                                                                                                                                                      |
| **Layar admin**       | #942  | Enam layar §3.0.3 (`src/pages/admin/booking/*.astro`), pengirim bersama `src/lib/ui/booking-admin-client.ts`, pesan terjemahan `src/lib/booking-admin-messages.ts` dan label `src/lib/booking-admin-labels.ts`, enam entri `navigation` dan perubahan status ke `active`, 218 entri katalog di `locales/en.po` / `id.po`, ledger cakupan turun menjadi tujuh kunci, dan `APP_BUDGET_BYTES` dinaikkan sebesar 11.259 B tujuh berkas skrip baru. Tanpa migrasi, tanpa perubahan API. Tes: `tests/admin-booking-page-contract.test.ts`, registry navigasi, `tests/e2e/admin-booking.e2e.ts` (hanya keyboard, setiap aksi), dan layar booking di `a11y-axe.e2e.ts` serta sapuan 360 px.                                                                                                                                                                                                                                                                                                                                                                              |
| **Pengingat**         | #943  | Job `booking:reminders:dispatch` (§7.5) di atas `booking-reminder-dispatch.ts` / `booking-reminder-job.ts`, tabel intent `sql/284` dan tiga pembacaan sempit `sql/285`, `BookingReminderRecipientPort`, template `booking.confirmation` / `booking.reminder`, diserahkan ke `whatsapp_delivery` lewat `WhatsappDeliveryPort`. Inert sampai deployment mendaftarkan resolver penerima.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |

**Masih desain (belum ada di kode):** route `extend` §5.1; `service_requirements` (`staff_assignments` ada sejak #949, §10.3, tanpa `staff_role`)
dan matriks T8 penuh (separuh konkurensinya ada di `booking-staff-availability.integration.test.ts`); route `reservations/reconciliation`; layar untuk create / reschedule / override reservasi, ketersediaan, catatan, dan laporan (§3.0.3 menjelaskan mengapa masing-masing tidak ada).

**Sambungan tempat irisan berikutnya menempel**

- `placeHold` (`application/booking-hold-service.ts`) adalah KLAIM. Ia memeriksa
  integritas klaim (offering dan resource ada dan bermode sesuai klaim (slot, atau stay bila tanggal `stay` dikirim), ukuran
  rombongan, jumlah unit, interval turunan, hold terjepit pada jam database,
  batas hold) dan menyerahkan **kebijakan** kepada handler pembuatan: jam buka
  (`OUTSIDE_SCHEDULE`), lead time dan horizon, serta apakah
  `reservations.override` mengangkatnya. Handler mengevaluasinya dengan mesin
  yang sama dengan pencarian (`answerAvailability`) sebelum memanggilnya.
- `claimUnits` (`application/booking-allocator.ts`) menerima union `UnitClaim`
  dengan tiga anggota: `time` dan `stay` berbagi loop unit bebas (anggota stay
  membaca dan menyisipkan `stay_from` / `stay_to`), dan `block` menyisipkan
  unit TETAP milik sebuah blok, dalam urutan `(resource_id, ordinal)`,
  semua-atau-tidak-sama-sekali, di bawah constraint stay yang sama.
- `reclaimExpiredHolds` menerima union `ReclaimWindow` dengan dua anggota:
  `time` memeriksa overlap `tstzrange`, `stay` memeriksa overlap `daterange`
  (dipakai untuk stay dan untuk blok).
- Confirm, cancel dan reschedule (#941) menulis tepat satu baris riwayat per
  transisi, dalam transaksi yang sama; primitif kedaluwarsa (`applyExpiry`)
  adalah modelnya. Trigger yang mengikat perubahan status ke baris riwayatnya
  masih belum dibangun.

**Keputusan yang diambil di irisan #939**

- **Reaper berjalan sebagai `awcms_worker`, lewat satu fungsi SECURITY DEFINER
  sempit** (`sql/200`, pola `sql/142` / ADR-0090), seperti job terjadwal lain.
  Worker dengan `UPDATE` pada reservasi juga bisa confirm dan cancel, sehingga ia
  sama sekali tak memegang privilege pada tabel booking: ia boleh `EXECUTE`
  `awcms_booking_expire_due_holds(tenant, batch)`, yang statement-nya tetap
  (hanya `status = 'expired'` pada hold yang berakhir menurut jam database, hanya
  alasan rilis literal, hanya baris riwayat `expired`, tanpa aktor) dan yang
  menolak tenant yang bukan milik sesi. Ia memilih `FOR UPDATE SKIP LOCKED` dan
  tak pernah menunggu request. Reklamasi malas tetap SQL aplikasi di dalam
  transaksi klaim itu sendiri (sebagai peran aplikasi), menunggu kunci baris (ia
  harus tahu jawabannya), dan mengunci menurut urutan naik `reservation id`. Dua
  implementasi untuk satu keadaan akhir dibandingkan oleh tes integrasi.
- **Reklamasi malas dibatasi pada klaim**: hanya hold berakhir yang alokasi
  hidupnya beririsan dengan rentang terpakai klaim pada resource target, jadi
  resource yang sibuk tidak mengubah setiap hold baru menjadi sapuan seluruh
  tenant. Ia berjalan sebelum savepoint klaim, sehingga kedaluwarsa tetap
  berlaku walau klaim sesudahnya ditolak. Ia bekerja per batch sampai satu batch
  tidak mengunci apa pun (`LIMIT ... FOR UPDATE` yang menunggu baris yang diubah
  transaksi lain membuang baris itu tanpa mengisi ulang, sehingga "kurang dari
  batas" tidak berarti selesai) dan memajukan kursor keyset, sehingga tak pernah
  memotong dan kunci tetap berurutan naik menurut id.
- **Pembacaan unit bebas adalah petunjuk, constraint adalah otoritas**: bacaan
  basi paling banyak menambah satu putaran (dibatasi 6, lalu
  `CONTENTION_RETRY`), tak pernah double-booking. Penolakan adalah nilai, dan
  seluruh klaim berjalan dalam savepoint sehingga penolakan tidak meninggalkan
  reservasi, item, atau alokasi.
- **Kesehatan reaper** dibaca dari data (`hold_overdue_unswept` dan
  `reaper.oldestOverdueSeconds` pada rekonsiliasi, masa tenggang 300 detik) dan
  dari telemetri job runner bersama; tak ada yang bergantung padanya.
- **N4 diselesaikan di #941: batas hold punya bawaan yang aman.** `NULL` di
  settings kini adalah bawaan modul, bukan tak terbatas: **5 hold hidup per
  pelanggan dan 500 per tenant** (`POLICY_DEFAULTS`). Alasannya: hold menempati
  inventaris tanpa pembayaran di baliknya, sehingga jumlah hold satu aktor adalah
  tuas melawan banjir hold. Lima longgar untuk orang yang membandingkan tanggal
  dan kecil untuk skrip; 500 adalah jumlah checkout yang sedang berjalan pada
  satu saat (hold berlangsung menit) yang tak dicapai properti sibuk dan yang
  membatasi apa yang bisa dikeluarkan satu pemanggil jahat dari penjualan. Terlalu
  rendah mengubah lonjakan sah (flash sale, kelas yang dibuka tengah hari) menjadi
  `429 HOLD_LIMIT_EXCEEDED` bagi pelanggan jujur; terlalu tinggi membiarkan satu
  pemanggil menahan seluruh rak. Hold walk-in tanpa referensi pelanggan hanya
  dibatasi batas tenant, dan konfirmasi `immediate` bukan hold. Angkanya kolom
  settings per tenant (`max_active_holds_per_*`, minimal 1; tenant yang tak ingin
  batas praktis mengisi angka sangat besar); route kebijakan yang menulisnya
  (`PUT /policy`, `policy.configure`) hadir bersama Issue #1030. **Setiap jalur pembuat hold
  tetap harus mengambil advisory lock per tenant yang sama**
  (`pg_advisory_xact_lock(hashtextextended('awcms_booking.holds:' || tenant, 0))`
  di `enforceHoldCaps`) sebelum menghitung hold hidup: `extend` kelak, seri,
  route adapter. Jalur yang membuat hold tanpa kunci itu membuka kembali balapan
  yang ditutup tes batas.

**Keputusan yang diambil di irisan #940**

- **Stay diklaim lewat `placeHold` yang sama**, dengan `stay: { checkInDate,
checkOutDate }` sebagai ganti `startsAtMs` (tepat salah satu). Klien tak
  pernah mengirim instant, akhir, atau buffer untuk stay. `deriveStay`
  (`domain/booking-stay.ts`) menerapkan pemeriksaan `evaluateStay` dalam urutan
  yang sama dan sebuah tes menegaskan keduanya sepakat pada tabel kasus, sehingga
  stay yang ditawarkan availability adalah stay yang diterima klaim. "Hari ini"
  adalah tanggal lokal jam database pada zona resource (kode zona JS yang sama
  dengan availability, sehingga modul punya satu pembacaan zona).
- **Pool resource stay harus sepakat pada satu zona dan satu pasang jam check-in
  / check-out** (`STAY_POOL_INCONSISTENT`), karena item men-snapshot satu set;
  alternatifnya, men-snapshot milik resource pertama secara tak sengaja, membuat
  tanggal bermakna lain pada unit yang berbeda.
- **Blok mengambil satu baris per unit, termasuk unit nonaktif**, dalam urutan
  `(resource_id, ordinal)` di dalam savepoint: unit yang tak berhasil dimenangkan
  adalah `BLOCK_CONFLICT` untuk seluruh blok dan savepoint membatalkan baris
  blok beserta unit yang sudah dimenangkan. Trade-off: blok atas seluruh resource
  ditolak karena satu kamar yang terbooking (operator memblokir kamar lain dengan
  menyebutnya), sebagai imbalan blok yang tak pernah parsial.
- **Blok yang tumpang tindih ditolak**, karena keduanya baris di bawah constraint
  yang sama. Alternatifnya (membebaskan blok-terhadap-blok) butuh constraint
  ketiga atau trigger, dan dua alasan tumpang tindih untuk satu malam dapat
  dipulihkan dengan melepas lalu memasang ulang.
- **Melepas blok adalah invarian database, bukan langkah handler**: trigger AFTER
  UPDATE `sql/204` melepas barisnya dalam statement yang men-stempel blok, dan
  guard update alokasi menolak melepas baris blok dengan cara lain. Melepas blok
  yang sudah dilepas adalah replay dan tidak menulis apa pun.
- **`BLOCK_CONFLICT` tidak membatalkan dan tidak menulis apa pun** (tanpa baris
  blok, tanpa alokasi, tanpa baris audit). Reservasi yang bentrok (nomor, status,
  tanggal; tak pernah referensi pelanggan) dikembalikan hanya bila pemanggil
  memintanya (`revealConflicts`, yang diatur route dari `reservations.read`),
  sehingga pemanggil tanpa izin itu tahu bahwa malam terpakai, bukan oleh siapa.
- **Availability tetap membaca tabel blok** agar jawabannya dapat menyebut
  `BLOCKED`; pembacaan stay karena itu mengecualikan baris blok (`block_id IS
NULL`), kalau tidak setiap blok dihitung sebagai booking dan alasannya turun
  menjadi `NO_UNIT_AVAILABLE`.
- **Reklamasi malas sadar-jenis.** Klaim slot tak pernah mereklamasi hold stay
  dan sebaliknya; blok mereklamasi hold stay yang beririsan dengan malamnya,
  sehingga hold berakhir yang belum disapu tidak menolak blok dan reaper yang
  berhenti tidak berpengaruh. Reaper (`sql/200`) tidak perlu diubah.
- **Tidak diputuskan di sini (dan tak diperlukan):** blok boleh dimulai di masa
  lalu (tak ada aturan "hari ini" untuk blok); route blok beserta
  `Idempotency-Key`-nya milik irisan route, di mana pemeriksaan state (rilis
  kedua adalah replay) dan constraint sudah membuat retry tidak berbahaya.

**Keputusan yang diambil di irisan #941**

- **Batas diperiksa sesudah klaim, bukan sebelumnya.** Advisory lock ditahan
  sampai commit, sehingga mengambilnya lebih dulu akan menyerialkan setiap hold
  satu tenant sebelum exclusion constraint melihatnya, dan T2 lalu membuktikan
  kunci, bukan constraint. Diperiksa sesudah unit dimenangkan (di dalam savepoint
  klaim, menghitung hold yang baru disisipkan, sehingga "melewati" adalah hitungan
  di atas batas), pesaing untuk unit yang sama tetap berebut di constraint dan
  hanya pemenang yang mengantre pada batas. Trade-off: pemenang satu tenant
  mengantre pada kunci sampai transaksinya selesai (throughput pembuatan hold
  terbatas per tenant, tak pernah lintas tenant), klaim yang melewati batas
  sebentar menang lalu kehilangan unitnya bersama savepoint, dan pemanggil yang
  kena batas yang meminta slot terambil dijawab `SLOT_UNAVAILABLE`, bukan
  `HOLD_LIMIT_EXCEEDED`. Tidak ada deadlock: pemegang kunci sudah menyelesaikan
  setiap insert yang bisa menunggu transaksi lain.
- **Kedua pemeriksaan mutasi (T7, T13) memakai offering `immediate`.** Keduanya
  menjaga klaim A tetap tak ter-commit selagi klaim B berjalan, untuk
  membuktikan bahwa constraint-lah yang menghentikan B. Klaim hold kini membuat
  B mengantre pada kunci batas sesudah klaim (disengaja), sehingga dengan
  constraint dicabut B akan menunggu commit A; reservasi confirmed tidak
  mengambil kunci batas, dan tes premis dengan constraint ada (T1, T9,
  interleaving `DO NOTHING`) tidak terpengaruh karena B terblokir pada baris
  alokasi sebelum mencapai batas.
- **Sapuan mengembalikan yang dikedaluwarsakannya.**
  `awcms_booking_expire_due_holds` mengubah tipe kembaliannya (`sql/209`; fungsi
  lama di-drop, `sql/200` tak tersentuh) agar job bisa menerbitkan `expired` dalam
  transaksi yang sama tanpa worker membaca tabel booking. Alternatif ditolak:
  fungsi "fakta" yang bisa dibaca worker atas reservasi sembarang, yang
  membiarkan worker yang dikompromikan membaca referensi eksternal setiap
  reservasi.
- **Satu fungsi fakta, bukan tiga pembangun payload.** Event hanya boleh membawa
  apa yang dikembalikan `awcms_booking_reservation_event_facts`; referensi
  pelanggan dan catatan bukan kolom yang dibacanya, sehingga tak ada handler yang
  bisa membocorkannya ke event secara tak sengaja. Sebuah tes menegaskan himpunan
  key dan bahwa tak ada key yang menamai orang, alasan, aktor, atau jumlah
  (envelope tetap membawa `actorTenantUserId`, seperti event setiap modul;
  PAYLOAD-nya tanpa aktor).
- **Pemeriksaan status adalah lapis idempotensi kedua, per kata kerja, menurut
  status target.** Confirm pada `confirmed`, cancel pada `cancelled`, check-in
  pada `checked_in`, check-out pada `completed`, no-show pada `no_show`
  mengembalikan `replayed: true` dan tidak menulis apa pun (tanpa baris riwayat,
  audit, atau event), dengan key apa pun. Reschedule pada `rescheduled` hanya
  replay bila request cocok dengan penggantinya; selain itu `INVALID_STATE`.
  Confirm reservasi `expired` adalah `HOLD_EXPIRED`, bukan `INVALID_STATE`.
- **Correlation id dari klien tidak dipercaya sebagai uuid.** Ia datang di header
  sebagai string apa pun; kolom tabel riwayat bertipe `uuid`, sehingga ditulis
  hanya bila terurai sebagai uuid (audit dan event menyimpan string-nya).
- **`externalRef.id` ditolak bila tampak seperti kredensial.** Outbox menolak
  payload dengan nilai berbentuk kredensial dan referensi itu ikut di setiap
  event; menolaknya di pintu adalah `400`, bukan `500` setelah klaim dimenangkan.
- **Grace no-show bawaan 15 menit** (`no_show_grace_seconds`; untuk stay instant
  kedatangan ditambah grace), angka yang harus dipilih irisan ini karena paket
  membiarkannya terbuka. Properti yang menahan kamar sampai malam menaikkannya.
- **`GET /reservations` dan `GET /reservations/{id}`** ditambahkan di luar daftar
  kata kerja issue karena matriks akses §6 menyebut `reservations.read` dan layar
  (#942) tak bisa dibangun tanpanya. Keduanya tak pernah mengembalikan catatan.
- **Request ber-key sama diserialkan oleh advisory lock.** Penyimpanan
  idempotensi berkunci `(tenant, scope, key)`; user pelaku hanya ada di hash
  request, sehingga user lain yang memakai ulang key mendapat
  `409 IDEMPOTENCY_CONFLICT`. Tanpa kunci, dua request konkuren dengan satu key
  sama-sama tidak menemukan apa pun dan sama-sama mengklaim, dan yang kalah bisa
  ditolak (`SLOT_UNAVAILABLE`, `HOLD_LIMIT_EXCEEDED`) oleh booking pemenang yang
  belum commit: retry diberi tahu booking-nya sendiri bentrok. Route dan port kini
  mengambil `pg_advisory_xact_lock('idem:' || tenant || scope || key)` sebelum
  pencarian, sehingga request kedua menunggu yang pertama commit dan memutar ulang
  respons tersimpannya (diuji dengan kapasitas 1: lima request konkuren, lima
  `201`, satu body). Port juga menjalankan produce-dan-simpan dalam savepoint dan
  menjawab balapan simpan yang kalah dengan hasil pemenang.
- **Jam dibaca setelah kunci baris.** `lockReservation` mengunci, lalu membaca
  `clock_timestamp()` dalam statement kedua, sehingga confirm yang mengantre di
  belakang penulis lain menilai "berakhir" pada instan yang sama dengan yang akan
  dinilai trigger `held -> confirmed`, dan menjadi `HOLD_EXPIRED`, bukan error
  trigger (diuji dengan hold yang berakhir selama menunggu).
- **Di luar cakupan dan dicatat:** route `extend`. Cara tenant mengubah batas
  hold dan grace no-show adalah `PUT /policy` (Issue #1030, §3.0.2). Default grace
  no-show (15 menit) adalah default modul, dapat diatur per tenant lewat baris
  settings yang sama.

**Keputusan yang diambil pada irisan #944**

- **Counter atas tabel event, kuantitas distempel saat tulis.** Alternatifnya, menjumlah baris alokasi saat laporan, akan kembali menjadi query langsung dan tidak bertahan dalam kontrak proyeksi: baris alokasi berubah (`released_at`), baris riwayat tidak. Menaruh kuantitas pada baris append-only menjadikan rebuild re-scan murni.
- **Trigger membaca baris alokasi, yang tetap ada setelah dilepas.** Pelepasan karenanya membawa persis apa yang dipesan konfirmasinya, dan reschedule memesan pengganti serta melepas aslinya, sehingga `booked - released` adalah total hidup.
- **Backfill menonaktifkan trigger append-only untuk satu statement** di dalam transaksi migrasi. Ia hanya menulis empat kolom baru dengan aturan yang sama dengan trigger.
- **Terpakai mencakup `completed`, mengecualikan `no_show`.** Jawaban O8 yang tercatat menyebut `confirmed` atau `checked_in`; stay yang sudah dijalani tetap harus dihitung pada malam yang dijalani, maka `completed` ditambahkan. `no_show` mempertahankan alokasi tetapi tak ada yang memakai unit. Kedua pilihan dinyatakan di deskripsi OpenAPI dan daftar status adalah satu konstanta (`OCCUPYING_STATUSES`).
- **Penyebut occupancy adalah setiap unit aktif saat ini.** Riwayat unit tidak disimpan (§4), dan apakah penutupan keluar dari penyebut masih terbuka (O8), maka `blockedUnitNights` dikembalikan di samping rate.
- **Utilization memakai waktu terpesan, bukan aktual**, juga masih terbuka di bawah O8.
- **Jendela hari dipatok ke Asia/Jakarta** (zona waktu laporan epik), bukan zona resource; malam stay adalah tanggal dan tak butuh zona.
- **Tidak ada dependensi `reporting` dideklarasikan.** Engine membaca deskriptor lewat `listModules()`; tenant tanpa `reporting` hanya tidak pernah me-refresh-nya.
- **Belum dibangun:** rincian per hari laporan alur reservasi, dan KPI retensi pelanggan (angka analitik lintas-domain, §7.2).

**Keputusan yang diambil di irisan #1030**

- **Keanggotaan pool adalah `poolId` milik resource, dan pool memakai izin `resources.*`.** Katalog (`sql/181`) menggambarkan `resources.*` sebagai "resource atau pool resource", jadi tak ada izin baru yang diciptakan. Pool tak punya daftar anggota untuk ditulis: memindahkan resource adalah `PATCH` resource.
- **Kapasitas bertambah, tidak pernah menyusut.** Unit adalah jangkar exclusion constraint dan tak dapat dihapus, jadi "hapus unit" tidak ada; menonaktifkannya mengeluarkannya dari kandidat alokator sementara riwayatnya tetap. Blok seluruh-resource mencakup unit yang ditambahkan dengan menaikkan kapasitas (`sql/240`), diuji lewat route.
- **`RESOURCE_IN_USE` lebih sempit daripada guard mode.** Database menolak perubahan mode atau zona selama ADA alokasi hidup (stay yang selesai mempertahankan alokasinya sebagai fakta). Delete hanya ditolak untuk reservasi held, confirmed atau checked-in atau blok aktif: resource yang alokasi hidupnya hanya milik stay selesai dapat dihapus. Alasannya: delete tak boleh menelantarkan janji; ia tak boleh terblokir selamanya oleh riwayat.
- **`PUT /policy` mengganti baris dan mewajibkan setiap field.** Alternatifnya, menggabung hanya field yang dikirim, menjadikan "kirim `null` untuk reset" dan "hilangkan untuk mempertahankan" dua ejaan satu request, dan klien parsial tak dapat tahu mana yang ia minta. Biayanya klien harus membaca sebelum menulis; `GET /policy` mengembalikan persis bentuk yang dapat ditulis di bawah `policy`.
- **Tanpa step-up MFA pada `policy.configure`.** ADR-0141 §6 menyebut izin payroll yang membawa `requiresMfaEnrolment` dan menyatakan menandai izin rutin adalah penguncian yang tidak dipilih tenant. Perubahan kebijakan berisiko tinggi (audit critical, idempoten, dapat dialamati SoD) tetapi tidak ditandai; menandainya kelak adalah perubahan satu baris deskriptor ditambah dua tes yang diwajibkan ADR-0141 §6.
- **`includeDeleted` butuh `.restore` juga** (aturan ADR-0128 di §6, preseden `hr-workforce`), dan baris terhapus yang dibaca lewat id **atau menjadi sasaran delete atau update** (replay delete berulang, penolakan `*_DELETED`) adalah `404` netral bagi yang tanpanya, sehingga pemisahan izin tak dapat dipakai untuk mengetahui bahwa baris itu ada.
- **Cap waktu DTO adalah string ISO UTC dengan mikrodetik** (pemformat keyset bersama), sehingga cursor daftar dan `createdAt` yang dilihat klien adalah teks yang sama.
- **Daftar adalah halaman keyset terbaru-dulu**, seperti setiap daftar booking lain; layar yang menginginkan urutan tampilan `sortOrder` mengurutkan halaman yang dipegangnya (`sortOrder` ada di setiap baris).

**Keputusan yang diambil di irisan #942**

- **Satu halaman per area, enam entri sidebar, tanpa tab.** Tiap area punya izin dan penjaga masuknya sendiri, sehingga pengguna yang hanya boleh membaca kebijakan melihat satu entri, dan aturan registry navigasi (halaman nyata dan `requiredPermission` yang di-seed dan ditegakkan untuk setiap entri) terpenuhi per entri. Alternatifnya, satu halaman `/admin/booking?view=` seperti `/admin/procurement`, akan menjadi berkas 3.000 baris dengan izin masuk yang terlemah dari enam.
- **Detail reservasi sebagai `?id=`, bukan `reservations/[id]`.** Sapuan render mensyaratkan tautan ke id nyata route dinamis di halaman induknya, dan tenant baru tak punya reservasi; sapuan yang gagal pada tenant kosong adalah pembacaan yang benar atas route yatim, jadi detail adalah tampilan halaman yang selalu ada.
- **Nama resource berasal dari `resources.read`.** Pembaca reservasi yang tak boleh membaca resource melihat tanda strip, bukan id atau penolakan: pemisahan izin dihormati di layar seperti di API.
- **Formulir kebijakan selalu mengirim kesepuluh field.** `PUT` mengganti baris (§3.0.2); formulir menampilkan yang diatur tenant dan, di samping setiap field kosong, bawaan yang berlaku, sehingga "kosong" tidak pernah dibaca "tanpa batas".
- **Reschedule, create, dan override tidak ada di layar.** Masing-masing butuh pemilih tanggal dan resource yang mencerminkan ketersediaan; membangun salinan kedua yang menyimpang dari aturan ketersediaan di sebuah halaman persis yang dilarang "tanpa logika bisnis di halaman". Tujuh izin yang mereka dan pembacaan tak berlayar lain butuhkan tetap di ledger cakupan yang hanya menyusut.
- **Anggaran aset dinaikkan sebesar yang terukur (dua kali: yang kedua untuk perbaikan tinjauan).** Tujuh berkas skrip berjumlah 11.259 B (1.153 B di antaranya pengirim bersama); lihat komentar ledger di `scripts/client-asset-budget.ts`. Tidak ada stylesheet yang membesar.
