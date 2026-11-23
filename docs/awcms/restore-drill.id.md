🇮🇩 Bahasa Indonesia · 🇬🇧 [English (source)](restore-drill.md)

<!-- i18n-source-hash: sha256:84e7e3b5eb59f4d3c1ca46f7d58d9a5cf60f917203e059820f86fc781ff1f49e -->

# Gladi backup, restore dan kelangsungan bisnis (separuh generik)

> **Status:** separuh otomatis dan sintetis sudah dibangun (Issue #968, keputusan
> pemilik K13 22 Nov 2026). **Separuh payroll belum**: `hr_payroll` terblokir
> DPIA (#976) dan tabelnya (#957) belum ada, sehingga pemeriksaannya dicatat
> `deferred` di setiap laporan (bagian 6) dan isu tetap terbuka. Gladi
> **terhadap deployment produksi dijalankan operator** (bagian 5), tidak
> diotomasi di sini.

Pendamping [`deploy/backup/README.md`](../../deploy/backup/README.md) (skrip
backup dan restore serta rancangan enkripsi/manifes, ADR-0123),
[`resilience-dr-verification.md`](resilience-dr-verification.md) dan
[`production-preflight-runbook.md`](production-preflight-runbook.md).

## 1. Apa yang dibuktikan gladi ini

`bun run ops:restore-drill` mengambil dump sebuah database berisi data
sintetis, memulihkannya ke **klaster kedua yang baru**, lalu menunjukkan bahwa:

| Klaim                                        | ID pemeriksaan                                                                                                                                   |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| semua tabel dan baris kembali, tak berubah   | `table_set`, `row_counts`, `row_checksums` (`md5` tak bergantung urutan atas setiap baris, per tabel)                                            |
| tidak ada sequence yang mundur               | `sequences_not_behind` (insert berikutnya tak dapat memakai ulang kunci)                                                                         |
| reservasi dan alokasi berasal dari satu saat | `booking_point_in_time`, `booking_reconciliation_clean` (booking.md bagian 7.1, dijalankan sesudah restore)                                      |
| row-level security bertahan                  | `rls_force_catalog`, `policies`, `rls_force_no_new_offenders`, dan sebagai `awcms_app`: `rls_isolation_as_app`, `rls_cross_tenant_write_refused` |
| grant role bertahan                          | `roles`, `grants_relations`, `grants_columns`, `functions_and_grants`, `triggers`, `append_only_grant_as_app`, `runtime_role_not_privileged`     |
| skema di sekitar data utuh                   | `constraints`, `indexes`, `extensions`                                                                                                           |

Domain yang diisi: booking (hold, konfirmasi, pembatalan, penjadwalan ulang,
reservasi slot dan menginap, semuanya ditulis lewat layanan asli sebagai
`awcms_app`, sehingga alokasi, riwayat, baris audit dan event adalah yang
ditulis produksi) dan kehadiran hr_workforce (employment dan event jam). Sisanya
adalah apa yang dihasilkan migrasi dan penulis-penulis itu; setiap tabel di
`public` dibandingkan.

**Titik waktu.** Gladi mengekspor snapshot, membaca digest saksi di dalamnya,
meng-commit reservasi dan satu event kehadiran tambahan **sesudahnya**, baru
menjalankan `pg_dump --snapshot`. Hasil restore harus sama dengan saksi dan tidak
boleh memuat satu pun tulisan susulan; salinan yang bukan satu saat akan tampak
sebagai drift rekonsiliasi. Gladi yang tidak menulis apa pun setelah snapshot
gagal (`booking_point_in_time` menolak lulus secara hampa).

**Sebagai `awcms_app`, bukan superuser.** Superuser melewati RLS, sehingga setiap
pemeriksaan isolasi akan lulus apa pun yang terjadi pada restore. Probe perilaku
login sebagai role runtime sungguhan pada database hasil restore: bukan superuser
atau `BYPASSRLS`, melihat nol baris tanpa konteks tenant dan untuk tenant asing,
melihat tepat jumlah saksi per tenant, ditolak `INSERT` lintas tenant (`42501`),
dan ditolak `UPDATE` pada log kehadiran append-only. Probe yang keliru diterima
di-rollback, tidak pernah ditinggalkan.

**Role bersifat tingkat klaster.** `pg_dump` tidak membawa role, dan restore ke
klaster tanpa role gagal pada `GRANT` pertama. Gladi membuat ulang role
`awcms_*` dari atribut sumber, setelan per-role (default `app.current_tenant_id`
yang fail-closed) dan keanggotaan, lalu memasang password sekali pakai
(operator memberi rahasia sungguhan seperti pada deployment mana pun; header
sql/019). Langkah itu diukur terpisah agar RTO tidak menyembunyikannya.

## 2. Menjalankannya

Dua klaster loopback sekali pakai (host:port berbeda; skrip menolak klaster yang
sama karena role sudah ada dan tidak membuktikan apa pun) dan `pg_dump`/
`pg_restore` dengan versi mayor minimal sama dengan server:

```bash
docker run -d --name drill-src --network host -e POSTGRES_USER=awcms -e POSTGRES_PASSWORD=awcms_password -e PGPORT=55968 postgres:18-alpine
docker run -d --name drill-dst --network host -e POSTGRES_USER=awcms -e POSTGRES_PASSWORD=awcms_password -e PGPORT=55969 postgres:18-alpine

export TMPDIR=/path/yang/lapang   # dump ditulis di sini
DRILL_SOURCE_URL=postgres://awcms:awcms_password@127.0.0.1:55968/postgres \
DRILL_TARGET_URL=postgres://awcms:awcms_password@127.0.0.1:55969/postgres \
  bun run ops:restore-drill --reservations 40 --employees 6 --days 5 --report drill.json

docker rm -f -v drill-src drill-dst
```

Skrip hanya membuat dan menghapus database bernama `awcms_drill_*`, menolak host
non-loopback, mencetak laporan JSON dan keluar non-nol kecuali setiap
pemeriksaan **wajib** ada dan lulus: menghapus satu pemeriksaan dari alurnya
menggagalkan gladi (`REQUIRED_CHECK_IDS`). Password diteruskan ke `pg_dump` dan
`pg_restore` lewat environment, tidak pernah argv.

Tes: `tests/restore-drill-compare.test.ts` (setiap pembanding gagal pada input
yang sengaja dirusak, dan gladi yang kehilangan pemeriksaan wajib mana pun gagal)
dan `tests/integration/restore-drill.integration.test.ts` (restore sungguhan,
lalu dua belas gangguan pada database hasil restore, yang masing-masing harus
memerahkan pemeriksaan yang sesuai dan, setelah dipulihkan, kembali hijau: FORCE
hilang, grant diperlebar atau dicabut, `BYPASSRLS`, policy diperlebar, sequence
dimundurkan, satu sel berubah, event hilang, alokasi hilang, fungsi menjadi
`SECURITY INVOKER`, trigger dimatikan, grant kolom; ditambah saksi yang mengklaim
tulisan pasca-snapshot bocor atau tidak ada).

## 3. RTO dan RPO

**RTO (terukur, LOKAL).** Gladi melaporkan `measuredRtoMs` = dump + penyediaan
role + restore + verifikasi, tiap fase terpisah; persiapan (migrasi, pengisian)
tidak termasuk.

**RPO adalah sifat kebijakan backup, bukan sesuatu yang diukur gladi.** Ia adalah
selang antara dua dump yang dapat dipakai (ditambah WAL terarsip, yang tidak
dijalankan deployment ini): `deploy/backup/backup-postgres.sh` yang dijalankan
setiap _T_ memberi RPO paling lama _T_ ditambah waktu menyalinnya ke luar situs.
Gladi memulihkan dump yang diberikan; ia tidak memilihnya. RPO produksi adalah
jadwal yang dijalankan operator dan dicatat di log gladi; tidak ada angka yang
diklaim di sini. (`deploy/backup/restore-drill.sh` melaporkan umur backup yang
dipulihkan sebagai `restoreRpoSeconds`: pengamatan satu backup, bukan kebijakan.)

## 4. Log gladi

> **LOKAL.** Klaster Docker loopback pada mesin pengembang bersama (PostgreSQL
> 18.x, `pg_dump` 18.6), `fsync` bawaan, data sintetis, tanpa lapisan enkripsi.
> Ini **bukan** angka produksi dan bukan pernyataan kapasitas; angka ini
> membatasi biaya prosedur pada database kecil yang didominasi skema.

Run 23 Nov 2026, empat run, semua `ok`:

| Run     | Reservasi/tenant | Karyawan/tenant | Hari | Tabel | Baris (semua tabel) | Byte dump | dump ms | role ms | restore ms | verifikasi ms | **RTO ms** |
| ------- | ---------------- | --------------- | ---- | ----- | ------------------- | --------- | ------- | ------- | ---------- | ------------- | ---------- |
| kecil 1 | 40               | 6               | 5    | 278   | 3168                | 2.894.580 | 540     | 44      | 6884       | 736           | **8204**   |
| kecil 2 | 40               | 6               | 5    | 278   | 3168                | 2.894.789 | 535     | 41      | 6229       | 690           | **7495**   |
| kecil 3 | 40               | 6               | 5    | 278   | 3168                | 2.894.404 | 535     | 177     | 5747       | 755           | **7214**   |
| sedang  | 300              | 30              | 6    | 278   | 12252               | 3.536.971 | 574     | 42      | 5669       | 748           | **7033**   |

(Tiap run: 2 tenant; run sedang mengisi 810 baris reservasi dan 720 event
kehadiran; run kecil 108 dan 120.)

Membacanya: **restore didominasi skema, bukan baris.** 278 tabel, 1.270 indeks,
298 policy dan 162 trigger memakan sekitar 5,7 sampai 6,9 detik baik database
berisi 3 ribu maupun 12 ribu baris, sehingga empat kali lipat baris tidak menggeser RTO
melampaui derau antar-run (7,0 sampai 8,2 detik). Jangan mengekstrapolasi volume baris dari sini; gladi
berukuran produksi (bagian 5) yang mengukurnya.

Ke-21 pemeriksaan wajib lulus di setiap run, 15 constraint `CHECK` sama setelah
tanda kurung pengelompokan diabaikan (lihat keterbatasan), dan rekonsiliasi
booking pasca-restore melaporkan drift 0 untuk kedua tenant. Role runtime hasil
restore login sebagai `awcms_app` (bukan superuser, bukan `BYPASSRLS`).

**Satu temuan, bukan kegagalan gladi.** `awcms_setup_state` memiliki kolom
`tenant_id` dan tidak punya row-level security, sebelum dan sesudah restore; ia
satu-satunya "tabel tenant tanpa FORCE" di skema. Pemeriksaannya
(`rls_force_no_new_offenders`) hanya gagal pada tabel yang **kehilangan** FORCE
karena restore, jadi gladi hijau; apakah tabel itu perlu dilindungi adalah
pertanyaan terpisah bagi pemiliknya, dicatat di sini, tidak diterima diam-diam.

**Keterbatasan gladi, dinyatakan.**

- Definisi `CHECK` dibandingkan tanpa tanda kurung dan spasi, karena `pg_dump`
  menulis ulang dan restore mem-parse ulang, meratakan grup `AND`/`OR` bersarang
  (15 check hanya beda pengelompokan). Kondisi yang berubah, hilang atau
  bertambah tetap gagal; pengelompokan ulang murni tidak terlihat.
- Sequence dibandingkan "tidak mundur": sequence tidak transaksional, sehingga
  dump boleh membaca nilai yang lebih maju dari snapshot.
- Gladi memakai `pg_dump`/`pg_restore` polos. Ia tidak menguji enkripsi `age`,
  manifes terautentikasi, atau salinan luar situs ADR-0123;
  `deploy/backup/restore-drill.sh` melakukannya, pada backup sungguhan, dan itulah
  yang dijalankan terjadwal.
- Ia tidak menguji pengarsipan WAL atau pemulihan titik waktu (tidak
  dikonfigurasi), replika, atau versi mayor PostgreSQL yang berbeda.
- `security:readiness` tidak dijalankan terhadap database hasil restore oleh
  gladi ini.

## 5. Gladi produksi: runbook operator

Dijalankan operator terhadap backup deployment sungguhan, pada jadwal milik
operator (minimal sebelum setiap rilis mayor dan setelah perubahan apa pun pada
backup, enkripsi atau penyiapan role). Gladi tidak pernah menargetkan produksi.

1. **Pilih backup sungguhan** hasil `deploy/backup/backup-postgres.sh`
   (terenkripsi, dengan manifesnya) yang sudah disalin ke luar situs; catat nama
   artefak dan `sha256`-nya. Memulihkan salinan lokal hanya membuktikan salinan
   lokal.
2. **Klaster scratch, versi mayor PostgreSQL sama dengan produksi**, terisolasi
   dari produksi (tanpa jaringan bersama, tanpa rahasia produksi). Buat role
   lebih dulu: role `awcms_*` bersifat tingkat klaster dan tidak ada di dump.
   Daftar dari produksi (`SELECT rolname FROM pg_roles WHERE rolname LIKE
'awcms\_%'`) dan buat dengan atribut serta default `ALTER ROLE ... SET` yang
   sama (`docs/awcms/environments.md`); pasang password runtime sungguhan seperti
   deployment baru (`ALTER ROLE awcms_app LOGIN PASSWORD '<rahasia>'`).
3. **Restore:** `deploy/backup/restore-postgres.sh <artefak>` (mode gladi, bawaan;
   memverifikasi manifes dan mendekripsi dulu) ke database scratch. Mulai
   pewaktu pada langkah 2 dan hentikan saat langkah 6 lulus: itulah RTO aktual
   deployment ini.
4. **Migrasi maju:** `bun run db:migrate` pada database hasil restore untuk
   membuktikan rilis saat ini berlaku di atas data hasil restore
   ([`production-preflight-runbook.md`](production-preflight-runbook.md)).
5. **Bandingkan** dengan isi produksi pada saat backup bila bisa: jumlah baris
   tabel domain (`awcms_booking_reservations`,
   `awcms_booking_resource_allocations`, `awcms_hr_attendance_events`, tabel
   payroll setelah ada), dan `SELECT relname, relforcerowsecurity FROM pg_class
WHERE relrowsecurity` untuk FORCE.
6. **Verifikasi sebagai role runtime, bukan pemilik:** login sebagai `awcms_app`;
   tanpa konteks tenant tabel tenant harus mengembalikan 0 baris; dengan id tenant
   nyata harus mengembalikan jumlah tenant itu; dengan UUID asing, 0. Lalu jalankan
   rekonsiliasi booking (`GET /api/v1/booking/reservations/reconciliation`,
   booking.md bagian 7.1) untuk setiap tenant aktif: reservasi dan alokasi harus
   kembali dari titik waktu yang sama, `drift` 0. Setelah restore apa pun jalankan
   juga `bun run security:readiness` dengan environment produksi (bukan `.env`
   lokal).
7. **Catat** di log gladi: tanggal, artefak dan `sha256`, umur backup (RPO yang
   teramati pada backup itu) dan RPO kebijakan, RTO terukur per fase, volume data,
   siapa yang menjalankan, dan setiap selisih. Hancurkan klaster scratch.

Tambahan payroll (berlaku setelah #957 mendarat; pemeriksaannya `deferred` pada
laporan sampai saat itu, bagian 6):

- simpan setiap key id yang masih dibutuhkan backup yang dapat dipulihkan di
  **kedua** key ring enkripsi dan hash (ADR-0137 bagian 2 dan 6): sebelum
  menjatuhkan sebuah key id, kueri prefiks `keyId` pada `account_ciphertext` di
  database **dan di setiap backup yang disimpan**;
- gladi restore **tanpa** key ring (reveal dan re-enkripsi harus gagal tertutup;
  baca bertopeng berfungsi) dan **dengan** key ring (reveal berfungsi, ciphertext
  yang terikat AAD terautentikasi);
- jalankan rekonsiliasi payroll (hr-payroll.md bagian 14) setelah kehadiran,
  komisi dan payroll dipulihkan dari titik waktu yang sama;
- pertanyaan penasihat L-P8 (backup yang masih memuat subjek data yang sudah
  dipurge) bergantung pada bukti gladi ini.

## 6. Payroll: ditunda, dengan titik kaitnya

Kontrol payroll di atas adalah bagian #968 yang memerlukan akun pembayaran dan
key ring, yakni #957. Ia hadir di setiap laporan sebagai `deferred`, tidak pernah
absen dan tidak pernah dihitung lulus (`PAYROLL_DEFERRED_CHECKS` di
`scripts/lib/restore-drill.ts`):

| Pemeriksaan tertunda                   | Kontrak                                                                                      |
| -------------------------------------- | -------------------------------------------------------------------------------------------- |
| `payroll_key_ring_retention`           | setiap key id yang dibutuhkan backup yang dapat dipulihkan ada di key ring enkripsi dan hash |
| `payroll_restore_without_key_ring`     | reveal dan re-enkripsi gagal tertutup, baca bertopeng berfungsi                              |
| `payroll_restore_with_key_ring`        | reveal berfungsi, ciphertext terikat AAD terautentikasi                                      |
| `payroll_reconciliation_after_restore` | rekonsiliasi payroll setelah kehadiran, komisi dan payroll dipulihkan ke satu saat           |

**Titik kait untuk #957:** tambahkan seed payroll ke
`scripts/lib/restore-drill-seed.ts` (akun pembayaran sintetis di bawah key ring
**sekali pakai**, bukan kunci sungguhan), tambahkan ID pemeriksaan ke
`REQUIRED_CHECK_IDS` dan implementasikan di `scripts/lib/restore-drill-verify.ts`,
lalu pindahkan entri dari `PAYROLL_DEFERRED_CHECKS`. Daftar gangguan pada tes
integrasi adalah tempat gangguan "key ring hilang" dan "key id salah". Sampai
saat itu isu tetap terbuka.

## 7. Hal terbuka

- Gladi produksi (bagian 5) belum dijalankan: ia memerlukan deployment dan backup
  operator.
- Tidak ada RPO produksi yang dinyatakan: ia mengikuti jadwal yang dijalankan
  operator.
- Pemilik `awcms_setup_state` memutuskan apakah ia memerlukan row-level security.
