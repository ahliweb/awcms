🇮🇩 Bahasa Indonesia · 🇬🇧 [English (source)](payroll-breach-notification-runbook.md)

<!-- i18n-source-hash: sha256:bac5852930000cdb3199bcae65a53db6c1f04af2d9f349071670d180e84cf86b -->

# Prosedur notifikasi pelanggaran data payroll (runbook)

> **STATUS: DRAF — belum disetujui; bukan nasihat hukum.** Ini prosedur yang
> disusun agen (keputusan pemilik K13, 22 November 2026). Isinya mengubah fakta
> teknis repositori ini menjadi prosedur operasi. **Ia tidak menentukan apa yang
> diwajibkan hukum.** Setiap rujukan hukum di bawah ditandai sebagai dikutip dari
> teks resmi dengan kewajiban konfirmasi, atau berbunyi "perlu verifikasi
> penasihat hukum". Prosedur ini berlaku hanya setelah pengendali data dan
> penasihat hukum meninjau dan menandatangani bagian 16. Sampai saat itu,
> perlakukan tenggat di bagian 5 sebagai **usulan**, bukan kewajiban.

- **Isu:** #1448. Menangani risiko residual **R-12** pada draf DPIA
  `docs/awcms/dpia-hr-payroll-phase-3.md` (draf di PR #1451, belum ada di `main`;
  "pelanggaran data payroll tidak terdeteksi atau tidak diberitahukan dalam
  tenggat yang diwajibkan") dan pertanyaan hukum **L-P9** pada
  [`hr-payroll.md`](hr-payroll.md) bagian 17.
- **Bergantung pada:** keputusan pemilik **O5** (apakah operator platform adalah
  pengendali, prosesor, atau keduanya, per deployment). O5 masih **terbuka**;
  bagian 2 memberi prosedur untuk tiap hasil dan tidak memilih salah satu.
- **Terkait:** [`privacy-analysis.md`](privacy-analysis.md) bagian 5 (apa yang
  hanya bisa dijawab operator), [`../../SECURITY.md`](../../SECURITY.md) (laporan
  kerentanan, kanal yang berbeda), [`data-lifecycle.md`](data-lifecycle.md)
  (legal hold), [`hr-payroll.md`](hr-payroll.md) 13.2 dan 13.3 (kesiapan
  pelanggaran, pembacaan sensitif).

## 1. Cakupan dan arti "data payroll" di sini

Dalam cakupan: **akses tanpa izin, pengungkapan, perubahan, kehilangan, atau
ketidaktersediaan** yang terkonfirmasi atau diduga atas data pribadi yang
disimpan untuk keluarga modul payroll (`hr_payroll`, serta data terkait
kompensasi dari `hr_commission` dan `hr_workforce`): kompensasi (dasar upah dan
nominal), akun pembayaran (rujukan bank atau dompet), baris run payroll
(pendapatan, potongan, pemotongan pajak), slip gaji, akrual komisi, fakta
kehadiran dan metrik, dan berkas ekspor apa pun dari data itu.

Di luar cakupan: laporan kerentanan tanpa bukti pengungkapan (pakai
`SECURITY.md`), dan gangguan layanan tanpa dampak kerahasiaan atau integritas
(pakai runbook operasi biasa, mis.
[`database-capacity-runbook.md`](database-capacity-runbook.md)). Gangguan yang
menghilangkan data payroll **termasuk** dalam cakupan (ketersediaan dan
kehilangan bagian dari definisi di atas; apakah suatu kehilangan wajib
diberitahukan adalah pertanyaan hukum, lihat bagian 3).

**Keadaan implementasi, dinyatakan terus terang.** Modul `hr_payroll` masih
**rancangan** (lihat `hr-payroll.md`): saat ini tidak ada tabel payroll di
`sql/` dan tidak ada rute payroll di `src/modules/`. Yang ada dan dipakai di
bawah: jejak audit (`awcms_audit_events`), audit pembacaan sensitif beserta
registri kebijakannya (`src/modules/_shared/sensitive-reads.ts`, yang sudah
menamai jenis payroll), log keputusan otorisasi, sesi, mesin legal hold, gerbang
kesiapan keamanan, dan pemeriksaan batas katalog payroll. Bila sebuah langkah
merujuk aksi audit yang akan ditulis modul payroll (mis. baris reveal akun
pembayaran), teksnya menyebutkannya. **Sebelum fase 3 tayang, kueri di bagian 8
harus dijalankan ulang pada database yang modul payrollnya aktif dan keluarannya
dibandingkan dengan dokumen ini** (butir go-live, bagian 15.4).

## 2. Siapa pengendali dan siapa prosesor

### 2.1 Para pihak dalam deployment AWCMS

| Pihak                 | Siapa                                                                                                                                             |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Operator**          | AhliWeb (atau siapa pun yang menjalankan deployment AWCMS): aplikasi, database, akun hosting, cadangan, administrasi platform.                    |
| **Tenant**            | Organisasi yang karyawannya digaji lewat deployment. Tiap tenant terisolasi oleh RLS; jejak audit per tenant.                                     |
| **Subjek data**       | Karyawan tenant (dan, untuk komisi, penerima manfaat yang dicatat tenant).                                                                        |
| **Sub-prosesor**      | Penyedia hosting dan cadangan, penyedia email atau pesan bila diaktifkan. Didaftar di addendum per-deployment (dokumen B DPIA, dilacak di #1449). |
| **Otoritas pengawas** | Otoritas pelindungan data menurut UU PDP. Apakah sudah terbentuk dan bagaimana ia menerima notifikasi **perlu diverifikasi penasihat hukum**.     |

### 2.2 Asumsi kerja, dan apa yang diubah O5

Draf DPIA (bagian 1.5) membahas **tiap tenant sebagai pengendali** data
karyawannya dan operator sebagai **prosesor** untuk data payroll tenant, serta
mungkin **pengendali** untuk data akun, keamanan, dan auditnya sendiri. Itu
pembahasan, bukan keputusan: **O5 memutuskannya per deployment.** Prosedur ini
ditulis agar langkah teknis sama di semua kasus dan hanya kolom "siapa
memberitahu siapa" yang berubah.

| Peristiwa                                            | Bila tenant = pengendali, operator = prosesor (asumsi A)                                                                                                                                                                                                              | Bila operator juga pengendali atas data terdampak (asumsi B)                                                                                                                                                |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Operator mendeteksi pengungkapan data payroll tenant | Operator **memberitahu tenant** (pengendali) dan menyerahkan bukti; **tenant yang memutuskan dan mengirim** pemberitahuan ke subjek data dan otoritas. Operator tidak menghubungi subjek data atau otoritas atas nama tenant kecuali syarat pemrosesan menyatakannya. | Operator **juga** pemberi notifikasi untuk bagian yang dikendalikannya (mis. data audit administrator operator, akun operator, cadangan yang dipegang operator). Kedua pihak menjalankan jam masing-masing. |
| Pengguna tenant (orang dalam) menyebabkannya         | Tenant pengendali atas perbuatan orang dalam itu; operator menyediakan bukti audit atas permintaan.                                                                                                                                                                   | Sama.                                                                                                                                                                                                       |
| Staf operator platform menyebabkannya                | Operator adalah pelakunya: segera memberitahu tenant dan menjadi pihak pertama yang disebut dalam pemberitahuan. Akses staf operator ke data payroll tenant adalah risiko terbuka R-11 (#1449).                                                                       | Sama, dan kewajiban operator sendiri sebagai pengendali juga terpicu (perlu verifikasi penasihat hukum).                                                                                                    |
| Sub-prosesor melaporkan insiden ke operator          | Operator meneruskan ke tenant; kontrak operator dengan sub-prosesor menentukan jam sub-prosesor ke operator.                                                                                                                                                          | Sama.                                                                                                                                                                                                       |

**Tidak diputuskan di sini, dan harus ditulis ke syarat pemrosesan (O5, #1449):**
seberapa cepat operator wajib memberitahu tenant (bagian 5 mengusulkan angka),
bukti apa yang diserahkan operator, siapa menanggung biaya pemberitahuan, apakah
operator boleh mengirim pemberitahuan atas instruksi tenant, dan siapa kontak
bernama di tiap sisi (bagian 14).

## 3. Kerangka hukum (UU 27/2022, Undang-Undang Pelindungan Data Pribadi)

Bagian ini hanya menyatakan apa yang diyakini penulis, dan memberi label pada
sisanya. Tidak ada yang menggantikan penasihat hukum. **Kewajiban konfirmasi:**
sebelum pengendali menandatangani, penasihat hukum mengonfirmasi tiap baris
terhadap teks resmi UU No. 27 Tahun 2022 dan peraturan pelaksanaannya yang
berlaku pada tanggal penandatanganan.

| Topik                                                                                                                                                                                                                                 | Yang menjadi sandaran runbook ini                                                                                                                                                                                                                                             | Status                                                                                                                                                           |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Kewajiban memberitahu saat terjadi kegagalan pelindungan data pribadi                                                                                                                                                                 | Pasal 46 UU 27/2022: **pengendali** wajib menyampaikan pemberitahuan tertulis kepada subjek data dan kepada otoritas. Ingatan penulis: tenggatnya **3 x 24 jam** dan isinya adalah data yang terungkap, kapan dan bagaimana terjadinya, serta upaya penanganan dan pemulihan. | Dikutip dari ingatan atas teks resmi. **Penasihat hukum wajib mengonfirmasi pasalnya, tenggatnya, pemicu penghitungan (penemuan atau kejadian) dan daftar isi.** |
| Pemberitahuan kepada publik pada hal tertentu                                                                                                                                                                                         | Pasal yang sama dipahami menambah pemberitahuan publik bila kegagalan mengganggu pelayanan publik atau berdampak serius pada kepentingan publik.                                                                                                                              | **Perlu verifikasi penasihat hukum.** Kecil kemungkinannya untuk payroll tenant swasta, tetapi tidak diasumsikan tak ada.                                        |
| Kewajiban prosesor memberitahu pengendali                                                                                                                                                                                             | Tidak dikutip. Apakah hukum membebankan kewajiban langsung berbatas waktu kepada prosesor, atau menyerahkannya pada perjanjian pemrosesan, **tidak ditegaskan**.                                                                                                              | **Perlu verifikasi penasihat hukum.** Bagian 5 memakai usulan kontraktual.                                                                                       |
| Penilaian dampak (DPIA)                                                                                                                                                                                                               | Diwajibkan untuk pemrosesan berisiko tinggi; draf DPIA mengutipnya.                                                                                                                                                                                                           | Lihat draf DPIA; penasihat hukum mengonfirmasi pasalnya.                                                                                                         |
| Kewajiban pengamanan dan kerahasiaan pengendali                                                                                                                                                                                       | Ada dalam undang-undang; nomor pasal tidak dikutip di sini.                                                                                                                                                                                                                   | **Perlu verifikasi penasihat hukum.**                                                                                                                            |
| Konsekuensi administratif atau pidana atas kegagalan memberitahu                                                                                                                                                                      | Ada dalam undang-undang; nominal maupun nomor pasal sengaja tidak dikutip di sini.                                                                                                                                                                                            | **Perlu verifikasi penasihat hukum.**                                                                                                                            |
| Peraturan pelaksana, prosedur otoritas, dan kanal notifikasi                                                                                                                                                                          | Penulis tidak mengetahui keadaan terkini peraturan pelaksana maupun formulir atau portal notifikasi otoritas.                                                                                                                                                                 | **Perlu verifikasi penasihat hukum.** Isi bagian 14 setelah diketahui.                                                                                           |
| **Rezim lain** yang mungkin ikut terpicu oleh data payroll: pajak, jaminan sosial, ketenagakerjaan, regulator sektoral, regulator keuangan bila akun pembayaran terlibat, hukum subjek data asing bila karyawan berada di luar negeri | Tidak dinilai.                                                                                                                                                                                                                                                                | **Perlu verifikasi penasihat hukum**, per deployment (addendum B).                                                                                               |
| Apakah suatu insiden **wajib diberitahukan** (ambang risiko)                                                                                                                                                                          | Tidak ditegaskan. Bagian 10 memberi lembar penilaian faktual; **keputusannya** ada pada pengendali bersama penasihat hukum.                                                                                                                                                   | Pengendali dan penasihat hukum memutuskan.                                                                                                                       |

**Konsekuensi desain.** Karena tenggat undang-undang, bila seperti yang diingat,
pendek dan berjalan pada pengendali, langkah operator-ke-tenant harus jauh lebih
pendek dari tenggat itu, atau tenant tidak mungkin patuh. Itulah sebabnya
bagian 5 mengusulkan jam operator dalam hitungan jam, bukan hari. Usulan itu
tetap berlaku bila penasihat hukum mengoreksi angka undang-undangnya; hanya jam
sisi pengendali yang berubah.

## 4. Peran dan tanggung jawab

Nama dan kontak **tidak** ada di repositori ini (tidak ada data pribadi di
dokumen). Bagian 14 adalah templat yang diisi tiap deployment pada salinannya
sendiri yang akses-nya dikendalikan.

| Peran                                           | Sisi         | Tanggung jawab                                                                                                                                 |
| ----------------------------------------------- | ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| **Komandan insiden (IC)**                       | Operator     | Memegang insiden dari triase sampai penutupan; menjaga lini masa; mengambil keputusan penahanan; satu-satunya suara kepada tenant.             |
| **Pemimpin keamanan**                           | Operator     | Menjalankan investigasi dan kueri bagian 8; menjaga bukti; mengonfirmasi atau menyingkirkan pengungkapan.                                      |
| **Insinyur on-call platform**                   | Operator     | Menjalankan penahanan (bagian 7): pencabutan sesi, penonaktifan akun, rotasi kunci, penonaktifan modul, legal hold.                            |
| **Kontak operator untuk hukum dan kontrak**     | Operator     | Memeriksa syarat pemrosesan, kontrak sub-prosesor, dan register pihak ketiga (bagian 12).                                                      |
| **Kontak insiden tenant**                       | Tenant       | Menerima pemberitahuan operator; berbicara atas nama pengendali.                                                                               |
| **Petugas pelindungan data tenant atau setara** | Tenant       | Bila ditunjuk (apakah wajib untuk deployment ini perlu diverifikasi penasihat hukum). Memutuskan kewajiban notifikasi bersama penasihat hukum. |
| **Penasihat hukum tenant**                      | Tenant       | Menentukan apa yang diwajibkan hukum; menyetujui pemberitahuan ke subjek data dan otoritas.                                                    |
| **Pimpinan HR/payroll tenant**                  | Tenant       | Tahu karyawan dan periode gaji mana yang terdampak; mendukung pemberitahuan dan pertanyaan karyawan; membekukan operasi payroll bila diminta.  |
| **Kontak sub-prosesor**                         | Pihak ketiga | Penyedia hosting, cadangan, email atau pesan: menyediakan log dan mengonfirmasi cakupan.                                                       |

Satu orang boleh memegang lebih dari satu peran pada deployment kecil, **kecuali**
orang yang perilakunya sedang diselidiki tidak memegang peran apa pun untuk
insiden ini (nyatakan dan ganti).

## 5. Jam (tenggat)

Ada dua jenis jam dan keduanya tidak boleh dicampur.

- **Jam undang-undang** (bagian 3): berjalan pada **pengendali**. Nilai dan
  pemicunya dikonfirmasi penasihat hukum. Di dokumen ini ditulis sebagai "S" dan
  tidak pernah sebagai angka yang ditegaskan dokumen ini.
- **Jam operasional** (di bawah): **target internal yang diusulkan runbook ini.**
  Bukan hukum. Syarat pemrosesan (O5) menjadikannya komitmen atau menggantinya.

Definisi: **T0** = saat siapa pun di operator pertama kali memiliki indikasi yang
kredibel (peringatan, laporan, temuan). **T1** = saat pemimpin keamanan mencatat
"pengungkapan terkonfirmasi" (atau "pengungkapan tidak dapat disingkirkan setelah
kueri tahap pertama"). **T1 tidak pernah lebih dari 24 jam setelah T0**; bila
kueri tidak dapat memutuskannya, jawaban pada hari itu adalah "tidak dapat
disingkirkan" dan tenant diberi tahu demikian.

| Langkah                                             | Target operasional yang diusulkan                                                               | Siapa                                   |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------- | --------------------------------------- |
| Menerima dan menunjuk IC                            | dalam 1 jam sejak T0, sepanjang waktu untuk peringatan kritis                                   | Insinyur on-call                        |
| Keputusan penahanan (bagian 7)                      | dalam 4 jam sejak T0                                                                            | IC                                      |
| Pelingkupan tahap pertama (kueri Q1 sampai Q6)      | dalam 24 jam sejak T0 (ini menetapkan T1)                                                       | Pemimpin keamanan                       |
| **Pemberitahuan operator ke tenant (pengendali)**   | **dalam 24 jam sejak T1; lebih awal lebih baik, dan kabar awal begitu pengungkapan masuk akal** | IC                                      |
| Tenant memutuskan kewajiban notifikasi dan mengirim | dalam **S** yang dihitung pengendali dari pemicunya sendiri                                     | Tenant, bersama penasihat hukum         |
| Kewajiban pihak ketiga (bagian 12), mis. LinkedIn   | **24 jam** bila syarat pihak ketiga menyatakannya, dihitung sesuai syarat pihak ketiga itu      | Operator (atau tenant, sesuai register) |
| Pelingkupan penuh dan akar masalah                  | dalam 10 hari kerja sejak T1 (usulan)                                                           | Pemimpin keamanan                       |
| Tinjauan pasca-insiden                              | dalam 15 hari kerja sejak penutupan                                                             | IC                                      |

Bila penasihat hukum menemukan bahwa tenggat undang-undang dimulai saat kejadian
dan bukan saat penemuan, atau bahwa prosesor punya kewajiban langsung, hanya
tabel ini yang berubah.

## 6. Gambaran prosedur

```
Deteksi -> Triase -> Tahan -> Nilai risiko -> Beritahu -> Pulihkan -> Tinjau
  (6)       (7.1)    (7.2)       (10)         (11,12)      (7.3)      (13)
```

Tiap langkah menulis satu baris di lini masa insiden (waktu dalam UTC, siapa,
apa, rujukan bukti). Lini masa itu catatan yang akan diminta penasihat hukum dan
pengendali; simpan di lokasi ber-akses-terkendali di luar repositori.

### 6.1 Deteksi: di mana pengungkapan tampak

Semua berikut ada di repositori hari ini kecuali baris yang berkata "akan ada
bersama modul payroll".

| Sinyal                                            | Apa yang dikatakannya                                                                                                                                                                                 | Sumber (diverifikasi di kode)                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Baris audit pembacaan sensitif** pada `warning` | Seorang aktor mencapai kelipatan sepuluh pembacaan atau rekaman dalam satu jendela (10, 100, 1000 dst.), atau menjalankan **ekspor** atau **unduh ekspor** (selalu `warning`, tidak pernah digabung). | Baris `awcms_audit_events` dengan `action` `sensitive_read.*`; ditulis `recordSensitiveRead` (`src/modules/logging/application/sensitive-read-audit.ts`); kebijakan per izin di `src/modules/_shared/sensitive-reads.ts`                                                                                                                                                                                |
| **Baris reveal akun pembayaran** (`warning`)      | Pengungkapan akun pembayaran terjadi dan oleh siapa, tidak pernah nilainya.                                                                                                                           | Akan ada bersama modul payroll (`hr-payroll.md` bagian 11.3, S12). Nama aksinya belum ditetapkan di kode.                                                                                                                                                                                                                                                                                               |
| **Baris audit kritis** pada `hr_payroll`          | Penguncian periode atau pembalikan akrual yang sudah dibayar.                                                                                                                                         | Tabel `hr-payroll.md` bagian 11.3.                                                                                                                                                                                                                                                                                                                                                                      |
| **Penolakan otorisasi** dari satu aktor           | Penjajakan: banyak keputusan `deny` pada izin payroll.                                                                                                                                                | `awcms_abac_decision_logs` (`decision = 'deny'`)                                                                                                                                                                                                                                                                                                                                                        |
| **Anomali autentikasi**                           | Lonjakan `login_failed`, `login_succeeded` dari konteks tak lazim, penolakan session handoff.                                                                                                         | `awcms_audit_events` aksi `login_failed`, `login_succeeded`, `auth.session_handoff.*` (`src/modules/identity-access`)                                                                                                                                                                                                                                                                                   |
| **Temuan kesiapan** `critical` / `fail`           | Kontrol yang menjaga data payroll di dalam batas tenant atau rolenya melemah (RLS, hak role, ekspresi policy).                                                                                        | `bun run security:readiness` (`scripts/security-readiness.ts`); kegagalan kritis keluar dengan kode non-nol                                                                                                                                                                                                                                                                                             |
| **Temuan batas katalog**                          | Sebuah view, rule, fungsi, trigger, atau grant menjangkau tabel payroll dari luar keluarga payroll, atau pemilik selain yang diharapkan.                                                              | `bun run payroll:catalog-boundary:check` (`scripts/payroll-catalog-boundary-check.ts`). Keputusan pemilik K3 menjadwalkannya **harian** terhadap database terdeploy dengan role khusus minimal (connect ditambah katalog, tanpa `SELECT` tabel); **operator menyediakan kredensial dan jadwalnya**: ini bukan job di repositori ini, dan deployment yang belum menyiapkannya tidak punya sinyal harian. |
| Laporan dari seseorang                            | Karyawan, admin tenant, sub-prosesor, peneliti.                                                                                                                                                       | Kontak laporan keamanan yang dipublikasikan operator; `SECURITY.md` untuk laporan kerentanan.                                                                                                                                                                                                                                                                                                           |
| Pemberitahuan sub-prosesor                        | Penyedia hosting atau cadangan melaporkan insiden.                                                                                                                                                    | Kanal kontrak sub-prosesor.                                                                                                                                                                                                                                                                                                                                                                             |

**Apa yang tidak dapat dilihat sinyal (batasan yang diucapkan di tiap penilaian):**

- Pembacaan karyawan atas slip gajinya **sendiri** yang sudah dirilis datang lewat
  ownership grant dan memang tidak masuk audit pembacaan sensitif
  (`sensitive-reads.ts`, rasional kebijakan slip gaji). Pengungkapan akun milik
  karyawan seperti itu tampak pada baris sesi dan login, bukan baris baca.
- Pembacaan **digabung**: dalam satu jendela, pembacaan pertama menulis baris dan
  pembacaan berikutnya hanya menaikkan penghitung. Identitas rekaman **tidak**
  dibuang (pembacaan yang menyebut rekaman yang belum diaudit menulis baris yang
  mendaftarnya), tetapi **jumlah pembacaan** di antara baris ada pada total
  berjalan di baris, dan tabel penghitung kerja (`awcms_sensitive_read_windows`)
  ditimpa jendela berikutnya. Bukti adalah baris audit, bukan tabel penghitung.
- Jejak audit mencatat **apa yang dilakukan aplikasi**. Pencurian **dump database
  atau cadangan**, **login langsung ke database**, atau **akses tingkat hosting**
  tidak meninggalkan baris audit aplikasi. Itu butuh log server database, log
  akses hosting, dan catatan penyedia cadangan, yang berada di luar repositori ini.
- Retensi audit terbatas: bawaan `awcms_audit_events` **730 hari** (minimum 365)
  dan `awcms_abac_decision_logs` **365 hari** (minimum 90), diatur deskriptor
  `data_lifecycle` dan `AUDIT_LOG_RETENTION_DAYS`. Investigasi pengungkapan lama
  bisa menemukan baris sudah terpurge: **pasang legal hold lebih dulu** (bagian 7.1).
- Bila `recordSensitiveRead` gagal, pembacaan **tidak terjadi** (fail-closed).
  Jadi ketiadaan baris baca bermakna untuk izin yang diaudit; ia tidak
  mengatakan apa pun tentang data yang dijangkau rute yang tidak pernah
  diklasifikasikan (gerbang `sensitive-reads:check` ada untuk mencegahnya, dan
  celah adalah temuan tersendiri).

## 7. Triase, penahanan, pemulihan

### 7.1 Triase (jam pertama)

1. Buka lini masa insiden. Catat T0, sinyal, dan siapa pelapornya.
2. Tunjuk IC dan pemimpin keamanan. Nyatakan konflik kepentingan (penyelidik
   yang menjadi tersangka diganti).
3. Klasifikasikan **tenant terdampak**. Pada deployment multi-tenant, lingkupkan
   **per tenant**: satu putaran kueri per tenant, dengan id tenant itu. Jangan
   pernah menggabung tenant dalam hasil kueri yang keluar dari operator.
4. **Jaga bukti sebelum apa pun berubah.**
   - Pasang **legal hold** pada jejak audit dan log keputusan tiap tenant
     terdampak agar job purge tidak menghapus baris. Pakai
     `POST /api/v1/data-lifecycle/legal-holds` (izin
     `data_lifecycle.legal_hold.create`; header `Idempotency-Key` dan alasan
     minimal 10 karakter wajib; hold diaudit pada `critical`; membuat hold tidak
     memberi kemampuan melepasnya). Kunci deskriptor: `logging.audit_events`,
     `identity_access.abac_decision_logs`, dan `identity_access.sessions` bila
     permukaan hold menerimanya (periksa responsnya; jangan berasumsi).
   - Ekspor hasil kueri bagian 8 ke lokasi bukti (baca-saja, bersama teks kueri,
     waktu jalan, dan operator yang menjalankannya).
   - Jeda `bun run logs:audit:purge` selama periode insiden bila dijadwalkan di
     luar mesin data-lifecycle (legal hold adalah kontrolnya; menjeda adalah
     langkah tambahan, bukan pengganti).
   - Minta penyedia hosting dan cadangan menyimpan log mereka.
5. **Jangan** menghapus atau menyunting apa pun untuk "merapikan".
   `awcms_audit_events` memang append-only bagi role aplikasi (migrasi 408); alat
   yang menulis ulang bukti adalah temuan.

### 7.2 Penahanan (dalam 4 jam)

Pilih tindakan paling kecil yang menghentikan pengungkapan, catat alasannya, dan
utamakan tindakan yang dapat dibalik. Semua ini ada hari ini.

| Situasi                                                     | Tindakan                                                                                                                                                                                                                             | Dapat dibalik?                    |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------- |
| Akun pengguna tenant diduga                                 | `POST /api/v1/users/{id}/sessions/revoke-all` (izin `identity_access.user_sessions.revoke`, diaudit; "kontrol insiden", efektif pada permintaan berikutnya); lalu `PATCH /api/v1/users/{id}` untuk menetapkan status inactive.       | Ya: status dapat diaktifkan lagi. |
| Perangkat pengguna sendiri diduga                           | `POST /api/v1/auth/sessions/revoke-all` oleh pengguna (swalayan) dan reset kata sandi; bila MFA aktif, tinjau faktornya.                                                                                                             | Ya.                               |
| Role atau policy ABAC terlalu lebar                         | Persempit lewat permukaan admin akses; ABAC default-deny, jadi mencabut grant berlaku segera untuk permintaan baru.                                                                                                                  | Ya.                               |
| Modul payroll sendiri harus dihentikan untuk satu tenant    | `POST /api/v1/tenant/modules/hr_payroll/disable` (siklus hidup modul tenant; tidak untuk modul inti).                                                                                                                                | Ya: enable.                       |
| Material kunci akun pembayaran mungkin terungkap (ADR-0137) | Rotasi key ring akun pembayaran dan key ring HMAC mengikuti ADR-0137 setelah diimplementasikan. **Belum dapat dilakukan hari ini**: catat sebagai celah bila terpicu.                                                                | n/a                               |
| Secret atau kredensial bocor (URL database, secret worker)  | Rotasi lewat secret store deployment; restart. Ikuti `deploy-coolify.md` dan `production-preflight-runbook.md` untuk urutannya.                                                                                                      | Ya.                               |
| Berkas ekspor bocor                                         | Nonaktifkan konfigurasi ekspor (`POST /api/v1/reports/exports/{id}/disable`) bila ekspor berasal dari modul reporting; untuk ekspor payroll, menurut modulnya setelah ada.                                                           | Ya.                               |
| Dugaan kompromi tingkat database                            | Eskalasi ke penyedia hosting; isolasi instans; rotasi semua kredensial role database; jangan restore menimpa bukti. Jalankan `bun run security:readiness` sebagai **role aplikasi** (bukan yang berhak istimewa) pada instans pulih. | Kasus per kasus.                  |

### 7.3 Pemulihan

- Restore dari cadangan hanya ke target **baru** dan setelah bukti terjaga
  (`deploy/backup/restore-postgres.sh`, `deploy/backup/README.md`). Restore data
  payroll membutuhkan rekonsiliasi pada `hr-payroll.md` bagian 14.
- Jalankan ulang `bun run security:readiness` (role aplikasi) dan
  `bun run payroll:catalog-boundary:check` pada database yang dipulihkan atau
  diperbaiki. Pemulihan belum selesai sampai keduanya bersih atau setiap temuan
  diterima tertulis oleh IC.
- Aktifkan lagi modul (`POST /api/v1/tenant/modules/hr_payroll/enable`) hanya bila
  IC mencatat akar masalah tertutup atau terkendali.

## 8. Bukti: "siapa membaca apa" untuk satu tenant dan satu jendela

Kueri ini **baca-saja** dan sudah dijalankan pada database yang baru dimigrasi
(semua migrasi diterapkan, satu tenant tersemai dengan baris audit sintetis) untuk
memeriksa sintaks, penyaringan tenant, dan path JSON. Kueri ini **tidak** dijalankan
pada data produksi. Kueri ini menjawab pertanyaan yang diajukan DPIA (PS-18):
siapa membaca apa, dan berapa banyak, untuk satu tenant dan satu jendela waktu.

**Cara menjalankan.**

- Hubungkan sebagai **role aplikasi** (`awcms_app`), lewat jalur akses operator,
  **bukan** sebagai superuser: RLS di-`FORCE` dan berkunci pada
  `app.current_tenant_id`; superuser melewati RLS dan bisa membaca lintas tenant.
  Setiap kueri di bawah **juga** membawa `tenant_id = :'tenant'` agar sesi
  berhak istimewa tidak tak sengaja melebarkannya.
- Tetapkan variabel sekali, lalu jalankan dalam satu **transaksi baca-saja**.
- Jangan menempel keluaran kueri berisi id rekaman atau id pengguna ke obrolan
  atau email. Id itu rujukan, bukan nilai (tidak ada nominal, nama, atau akun
  yang disimpan di baris ini), tetapi ia mengidentifikasi orang bagi siapa pun
  yang bisa menggabungkannya.

```sql
-- psql
\set ON_ERROR_STOP on
\set tenant '<uuid tenant>'
\set from   '<awal jendela, ISO 8601 UTC, mis. 2026-11-01T00:00:00Z>'
\set to     '<akhir jendela, eksklusif>'

BEGIN READ ONLY;
SELECT set_config('app.current_tenant_id', :'tenant', true);
```

**Q1 - Setiap pembacaan sensitif dalam jendela (satu baris per baris audit).**

```sql
SELECT created_at, actor_tenant_user_id, module_key, action, resource_type, severity,
       (attributes ->> 'callItemCount')::int AS call_item_count,
       attributes ->> 'reason'               AS reason,
       attributes ->> 'mode'                 AS mode,
       correlation_id
  FROM awcms_audit_events
 WHERE tenant_id = :'tenant'::uuid
   AND created_at >= :'from'::timestamptz AND created_at < :'to'::timestamptz
   AND module_key IN ('hr_payroll', 'hr_commission', 'hr_workforce')
   AND action LIKE 'sensitive\_read.%'
 ORDER BY created_at;
```

**Q2 - Siapa membaca seberapa banyak (per aktor dan jenis).** Urutkan untuk
menemukan pencilan.

```sql
SELECT actor_tenant_user_id, action,
       count(*)                                                AS audit_rows,
       count(*) FILTER (WHERE severity <> 'info')              AS warning_rows,
       sum((attributes ->> 'callItemCount')::bigint)           AS records_in_rows,
       max((attributes ->> 'windowItemCount')::bigint)         AS peak_window_items,
       max((attributes ->> 'windowReadCount')::bigint)         AS peak_window_reads,
       min(created_at) AS first_seen, max(created_at) AS last_seen
  FROM awcms_audit_events
 WHERE tenant_id = :'tenant'::uuid
   AND created_at >= :'from'::timestamptz AND created_at < :'to'::timestamptz
   AND module_key IN ('hr_payroll', 'hr_commission', 'hr_workforce')
   AND action LIKE 'sensitive\_read.%'
 GROUP BY actor_tenant_user_id, action
 ORDER BY records_in_rows DESC NULLS LAST;
```

`records_in_rows` menghitung rekaman yang dikembalikan panggilan yang menulis
baris; `peak_window_items` dan `peak_window_reads` adalah total berjalan jendela
pada baris terakhirnya, dan merupakan ukuran volume yang lebih baik untuk jendela
yang digabung.

**Q3 - Rekaman mana yang dijangkau (himpunan terdampak).** Ini daftar yang menjadi
daftar karyawan terdampak: id adalah id rekaman (employment, kompensasi, slip
gaji); petakan ke orang **di dalam sistem tenant sendiri**, bukan dalam kueri.
Daftar ini lengkap menurut desain: penulis mendaftar setiap id rekaman yang
diauditnya.

```sql
SELECT DISTINCT e.action, e.actor_tenant_user_id, rid AS record_id
  FROM awcms_audit_events e
  CROSS JOIN LATERAL jsonb_array_elements_text(
         CASE WHEN jsonb_typeof(e.attributes -> 'resourceIds') = 'array'
              THEN e.attributes -> 'resourceIds' ELSE '[]'::jsonb END) AS rid
 WHERE e.tenant_id = :'tenant'::uuid
   AND e.created_at >= :'from'::timestamptz AND e.created_at < :'to'::timestamptz
   AND e.module_key IN ('hr_payroll', 'hr_commission', 'hr_workforce')
   AND e.action LIKE 'sensitive\_read.%'
 ORDER BY e.action, rid;
```

Baris **ekspor** membawa jumlah baris dan id rekaman yang dikandungnya
(`hr-payroll.md` 13.3): ekspor dengan `callItemCount` besar dan sedikit id di
`resourceIds` berarti id terpotong oleh batas per-baris dan ekspor itu membentang
beberapa baris yang berbagi panggilan (`idsChunk`, `idsChunks`); baca semua chunk.

**Q4 - Aksi payroll pada `warning` atau `critical` (ekspor, reveal, pembalikan, kunci).**

```sql
SELECT created_at, actor_tenant_user_id, module_key, action, resource_type, resource_id,
       severity, attributes, correlation_id
  FROM awcms_audit_events
 WHERE tenant_id = :'tenant'::uuid
   AND created_at >= :'from'::timestamptz AND created_at < :'to'::timestamptz
   AND module_key = 'hr_payroll'
   AND severity IN ('warning', 'critical')
 ORDER BY created_at;
```

**Q5 - Keputusan otorisasi pada keluarga payroll (allow dan deny).**

```sql
SELECT tenant_user_id, module_key, activity_code, action, decision,
       count(*) AS decisions, min(created_at) AS first_seen, max(created_at) AS last_seen
  FROM awcms_abac_decision_logs
 WHERE tenant_id = :'tenant'::uuid
   AND created_at >= :'from'::timestamptz AND created_at < :'to'::timestamptz
   AND module_key IN ('hr_payroll', 'hr_commission', 'hr_workforce')
 GROUP BY tenant_user_id, module_key, activity_code, action, decision
 ORDER BY decisions DESC;
```

Jumlah `deny` tinggi untuk satu `tenant_user_id` adalah penjajakan; jumlah `allow`
tinggi untuk satu aktor pada aksi baca harus cocok dengan Q2.

**Q6 - Peristiwa identitas dalam jendela (login, handoff, perubahan akses).**

```sql
SELECT created_at, actor_tenant_user_id, action, severity, correlation_id
  FROM awcms_audit_events
 WHERE tenant_id = :'tenant'::uuid
   AND created_at >= :'from'::timestamptz AND created_at < :'to'::timestamptz
   AND module_key = 'identity_access'
 ORDER BY created_at;
```

**Q7 - Sesi yang diterbitkan dalam jendela, dan mana yang masih hidup.** Sesi
berkunci pada identitas; petakan `tenant_user_id` ke identitasnya dengan Q8.

```sql
SELECT s.id, s.identity_id, s.issued_at, s.expires_at, s.revoked_at
  FROM awcms_sessions s
 WHERE s.tenant_id = :'tenant'::uuid
   AND s.issued_at >= :'from'::timestamptz AND s.issued_at < :'to'::timestamptz
 ORDER BY s.issued_at;
```

**Q8 - Petakan id aktor tersangka ke identitas.**

```sql
SELECT tu.id AS tenant_user_id, tu.identity_id
  FROM awcms_tenant_users tu
 WHERE tu.tenant_id = :'tenant'::uuid
   AND tu.id = ANY (ARRAY['<uuid tenant_user>']::uuid[]);

ROLLBACK;
```

**Pemeriksaan silang dengan alat lain.** Filter `resourceType` yang sama tersedia
lewat `GET /api/v1/logs/audit` (izin `logging.audit_trail.read`, sampai 100 item
per panggilan, terbaru dulu, hanya tenant saat ini) dan layar admin
`/admin/audit-trail`; keduanya tidak menyaring menurut aktor atau jendela waktu,
karena itu SQL di atas adalah jalur investigasi.

**Menjawab "apakah dibaca" secara negatif.** Temuan negatif ("tidak ada baris
baca untuk aktor X") hanya sekuat batasan di bagian 6.1. Tulis batasannya ke
dalam temuan.

## 9. Catatan triase (apa yang dicatat)

Per insiden, di lini masa insiden (tidak pernah di repositori ini):

- T0, T1, IC, pemimpin keamanan, tenant terdampak, sub-prosesor yang terlibat.
- Sinyalnya, hasil kueri tahap pertama (diekspor), tindakan penahanan beserta
  waktunya, dan apakah legal hold dipasang (id hold).
- Kategori data dalam himpunan terdampak (kompensasi, akun pembayaran, slip gaji,
  komisi, kehadiran), **jumlah subjek data** (karyawan berbeda setelah
  memetakan Q3 di sistem tenant), periode yang tercakup, dan apakah **nilai**
  akun pembayaran (bukan hanya mask) mungkin terungkap (hanya reveal atau kompromi
  tingkat database yang bisa).
- Apa yang **belum diketahui**, dinyatakan eksplisit.

## 10. Lembar penilaian risiko (masukan faktual untuk pengendali)

Operator mengisi kolom faktual; **pengendali, bersama penasihat hukum,
memutuskan kewajiban notifikasi.** Runbook ini tidak menegaskan ambang.

| Pertanyaan                                                                                                    | Sumber jawaban                                                                                                          |
| ------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Apakah manusia atau sistem di luar staf berwenang tenant dapat membaca data?                                  | Q1 sampai Q7; log hosting dan database                                                                                  |
| Apakah data terbaca (jelas) atau terlindungi (dimask, dienkripsi)?                                            | Akun pembayaran: ciphertext ditambah mask kecuali di-reveal (ADR-0137, rancangan); nominal terbaca oleh pembaca berizin |
| Kategori apa, berapa subjek, periode mana?                                                                    | Q3 yang dipetakan di dalam sistem tenant                                                                                |
| Dapatkah data mendukung penipuan (akun pembayaran dengan nama), diskriminasi, pemerasan, pencurian identitas? | Penilaian pengendali                                                                                                    |
| Apakah pengungkapan sudah tertahan, dan apakah masih berlangsung?                                             | Tindakan bagian 7 dan jalankan ulang Q1 setelah penahanan                                                               |
| Apakah individu terdampak rentan (tim kecil, orang yang mudah dikenali)?                                      | Pengendali                                                                                                              |
| Ada unsur lintas negara?                                                                                      | Addendum B; penasihat hukum                                                                                             |
| Rezim lain terpicu (bagian 3)?                                                                                | Penasihat hukum                                                                                                         |

Klasifikasikan, hanya untuk catatan internal: **Pengungkapan terkonfirmasi**,
**Pengungkapan mungkin (tidak dapat disingkirkan)**, **Disingkirkan** (dengan
alasan dan batasannya). Temuan "disingkirkan" juga dilaporkan ke tenant bila
tenant sudah diberi tahu tentang dugaan itu.

## 11. Isi dan templat pemberitahuan

Templat adalah **draf untuk penasihat hukum**. Penampung ada di tanda kurung
siku. Jangan pernah menaruh nominal, nomor akun, nama, atau nomor identitas
nasional di pemberitahuan mana pun. Sebutkan kategori yang terdampak, tidak
pernah nilainya. Kirim lewat kanal yang sudah disebut tenant di bagian 14, bukan
kanal yang mungkin ikut terkompromi.

### 11.1 Operator ke tenant (pengendali)

> **Subjek:** [Insiden keamanan - data payroll] <deployment> - <tenant> - ref <id insiden>
>
> Kepada: <kontak insiden tenant>, <kontak pelindungan data tenant, bila ada>
>
> Ini pemberitahuan dari <operator>, sebagai prosesor data payroll <tenant>,
> berdasarkan <rujukan syarat pemrosesan, klausul>.
>
> 1. **Apa yang terjadi (fakta yang diketahui pada <waktu UTC>):** <uraian singkat>.
> 2. **Kapan:** indikasi pertama <T0, UTC>; pengungkapan terkonfirmasi atau tidak
>    dapat disingkirkan <T1, UTC>; periode kemungkinan pengungkapan <dari> sampai
>    <sampai>; masih berlangsung: <ya/tidak>.
> 3. **Data terdampak (hanya kategori):** <kompensasi / akun pembayaran (dimask
>    atau jelas) / slip gaji / baris run / komisi / kehadiran>. Perkiraan jumlah
>    karyawan: <n, atau "sedang ditentukan">. Rujukan bukti: <id berkas>.
> 4. **Bagaimana terdeteksi dan bagaimana dijangkau:** <baris audit / laporan / penyedia>.
> 5. **Yang sudah kami lakukan:** <tindakan penahanan beserta waktu>; bukti terjaga
>    (legal hold dipasang: <ya/tidak>).
> 6. **Yang belum kami ketahui:** <daftar>.
> 7. **Yang kami butuhkan dari Anda:** keputusan pemberitahuan ke subjek data dan
>    otoritas (kewajiban hukumnya ada pada Anda sebagai pengendali); kontak
>    bernama; <lainnya>.
> 8. **Yang akan kami berikan:** hasil kueri untuk tenant Anda (Q1 sampai Q8),
>    lini masa, dan pembaruan tertulis pada <waktu, paling jarang tiap 24 jam
>    sampai ditutup>.
>
> Kontak: <komandan insiden, kanal>. Pemberitahuan ini pernyataan fakta yang
> diketahui pada saat disampaikan dan bukan nasihat hukum.

### 11.2 Pengendali (tenant) ke subjek data

Untuk difinalkan tenant dan penasihat hukumnya. Butir isi di bawah mengikuti
unsur yang diingat penulis dari kewajiban pemberitahuan (bagian 3, dikonfirmasi
penasihat hukum): data apa, kapan dan bagaimana, apa yang dilakukan, apa yang
dapat dilakukan orang itu.

> **Subjek:** Pemberitahuan tentang data pribadi Anda yang dipegang <organisasi>
>
> Kami menulis untuk memberi tahu tentang insiden yang mungkin menyangkut
> informasi payroll Anda.
>
> - **Apa yang terjadi:** <uraian bahasa sehari-hari>, ditemukan pada <tanggal>.
> - **Informasi apa:** <kategori, mis. "tingkat gaji dan slip gaji Anda"; nyatakan
>   dengan jelas apakah data bank atau dompet terlibat dan apakah terbaca atau
>   terlindungi>.
> - **Kapan dan bagaimana:** <periode; bagaimana akses terjadi>.
> - **Yang sudah kami lakukan:** <tindakan>; <tindakan mencegah terulang>.
> - **Yang dapat Anda lakukan:** <pantau rekening untuk transaksi tak lazim;
>   hubungi bank bila data rekening terlibat; waspadai pesan yang menyebut gaji
>   Anda; ganti kata sandi>.
> - **Kepada siapa bertanya:** <kontak, kanal, jam>.

### 11.3 Pengendali (tenant) ke otoritas

Format, kanal, dan formulir apa pun **dikonfirmasi penasihat hukum** (bagian 3).
Siapkan fakta dalam urutan ini, yang merupakan himpunan super dari yang diminta
kewajiban yang diingat: identitas dan kontak pengendali; uraian dan lini masa;
kategori dan perkiraan jumlah subjek; kemungkinan akibat; langkah yang diambil
dan direncanakan; apakah subjek data sudah atau akan diberi tahu, dan kapan;
apakah otoritas atau pihak ketiga lain diberi tahu. Tandai sebagai **"pemberitahuan
awal, akan dilengkapi"** bila fakta masih ditentukan, jika penasihat hukum
mengonfirmasi bahwa pemberitahuan bertahap diterima.

### 11.4 Operator ke pihak ketiga yang punya klausul insiden sendiri

Pakai kanal dan redaksi yang diwajibkan pihak ketiga (bagian 12). Tetap faktual:
akun atau kredensial yang terlibat, waktu penemuan, penahanan, kontak.

## 12. Kewajiban kepada pihak ketiga (pola register)

Sebagian integrasi membawa klausul insiden sendiri, terpisah dari undang-undang
dan hubungan dengan tenant. Polanya, yang ditetapkan keputusan pemilik K15
(22 November 2026), adalah menyimpan **register**-nya, menaruh jam masing-masing
di lini masa insiden pada T0, dan menamai siapa yang mengirim.

| Pihak ketiga | Klausul (diverifikasi verbatim oleh orchestrator pada 22 Nov 2026)                                                                                                                                                                                            | Jam    | Kontak dalam syarat                         | Pengirim                                             | Terpicu oleh data payroll?                                                                                                  |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ------------------------------------------- | ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| LinkedIn     | API Terms of Use (revisi 13 Desember 2022), bagian 7.1(d): laporkan insiden keamanan ke LinkedIn dalam 24 jam.                                                                                                                                                | 24 jam | alamat keamanan yang tercantum dalam syarat | Operator, sebagai pemegang kredensial aplikasi (U15) | **Tidak**, kecuali token akses LinkedIn atau data asal LinkedIn ada dalam himpunan terungkap (periksa Q6 dan akun konektor) |
| Lainnya      | Operator melengkapi baris ini per konektor yang aktif (pembayaran, pesan, email, marketplace): klausul, jam, kanal, pemilik. Konektor yang **tidak** ditemukan klausulnya dicatat "tidak ditemukan, diperiksa pada <tanggal>", tidak pernah dibiarkan kosong. | -      | -                                           | -                                                    | -                                                                                                                           |

Aturan: jam LinkedIn dan jam payroll berjalan **independen**. Satu insiden dapat
memulai keduanya. Isi pemberitahuan LinkedIn (pembacaan K15, dikonfirmasi
penasihat hukum untuk hubungan dengan tenant): apa yang terungkap dari data dan
token LinkedIn, waktu penemuan, penahanan, kontak. Data payroll **tidak**
dibagikan ke LinkedIn dan tidak boleh disertakan dalam pemberitahuan LinkedIn.

## 13. Penutupan dan tinjauan

Insiden ditutup bila penahanan terverifikasi (Q1 dijalankan ulang tidak
menunjukkan pembacaan tanpa izin lagi), pemulihan terverifikasi (bagian 7.3),
pemberitahuan terkirim atau pengendali mencatat alasannya (bersama penasihat
hukum), dan register pihak ketiga menunjukkan tiap klausul tertangani.

Dalam 15 hari kerja yang diusulkan, adakan **tinjauan tanpa menyalahkan**: lini
masa, apa yang ditunjukkan sinyal dan kapan, apa yang tidak ditunjukkan
(batasan bagian 6.1), apakah jam di bagian 5 terpenuhi, dan tindak lanjut sebagai
isu. Catat di log pasca-insiden deployment. Rilis yang membawa perubahan terkait
juga mendapat barisnya di [`post-release-reviews.md`](post-release-reviews.md),
yang menunjuk ke catatan insiden alih-alih menyalinnya.

## 14. Titik kontak (templat per-deployment, disimpan di luar repositori)

| Peran                      | Nama | Kanal (utama dan cadangan)     | Jam/eskalasi | Diverifikasi pada |
| -------------------------- | ---- | ------------------------------ | ------------ | ----------------- |
| Komandan insiden operator  |      |                                |              |                   |
| Pemimpin keamanan operator |      |                                |              |                   |
| Insinyur on-call operator  |      |                                |              |                   |
| Hukum dan kontrak operator |      |                                |              |                   |
| Kontak insiden tenant      |      |                                |              |                   |
| DPO tenant atau setara     |      |                                |              |                   |
| Penasihat hukum tenant     |      |                                |              |                   |
| Pimpinan HR/payroll tenant |      |                                |              |                   |
| Kanal notifikasi otoritas  |      | (dikonfirmasi penasihat hukum) |              |                   |
| Keamanan penyedia hosting  |      |                                |              |                   |
| Penyedia cadangan          |      |                                |              |                   |

Verifikasi tabel ini sekurang-kurangnya tiap enam bulan dan setiap pergantian
staf: kontak yang belum pernah dicoba bukan kontak. Pakai kanal yang tidak
bergantung pada deployment itu sendiri (gangguan atau kompromi AWCMS tidak boleh
memutus jalur ke tenant).

## 15. Latihan dan penerimaan

### 15.1 Kadens

- **Latihan meja (tabletop)** sekurang-kurangnya **sekali setahun** dan **sebelum
  fase 3 payroll tayang** (usulan; pengendali boleh mewajibkan lebih sering).
- **Latihan teknis** bagian 8 (jalankan Q1 sampai Q8 pada salinan, bukan
  produksi) setelah migrasi apa pun yang menyentuh tabel audit, log keputusan,
  sesi, atau keluarga payroll, dan sebagai bagian pemeriksaan go-live bagian 1.
- Tinjau tabel kontak (bagian 14) tiap enam bulan; tinjau kerangka hukum
  (bagian 3) setiap kali penasihat hukum melaporkan perubahan hukum.

### 15.2 Skenario tabletop (latihan pertama)

**Skenario "ekspor yang tidak seharusnya keluar".** Akun staf payroll sebuah
tenant menjalankan dua aksi `sensitive_read.export` pada 02:10 dan 02:14 UTC hari
Minggu, masing-masing beberapa ratus rekaman, lalu membaca slip gaji karyawan
lain lewat `hr_payroll.payslips.read` (membuka jendela dan mencapai tonggak 100
rekaman). Pemilik akun berkata sedang tidur. Kueri pertama pemimpin keamanan (Q2)
menunjukkan akun itu di puncak; Q6 menunjukkan `login_succeeded` dari jaringan
asing sesaat sebelumnya. Seorang staf operator juga melaporkan bahwa direktur HR
tenant kemarin bertanya mengapa "sistemnya lambat".

Kartu injeksi, berurutan, dengan pertanyaan yang harus dijawab tiap kartu:

1. **Deteksi.** Sinyal mana yang menyala, dan siapa yang melihatnya? Berapa lama
   sampai ada yang menerima? (Bagian 6.1.)
2. **Triase dan penjagaan.** Siapa IC? Apakah legal hold dipasang sebelum
   apa pun? Kueri siapa, dijalankan sebagai role apa? (Bagian 7.1, 8.)
3. **Penahanan.** Tindakan mana dulu: cabut semua sesi pengguna, lalu nonaktifkan?
   Apakah itu juga menghentikan penyerang yang sudah memegang sesi? (Bagian 7.2.)
4. **Lingkup.** Q3 mendaftar 640 id rekaman. Bagaimana memetakannya ke karyawan,
   dan siapa yang memetakan? Batasan bagian 6.1 mana yang berlaku (apakah
   pembacaan slip gaji milik sendiri tercakup)?
5. **Peran.** Asumsi A atau B? Siapa memberitahu siapa, dan seberapa cepat? Siapa
   memutuskan memberitahu karyawan dan otoritas, dan siapa yang menulis kepada
   mereka? (Bagian 2, 11.)
6. **Jam.** Isi tabel bagian 5 dengan waktu dari latihan. Jam mana yang paling
   ketat?
7. **Pihak ketiga.** Apakah himpunan terungkap mencakup kredensial konektor
   (bagian 12)? Apa yang akan dikirim, kepada siapa?
8. **Komunikasi.** Susun pemberitahuan bagian 11.1 dalam 15 menit; orang kedua
   memeriksanya untuk nominal, nama, dan identitas (tidak boleh ada).
9. **Penutupan.** Apa yang dianggap penutupan? Tindak lanjut apa yang akan diajukan?

Pengamat mencatat: waktu ke tiap keputusan, langkah apa pun yang membutuhkan
dokumen yang tidak ada, kueri apa pun yang tidak jalan, kontak apa pun yang tidak
terjangkau.

### 15.3 Catatan latihan

| Bidang                              | Isian                                                    |
| ----------------------------------- | -------------------------------------------------------- |
| Tanggal, durasi, fasilitator        | **BELUM DILAKSANAKAN.** Belum ada latihan pada draf ini. |
| Peserta (peran, bukan nama di sini) |                                                          |
| Skenario yang dipakai               | 15.2 (latihan pertama)                                   |
| Waktu tercapai vs usulan bagian 5   |                                                          |
| Celah ditemukan (nomor isu)         |                                                          |
| Perubahan pada dokumen ini          |                                                          |
| Latihan berikutnya jatuh tempo      |                                                          |

Butir penerimaan "tabletop exercise recorded" pada #1448 terpenuhi **hanya bila
tabel ini terisi untuk latihan yang sungguh dilakukan.** Skenario dan format
catatan ada di sini; latihannya membutuhkan orang operator dan tenant dalam satu
ruangan, yang tidak dapat diselenggarakan agen.

### 15.4 Butir daftar periksa go-live yang ditambahkan runbook ini

- [ ] O5 diputuskan; syarat pemrosesan memuat jam operator (bagian 5) atau
      penggantinya (#1449).
- [ ] Penasihat hukum mengonfirmasi bagian 3 baris demi baris dan mengisi sel
      "perlu verifikasi penasihat hukum".
- [ ] Bagian 14 diisi untuk deployment, dicoba, dan diberi tanggal.
- [ ] Kueri bagian 8 dijalankan ulang pada database yang modul payrollnya aktif,
      keluaran dibandingkan dengan dokumen ini; nama aksi audit reveal akun
      pembayaran ditambahkan ke Q4 atau Q1.
- [ ] `payroll:catalog-boundary:check` dijadwalkan operator (K3) dengan role
      khususnya, dan `security:readiness` dijalankan sebagai role aplikasi secara
      terjadwal.
- [ ] Latihan tabletop pertama diadakan dan dicatat (bagian 15.3).

## 16. Pengesahan (keputusan pemilik K13)

Akuntabilitas menurut UU PDP tidak dapat didelegasikan kepada agen. Dokumen ini
tidak berdampak hukum sampai pengendali dan penasihat hukum menandatangani di
sini.

| Bidang                                          | Isian |
| ----------------------------------------------- | ----- |
| Nama perwakilan pengendali                      |       |
| Nama penasihat hukum                            |       |
| Tanggal tinjauan                                |       |
| Keputusan (setujui / setujui bersyarat / tolak) |       |
| Syarat                                          |       |
| Perwakilan operator platform (untuk bagian 5)   |       |

## 17. Butir bertanda "perlu verifikasi penasihat hukum" (dikumpulkan)

1. Pasal 46 UU 27/2022 dan tenggat **3 x 24 jam**, pemicu penghitungannya, isi
   pemberitahuan (dikutip dari ingatan penulis atas teks resmi).
2. Pemberitahuan publik pada gangguan pelayanan publik atau kepentingan publik serius.
3. Apakah **prosesor** punya kewajiban langsung berbatas waktu untuk memberitahu.
4. Otoritas: apakah sudah terbentuk, kanal dan formulir notifikasinya.
5. Apakah pemberitahuan bertahap atau awal diterima.
6. Apakah petugas pelindungan data wajib untuk deployment.
7. Nomor pasal untuk pengamanan, kerahasiaan, dan konsekuensi kegagalan memberitahu.
8. Rezim lain yang terpicu data payroll (pajak, jaminan sosial, ketenagakerjaan,
   sektoral, regulator keuangan, hukum asing).
9. Apakah suatu insiden **wajib diberitahukan** (ambang risiko).
10. Pembacaan klausul pihak ketiga (bagian 12) untuk hubungan dengan tenant (K15).

## 18. Rujukan

`dpia-hr-payroll-phase-3.md` (draf, PR #1451, R-12);
[`hr-payroll.md`](hr-payroll.md) 11.3, 13.2, 13.3, 14, 17 (L-P9, O5, PS-18);
[`privacy-analysis.md`](privacy-analysis.md); [`data-lifecycle.md`](data-lifecycle.md);
[`../adr/0137-payout-account-encryption-at-rest-and-keyed-hashing.md`](../adr/0137-payout-account-encryption-at-rest-and-keyed-hashing.md);
`src/modules/logging/application/sensitive-read-audit.ts`;
`src/modules/_shared/sensitive-reads.ts`; `sql/007`, `sql/005`, `sql/224`, `sql/408`;
keputusan pemilik K3, K13, K15 (22 November 2026); isu #1448.
