🇮🇩 Bahasa Indonesia · 🇬🇧 [English (source)](booking-benchmarks.md)

<!-- i18n-source-hash: sha256:854785fcefa5e74ba0e202fe753b6aa8cde4feba4556759ed75459609a58288a -->

<!-- i18n-source-hash: sha256:pending -->

# Benchmark Booking dan Absensi (Issue #967)

Benchmark beban, stres dan konkurensi yang dapat diulang untuk allocator
`booking`, pembacaan ketersediaan, reaper kedaluwarsa hold saat backlog, dan
ingest event absensi `hr_workforce`. Satu perintah: `bun run bench:booking`
([`scripts/bench-booking.ts`](../../scripts/bench-booking.ts), implementation in [`tests/bench/booking-bench.ts`](../../tests/bench/booking-bench.ts)).

## Bukan bagian dari suite test

Benchmark menegaskan waktu dinding, dan asersi waktu di `bun test` adalah test
yang flaky. Karena itu skrip ini **bukan** `*.test.ts`: baik `bun test` maupun
`bun test tests/integration/` tidak menemukannya, dan ia **tidak** ada di
rantai `bun run check`. Seperti `build:asset-budget:check`, ia skrip dengan
budget terdokumentasi yang dijalankan sesuai kebutuhan atau di lane tersendiri
(lihat [`performance-suite.md`](performance-suite.md) untuk desain target yang
lebih luas).

Ia memeriksa dua hal, dan memisahkannya:

- **Invarian** (selalu ditegakkan, exit 1). Tepat satu pemenang untuk slot atau
  malam terakhir; tepat `capacity` pemenang untuk pool; alokasi aktif sama
  dengan jumlah pemenang (tanpa alokasi ganda, tanpa klaim parsial yang
  tertinggal); setiap yang kalah mendapat `SLOT_UNAVAILABLE`; tidak ada peserta
  yang melempar error; reaper mengedaluwarsakan dan melepas setiap hold yang
  lewat waktu dan klaim yang berpacu dengannya tidak pernah ditolak; setiap
  event absensi tersimpan tepat sekali dan replay mengembalikan aslinya. Ini
  kebenaran di bawah beban, bukan waktu, jadi tidak flaky.
- **Ambang** (ditegakkan secara default pada profil `standard`; beri
  `--no-thresholds` untuk hanya melaporkan). Tiap
  ambang berjarak lebar dari baseline di bawah, sehingga variasi mesin tidak
  memicunya tetapi regresi satu orde besaran (indeks hilang, N+1, kunci yang
  ditahan melintasi round trip) memicunya. Profil `smoke` hanya memeriksa
  invarian: segelintir sampel tidak punya p95 yang bermakna.

## Menjalankannya

```bash
# butuh DATABASE_URL superuser yang sama dengan suite integrasi
DATABASE_URL=postgres://postgres@127.0.0.1:5432/postgres bun run bench:booking
bun run bench:booking --profile smoke        # hitungan detik; hanya invarian
bun run bench:booking --json bench.json      # laporan machine-readable
bun run bench:booking --no-thresholds        # lapor saja, tanpa gerbang
```

Ia memakai ulang harness integrasi: database sementara `awcms_it_<pid>`,
migrasi asli, klaim lewat role runtime produksi `awcms_app` (FORCE RLS
berlaku) dan reaper lewat `awcms_worker`. Tiap peserta punya koneksi pool dan
transaksinya sendiri (bentuk `withTenant` tanpa gerbang work-class dalam
proses, sehingga database melihat semua peserta sekaligus). Ia tidak menyentuh
database yang disebut `DATABASE_URL` selain membuat dan menghapus miliknya
sendiri.

Karena `awcms_app` dan `awcms_worker` berlingkup cluster, teardown integrasi
proses lain dapat mematikan login keduanya di tengah run yang berlangsung
beberapa menit; skrip menegaskan ulang kedua login di awal tiap bagian
(`reassertRuntimeRoleLogins` di harness). Jangan menjalankannya pada cluster
yang role-nya bukan milik Anda.

## Apa yang dilakukan tiap skenario

| #   | Skenario             | Bentuk                                                                                                                                                                                                                                                                                                                                                    |
| --- | -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Klaim konkuren       | 30 ronde per kasus pada resource baru, N panggilan `placeHold` serentak yang dilepas bersamaan: **slot terakhir** (kapasitas 1, slot), **malam terakhir** (kapasitas 1, menginap), **pool 3** (kapasitas 3, kuantitas 1). N adalah 8 dan 32.                                                                                                              |
| 2   | Baca ketersediaan    | 500 resource x 2 unit, masing-masing berjadwal, dan 2.000 hold aktif tersebar di atasnya; jendela slot 7 hari untuk satu resource. 400 pertanyaan berurutan, lalu 400 dengan 16 pembaca sekaligus.                                                                                                                                                        |
| 3   | Reaper saat backlog  | 5.000 hold yang lewat waktu pada 100 resource dalam satu tenant, dikuras oleh `runBookingHoldExpiry` sebagai `awcms_worker` sampai satu run tidak menemukan apa pun, sementara 8 pengklaim terus menaruh hold pada resource lain. Melaporkan throughput pengurasan dan latensi pengklaim (kunci reaper tidak boleh menolak atau menahan slot yang bebas). |
| 4   | Ingest event absensi | 5.000 panggilan `recordEvent` (200 employment, 16 penulis, sekitar 10% dicatat supervisor, jalur yang diaudit), lalu 1.000 replay `clientEventKey` yang sudah ada.                                                                                                                                                                                        |

Batas anti-penyalahgunaan bawaan tenant bench (500 hold aktif per tenant, 5 per
pelanggan) dinaikkan hanya untuk tenant itu: benchmark backlog akan mengukur
429 bila tidak.

## Angka yang tercatat

Dua run `standard` berurutan pada mesin di bawah, dengan cluster dipakai
bersama proses lain (jadi bukan hasil terbaik pada mesin sepi). Semua waktu
dalam milidetik kecuali dinyatakan lain; "klaim" adalah satu `placeHold`
termasuk waktu menunggu kunci pemenang.

**Perangkat keras dan lunak:** 4 CPU logis (Intel Xeon Processor @ 2,80 GHz),
RAM 16 GB, PostgreSQL 16.14 (Ubuntu 24.04, x86_64, konfigurasi bawaan, TCP
loopback), Bun 1.3.14, pool runtime 34 koneksi. Tanggal: 16 Oktober 2026.

### 1. Klaim konkuren (p50 / p95 / p99 satu klaim)

| Kasus                   | Run 1           | Run 2           |
| ----------------------- | --------------- | --------------- |
| slot terakhir, 8 worker | 38 / 103 / 132  | 56 / 142 / 169  |
| malam terakhir, 8 w.    | 38 / 61 / 69    | 59 / 128 / 172  |
| pool 3, 8 worker        | 49 / 72 / 77    | 82 / 151 / 260  |
| slot terakhir, 32 w.    | 72 / 99 / 103   | 97 / 175 / 220  |
| malam terakhir, 32 w.   | 70 / 110 / 126  | 118 / 187 / 201 |
| pool 3, 32 worker       | 104 / 131 / 141 | 175 / 234 / 250 |

Setiap ronde: satu pemenang (tiga untuk pool), sisanya `SLOT_UNAVAILABLE`, tanpa
alokasi ganda. Satu ronde 32 arah selesai sekitar 75-185 ms pada median.

### 2. Baca ketersediaan (500 resource, 2.000 hold aktif, jendela 7 hari)

| Mode                   | Run 1 p50 / p95 / p99 | Run 2 p50 / p95 / p99 |
| ---------------------- | --------------------- | --------------------- |
| berurutan              | 6,5 / 16,6 / 24,5     | 4,8 / 13,6 / 18,4     |
| 16 pembaca sekaligus   | 55,9 / 106 / 119      | 35,4 / 62,6 / 78,6    |
| throughput, 16 pembaca | 256 pertanyaan/dtk    | 407 pertanyaan/dtk    |

### 3. Reaper kedaluwarsa hold (5.000 hold lewat waktu)

| Ukuran                                | Run 1     | Run 2     |
| ------------------------------------- | --------- | --------- |
| waktu pengurasan (2 run job)          | 8,6 dtk   | 9,4 dtk   |
| hold dikedaluwarsakan dan dilepas/dtk | 581       | 531       |
| klaim p50 / p95 saat pengurasan       | 218 / 285 | 214 / 280 |

Batas pass per tenant pada job membuat backlog memakan lebih dari satu run,
sebagaimana juga dilihat scheduler; run terakhir tidak menemukan apa pun.
Klaim yang berpacu dengan pengurasan lebih lambat daripada yang tak terganggu
di skenario 1 (sekitar 2x pada median) tetapi tidak ada yang ditolak:
`SKIP LOCKED` menjaga reaper tidak pernah menunggu atau menahan sebuah klaim.

### 4. Ingest event absensi (5.000 event, 16 penulis)

| Ukuran                 | Run 1        | Run 2        |
| ---------------------- | ------------ | ------------ |
| event tercatat / detik | 780          | 738          |
| catat p50 / p95 / p99  | 18 / 37 / 60 | 20 / 40 / 70 |
| replay p50 / p95 / p99 | 7 / 15 / 19  | 7 / 18 / 26  |

## Ambang (gerbang regresi)

Didefinisikan sebagai `THRESHOLDS` di `tests/bench/booking-bench.ts` dan berlaku pada profil `standard`:

| Budget                         | Batas            | Terburuk tercatat |
| ------------------------------ | ---------------- | ----------------- |
| balapan apa pun, p95 klaim     | <= 1.500 ms      | 234 ms            |
| ketersediaan, berurutan p95    | <= 250 ms        | 16,6 ms           |
| ketersediaan, 16 pembaca p95   | <= 750 ms        | 106 ms            |
| throughput pengurasan reaper   | >= 100 hold/dtk  | 531 hold/dtk      |
| p95 klaim saat reaper menguras | <= 1.500 ms      | 285 ms            |
| throughput ingest absensi      | >= 100 event/dtk | 738 event/dtk     |
| p95 pencatatan absensi         | <= 500 ms        | 40 ms             |

Marginnya sekitar 5-10x karena angka bergeser 1,5-2x antara dua run pada mesin
yang sama. Baseline ulang (perbarui tabel ini dan `THRESHOLDS` bersamaan)
saat perangkat keras atau versi mayor PostgreSQL berubah; jangan mengetatkan
batas sampai sama dengan nilai terukur.

## Keterbatasan benchmark ini

- Satu server database di host yang sama dengan pembangkit beban: latensi
  jaringan dan tier aplikasi terpisah tidak dimodelkan, dan angkanya memuat CPU
  pembangkit itu sendiri.
- Satu tenant per skenario; interferensi lintas tenant dan gerbang work-class
  dalam proses (admisi `withTenant`) tidak diuji.
- Ketersediaan dibaca terhadap backlog yang sudah tenang; pembacaan bersamaan
  dengan lalu lintas klaim yang berat tidak diukur.
- Tanpa lapisan HTTP: handler, autentikasi dan ABAC berada di luar pengukuran.
- Tidak dikaitkan ke CI: runner bersama memberi waktu yang tidak stabil.
  Invarian yang diperiksanya juga dibuktikan, tanpa waktu, oleh
  `tests/integration/booking-concurrency.integration.test.ts`.
