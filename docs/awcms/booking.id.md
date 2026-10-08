🇮🇩 Bahasa Indonesia · 🇬🇧 [English (source)](booking.md)

<!-- i18n-source-hash: sha256:9ca65ba84248a8ca3246d0a591fce933fc1eac39f67e6786de80c3045a3afcce -->

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
> dibangun.

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
  tumpang tindih. `start < end` dan `end − start ≤ 366 hari` adalah CHECK.
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

## 4. ERD dan kamus data

```
awcms_profiles (profile_identity) <-0..1- reservations
resource_pools 1──0..n resources 1──1..n resource_units
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

| Tabel                  | Memuat                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Hak `awcms_app`                                             |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `settings`             | `default_hold_seconds`, `max_hold_seconds`, `max_active_holds_per_customer`, `max_active_holds_per_tenant`, `min_lead_seconds`, `max_horizon_days`, `no_show_grace_seconds`, `default_timezone`; `NULL` = default modul                                                                                                                                                                                                                                                                                                               | SELECT, INSERT, UPDATE                                      |
| `resources`            | `code` (unik per tenant di antara yang hidup), `name`, `kind` (kode pendek, mis. `room`, `chair`, `court`, `vehicle`), `status` (`active`/`inactive`), `capacity int 1..500`, `pool_id` (nullable), `timezone` (IANA), `sort_order`, stempel soft-delete                                                                                                                                                                                                                                                                              | SELECT, INSERT, UPDATE (tanpa DELETE)                       |
| `resource_units`       | `resource_id`, `ordinal 1..capacity`, `label`, `status` (`active`/`inactive`); tepat `capacity` baris, dibuat bersama resource; **jangkar constraint eksklusi** (unik `(resource_id, ordinal)`)                                                                                                                                                                                                                                                                                                                                       | SELECT, INSERT, UPDATE (tanpa DELETE)                       |
| `resource_pools`       | `code`, `name`, `allocation_policy` (`first_free` menurut `sort_order, ordinal`; v1 hanya ini), stempel soft-delete. Pool adalah himpunan resource yang dapat dipertukarkan (tiga ruang perawatan)                                                                                                                                                                                                                                                                                                                                    | SELECT, INSERT, UPDATE (tanpa DELETE)                       |
| `service_offerings`    | `code`, `name`, `duration_seconds`, `setup_seconds`, `cleanup_seconds`, `slot_step_seconds`, `min_party`, `max_party`, `confirmation_mode` (`immediate`/`hold_then_confirm`), `cancellation_cutoff_seconds`, override `min_lead_seconds`/`max_horizon_days`, `status`, stempel soft-delete. **Tanpa harga, tanpa id produk**                                                                                                                                                                                                          | SELECT, INSERT, UPDATE (tanpa DELETE)                       |
| `service_requirements` | `offering_id`, `pool_id` xor `resource_id` (CHECK), `unit_count ≥ 1` (per anggota rombongan atau per booking: `unit_basis`), `staff_required bool`, `staff_role` (kode pendek)                                                                                                                                                                                                                                                                                                                                                        | SELECT, INSERT, UPDATE, DELETE (konfigurasi)                |
| `schedules`            | `resource_id` (NULL = default tenant), `timezone`, `effective_from`/`effective_to` (tanggal lokal, setengah-terbuka), `rules` jsonb (skema tertutup: hari kerja → daftar jendela lokal `[from,to)`, plus rekurensi §2.4), `status`. Jendela efektif baru **menggantikan**, tidak mengedit (trigger tumpang-tindih seperti ADR-0127)                                                                                                                                                                                                   | SELECT, INSERT, UPDATE (tanpa DELETE)                       |
| `schedule_exceptions`  | `schedule_id` atau `resource_id`, `local_from`/`local_to` (tanggal, setengah-terbuka, dalam zona jadwal), `kind` (`closed`/`override_hours`), `windows` jsonb untuk `override_hours`, `reason_code` (kode pendek, tanpa teks bebas)                                                                                                                                                                                                                                                                                                   | SELECT, INSERT, UPDATE, DELETE (konfigurasi)                |
| `reservations`         | `reservation_no` (kode acak buatan server, unik per tenant), `lineage_id`, `rescheduled_from_id`, `superseded_by_id`, `series_id`, `status`, `customer_profile_id` (FK komposit nullable ke `awcms_profiles`), `external_customer_ref` (buram, O12), `party_size`, `starts_at`/`ends_at` (selubung item-nya), `hold_expires_at`, `source`, `external_ref_type`/`external_ref` (satu pasangan buram), `customer_note` (**di-redact**, ≤ 500 karakter), `late_cancellation`, `cancel_reason_code`, kolom aktor dan stempel per transisi | SELECT, INSERT, UPDATE (**tanpa DELETE**)                   |
| `reservation_items`    | `reservation_id`, `line_no`, `offering_id`, snapshot offering (`code`, `name`, `duration_seconds`, `setup_seconds`, `cleanup_seconds`), `starts_at`, `ends_at`, `quantity` (unit diminta). Immutable setelah insert                                                                                                                                                                                                                                                                                                                   | SELECT, INSERT (**tanpa UPDATE/DELETE**)                    |
| `resource_allocations` | `item_id`, `resource_unit_id`, `resource_id`, `starts_at`, `ends_at`, `occupied_from`, `occupied_to` (CHECK `occupied_from ≤ starts_at < ends_at ≤ occupied_to`; trigger memverifikasi buffer sama dengan snapshot item), `released_at`, `released_reason` (`cancelled`/`expired`/`rescheduled`), **constraint eksklusi**                                                                                                                                                                                                             | SELECT, INSERT, UPDATE hanya `released_*`, sekali (trigger) |
| `staff_assignments`    | `item_id`, `staff_ref` (teks buram ≤ 128, hanya diselesaikan port tenaga kerja), `staff_role`, `occupied_from`/`occupied_to`, `released_at`/`released_reason`, **constraint eksklusi yang sama berkunci `staff_ref`**                                                                                                                                                                                                                                                                                                                 | SELECT, INSERT, UPDATE hanya `released_*`, sekali (trigger) |
| `reservation_events`   | `reservation_id`, `seq` (per reservasi), `kind`, `from_status`, `to_status`, `actor_user_id`, `correlation_id`, `reason_code`, `detail` jsonb (kunci tertutup: id, instant, hitungan — **tanpa teks bebas, tanpa data pribadi**), `occurred_at` (jam DB); unik `(reservation_id, kind)` untuk jenis sekali-saja; kolom `kind` ter-generate untuk proyeksi                                                                                                                                                                             | SELECT, INSERT (**tanpa UPDATE/DELETE**)                    |

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

**Jawaban subjek data (ADR-0094).** `reservations.customer_profile_id` dan
`external_customer_ref` mengidentifikasi seseorang; `customer_note` mungkin
memuatnya; aktor adalah pengguna tenant. Saat penghapusan atau anonimisasi
profil, modul memutus `customer_profile_id`/`external_customer_ref` dan men-null
`customer_note`, dan mempertahankan fakta non-pribadi (resource, interval,
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
  dihitung dalam _occupancy_ (sebuah KPI) adalah pertanyaan terpisah (O8);
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

| Izin                                                               | Mencakup                                                  | Risiko            |
| ------------------------------------------------------------------ | --------------------------------------------------------- | ----------------- |
| `resources.read` / `.create` / `.update` / `.delete` / `.restore`  | resource, unit, pool                                      |                   |
| `offerings.read` / `.create` / `.update` / `.delete` / `.restore`  | offering dan requirement                                  |                   |
| `schedules.read` / `.create` / `.update` / `.delete`               | jadwal dan pengecualian                                   |                   |
| `availability.read`                                                | pencarian ketersediaan, quote (tanpa persistensi)         | dibatasi rate     |
| `reservations.read`                                                | daftar, detail, event (catatan dikecualikan)              |                   |
| `reservation_notes.read`                                           | `customer_note` yang di-redact                            | baca teraudit     |
| `reservations.create` / `.confirm` / `.cancel`                     | hold/create, confirm, cancel                              |                   |
| `reservations.reschedule` / `.check_in` / `.complete` / `.no_show` | transisi lain (anggota `AccessAction` baru)               |                   |
| `reservations.override`                                            | booking atau reschedule di luar jam jadwal atau lead time | **tinggi** (baru) |
| `reservations.reconcile`                                           | rekonsiliasi read-only                                    |                   |
| `policy.read` / `policy.configure`                                 | pengaturan (hold, lead time, horizon, grace)              | berdampak tinggi  |
| `reports.read`                                                     | laporan occupancy / utilization / reservasi               |                   |

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
`lineage_id` putus, dan reservasi tanpa event `created`. Ia tidak memperbaiki
apa pun; cacat dikoreksi dengan transisi kompensasi, tak pernah edit.

### 7.2 Proyeksi occupancy dan utilization (engine reporting, dimiliki di sini)

Proyeksi menumpang engine `reporting` yang ada sebagai **counter monotonik** atas
tabel event append-only (engine menjepit decrement di nol, sehingga setiap
metrik adalah counter yang hanya naik, seperti ADR-0126/0128):

| Proyeksi               | Counter                                                                                                                                  |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `booking.reservations` | created, held, confirmed, cancelled, late_cancelled, rescheduled, expired, checked_in, completed, no_show                                |
| `booking.time`         | `booked_seconds` (+ saat confirmed / pada pengganti), `released_seconds` (+ saat cancel / reschedule-pergi dari reservasi terkonfirmasi) |

Waktu terpesan bersih adalah `booked − released`, dihitung saat baca, sehingga
rebuild menghasilkan angka yang sama. **Utilization** = detik terpesan bersih ÷
detik _tersedia_, di mana detik tersedia adalah fungsi murni dari ekspansi jadwal
(§2), bukan event, sehingga penyebut dihitung langsung oleh
`GET /booking/reports/utilization`. **Occupancy** (unit terpakai pada satu
instant ÷ unit) adalah query langsung. **Definisinya — apakah hold dihitung,
apakah penyebut mengecualikan penutupan pemeliharaan, waktu terpesan versus
aktual (`checked_in`→`completed`) — adalah keputusan pemilik O8 dan _tidak_
ditetapkan di sini**; counter di atas adalah masukan setiap definisi kandidat,
itulah mengapa dipilih lebih dulu. Detail (resource mana, hari mana) adalah
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
milik adapter sendiri), `occurredAt`, `correlationId`. **Tak pernah** nama,
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

## 9. Catatan ancaman dan privasi

**Aset.** Integritas klaim (tanpa double-booking, tanpa booking hantu),
ketersediaan jadwal (tak ada yang menyandera), dan data pribadi orang yang
memesan (referensi pelanggan, catatan teks bebas, dan di beberapa vertikal apa
yang diungkap catatan itu).

| Ancaman                                                                            | Mitigasi                                                                                                                                                                                                                                                      |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Balapan ke slot terakhir (double-booking)                                          | §8: constraint eksklusi deklaratif; tes regresi wajib                                                                                                                                                                                                         |
| **Banjir hold** — aktor menahan setiap slot untuk memblokir penjualan atau pesaing | hold dibatasi per pelanggan dan per tenant (`max_active_holds_*`), kedaluwarsa (TTL maks), `extend` dibatasi, membuat hold butuh `reservations.create` (kanal publik hilir mengautentikasi pelanggannya dan membatasi rate di edge); kedaluwarsa melepas      |
| Enumerasi ketersediaan (pesaing meng-scrape occupancy, atau jam janji seseorang)   | `availability.read` adalah izin, jendela pencarian ≤ 31 hari dan terbatas halaman, batas rate per-principal, hasil tak pernah memuat identitas pelanggan lain; **tak pernah edge-cache** (per-tenant dan per-request); proyeksi publik adalah keputusan hilir |
| Baca atau tulis lintas tenant                                                      | `tenant_id` + FORCE RLS pada setiap tabel, FK komposit, tes sebagai `awcms_app`                                                                                                                                                                               |
| IDOR pada id reservasi                                                             | setiap handler mengotorisasi lewat `authorizeInTransaction`; akses bergaya-kepemilikan untuk pelanggan adalah grant hilir (ADR-0063), tidak diasumsikan                                                                                                       |
| Replay / double submit                                                             | §5.2 tiga lapis                                                                                                                                                                                                                                               |
| Klien menegaskan status, interval, harga, atau pembayaran                          | server memiliki status, interval (diturunkan dari offering dan awal request), buffer, kedaluwarsa; field pembayaran ditolak dengan namanya                                                                                                                    |
| Manipulasi zona waktu / DST untuk memesan waktu mustahil                           | zona IANA eksplisit, aturan gap dan fold RFC 5545, `start < end`, pemeriksaan lead-time dan horizon pada instant UTC                                                                                                                                          |
| Rekurensi / ekspansi tak terbatas (denial CPU)                                     | skema tertutup, batas keras (§2.4), horizon ekspansi ≤ 366 hari, ≤ 52 kemunculan per seri                                                                                                                                                                     |
| Staf kelebihan pesan atau shift diabaikan                                          | constraint eksklusi staf + pembacaan penasihat port tenaga kerja; perubahan shift kemudian dilaporkan (§7.3), tak pernah diterapkan diam-diam                                                                                                                 |
| Kebocoran catatan teks bebas (log, ekspor, event, audit)                           | `customer_note` diklasifikasikan, ≤ 500 karakter, di `redactedColumns`, tidak ada di event/audit/log, dibaca di balik `reservation_notes.read` (teraudit), di-null saat penghapusan                                                                           |
| Penyalahgunaan override (booking di luar jam)                                      | `override` BERISIKO TINGGI, `Idempotency-Key`, diaudit `critical`; tak pernah bisa menimpa constraint eksklusi                                                                                                                                                |
| Panggilan provider di dalam transaksi                                              | tidak ada; notifikasi atau pembayaran apa pun ada di hilir, lewat outbox                                                                                                                                                                                      |

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
_retensi_ — reservasi dipertahankan selama umur tenant di v1 dan jendela retensi
per-tenant dengan archive-then-purge adalah tindak lanjut tercatat yang butuh
ADR sendiri; _keamanan_ — masking/redaksi di log, ekspor, baris audit, dan
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
  hold(input: { …quote input; customerRef?; holdSeconds?; externalRef?: { type; id }; idempotencyKey }):
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
`capabilities.consumes`: `profile_identity` (referensi pelanggan, opsional),
ketersediaan tenaga kerja (opsional), `reporting` (proyeksi),
`domain_event_runtime` (outbox); status `experimental` sampai layar admin
pertamanya (registry navigasi mensyaratkan halaman nyata). Kelas kompatibilitas:
offline-lan-safe.

## 11. Pertanyaan terbuka (keputusan pemilik — dicatat, TIDAK diputuskan di sini)

Dipetakan ke tracker hilir
[`aw-business-platform-dor.md`](https://github.com/ahliweb/awcms-one/blob/main/docs/aw-business-platform-dor.md).
ADR-0040 hanya menetapkan penempatan; O1–O12 tetap terbuka. "Memblokir"
menyatakan apa di paket ini yang tak bisa difinalkan sampai jawabannya dicatat.

| #       | Pertanyaan                                                                                                                                    | Yang diasumsikan paket ini sementara                                                                           | Memblokir                                                                                                                             |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| **O1**  | Persona dalam cakupan                                                                                                                         | Daftar provisional di §1 (resepsionis, manajer, pemilik resource, adapter, auditor)                            | Bundel peran §6 dan seed grant; UAT                                                                                                   |
| **O2**  | Vertikal mana yang pertama (hotel/vila, salon, klinik, rental, fasilitas, bengkel, pelatihan), dan apakah konsumen membangun lokal lebih dulu | Hanya generik; tanpa field vertikal. Rekurensi `MONTHLY` dan menginap (hari check-in/check-out) **di luar v1** | Rekurensi `MONTHLY`, menginap granularitas-hari (hotel), kebijakan catatan kesehatan (§9), layar admin pertama (bentuk akhir migrasi) |
| **O3**  | MoSCoW lintas CRM, Booking, Workforce, Payroll, Notification, Analytics                                                                       | Booking Wave A/B; job no-show otomatis dan waitlist tetap _Could_                                              | Hanya urutan; tanpa skema                                                                                                             |
| **O5**  | Peran hukum operator (pengendali/prosesor/keduanya)                                                                                           | Tak satu pun ditegaskan; desain netral (§9)                                                                    | Teks analisis privasi, bukan skema                                                                                                    |
| **O8**  | Occupancy vs utilization, **apakah hold dihitung**, waktu terpesan vs aktual, aturan penyebut                                                 | Counter membawa masukannya (§7.2); hold memblokir ketersediaan tetapi bobot occupancy-nya terbuka              | Hanya _definisi_ laporan/proyeksi; tanpa tabel                                                                                        |
| **O9**  | Non-tujuan eksplisit                                                                                                                          | Daftar §1                                                                                                      | Redaksi cakupan                                                                                                                       |
| **O12** | Identitas pelanggan: commerce tetap otoritas pelanggan, atau harmonisasi `profile_identity`                                                   | Keduanya: `customer_profile_id` opsional dan `external_customer_ref` buram, salah satu boleh null (walk-in)    | Kolom pelanggan `reservations` dan jalur penghapusan **sebelum migrasi**                                                              |

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
waitlist; ekspor iCal; no-show otomatis; jendela retensi dengan
archive-then-purge; rekurensi `MONTHLY` dan menginap granularitas-hari (O2);
keyed hashing dan enkripsi at-rest tidak berlaku (tak ada identifier yang
disimpan).
