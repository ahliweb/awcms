🇮🇩 Bahasa Indonesia · 🇬🇧 [English (source)](workforce-metrics.md)

<!-- i18n-source-hash: sha256:8756f89682144ebcfe149c683c2f747f9bcbc4c69279ce92d867dffbeb00cefa -->

# Metrik tenaga kerja — fakta kehadiran, jam kerja, cakupan shift, dan produktivitas

> **Status:** sudah dibangun (Issue #953, Wave D epik platform; bertumpu pada data
> kehadiran dan shift dari Issue #946/#947). Modul: `hr_workforce` (experimental,
> layar karyawan, supervisor, dan HR sudah ada sejak Issue #952, lihat `workforce-self-service.md`). **Dokumen ini adalah kontrak acuan untuk metrik tenaga
> kerja.** Katalog metrik hulu yang dirujuk issue
> (`docs/aw-business-platform-metrics.md`) tidak ada di repositori ini; bila di
> sana sebuah metrik tenaga kerja didefinisikan berbeda, samakan dengan mengubah
> kontrak ini dan menaikkan `WORKFORCE_METRICS_CONTRACT_VERSION`, bukan dengan
> membiarkan dua definisi berdampingan.

## 1. Apa ini, dan apa yang sengaja ditolaknya

Metrik tentang waktu kerja orang adalah angka yang paling mudah disalahgunakan di
sebuah sistem back-office. Kontrak ini sengaja sempit:

- **Hanya fakta bisnis yang transparan.** Setiap angka adalah cacahan, jumlah
  menit, atau rasio dari dua angka yang disebutkan. Definisinya tertulis di §4 dan
  definisi yang sama dijalankan di kode (`domain/hr-workforce-metrics.ts`).
- **Tanpa skor komposit.** Tidak ada peringkat, rating, nilai, bobot, ambang,
  lampu lalu lintas, atau penanda "baik/buruk", dan tidak ada field yang bisa
  membawanya. Angka dua karyawan tidak pernah digabung menjadi vonis. Sebuah test
  memastikan kunci yang dilaporkan persis kunci kontrak dan tidak ada kunci
  respons bernama score, rank, rating, grade, atau risk.
- **Tanpa data foto, biometrik, perangkat, atau lokasi.** Tabel sumber tidak
  menyimpannya (keputusan pemilik O6, ADR-0138) dan kode metrik tidak punya input
  yang bisa membawanya. Bukti vonis geolokasi ADR-0138 juga tidak dibaca.
- **Tanpa payroll.** Metrik membaca `awcms_hr_attendance_events` dan
  `awcms_hr_shift_assignments` (ditambah header employment dan terms saat ini
  untuk office dan uji bekerja-dalam-jendela). Tabel kompensasi, komisi, dan
  payroll tidak pernah dibaca; gerbang batas payroll
  (`payroll:sql-boundary:check`, aturan payroll registry projection) tetap hijau.
- **Fakta bukan penilaian.** Shift terlewat bisa berarti clock-in tidak tercatat;
  keterlambatan bisa karena gangguan transportasi. Baca §7 sebelum memakai angka
  apa pun untuk keputusan tentang seseorang.

## 2. Dari mana angka berasal

| Sumber                                                        | Dipakai untuk                                                               |
| ------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `awcms_hr_attendance_events` (catatan efektif)                | saat clock-in/out dan break. Event yang digantikan dikecualikan.            |
| `awcms_hr_shift_assignments` (published, hanya `work`)        | shift terjadwal dan menit terencana. Draft, batal, time off: tidak dihitung |
| `awcms_hr_employments` + `awcms_hr_employment_terms` saat ini | pengelompokan office, tautan manajer, uji bekerja-dalam-jendela             |

Isolasi tenant adalah milik database (RLS `FORCE` di setiap tabel di atas); query
juga mengikat `tenant_id`.

## 3. Visibilitas — siapa melihat angka siapa

Default-deny. Tiga audiens untuk fakta per orang dan satu untuk agregat; semuanya
izin dan jalur baca yang terpisah, tidak pernah digabung.

| Audiens             | Caranya                                                    | Melihat                                                      |
| ------------------- | ---------------------------------------------------------- | ------------------------------------------------------------ |
| **Karyawan**        | `GET …/workforce-metrics/employees?mine=true` — tanpa izin | hanya employment miliknya                                    |
| **Supervisor**      | `…/employees?reports=true` — tanpa izin                    | hanya bawahan **langsung** (satu tingkat)                    |
| **HR**              | `hr_workforce.workforce_metrics.read`                      | semua karyawan di tenant                                     |
| **Pelihat agregat** | `hr_workforce.workforce_metrics.analyze` (atau `.read`)    | agregat per office, grup kecil ditahan; tanpa baris individu |

- `mine` dan `reports` adalah **ownership grant** (ADR-0063): dihitung di server
  dari tautan login yang tersimpan dan tautan manajer saat ini, tidak pernah dari
  request; hanya memperluas pembacaan ini; ABAC, scope, dan SoD tetap berjalan;
  kredensial mesin tidak pernah membawanya. Login yang tidak terhubung ke
  employment mana pun mendapat daftar kosong, bukan error dan bukan data orang
  lain.
- **Bawahan langsung, bukan rantai.** Daftar kehadiran menelusuri sepuluh tingkat
  rantai manajer; metrik sengaja tidak. Fakta berbau kinerja orang dua tingkat di
  bawah adalah yang paling tidak berhak dilihat seorang manajer. Employment yang
  di-soft-delete tidak tercakup. Fakta dimulai sejak garis pelaporan ada:
  supervisor melihat seorang bawahan hanya sejak `effective_from` term bawahan
  itu yang berlaku di bawahnya (perubahan jabatan memulai term baru dan memajukan
  tanggal itu), tidak pernah riwayat sebelum ia mengelola orang itu. Manajer yang
  diberhentikan, bawahan yang diberhentikan atau di-soft-delete, atau bawahan yang
  dipindahkan ke orang lain langsung tidak tercakup.
- `employmentId` di luar basis yang dipilih adalah **403 — jawaban yang sama
  dengan id yang tidak ada**, sehingga penolakan tidak membocorkan siapa yang ada.
- Memegang `analyze` **tidak** membuka daftar individu, dan tidak memegang apa pun
  adalah 403 di mana-mana. Input cacat dari pemanggil yang tidak berhak atas apa
  pun juga 403 (hak dinilai sebelum input).
- Tidak ada kunci yang diberikan ke peran mana pun secara default; "HR" adalah
  peran yang dibangun tenant. Keduanya tidak mengimplikasikan `attendance.read`,
  `corrections.read`, atau kewenangan kompensasi apa pun.
- Setiap respons `Cache-Control: private, no-store` dan membawa pemberitahuan tata
  kelola (§7).

## 4. Kontrak metrik (versi 1)

Jendela: `[from, to)` sebagai instan UTC, keduanya wajib, paling lama **31 hari**.
"Sekarang" adalah waktu request. Angka per employment; angka grup menjumlahkan
anggota dan menghitung ulang rasio dari jumlahnya (bukan rata-rata rasio).

| Kunci (JSON)             | Definisi                                                                                                                             | Satuan |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ | ------ |
| `scheduledShifts`        | shift `work` published, tidak batal, yang mulainya ada di jendela **dan sudah lewat**                                                | cacah  |
| `attendedShifts`         | dari itu, shift yang cocok dengan sebuah clock-in (di bawah)                                                                         | cacah  |
| `missedShifts`           | dari itu, shift yang sudah **berakhir** tanpa clock-in yang cocok. Shift yang sedang berjalan belum dihitung terlambat atau terlewat | cacah  |
| `lateArrivals`           | shift yang dihadiri dengan clock-in lebih dari **5 menit** setelah mulai                                                             | cacah  |
| `scheduledMinutes`       | panjang terencana dikurangi istirahat terencana, dari shift yang sudah berakhir                                                      | menit  |
| `workedMinutes`          | tiap sesi selesai (clock-in … clock-out, clock-in di dalam jendela): menit berlalu dikurangi istirahat yang diambil                  | menit  |
| `breakMinutes`           | istirahat yang diambil di dalam sesi-sesi itu                                                                                        | menit  |
| `incompleteSessions`     | clock-in tanpa clock-out dalam **24 jam** (lupa clock-out). Tidak pernah dihitung sebagai jam kerja                                  | cacah  |
| `coverageRatio`          | `attendedShifts / (attendedShifts + missedShifts)`; `null` bila belum ada shift yang tuntas                                          | rasio  |
| `workedToScheduledRatio` | `workedMinutes / scheduledMinutes`; `null` bila tidak ada yang dijadwalkan. Boleh lebih dari 1 (lembur). Fakta, bukan target         | rasio  |

**Pencocokan.** Sebuah clock-in cocok dengan shift paling awal yang belum cocok
yang rentang `[mulai − 2 jam, selesai)`-nya memuatnya; satu clock-in paling banyak
cocok dengan satu shift. Sesi masuk jendela menurut instan clock-in-nya; shift
menurut instan mulainya.

**Pembentukan sesi** longgar dan tidak pernah mengoreksi: clock-in kedua saat satu
masih terbuka, clock-out tanpa sesi terbuka, dan break di luar sesi diabaikan;
break yang masih terbuka saat clock-out berakhir di situ. Memperbaiki catatan
adalah tugas alur koreksi, bukan metrik.

**Pemetaan ke empat keluarga dalam issue.**

| Keluarga      | Kunci                                                                                  |
| ------------- | -------------------------------------------------------------------------------------- |
| Kehadiran     | `scheduledShifts`, `attendedShifts`, `missedShifts`, `lateArrivals`                    |
| Jam kerja     | `scheduledMinutes`, `workedMinutes`, `breakMinutes`, `incompleteSessions`              |
| Cakupan shift | `coverageRatio` (per karyawan, dan per office dalam agregat)                           |
| Produktivitas | `workedToScheduledRatio`, beserta pembilang dan penyebut yang disebutkan di sampingnya |

"Produktivitas" di sini dibatasi pada apa yang bisa dinyatakan data kehadiran dan
shift: waktu bekerja terhadap waktu terjadwal. Ukuran output per jam (penjualan,
tiket) butuh data modul sumber dan tidak dikarang di sini; metrik berikutnya
ditambahkan ke kontrak ini dengan definisi, sumber, dan visibilitasnya sendiri,
tidak diselundupkan.

## 5. Projection reporting yang didaftarkan

`hr_workforce` mendaftarkan satu projection ke engine `reporting`
(`reportingProjections`, seperti `booking` dan `inventory`):
**`hr_workforce.attendance_events`**, cacah seumur hidup event kehadiran yang
tercatat per jenis (`clock_in_events`, `clock_out_events`, `break_start_events`,
`break_end_events`), diturunkan inkremental dari tabel event append-only oleh
worker `cursor_table` yang sudah ada (kursor `recorded_at`, jam saat-insert
database; indeks di `sql/308`). Rebuild dan rekonsiliasi adalah milik engine.
Izin untuk membacanya: `hr_workforce.workforce_metrics.read` (HR).

**Mengapa hanya volume yang menjadi projection.** Engine menyimpan penghitung
seluruh-tenant, tiap angka dapat dibaca siapa pun yang memegang satu izin
descriptor. Bentuk itu tidak bisa mengatakan "hanya untuk karyawan itu" atau
"tahan bila kurang dari lima orang berkontribusi". Maka angka perilaku (§4)
**tidak** diproyeksikan: dihitung langsung dari catatan efektif, tempat hubungan
pelihat dengan tiap karyawan diperiksa per request dan supresi berlaku. Itulah
`drillDownPath` projection. Event yang digantikan tetap dihitung di projection
(penghitung hanya naik) dan tidak di angka langsung; projection adalah volume
event, bukan metrik §4.

## 6. Supresi grup kecil

**Aturan jendela (pengurangan/differencing).** Route `groups` hanya menerima
**satu minggu ISO UTC yang sudah tutup** (`from` hari Senin 00:00Z, `to` Senin
berikutnya). Jendela lain, termasuk bulan kalender, adalah `400`, begitu pula
minggu yang belum berakhir. Minggu saling lepas dan tidak pernah bersarang,
sehingga tidak ada dua jendela yang diterima yang bisa dikurangkan hingga
menyisakan potongan (sebulan dikurangi minggu penuh di dalamnya menyisakan hari
di tepinya, itulah sebabnya bulan tidak diterima). Dengan `from`/`to`
bebas, dua request yang berbeda satu potongan ekor mengisolasi satu orang (selisih
dua jumlah _adalah_ kontribusi orang itu ketika grup berada di sekitar ambang);
dengan bucket tetap, setiap agregat mencakup hari yang sama untuk semua orang, dan
bucket yang sudah tutup tidak tumbuh seiring jam. Sebuah test memutar ulang
serangan jendela-bergeser dan memastikan setiap jendela yang tidak selaras
ditolak.

**Aturan.** Agregat per office yang dihitung dari **kurang dari 5 karyawan
berkontribusi** ditahan seluruhnya: grup dikembalikan dengan `suppressed: true`
dan `reason: "small_group"` dan **tanpa angka** — bukan fakta, bukan jumlah
kontributor, dan **bukan `officeId`** (Issue #1083, L2): pemegang `.analyze`
saja tidak boleh tahu office mana yang ada atau mana yang di bawah ambang. Grup
yang ditahan didaftar setelah grup yang tampil, semuanya serupa, sehingga office
maupun posisinya dalam daftar tidak terbuka. Grup yang ditampilkan hanya melaporkan sebuah **band** (`"5-9"`,
`"10-19"`, `"20+"`), tidak pernah jumlah persisnya, sehingga menambah atau
mengurangi satu orang tidak menggeser angka yang tampil.

**Lantai kontributor.** _Kontributor_ adalah karyawan dengan sedikitnya
**`MIN_CONTRIBUTION_MINUTES = 240`** (empat jam) waktu terjadwal **atau** waktu
kerja dalam bucket. Karyawan di bawah lantai tidak dihitung terhadap ambang dan
tidak masuk jumlah. Tanpa lantai, satu karyawan nyata ditambah beberapa shift atau
sesi pendek yang ditanam akan mengangkat grup melewati lima dan menjadikan agregat
itu angka satu orang. Diuji dengan shift 15 menit yang ditanam.

**Konstanta.** `SMALL_GROUP_MIN_CONTRIBUTORS = 5` dan
`MIN_CONTRIBUTION_MINUTES = 240`. Katalog metrik yang dirujuk issue tidak
tersedia, jadi nilainya dipilih di sini: lima adalah angka yang sudah dipakai
laporan utilisasi `booking` untuk menahan rasio dan lazim sebagai batas bawah
dalam statistik publik; empat jam adalah setengah shift standar. Keduanya
**konstanta kode, bukan pengaturan tenant**, dengan sengaja: tenant yang bisa
menurunkannya menjadikan supresi saklar yang bisa dibalik oleh pihak yang justru
hendak dilindungi. Mengubahnya adalah perubahan kode dengan kenaikan versi
kontrak. Respons menyebut keduanya (`suppression`).

**Pengurangan antar-grup.** Endpoint agregat **tidak menyediakan total
seluruh-tenant**, sehingga grup yang ditahan tidak bisa dipulihkan dengan
mengurangkan grup yang tampil dari total. Rasio dihitung ulang dari jumlah.

**Di mana berlaku.** Hanya untuk agregat. Fakta per orang ditampilkan kepada yang
berhak atas orang itu (karyawan, supervisor langsungnya, HR); bagi mereka tidak
ada grup untuk bersembunyi. Izin agregat ada agar yang bukan HR bisa melihat
bagaimana sebuah lokasi diawaki tanpa melihat individu mana pun — yang hanya
bernilai bila agregat tidak bisa dipersempit sampai satu orang.

**Risiko sisa (disebut, tidak diselesaikan).**

0. **Office yang ditahan dapat disimpulkan lewat selisih himpunan (Issue #1083,
   L-3).** Grup yang ditahan tidak lagi menyebut office-nya, tetapi grup yang
   tampil tetap menyebutnya. Pemanggil yang tahu daftar office tenant dari
   jalur lain mengetahui mana yang tidak ada di respons, jadi ditahan.
   Menutupnya berarti menampilkan setiap office sebagai band atau menyembunyikan
   himpunan yang tampil juga; yang dilindungi penahanan bukan keberadaan
   office, melainkan angka kohort kecil.

1. **Menggabungkan izin mempersempit agregat (Issue #1083, M1).** Pemanggil yang
   juga tahu sebagian anggota grup kecil — sebagai supervisor sebagian dari
   mereka (`?reports=true`), atau karena dapat menanam atau melihat shift yang
   membuat seseorang menjadi kontributor (`shifts.create`, `shifts.publish`,
   lihat perbaikan H2 di #953) — dapat mengurangkan yang ia ketahui dari angka
   yang tampil dan mengetahui sisanya. **Aturan bagi tenant: jangan beri
   `.analyze` kepada orang yang menyupervisi, atau menjadwalkan, orang-orang
   yang sama.** **Mengapa didokumentasikan dan tidak ditegakkan:** aturan SoD
   platform (`ModuleDescriptor.sodRules`) diperiksa di chokepoint hanya untuk
   aksi high-risk dan berupa pasangan izin. `.analyze` bukan high-risk,
   "menyupervisi office yang sama" adalah fakta tautan manajer dan bukan izin,
   dan peran `owner` setiap tenant memegang semua izin, sehingga aturan atas
   `analyze` + `shifts.publish` akan menolak publish milik owner. Karena itu
   aturan ini keputusan desain peran tenant (dan kelak kondisi ABAC pada tautan
   manajer), bukan bawaan. Jejak audit menyempitkan celahnya: pembacaan agregat
   dan setiap pembacaan seluruh karyawan meninggalkan baris
   `sensitive_read.workforce_metrics` (bagian 9).

2. Perubahan keanggotaan antar bucket terlihat dengan sendirinya: bila grup tampil
   di minggu 12 dan tidak di minggu 13, seseorang keluar atau turun di bawah
   lantai.
3. Grup tepat lima dengan empat angka identik membuka angka kelima bagi yang
   mengenal keempatnya.
4. Bucket yang sudah tutup masih bisa berubah sedikit sesudahnya: replay kiosk
   offline (sampai tujuh hari terlambat) atau koreksi yang disetujui dapat
   mengubahnya. Dua pembacaan bucket sebelum dan sesudah perubahan itu berbeda
   sebesar catatan terlambat tersebut.
5. Projection volume event seluruh-tenant hanya untuk HR karena di tenant satu
   karyawan penghitung apa pun menjadi bersifat pribadi.

## 7. Tinjauan tata kelola sebelum pemakaian yang berdampak

Angka-angka ini menggambarkan kehadiran yang tercatat dan shift yang
dipublikasikan. Mereka masukan untuk sebuah percakapan, bukan penilaian.
**Sebelum angka apa pun dari kontrak ini dipakai untuk memutuskan sesuatu yang
berdampak tentang seseorang** — sanksi disiplin, gaji, promosi, demosi,
pemutusan hubungan kerja, penalti jadwal, atau keputusan otomatis apa pun — pemberi
kerja harus telah menyelesaikan dan mencatat, di luar sistem ini:

1. **Pernyataan tujuan** yang menyebut keputusannya dan mengapa fakta kehadiran
   relevan dan proporsional untuknya.
2. **Penilaian pelindungan data** bila hukum mewajibkan (UU PDP / penasihat hukum
   pemberi kerja yang menentukan), mencakup retensi dan akses.
3. **Langkah tinjauan manusia**: seseorang melihat konteks di balik angka
   (clock-in tidak tercatat, koreksi tertunda, cuti yang disetujui, gangguan
   sistem) sebelum bertindak. Tidak ada keputusan merugikan otomatis berdasarkan
   fakta ini.
4. **Pemberitahuan kepada karyawan** tentang angka apa yang ada, siapa melihat,
   dan untuk apa.
5. **Jalur untuk menyanggah**: karyawan dapat membaca angkanya sendiri
   (`mine=true`) dan meminta koreksi kehadiran (`corrections.create`) lewat alur
   persetujuan.

API mengulang bentuk singkatnya di setiap respons (`governance`). Modul tidak
menegakkan tinjauan itu — ia tidak bisa tahu sebuah keputusan diambil — itulah
sebabnya angka-angka ini fakta, bukan penanda, dan tidak ada field yang menandai
seseorang sebagai masalah.

**Belum dimitigasi oleh produk.** Belum ada **layar yang menghadap karyawan**:
karyawan hanya bisa membaca angkanya sendiri dan meminta koreksi lewat API,
sehingga "jalur untuk menyanggah" di atas ada di API tetapi belum sebagai sesuatu
yang bisa ditemukan karyawan. Sampai layar tersedia, pemberi kerja harus
menyediakan cara lain bagi karyawan untuk melihat angkanya sendiri bila diminta.
Angka turunan tidak diekspor atau dihapus terpisah oleh perangkat hak subjek
(angka dihitung langsung dari baris kehadiran dan shift, yang tercakup), dan HR
tetap melihatnya, berkunci `employeeNo`, untuk employment yang orangnya sudah
dianonimkan, selama baris employment-nya ada. Retensi catatan kehadiran dasar
adalah keputusan pemberi kerja (ADR-0132 bagian 13.2).

## 8. Bukti

| Bukti                                                                                                                                                                                                | Ditunjukkan di                                                                                                         |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Tiap definisi §4 menghasilkan angka yang dinyatakan                                                                                                                                                  | `tests/hr-workforce-metrics.test.ts` (jam kerja, break, toleransi terlambat, pencocokan, cakupan, rasio produktivitas) |
| Angka yang sama keluar dari baris nyata (catatan efektif, hanya shift kerja published, tepi jendela)                                                                                                 | `tests/integration/hr-workforce-metrics-database.integration.test.ts`                                                  |
| Tanpa skor, peringkat, atau penanda; tanpa kunci foto/biometrik/perangkat/lokasi                                                                                                                     | asersi himpunan kunci di test unit dan `…-api.integration.test.ts`                                                     |
| Supresi grup kecil: 4 ditahan tanpa digit, 5 tampil; non-kontributor tidak dihitung; tanpa total                                                                                                     | test unit + database + API                                                                                             |
| Kepemilikan: data karyawan lain 403 (sama dengan id yang tidak ada); orang dua tingkat di bawah, rekan setingkat, dan orang luar ditolak untuk supervisor; login tak terhubung tidak melihat apa pun | `tests/integration/hr-workforce-metrics-api.integration.test.ts`                                                       |
| Default-deny: tanpa token 401; tanpa izin 403; `analyze` tidak membuka daftar individu                                                                                                               | test API                                                                                                               |
| Isolasi tenant (RLS) untuk fakta dan grup                                                                                                                                                            | test database dan API                                                                                                  |
| Projection menghitung tiap jenis sekali, rekonsiliasi cocok, selamat dari rebuild tanpa hitung ganda                                                                                                 | test database (peran worker)                                                                                           |
| Tidak ada tabel payroll yang dibaca                                                                                                                                                                  | `bun run payroll:sql-boundary:check` dan aturan payroll registry projection                                            |

## 9. Keterbatasan

- Layar baca untuk karyawan, supervisor, dan HR sudah ada (Issue #952, `workforce-self-service.md`); pembacaan mode `all` per orang oleh HR tetap hanya lewat API sampai audit baca Issue #1083 selesai.
- Aritmetika jendela memakai instan UTC; klien yang butuh jendela hari lokal
  mengonversinya. Pengelompokan office memakai terms **saat ini**, bukan terms pada
  saat tiap shift.
- Jendela daftar per karyawan adalah instan UTC bebas (paling lama 31 hari);
  agregat hanya menerima satu minggu ISO penuh yang sudah tutup
  (bagian 6).
- Tenant di atas 10.000 employment mendapat `422 WORKFORCE_METRICS_SCOPE_TOO_LARGE`
  di endpoint agregat (diputuskan dari COUNT sebelum halaman apa pun dibaca); agregat yang dipecah atau dihitung-di-muka adalah tindak
  lanjut.
- **Audit pembacaan (Issue #1083, M3, M-2).** Pembacaan SELURUH karyawan atas
  fakta tingkat-orang (`employees` tanpa `mine` maupun `reports`) DAN pembacaan
  `reports` lewat rantai manajer (hingga sepuluh tingkat pada daftar kehadiran,
  sehingga direktur tanpa izin HR dapat membaca semua orang) adalah sensitive
  read, dengan atribut `mode` (`all` atau `reports`): satu baris audit berjenis `sensitive_read.workforce_metrics` memuat id
  employment dan jumlah, tidak pernah angka, digabung per aktor dalam jendela
  lima menit (baris `warning` tambahan pada kelipatan 10/100/1000 pembacaan atau
  item dalam jendela). Rute agregat mencatat izin yang benar-benar
  memberi akses: `.read` dengan jenis yang sama (jumlah grup, tanpa id),
  `.analyze` dengan `sensitive_read.workforce_metrics_aggregate` (satu jenis
  hanya untuk satu kebijakan). Daftar kehadiran dicakup dengan cara sama
  (`sensitive_read.attendance_events`), begitu pula koreksi kehadiran
  (`sensitive_read.attendance_corrections`): DAFTAR-nya (jam usulan semua
  karyawan) pada mode all dan reports, dan satu catatan hanya bila alasan
  bebasnya diperoleh dari grant peran `corrections.read`, bukan untuk pemohon
  atau assignee persetujuan. Hanya pembacaan DIRI SENDIRI yang tidak dicatat
  (decision log tetap mencatat tiap otorisasi). Jendela berlaku per aktor dan
  jenis, sehingga pembacaan `reports` yang id-nya sudah diaudit di jendela itu
  sebagai `all` tidak menambah baris. Pembacaan bukti lokasi mempertahankan
  barisnya sendiri (`hr_workforce.location_evidence.read`), yang kini memuat id
  employment pada halaman itu.
  Izin baca `hr_workforce` lain diklasifikasi, beserta alasan, di
  `NOT_SENSITIVE_READS` (`src/modules/_shared/sensitive-reads.ts`) dan
  `hr_workforce` ada di `SENSITIVE_READ_MODULE_KEYS`, sehingga izin baca baru
  modul ini belum terklasifikasi (dan `bun run sensitive-reads:check` merah)
  sampai ada yang memutuskan.
- Layar untuk karyawan atas `?mine=true` (jalur transparansi dan keberatan)
  tidak dibangun di sini; itu milik #952.
- Tenant yang sudah ada harus diberi dua izin baru
  (`bun run identity-access:permissions:backfill`), seperti setiap migrasi seed
  izin.
