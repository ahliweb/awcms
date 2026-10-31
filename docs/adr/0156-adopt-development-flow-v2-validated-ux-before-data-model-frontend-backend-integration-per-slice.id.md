🇮🇩 Bahasa Indonesia · 🇬🇧 [English (source)](0156-adopt-development-flow-v2-validated-ux-before-data-model-frontend-backend-integration-per-slice.md)

<!-- i18n-source-hash: sha256:4224ac4bff8a2cdc8dc8b02edd0022568e061686ca15e7dcc5face884eac7c99 -->

<!-- i18n-source-hash: sha256:0 -->

# ADR-0156 — Mengadopsi alur pengembangan v2: UX/UI tervalidasi sebelum model data, dan frontend → backend → integrasi per slice

- **Status:** Diterima
- **Tanggal:** 2026-10-30
- **Pengambil keputusan:** ahliweb (pemilik), diputuskan 2026-10-30
- **Mengamendemen:** urutan langkah di [`docs/awcms/alur-pengembangan.md`](../awcms/alur-pengembangan.id.md) (alur kanonik yang ditulis pada 13 Agustus 2026). Ia tidak mengamendemen ADR terdahulu mana pun.
- **Terkait:** [ADR-0083](0083-this-template-deploys-to-one-environment.id.md) (langkah 13–14 tetap TIDAK BERLAKU), [ADR-0146](0146-persona-apps-prefer-lynx-in-consumer-repos-astro-keeps-admin-and-public-web.id.md) (pertanyaan permukaan baru tetap punya gerbangnya), [ADR-0055](0055-development-confined-to-awcms-and-awcms-astro.id.md). Keputusan hulu: **DL-033** di decision log `ahliweb/personal-coding`, yang `docs/alur-pengembangan-produk.md` v2.0.0-nya adalah alur generik yang diadopsi repo ini.

**Hanya dokumen dan tata kelola.** ADR ini tidak menambah modul, migrasi, rute, path OpenAPI, kanal AsyncAPI, dependensi, maupun perkakas. Ia mengubah _urutan_ dokumen yang sudah ada dihasilkan dan menamai celah yang ditampakkan urutan baru itu.

## Konteks

Alur kanonik (v1) menaruh UX/UI di **langkah 8**: setelah ERD (4), matriks RBAC/ABAC/RLS (5), spesifikasi domain (6), dan kontrak API (7). Baru sesudah itu sebuah layar digambar, dan review lintas-spesifikasi (9) adalah tempat pertama semuanya bertemu.

Urutan itu punya biaya struktural, dan repo ini sudah membayarnya lebih dari sekali dalam rupa lain (ADR-0087 dan ADR-0088 menulis rencana yang mengasumsikan pembacaan yang FORCE RLS larang, dan ketahuan saat implementasi, bukan di langkah 9):

- **Kontrak dibekukan sebelum ada yang melihat layarnya.** Model data dan API dibentuk oleh apa yang penulis _kira_ dibutuhkan sebuah layar. Ketika layar digambar di langkah 8, celahnya berupa perubahan pada kontrak yang sudah direview, sehingga ia diserap sebagai endpoint yang janggal atau membuka ulang langkah 4–7.
- **Tidak ada di v1 yang menguji desain dengan pengguna sebelum kode ada.** Langkah 8 menjawab "bentuknya di layar"; ia tidak mewajibkan prototipe yang sudah dicoba pengguna representatif. Kontak pertama antara pengguna dan produk adalah layar yang sudah dibangun.
- **Langkah 11 adalah satu blok tak terbagi.** "Implementasi" membiarkan frontend dan backend dibangun berdasarkan tebakan satu sama lain dan disambung di akhir. Itu integrasi big-bang, dan biaya integrasinya jatuh di minggu terakhir.

Alur generik di `ahliweb/personal-coding` direvisi ke v2.0.0 pada 2026-10-30 (DL-033) untuk memperbaiki ini. Otoritas normatifnya untuk `awcms` tetap di sini: dokumen itu menyatakan eksplisit bahwa v2.0.0-nya tidak otomatis berlaku di repo produk dan memerlukan ADR di repo itu. Ini ADR tersebut.

## Keputusan

Adopsi alur **v2.0.0** di `docs/awcms/alur-pengembangan.md` (sumber Inggris dan cermin Indonesia).

### 1. UX/UI pindah dari langkah 8 ke langkah 4, sebagai prototipe tervalidasi

Langkah 4 menjadi **visualisasi UX/UI + prototipe tervalidasi**: arsitektur informasi, user flow, prototipe yang sudah dicoba pengguna representatif, seluruh state layar (kosong, memuat, error, sebagian, tanpa izin, offline/lambat, konfirmasi aksi destruktif), WCAG 2.2 AA sejak desain, dan **inventaris data per layar** (apa yang ditampilkan, diinput, difilter, diurutkan). Inventaris itu adalah masukan langsung bagi ERD (5) dan kontrak (8). Langkah 2 mendapat riset pengguna sebagai masukan wajib PRD.

### 2. Peta penomoran

| v1 (13 Agu 2026)                          | v2 (ADR ini)                                           | Perubahan                                                        |
| ----------------------------------------- | ------------------------------------------------------ | ---------------------------------------------------------------- |
| 1 Master Blueprint                        | 1 Master Blueprint                                     | tidak ada                                                        |
| 2 PRD                                     | 2 Riset Pengguna + PRD                                 | riset menjadi masukan wajib                                      |
| 3 Threat Model + Privacy                  | 3 Threat Model + Privacy                               | tidak ada (pass kedua ditambahkan di gerbang 9)                  |
| 8 UX/UI                                   | **4** Visualisasi UX/UI + Prototipe Tervalidasi        | dipindah ke depan model data                                     |
| 4 ERD + Data Dictionary                   | **5** ERD + Data Dictionary                            | +1                                                               |
| 5 RBAC + ABAC + RLS Matrix                | **6** RBAC + ABAC + RLS Matrix                         | +1                                                               |
| 6 Algoritma Domain / Verifikasi           | **7** Algoritma Domain / Verifikasi                    | +1                                                               |
| 7 OpenAPI + AsyncAPI                      | **8** OpenAPI + AsyncAPI + mock hasil generate         | +1; mock dihasilkan, tidak pernah ditulis tangan                 |
| 9 Cross-Spec Review / Definition of Ready | 9 (nomor tidak berubah)                                | mendapat pemeriksaan baru di §4                                  |
| 10 Issue GitHub Atomic                    | 10                                                     | issue dipotong per vertical slice, tiap slice 11.1 → 11.2 → 11.3 |
| 11 Implementasi + Test Otomatis           | 11 = **11.1 Frontend → 11.2 Backend → 11.3 Integrasi** | dipecah, urutan wajib, per slice                                 |
| 12 PR + Review + CI                       | 12                                                     | setiap PR dari 11.1, 11.2, dan 11.3 melewatinya                  |
| 13–14 (N/A, ADR-0083), 15–18              | 13–14 (N/A), 15–18                                     | tidak ada                                                        |

### 3. Langkah 11 dipecah per vertical slice

- **11.1 Frontend** dibangun terhadap **mock yang dihasilkan dari kontrak**, mencakup semua state termasuk error dan tanpa izin.
- **11.2 Backend** mengimplementasikan kontrak yang sama; perbedaan mengembalikan pekerjaan ke langkah 8, tidak pernah penyesuaian diam-diam.
- **11.3 Integrasi** mengganti mock dengan backend nyata, menjalankan uji kontrak di kedua sisi dan tes end-to-end jalur kritis.

Per slice, bukan per produk: menyelesaikan seluruh frontend sebelum backend mana pun adalah integrasi big-bang dan dilarang. Celah kontrak yang ditemukan frontend pulang ke langkah 8 dan melewati gerbang 9 lagi (perubahan aditif yang kompatibel ke belakang boleh memakai review kontrak ringkas yang tercatat). **Otorisasi tetap ditegakkan di backend dan database** (chokepoint, FORCE RLS); frontend hanya mencerminkannya. Tidak ada dalam ADR ini yang memindahkan pemeriksaan ke klien.

### 4. Gerbang 9 mendapat pemeriksaan baru, termasuk satu cacat blocking

Ditambahkan ke cross-spec review (Definition of Ready): setiap layar punya sumber data yang terpetakan ke operasi kontrak; temuan usabilitas berprioritas tinggi sudah tuntas atau diterima sadar oleh orang yang disebut namanya; desain diperiksa terhadap WCAG 2.2 AA; mock dihasilkan dari kontrak dan menjalankan contohnya; dan pass **kedua** atas keamanan/privasi langkah 3 dilakukan setelah UI, data, dan API punya bentuk.

**Cacat blocking baru: layar tanpa sumber data di kontrak.** Ia bergabung dengan yang sudah ada (endpoint tanpa permission, tabel tanpa klasifikasi, kolom PII tanpa kebijakan retensi). Ia tidak bisa diloloskan dengan catatan.

### 5. Kenapa gerbang 9 dan 15 mempertahankan nomornya

Nomor adalah rujukan, dan dua ini yang paling sering dikutip di repo ini. "Langkah 9" dikutip oleh template Definition of Ready dan cerminnya, `docs/awcms/README.md`, ADR-0146 §6, dan dokumen alur itu sendiri; "langkah 15" serta langkah 10, 12, dan 13–18 dikutip oleh `AGENTS.md`, `CONTRIBUTING.md`, prompt agent, register rilis, dan runbook produksi. Menomori ulang semuanya akan membuat tiap rujukan itu berbohong secara diam-diam tanpa ada gerbang yang menyadarinya, dan biayanya tidak membeli apa pun: revisi ini hanya menyusun ulang pekerjaan di dalam fase spesifikasi dan memecah langkah 11. Peta di atas adalah tabel terjemahannya. Aturan turunannya: rujukan ke "langkah 4" sampai "langkah 8" yang ditulis **sebelum 2026-10-30** memakai penomoran v1.

Langkah 13 dan 14 tetap **TIDAK BERLAKU** di bawah ADR-0083. v2 tidak menyalakan staging. Teks gerbang 15 v2 yang meminta temuan usabilitas "pada build nyata" hanya dipenuhi di sini oleh langkah 17 (validasi produksi), dengan biaya yang sudah dicatat `alur-pengembangan.md` §14.

## Konsekuensi

**Rujukan yang dinomori ulang dalam perubahan ini** (hanya dokumen yang hidup):

- `docs/awcms/alur-pengembangan.md` dan `.id.md`: diagram, tabel kelas perubahan, seluruh bagian 4–8, teks langkah 2 dan 11, tabel celah, dan kalimat tentang permukaan produk baru (kini keputusan langkah 4 dan 9).
- `.claude/agents/awcms-security-auditor.md`: "langkah 5 (matriks RBAC/ABAC/RLS)" kini langkah 6.
- `CONTRIBUTING.md`: daftar langkah 1–9 yang tidak dicakup dokumen itu disusun ulang, dan langkah 11 dicatat sebagai terpecah.
- `AGENTS.md`: kalimat kelas perubahan diperbarui untuk pemecahan langkah 11.

**Rujukan yang SENGAJA tidak diubah:**

- ADR terdahulu (0001–0155) mempertahankan redaksinya sebagai catatan. Bila salah satunya menulis "langkah N" pada rentang 4–8, artinya v1; ADR-0146 §6 menulis "langkah 9", yang tidak berubah.
- `docs/awcms/templates/definition-of-ready.md` dan rujukan ke langkah 3, 9, 10–12, dan 18 di dokumen lain: nomornya tidak bergeser.
- Entri ronde historis `docs/PROJECT_STATE.md` dan `CHANGELOG.md`.
- Artefak hasil generate (`graphify-out/`): diregenerasi oleh perkakasnya sendiri, tidak diedit tangan.

**Celah baru, ditulis dan tidak disembunyikan** (rincian di dokumen alur): tidak ada artefak laporan uji usabilitas atau inventaris data per layar; WCAG 2.1 AA di `14_ui_ux_design_system.md` terhadap 2.2 AA pada v2; tidak ada perkakas yang menghasilkan mock atau klien dari kontrak OpenAPI; snapshot kontrak konsumen bersifat satu sisi; template Definition of Ready belum memuat pemeriksaan gerbang 9 yang baru. Masing-masing butuh issue sendiri; ADR ini tidak menutupnya.

**Biaya.** Langkah 4 menjadi lebih berat dan lebih awal: perubahan yang menyentuh layar yang terlihat pengguna membutuhkan prototipe yang sudah dicoba sebelum skemanya digambar. Tabel kelas perubahan menjaganya proporsional, karena perbaikan bug atau perubahan dokumen tetap hanya menempuh 10 → 12.

## Alternatif yang dipertimbangkan

1. **Tetap v1.** Ditolak: ia membekukan kontrak sebelum layar terlihat, yaitu biaya yang diuraikan di Konteks.
2. **Adopsi v2 dan nomori ulang semuanya agar rapi.** Ditolak: gerbang 9 dan 15 adalah nomor yang paling banyak dirujuk, dan menomorinya ulang diam-diam membasikan dokumen yang tidak bisa dideteksi gerbang (§5).
3. **Adopsi urutannya tetapi tidak pemecahan 11.x.** Ditolak: memindahkan UX ke depan tanpa memecah langkah 11 menyisakan integrasi big-bang, yang separuh dari masalahnya.
4. **Menyalakan staging agar usabilitas dapat diuji pada build.** Di luar cakupan: itu keputusan untuk menggantikan ADR-0083, bukan untuk diambil di dalam ADR proses.

## Referensi

- `ahliweb/personal-coding`: `docs/alur-pengembangan-produk.md` v2.0.0 (§Pernyataan Pokok, §3, §5 langkah 4 dan 11, §6) dan decision log DL-033.
- [`docs/awcms/alur-pengembangan.md`](../awcms/alur-pengembangan.id.md)
- [ADR-0083](0083-this-template-deploys-to-one-environment.id.md), [ADR-0146](0146-persona-apps-prefer-lynx-in-consumer-repos-astro-keeps-admin-and-public-web.id.md)
