🇮🇩 Bahasa Indonesia · 🇬🇧 [English (source)](dpia-addendum-hr-payroll-template.md)

<!-- i18n-source-hash: sha256:637ff80bef0bbfe45d53da1164786f075bf0afeccba9b68e85f3679eccd50388 -->

# Templat adendum DPIA — penggajian HR, satu per deployment (dokumen B)

> **STATUS: TEMPLAT.** Bukan adendum, belum disetujui, bukan nasihat hukum.
> Dokumen ini tidak punya akibat hukum sampai pengendali menyalinnya,
> melengkapinya, dan menandatanganinya (keputusan pemilik K13: akuntabilitas
> menurut UU PDP, UU No. 27 Tahun 2022, tidak dapat didelegasikan kepada agen
> maupun repositori ini). Setiap rujukan hukum di bawah yang tidak diyakini
> penulis ditandai **perlu verifikasi penasihat hukum**; tidak ada yang dikutip
> sebagai fakta.

Ini **dokumen B** dari pasangan DPIA penggajian. **Dokumen A** adalah DPIA
tingkat platform atas rancangan fase 3 (`dpia-hr-payroll-phase-3.md`, #976, draf
sampai pengendali menandatangani). Dokumen A menjawab "apakah rancangannya cukup
aman untuk dibangun". Adendum ini menjawab hal yang hanya bisa dijawab sebuah
deployment: untuk deployment **ini**, siapa pengendali, untuk tujuan apa,
berapa orang, berapa lama, dengan prosesor mana, ke negara mana, siapa di
operator yang boleh melihat apa, dan apa yang diberitahukan kepada karyawan. Ia
menutup residu **R-11** (akses operator dan O5) dan **R-13** (pemrosesan lintas
negara) dari dokumen A (#1449), dan sejajar dengan DPIA per tenant yang
disyaratkan ADR-0138 sebelum bukti geolokasi.

## Cara memakainya

1. Salin berkas ini ke `docs/awcms/dpia-addenda/<ref>.md` (`<ref>`: huruf kecil,
   angka, dan tanda hubung, misalnya `acme-prod-2026`).
2. Ganti **setiap** penanda kurung-siku-ganda (isian kosong di tabel dan di
   Catatan gerbang) dengan jawaban deployment, dan ubah baris status di bagian
   atas agar menyatakan dokumen ini adendum yang disetujui. Satu penanda yang
   tersisa di mana pun dalam berkas, termasuk di bagian "Cara memakainya" ini,
   menjaga gerbang go-live tetap tertutup, jadi hapus bagian ini setelah Anda
   mengikutinya. Hapus asumsi yang tidak dipakai di bagian 1 (A atau B) dan
   pertahankan yang lain; pertahankan setiap baris
   `<!-- addendum-section: ... -->`, itulah yang dicari gerbang.
3. Minta penasihat hukum meninjau dan pengendali menandatangani (bagian 11).
   Lalu isi **Catatan gerbang** di akhir berkas dan set `status: approved`.
4. Hitung `sha256sum docs/awcms/dpia-addenda/<ref>.md` **setelah suntingan
   terakhir** dan set `HR_PAYROLL_DPIA_ADDENDUM_REF`,
   `HR_PAYROLL_DPIA_ADDENDUM_APPROVED_ON` dan `HR_PAYROLL_DPIA_ADDENDUM_SHA256`
   (lihat `.env.example`).
5. `bun run config:validate` dan `bun run security:readiness` memverifikasi
   berkas itu; modul `hr_payroll` tidak bisa diaktifkan untuk tenant mana pun,
   dan menolak setiap permintaan, sampai ini terpasang. Suntingan berikutnya
   mengubah digest dan menutup gerbang lagi sampai pengendali menyetujui ulang.

Ketiga variabel itu adalah sakelar go-live deployment untuk **penggajian
sebagai modul**. Ia tidak menggantikan langkah per tenant dari modul itu sendiri.

## 1. Deployment dan peran hukum operator (keputusan pemilik O5)

<!-- addendum-section: o5-outcome -->

| Butir                                      | Isian                                                     |
| ------------------------------------------ | --------------------------------------------------------- |
| Nama deployment dan lingkungan             | [[nama deployment, produksi atau lainnya]]                |
| Operator (badan hukum)                     | [[nama hukum, alamat]]                                    |
| Tenant yang akan memakai penggajian        | [[kode tenant dan badan hukum yang diwakili tiap tenant]] |
| Hasil keputusan pemilik O5, deployment ini | [[A atau B: hapus asumsi yang tidak berlaku]]             |

**Asumsi A: tenant adalah pengendali, operator adalah prosesor.** Tiap tenant
menentukan mengapa dan bagaimana data gaji karyawannya diproses; operator
memprosesnya hanya atas instruksi tertulis tenant. Operator dapat menjadi
pengendali atas data **miliknya sendiri** (akun operator, data keamanan dan audit
staf operator), yang didaftar adendum ini di [[daftar atau "tidak ada"]].

- Tenant menjawab permintaan subjek data dan memutuskan apakah suatu
  pelanggaran wajib dilaporkan (operator menyediakan bukti bila diminta).
- Perjanjian pemrosesan antara tiap tenant dan operator **wajib**
  (`payroll-processing-terms-template.id.md`, varian A).

**Asumsi B: operator adalah pengendali bersama, atau berperan lain sesuai
keputusan DPIA.** [[uraikan: tujuan dan sarana mana yang ditentukan operator, untuk data apa, dan mengapa; misalnya operator menetapkan retensi cadangan atau memilih negara hosting]].

- Siapa menjawab permintaan subjek data yang mana: [[tabel pembagian]].
- Pengaturan pengendali bersama (intinya disediakan bagi subjek data) atau
  instrumen yang sesuai bagi perannya: **perlu verifikasi penasihat hukum**
  apakah UU PDP mensyaratkan bentuk dan isi tertentu.
- Kewajiban operator sendiri untuk memberi tahu atas bagian yang ia kendalikan
  juga terpicu (**perlu verifikasi penasihat hukum**).

Apa pun hasilnya, isolasi teknisnya sama dan tidak bergantung pada keputusan
ini: RLS per tenant, audit per tenant, ekspor data subjek per tenant
(`hr-payroll.md` 13.2, ADR-0094 keputusan 1).

## 2. Tujuan dan dasar hukum

<!-- addendum-section: purposes-and-basis -->

| Butir                                  | Isian                                                                                      |
| -------------------------------------- | ------------------------------------------------------------------------------------------ |
| Tujuan penggajian di deployment ini    | [[misalnya: membayar karyawan, pemotongan dan iuran yang menjadi kewajiban pemberi kerja]] |
| Dasar hukum yang dipakai, per tujuan   | [[dasar dan sumbernya dalam hukum; persetujuan bukan dasar yang diusulkan]]                |
| Tujuan yang secara tegas TIDAK dikejar | [[misalnya: pembuatan profil, penilaian kinerja, pemasaran, berbagi untuk dijual]]         |

Dokumen A, bagian 1.1, mengusulkan hubungan kerja dan kewajiban hukum pemberi
kerja sebagai dasar kandidat, dan mencatat bahwa persetujuan tidak cocok karena
karyawan tidak bebas menolak. Dasar mana yang berlaku menurut UU PDP, dan apakah
ada kategori yang butuh dasar lain: **perlu verifikasi penasihat hukum**.

## 3. Jumlah orang dan data

<!-- addendum-section: headcount-and-data -->

| Butir                                                     | Isian                                                                             |
| --------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Jumlah subjek data per tenant (sekarang, 12 bulan lagi)   | [[angka]]                                                                         |
| Lebih besar dari kohort kecil? (indikator skala)          | [[ya atau tidak, beserta alasannya]]                                              |
| Kategori yang benar-benar dipakai (dokumen A, bagian 1.2) | [[kompensasi, rekening pembayaran, baris run, slip gaji, akrual komisi, lainnya]] |
| Identitas pajak (NIK, NPWP) yang dipakai sebuah run       | [[ya atau tidak; tetap di modul identitas, tidak pernah disalin]]                 |
| Posisi data pribadi spesifik                              | [[kesimpulan penasihat hukum atas data keuangan pribadi; dokumen A, bagian 1.3]]  |

Tenant dengan satu karyawan, atau departemen berisi satu orang, membuat angka
gaji mengidentifikasi seseorang; karena itu laporan penggajian tetap berada di
balik batas data (`payroll-data-boundary.ts`) berapa pun jumlah orangnya.

## 4. Retensi

<!-- addendum-section: retention -->

Repositori tidak menyatakan masa retensi menurut undang-undang. Isi tiap kelas
catatan dari nasihat penasihat hukum (dokumen A, bagian 2.3, residu R-07).

| Kelas catatan                              | Masa dan sumber hukum         | Mekanisme yang mengakhirinya     |
| ------------------------------------------ | ----------------------------- | -------------------------------- |
| Riwayat kompensasi                         | [[masa, sumber]]              | [[rute purge, atau "belum ada"]] |
| Baris run dan slip gaji                    | [[masa, sumber]]              | [[...]]                          |
| Rekening pembayaran (setelah dipensiunkan) | [[masa, sumber]]              | [[...]]                          |
| Akrual komisi                              | [[masa, sumber]]              | [[...]]                          |
| Cadangan yang memuat hal di atas           | [[masa, cara kedaluwarsanya]] | [[...]]                          |
| Baris audit dan audit-baca                 | [[masa, sumber]]              | [[...]]                          |

## 5. Prosesor dan sub-prosesor

<!-- addendum-section: processors-and-subprocessors -->

Daftarkan setiap pihak yang dapat menjangkau data penggajian, termasuk penyedia
cadangan dan email bila diaktifkan. Tidak ada yang keluar menurut rancangan hari
ini: tidak ada penyedia pembayaran, berkas bank, maupun pengiriman nomor
rekening (dokumen A, bagian 1.5).

| Pihak                         | Peran                    | Data yang terjangkau                  | Perjanjian dan tanggal | Negara     |
| ----------------------------- | ------------------------ | ------------------------------------- | ---------------------- | ---------- |
| [[penyedia hosting]]          | [[hosting]]              | [[semua, terenkripsi saat disimpan?]] | [[rujukan]]            | [[negara]] |
| [[penyedia cadangan]]         | [[penyimpanan cadangan]] | [[...]]                               | [[rujukan]]            | [[negara]] |
| [[lainnya, atau "tidak ada"]] |                          |                                       |                        |            |

## 6. Transfer lintas negara (residu R-13)

<!-- addendum-section: cross-border-transfers -->

| Pertanyaan                                                                                                                           | Isian                                                           |
| ------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------- |
| Apakah ada pihak di bagian 5 yang menyimpan atau mengakses data penggajian di luar Indonesia (termasuk cadangan dan akses dukungan)? | [[ya atau tidak, per pihak]]                                    |
| Posisi hukum transfer yang sah (kecukupan, pengamanan, persetujuan) per transfer                                                     | [[posisi]]                                                      |
| Bila jawabannya "belum ada pengamanan"                                                                                               | [[keputusan: simpan data di dalam negeri, atau jangan go-live]] |

Syarat yang ditetapkan UU PDP untuk transfer dan bentuk pengamanannya: **perlu
verifikasi penasihat hukum** (L-P10). Jangan biarkan bagian ini kosong dengan
alasan "penyedianya terpercaya"; jawabannya adalah posisi hukum.

## 7. Akses staf operator ke data penggajian tenant (residu R-11)

<!-- addendum-section: operator-staff-access -->

Bagian ini menyatakan **siapa di operator yang boleh melihat data penggajian
tenant dan bagaimana itu dicatat**. Bawaannya, dipertahankan kecuali bagian ini
menyatakan lain: **tidak ada staf operator yang memiliki akses tetap ke data
penggajian tenant mana pun.**

**Yang ditegakkan repositori hari ini (terverifikasi di kode):**

- Tabel penggajian hanya diberi hak kepada role permintaan (`awcms_app`).
  `PUBLIC` dan role worker tidak memegang apa pun di atasnya
  (`PAYROLL_ALLOWED_GRANTEES`, `payroll:catalog-boundary:check`).
- Row-level security di-`FORCE` dan berlingkup tenant: staf operator yang masuk
  ke **tenant platform** tidak melihat baris tenant lain, dan izin penggajian
  berlingkup tenant, bukan berlingkup platform, sehingga tidak ada izin baca
  penggajian tingkat platform untuk diberikan.
- Pembacaan lewat aplikasi meninggalkan baris audit-baca sensitif (siapa, izin
  apa, id dan jumlah mana, tidak pernah nominalnya), pada tingkat keparahan
  registri baca sensitif.

**Yang TIDAK dapat dilihat repositori:** orang dengan hak administrator database
atau hosting (superuser, pemilik tabel, konsol penyedia, pemulihan cadangan)
melewati setiap kontrol aplikasi, dan bacaan mereka tidak muncul di audit
aplikasi mana pun. Inilah eksposur R-11 yang sebenarnya, dan ia dikendalikan
oleh praktik deployment sendiri, dicatat di bawah.

| Pertanyaan                                                                            | Isian                                                                                 |
| ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Role bernama di operator yang memegang hak administrator database atau hosting        | [[role, bukan data pribadi; jumlahnya]]                                               |
| Apakah akses ke baris penggajian oleh role itu diizinkan, dan kapan?                  | [[misalnya: hanya untuk memulihkan atau memperbaiki atas permintaan tertulis tenant]] |
| Persetujuan yang dibutuhkan (siapa menyetujui, perlu orang kedua)                     | [[...]]                                                                               |
| Pemberitahuan ke tenant sebelum atau sesudah akses                                    | [[waktu dan saluran]]                                                                 |
| Di mana akses dicatat di luar aplikasi (tiket, rekaman sesi, ekstensi audit database) | [[sistem dan retensinya; tulis "belum dikonfigurasi" bila memang belum]]              |
| Frekuensi tinjauan daftar akses                                                       | [[misalnya triwulanan]]                                                               |
| Pernyataan kerahasiaan staf                                                           | [[rujukan]]                                                                           |

Akses apa pun pada varian A atas instruksi tertulis tenant; pada varian B catat
dasar operator sendiri.

## 8. Posisi DPO

<!-- addendum-section: dpo-position -->

| Butir                                                                             | Isian                            |
| --------------------------------------------------------------------------------- | -------------------------------- |
| Apakah pejabat pelindungan data pribadi wajib bagi pengendali ini (dan operator)? | [[ya, tidak, beserta alasannya]] |
| Nama atau peran dan kontak, bila ditunjuk                                         | [[...]]                          |

Apakah UU PDP mewajibkan penunjukan untuk pemrosesan ini: **perlu verifikasi
penasihat hukum** (dokumen A bagian 6 mendaftarnya sebagai butir konsultasi).

## 9. Pemberitahuan kepada karyawan (L-P11)

<!-- addendum-section: employee-notice -->

| Butir                                                                                                        | Isian                                 |
| ------------------------------------------------------------------------------------------------------------ | ------------------------------------- |
| Di mana dan bagaimana tiap karyawan diberi tahu (tujuan, kategori, retensi, hak, kontak, penerima, transfer) | [[saluran, bahasa, versi]]            |
| Tanggal pemberitahuan pertama diberikan, sebelum penggajian go-live                                          | [[tanggal]]                           |
| Bagaimana permintaan subjek data sampai ke pengendali                                                        | [[kontak]]                            |
| Siapa menjawabnya, dalam jangka berapa                                                                       | [[peran, jangka; mengikuti bagian 1]] |

## 10. Penanganan risiko residual terbuka dokumen A

<!-- addendum-section: residual-risk-treatment -->

Dokumen A mendaftar risiko yang belum punya pengurangan residual, yang wajib
ditangani pengendali sebelum go-live. Untuk tiap risiko, catat penanganan atau
penerimaannya dan siapa yang menerima.

| Risiko                                                              | Penanganan atau penerimaan di deployment ini                                                                 |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| R-07 retensi belum ditetapkan                                       | [[lihat bagian 4]]                                                                                           |
| R-11 akses operator dan O5                                          | [[lihat bagian 1 dan 7]]                                                                                     |
| R-12 pelanggaran tidak terdeteksi atau tidak dilaporkan tepat waktu | [[runbook diadopsi, kontak terisi, tanggal latihan pertama; lihat `payroll-breach-notification-runbook.md`]] |
| R-13 lintas negara                                                  | [[lihat bagian 6]]                                                                                           |
| Lainnya yang masih terbuka di dokumen A, bagian 3.2                 | [[daftar]]                                                                                                   |

## 11. Pengesahan pengendali (keputusan pemilik K13)

<!-- addendum-section: controller-sign-off -->

- [ ] Penasihat hukum meninjau adendum ini dan ketentuan pemrosesan (atau
      pengaturan bersama), termasuk setiap butir bertanda "perlu verifikasi
      penasihat hukum".
- [ ] O5 diputuskan untuk deployment ini dan bagian 1 dan 7 mengikutinya.
- [ ] Perjanjian pemrosesan atau instrumen setara ditandatangani oleh setiap
      pihak yang perlu menandatangani.
- [ ] Karyawan diberi pemberitahuan (bagian 9) sebelum go-live.
- [ ] Runbook pemberitahuan pelanggaran diadopsi: kontak terisi, latihan pertama
      dijadwalkan.
- [ ] Setiap risiko di bagian 10 punya penanganan atau penerimaan tercatat.

| Bidang                              | Isian          |
| ----------------------------------- | -------------- |
| Pengendali (badan hukum)            | [[...]]        |
| Penandatangan (nama dan kapasitas)  | [[...]]        |
| Tanggal ditandatangani              | [[YYYY-MM-DD]] |
| Penasihat hukum (kantor atau orang) | [[...]]        |
| Tanggal penasihat hukum meninjau    | [[YYYY-MM-DD]] |

Dokumen ini bukan nasihat hukum. Menandatanganinya adalah tindakan pengendali.

## Catatan gerbang

Bagian yang dibaca mesin oleh gerbang go-live. Pertahankan satu `- kunci: nilai`
per baris (kuncinya tetap berbahasa Inggris). Nilai diganti saat adendum
disetujui; nilai yang belum diisi (penanda kurung-siku-ganda, `TBD`, kosong, atau
dalam kurung sudut) menjaga gerbang tetap tertutup.

- status: draft
- template-version: 1
- o5-outcome: [[A atau B]]
- approved-on: [[YYYY-MM-DD]]
- controller-signed-by: [[nama dan kapasitas]]
- controller-signed-on: [[YYYY-MM-DD]]
- counsel-reviewed-on: [[YYYY-MM-DD]]
