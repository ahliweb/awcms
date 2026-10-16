🇮🇩 Bahasa Indonesia · 🇬🇧 [English (source)](workforce-self-service.md)

<!-- i18n-source-hash: sha256:7d7d8828193be32e1295f5be020c49510e62cad18c4ff95ca9d0e582bb8f0984 -->

# Swalayan tenaga kerja — layar karyawan, supervisor, dan HR

> **Status:** sudah dibangun (Issue #952, Wave D epik platform; bertumpu pada
> Issue #946, #947, #950/#951, dan #953). Modul: `hr_workforce` dan
> `hr_commission` (keduanya `active` sejak issue ini: masing-masing kini
> mendeklarasikan sebuah layar admin, kriteria 1 ADR-0021). Issue ini juga
> menutup butir M4 Issue #1083 (layar untuk karyawan pada jalur transparansi dan
> keberatan metrik tenaga kerja).

## 1. Layar-layarnya

Kelimanya berada di dalam shell `/admin/*` yang sudah ada, di bawah `/admin/hr/`.

| Layar                     | Untuk      | Dibuka oleh (`navigation.requiredPermission`) | Menampilkan                                                                                                                                    |
| ------------------------- | ---------- | --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `/admin/hr/my-work`       | karyawan   | `hr_workforce.self_service.read`              | shift terpublikasi milik sendiri (14 hari ke depan), kehadiran efektif sendiri (14 hari terakhir), permintaan koreksi sendiri, dan formulirnya |
| `/admin/hr/my-metrics`    | karyawan   | `hr_workforce.self_service.read`              | fakta tenaga kerja sendiri untuk 7, 14, atau 30 hari, beserta definisi tiap angka dan cara mengajukan keberatan                                |
| `/admin/hr/my-commission` | karyawan   | `hr_commission.my_accruals.read`              | akrual komisi milik sendiri, hanya baca                                                                                                        |
| `/admin/hr/team`          | supervisor | `hr_workforce.self_service.read`              | fakta bawahan langsung, kehadiran terbaru mereka, dan permintaan koreksi mereka yang tertunda                                                  |
| `/admin/hr/workforce`     | HR         | `hr_workforce.employments.read`               | data kepegawaian (nomor, jabatan, tipe, status), koreksi tertunda (`corrections.read`), dan kehadiran terbaru (`attendance.read`)              |

## 2. Apa yang menentukan siapa melihat apa

- **Data diikat oleh tautan, bukan oleh kunci.** Setiap pembacaan karyawan dan
  supervisor berjalan pada basis `mine` atau `reports`: tautan akun yang
  tersimpan pada kepegawaian aktif (`awcms_hr_employments.tenant_user_id`) dan
  tautan atasan saat ini, dihitung _di dalam query_. Layar tidak punya parameter
  orang, kepegawaian, atau id, sehingga tidak ada yang bisa diperluas. Akun yang
  tidak tertaut ke kepegawaian mana pun mendapat halaman kosong. Draf dan shift
  yang dibatalkan tidak pernah ditampilkan kepada karyawan.
- **Setiap panel diotorisasi seperti route API-nya, bukan oleh kunci masuk.**
  Kunci masuk membuka halaman; tiap panel lalu menanyakan pertanyaan yang
  ditanyakan route-nya: guard route beserta ownership grant route itu, lewat
  chokepoint (`canReadPanel`, `src/lib/hr-self-service-access.ts`; pemuatannya di
  `src/lib/hr-self-service-loaders.ts`). Sebuah ABAC `deny` tenant pada
  `attendance.read` karena itu membuat `GET /attendance-events?mine=true` 403
  _dan_ menyembunyikan kejadian di `/admin/hr/my-work`: deny-overrides-allow
  berlaku juga untuk halaman. Panel yang ditolak tidak dibaca dan halaman
  menampilkan "Beberapa bagian tidak tersedia untuk Anda". Panel `all` milik HR
  mensyaratkan role-nya memberikannya; tidak ada pelebaran lewat kepemilikan.
- **Pembacaan di luar basis milik sendiri diaudit.** `/admin/hr/team` (basis
  `reports`) dan `/admin/hr/workforce` (basis `all`) mencatat baris audit
  `sensitive_read` yang sama dengan yang dicatat route (id dan jumlah, tidak
  pernah waktu atau nilai, mode `reports`/`all`), dalam transaksi yang sama dan
  fail-closed: bila audit tidak dapat ditulis, pemuatan gagal dan tidak
  menampilkan apa pun. Basis milik karyawan sendiri tidak dicatat.
  `tests/hr-self-service-read-gate.test.ts` menggagalkan build bila halaman atau
  loader mana pun membaca baris itu pada basis selain milik sendiri tanpa
  mencatatnya.
- **Layar supervisor hanya membaca bawahan langsung.** Kejadian dan koreksi
  di-query untuk id bawahan langsung saja dan dipangkas sejak garis pelaporan
  dimulai, sehingga supervisor tidak pernah membaca riwayat sebelum ia mengelola
  orang itu.
- **Dua permission baru hanyalah gerbang layar.** Sidebar butuh permission yang
  di-seed untuk menampilkan entri, dan karyawan memang tidak memegang permission
  HR, jadi `hr_workforce.self_service.read` dan `hr_commission.my_accruals.read`
  (migrasi `sql/313`) membuka layar. Keduanya tidak memberi data yang belum
  diberikan oleh ownership grant pada route yang sudah ada. Tidak ada role yang
  diberi keduanya secara otomatis: tenant yang memutuskan (biasanya semua role
  staf). Untuk tenant yang sudah ada, jalankan
  `bun run identity-access:permissions:backfill`.
- **`GET /api/v1/hr-workforce/me`** (`self_service.read`) hanya mengembalikan
  kepegawaian milik pemanggil sendiri (tanpa id profil, nama, atau kontak) dan
  apakah ada yang melapor kepadanya.
- **`GET /api/v1/hr-commission/my-accruals[/{id}]`** (`my_accruals.read`)
  menggabungkan kepegawaian aktif yang tertaut ke akun pemanggil. Id akrual
  karyawan lain dijawab **404, sama persis dengan id yang tidak ada** (bukan
  403), dan tampilannya tidak memuat pemberi persetujuan, pembayar, referensi
  pembayaran, id baris aturan, maupun id kepegawaian. Karyawan yang membaca
  penghasilannya sendiri bukan sensitive read yang diaudit (preseden
  pemilik-membaca-miliknya pada `payslips.read`; tercatat di
  `NOT_SENSITIVE_READS`); penghasilan orang lain tetap lewat `GET /accruals`,
  yang diaudit.
- **Route `mine`/`reports` yang sudah ada tetap menjawab 403, bukan 404,** untuk
  kepegawaian bernama di luar basis (`employmentId` pada daftar kehadiran,
  shift, koreksi, dan metrik, serta koreksi berdasarkan id): 403 itu adalah
  jawaban anti-oracle yang terdokumentasi pada ADR-0063 (id yang tidak ada dan id
  milik orang lain dijawab 403 yang sama) dan tesnya tidak berubah. Route baru,
  yang tidak punya kepegawaian dari pemanggil, menjawab 404.

## 3. Yang tidak dilakukan layar mana pun

- **Tidak ada ekspor, unduhan, atau cetak data siapa pun.** Ekspor data orang
  lain memerlukan permission berisiko tinggi tersendiri dan baris audit; issue
  ini tidak mendefinisikannya, sehingga tidak ditawarkan.
  `tests/admin-hr-self-service-page-contract.test.ts` menggagalkan build bila
  sebuah layar mendapatkannya.
- **Alasan koreksi tidak pernah ditampilkan kembali.** Formulir mengirimnya
  sekali; daftar tidak memuatnya (daftar API pun tidak). Alasan bersifat sensitif
  dan hanya dibaca oleh pemohon, penerima tugas alur kerja, atau pemegang
  `corrections.read`.
- **HR tidak membaca fakta produktivitas per orang di sini.** Pembacaan mode
  `all` untuk `workforce_metrics` oleh HR adalah keputusan audit Issue #1083
  (M3); halaman yang membacanya akan melewati audit itu, sehingga tetap hanya
  lewat API sampai itu selesai.
- **Tanpa skor komposit, peringkat, atau penilaian warna** pada fakta: hitungan,
  menit, dan rasio beserta definisinya (`workforce-metrics.md` bagian 4). Rasio
  tanpa pembagi ditampilkan sebagai tanda hubung, bukan 0 %.
- **Tidak ada mutasi selain permintaan koreksi**, yaitu
  `POST /api/v1/hr-workforce/attendance-corrections` dengan `Idempotency-Key`,
  hanya untuk kepegawaian milik pemanggil (selain itu 403), yang memulai alur
  persetujuan; ia tidak pernah mengubah kejadian aslinya.

## 4. Transparansi dan keberatan (workforce-metrics bagian 7)

`/admin/hr/my-metrics` memberi tahu karyawan apa yang dihitung, bagaimana tiap
angka didefinisikan, bahwa angka-angka itu fakta bisnis dan bukan penilaian, dan
menautkan ke permintaan koreksi di `/admin/hr/my-work`. Karyawan yang
mempersoalkan sebuah angka meminta catatan kehadiran dasarnya dikoreksi dan
seorang pemberi persetujuan memutuskan.

## 5. Aksesibilitas dan tata letak

Layar hanya memakai primitif admin bersama (tabel `data-table--stack` dengan
`data-label` yang diterjemahkan, filter `admin-segmented`, kartu
`admin-stat-card`, `admin-status-pill`). Setiap status adalah label yang
diterjemahkan, bukan enum mentah. String adalah entri `t()` gettext di
`locales/en.po` dan `locales/id.po`. `tests/e2e/a11y-axe.e2e.ts` mencakup
kelimanya dengan axe dan `tests/e2e/responsive-360.e2e.ts` menyapunya pada 360,
640, 768, dan 1024 px secara otomatis (ia menemukan `src/pages/admin/**`).

## 6. Butir bukti

1. Kepemilikan (`tests/integration/hr-self-service-api.integration.test.ts`):
   Anda hanya mendaftar akrual milik sendiri; id akrual karyawan lain adalah 404
   yang identik dengan id yang tidak ada; tampilan sendiri tidak memuat pemberi
   persetujuan, pembayar, atau referensi pembayaran; `me` hanya mengembalikan
   kepegawaian pemanggil; default-deny (401, 403) dan kedua kunci adalah
   kewenangan yang terpisah.
2. Kontrak (`tests/admin-hr-self-service-page-contract.test.ts`): setiap kunci
   yang dipakai sebagai gerbang dideklarasikan dan di-seed, setiap entri
   navigasi punya halaman nyata dan route yang menegakkannya, tidak ada halaman
   karyawan atau supervisor yang membaca dalam mode `all` atau menerima parameter
   orang, tidak ada layar yang mengekspor atau mengunduh, tidak ada alasan atau
   referensi pembayaran yang ditampilkan.
3. Fungsi murni (`tests/hr-self-service.test.ts`): jendela tidak pernah melebihi
   batas 31 hari pada kontrak, periode yang tidak dikenal kembali ke default,
   setiap label enum lengkap.

## 7. Keterbatasan

- Layar tulis kepegawaian (buat, ketentuan, tautkan akun, hapus, pulihkan), layar
  pengaturan, dan editor roster shift masih hanya lewat API.
- Kehadiran karyawan ditampilkan dalam UTC (kejadian tidak membawa zona waktu);
  shift ditampilkan dalam zonanya sendiri.
- Absen masuk dan absen pulang tidak ditawarkan di layar ini (membutuhkan alur
  pemberitahuan geolokasi pada ADR-0138).
- Daftar kehadiran supervisor di API mencakup seluruh rantai atasan; layar hanya
  menampilkan bawahan langsung (satu tingkat sesuai kontrak metrik).
