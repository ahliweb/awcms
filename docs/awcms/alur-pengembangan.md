# Alur pengembangan AWCMS

> **Dokumen kanonik proses.** Ia menjawab satu pertanyaan: _dari niat sampai
> produksi, apa yang harus ada, dalam urutan apa, dan apa yang menegakkannya._
>
> Ia **tidak** mengulang isi dokumen lain. Setiap langkah menunjuk artefak
> nyata di repo ini, dan bila artefaknya **belum ada**, langkah itu mengatakannya
> — celah yang ditulis lebih berguna daripada celah yang disamarkan.

- **Menggantikan** [`alur-pengembangan-mini-first.md`](alur-pengembangan-mini-first.md),
  yang dicabut [ADR-0055](../adr/0055-development-confined-to-awcms-and-awcms-astro.md)
  dan kini hanya catatan sejarah.
- **Melengkapi, bukan menggantikan:** [`../../AGENTS.md`](../../AGENTS.md)
  (kontrak kerja teknis) dan [`../../CONTRIBUTING.md`](../../CONTRIBUTING.md)
  (mekanik langkah 10–12).

## Alurnya

```mermaid
flowchart TD
  S1[1 Master Blueprint] --> S2[2 PRD]
  S2 --> S3[3 Threat Model + Privacy]
  S3 --> S4[4 ERD + Data Dictionary]
  S4 --> S5[5 RBAC + ABAC + RLS Matrix]
  S5 --> S6[6 Spesifikasi Algoritma Domain]
  S6 --> S7[7 OpenAPI + AsyncAPI]
  S7 --> S8[8 UX/UI]
  S8 --> S9[9 Cross-Spec Review / Definition of Ready]
  S9 --> S10[10 Issue GitHub Atomic]
  S10 --> S11[11 Implementasi + Test Otomatis]
  S11 --> S12[12 PR + Review + CI]
  S12 --> S13[13 Deploy Staging - TIDAK BERLAKU ADR-0083]
  S13 --> S14[14 UAT Internal - TIDAK BERLAKU]
  S14 --> S15[15 Release Readiness / Go-No-Go]
  S15 --> S16[16 Deploy Produksi]
  S16 --> S17[17 Validasi Produksi]
  S17 --> S18[18 Monitoring + Post-Release Review]
  S18 -->|perbaikan berkelanjutan| S1
```

## Dua hal yang harus dibaca sebelum memakai diagram ini

**Pertama: tidak setiap perubahan menempuh 18 langkah.** Yang menentukan bukan
selera, melainkan KELAS perubahannya:

| Kelas perubahan                                         | Langkah wajib                                                                                               |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Dokumen saja, chore, dependency bump                    | 10 → 12, lalu 16–18 saat rilis                                                                              |
| Perbaikan bug tanpa perubahan kontrak/skema             | 10 → 12                                                                                                     |
| Perubahan perilaku pada modul yang sudah ada            | 3, 5 (bila menyentuh akses), 7 (bila menyentuh API), 10 → 12                                                |
| Skema baru / kolom baru                                 | 4, 5, 10 → 12                                                                                               |
| **Modul baru**                                          | 1 → 12 penuh, plus admission ADR ([`21_module_admission_governance.md`](21_module_admission_governance.md)) |
| Perubahan lapisan fondasi (auth, access, sync, tenancy) | 1 → 12 penuh, **ADR wajib**                                                                                 |

**Kedua: langkah 1–9 menghasilkan DOKUMEN, dan dokumen di repo ini menua.**
Aturan yang sudah berlaku tetap berlaku: sebuah dokumen yang salah lebih
berbahaya daripada dokumen yang tidak ada, karena ia dipercaya. Kalau sebuah
langkah menghasilkan klaim yang bisa basi (angka, daftar berkas, status), taruh
klaim itu di tempat yang **di-generate atau digerbangi**, bukan di prosa.

---

## 1. Master Blueprint

**Menjawab:** produk ini apa, batasnya di mana, dan apa yang secara sengaja
BUKAN bagiannya.

| Artefak                                                            | Peran                                 |
| ------------------------------------------------------------------ | ------------------------------------- |
| [`01_canvas_induk.md`](01_canvas_induk.md)                         | ringkasan produk & prinsip            |
| [`11_implementation_blueprint.md`](11_implementation_blueprint.md) | blueprint implementasi per sprint     |
| [`../ARCHITECTURE.md`](../ARCHITECTURE.md)                         | arsitektur current-state (digerbangi) |
| [`../adr/`](../adr/README.md)                                      | keputusan yang mengunci ruang lingkup |

Perubahan ruang lingkup di tingkat ini **selalu** sebuah ADR. Blueprint tidak
mengubah arah; ADR yang mengubah, dan blueprint mengikutinya.

## 2. PRD

**Menjawab:** siapa penggunanya, pekerjaan apa yang diselesaikan, dan apa
kriteria diterimanya.

[`02_prd_detail_per_modul.md`](02_prd_detail_per_modul.md).

## 3. Threat Model + Privacy Analysis

**Menjawab:** siapa penyerangnya, apa yang ia incar, dan data pribadi apa yang
tersentuh.

| Bagian                      | Artefak                                                                                | Status          |
| --------------------------- | -------------------------------------------------------------------------------------- | --------------- |
| Threat model                | [`20_threat_model_security_architecture.md`](20_threat_model_security_architecture.md) | ada             |
| Peta kontrol                | [`standar-performa-dan-keamanan.md`](standar-performa-dan-keamanan.md)                 | ada, **hidup**  |
| Retensi data                | [`data-lifecycle.md`](data-lifecycle.md) + gerbang `data-lifecycle:*`                  | ada, digerbangi |
| **Privacy analysis / DPIA** | [`privacy-analysis.md`](privacy-analysis.md)                                           | ada             |
| Per fitur                   | [`templates/privacy-analysis-template.md`](templates/privacy-analysis-template.md)     | ada             |

Keduanya wajib dan menjawab hal berbeda: threat model menjawab "siapa
penyerangnya", analisis privasi menjawab "data siapa yang ada di sini".

Analisis privasi sengaja **tidak** menyalin angka retensi per tabel — salinan
itu basi pada hari pertama seseorang mengubah deskriptornya, dan angka basi di
dokumen privasi lebih berbahaya daripada tidak ada angka. Ia menunjuk ke tempat
yang digerbangi. Ia juga menyatakan apa yang **hanya bisa dijawab operator**
(dasar hukum, DPO, transfer lintas-yurisdiksi) alih-alih berpura-pura
menjawabnya.

## 4. ERD + Data Dictionary

**Menjawab:** entitas apa, relasinya bagaimana, dan kolomnya berarti apa.

[`04_erd_data_dictionary.md`](04_erd_data_dictionary.md), dengan skema nyata di
[`../../sql/`](../../sql/) dan konvensinya di
[`database-migrations.md`](database-migrations.md).

**Yang menegakkan, bukan sekadar menyarankan:**

- migrasi terapan **immutable** — mengeditnya memblokir `db:migrate` di
  deployment yang sudah jalan;
- setiap tabel `awcms_%` wajib `ENABLE` **dan** `FORCE ROW LEVEL SECURITY`
  kecuali terdaftar sebagai global ber-alasan (`security:readiness`);
- setiap kolom foreign key wajib terjangkau index (`db:fk-index:check`);
- setiap tabel wajib menjawab pertanyaan retensi
  (`data-lifecycle:table-coverage:check`).

## 5. RBAC + ABAC + RLS Matrix

**Menjawab:** siapa boleh melakukan apa, terhadap objek mana.

| Artefak                                                        | Peran                                |
| -------------------------------------------------------------- | ------------------------------------ |
| [`17_default_seed_rbac_abac.md`](17_default_seed_rbac_abac.md) | seed role & policy default           |
| Deskriptor `permissions` di `src/modules/*/module.ts`          | katalog permission yang sesungguhnya |
| Policy RLS di `sql/`                                           | batas tenant yang sesungguhnya       |

**Yang menegakkan:** `access:chokepoint:check` (setiap handler lewat gerbang),
`access:permissions:enforcement:check`, `access:decision-log:coverage:check`,
`access:grant-readers:check`, `identity-access:sod-registry:check`, dan
`security:readiness` untuk RLS terhadap basis data nyata.

Aturan yang tidak bisa ditawar: **default-deny**, gerbang struktural di ATAS
pengambilan permission, dan setiap gerbang baru **deny-only** — tidak satu pun
boleh menghasilkan `allowed: true`.

## 6. Spesifikasi Algoritma Domain / Verifikasi

**Menjawab:** aturan bisnisnya persisnya apa, termasuk kasus tepinya.

[`03_srs_detail_per_modul.md`](03_srs_detail_per_modul.md).

Aturan yang berlaku sejak awal repo ini: **logika murni dipisahkan dari I/O**.
Yang bisa ditulis sebagai fungsi murni ditulis begitu, karena itu yang membuat
kasus tepi bisa diuji tanpa basis data — dan karena itu yang membuat mutasi
bisa membuktikan sebuah gerbang benar-benar menjaga sesuatu.

## 7. OpenAPI + AsyncAPI

**Menjawab:** kontrak yang dijanjikan ke pemanggil.

Fragmen per modul di [`../../openapi/modules/`](../../openapi/modules/), pola
dan alasannya di [`05_openapi_asyncapi_detail.md`](05_openapi_asyncapi_detail.md)
dan [`api-contribution-guide.md`](api-contribution-guide.md).

**Yang menegakkan:** `api:spec:check`, `api:docs:check`,
`api:consumer-contract:check`, dan gerbang kesegaran bundle — spesifikasi yang
tidak cocok dengan rutenya memerahkan CI, bukan menunggu ditemukan konsumen.

## 8. UX/UI

**Menjawab:** bentuknya di layar, dan bagaimana ia gagal di depan pengguna.

[`14_ui_ux_design_system.md`](14_ui_ux_design_system.md) dan
[`15_frontend_architecture_integration.md`](15_frontend_architecture_integration.md).

Dua batasan yang sering baru ditemukan belakangan: **CSP single-owner** (script
harus di-import lalu di-bundle, bukan inline) dan setiap layar admin wajib lewat
`loadAdminScreen` (`access:chokepoint:check` menghitungnya).

## 9. Cross-Spec Review / Definition of Ready

**Menjawab:** apakah langkah 1–8 saling setuju, sebelum ada yang menulis kode.

| Artefak                                                                                                | Peran                              |
| ------------------------------------------------------------------------------------------------------ | ---------------------------------- |
| [`templates/definition-of-ready.md`](templates/definition-of-ready.md)                                 | **Definition of Ready umum**       |
| [`13_final_master_index_traceability.md`](13_final_master_index_traceability.md)                       | matriks traceability antar-dokumen |
| [`templates/module-admission-decision-checklist.md`](templates/module-admission-decision-checklist.md) | checklist — modul baru             |

Definition of **Done** di `CONTRIBUTING.md` diperiksa di ujung; daftar di atas
diperiksa di pangkal, dan itu seluruh perbedaannya.

Pengalaman repo ini menunjukkan biayanya, dan pertanyaan PERTAMA di Definition
of Ready ada karena itu: **dua gelombang berturut-turut** (ADR-0087 dan
ADR-0088) menulis rencana yang mengasumsikan pembacaan lintas-tenant yang FORCE
RLS larang, dan keduanya baru ketahuan saat implementasi.

## 10. Issue GitHub Atomic

**Menjawab:** unit kerja terkecil yang bisa di-review sendirian.

Pola di [`06_github_issues_detail.md`](06_github_issues_detail.md), konvensi
penamaan/roadmap di [`09_roadmap_repository_commit.md`](09_roadmap_repository_commit.md).

Satu issue = satu branch = satu PR. Bila sebuah issue tidak bisa mendarat tanpa
meninggalkan pohon dalam keadaan lebih lemah, ia dipecah sampai bisa.

## 11. Implementasi + Test Otomatis

**Menjawab:** kodenya, dan bukti bahwa kodenya benar.

Standar di [`10_template_kode_coding_standard.md`](10_template_kode_coding_standard.md)
dan [`../../AGENTS.md`](../../AGENTS.md).

Tiga aturan yang khas repo ini dan tidak ada di panduan umum mana pun:

1. **Jalankan, jangan dibaca.** Migrasi diverifikasi dengan di-apply dari nol
   pada Postgres nyata, dan constraint dibuktikan **MENOLAK** — bukan sekadar
   ada.
2. **Gerbang wajib dibuktikan GAGAL.** Sebuah cek yang hijau tidak membuktikan
   apa pun sampai sebuah mutasi memerahkannya. Kembalikan cacat aslinya, lihat
   test yang benar memerah, lalu pulihkan.
3. **Klaim berbentuk "X berjalan sebelum Y" diuji di level SOURCE**, karena test
   perilaku bisa dipuaskan oleh susunan yang benar _dan_ oleh susunan yang
   termutasi — dan asersi source wajib rename-proof, atau ia lolos secara hampa.

## 12. PR + Review + CI

**Menjawab:** apakah ini boleh masuk `main`.

Mekaniknya di [`../../CONTRIBUTING.md`](../../CONTRIBUTING.md), template di
[`../../.github/PULL_REQUEST_TEMPLATE.md`](../../.github/PULL_REQUEST_TEMPLATE.md),
proteksi branch di [`branch-protection.md`](branch-protection.md).

Gerbangnya: rantai `bun run check` penuh, suite DB-gated, E2E Playwright,
CodeQL, GitGuardian, dan changeset wajib untuk perubahan perilaku.

**Jebakan yang sudah pernah menggigit:** PR bertumpuk (base bukan `main`)
menjalankan **NOL** gerbang, sementara `gh pr checks` tetap tampak hijau karena
GitGuardian lulus sendirian.

## 13. Deploy Staging — **TIDAK BERLAKU untuk repo ini**

> **Keputusan, bukan celah** (13 Agustus 2026).
> [ADR-0083](../adr/0083-this-template-deploys-to-one-environment.md) tetap
> berlaku: template ini men-deploy ke **SATU** environment, produksi.

Langkah ini ada di alur generik dan **sengaja dilewati di sini**. Pemilik repo
diminta memilih antara menghidupkan staging (men-supersede ADR-0083) dan
mempertahankan satu environment, dan memilih yang kedua.

**Yang menggantikannya, dinyatakan supaya tidak perlu diterka:**

| Peran staging                        | Yang mengisinya di sini                                                           |
| ------------------------------------ | --------------------------------------------------------------------------------- |
| skema diterapkan dari nol            | basis data ephemeral CI (langkah 12)                                              |
| jalur request diuji ujung ke ujung   | E2E Playwright + suite DB-gated (langkah 12)                                      |
| verifikasi terhadap basis data nyata | `bun run security:readiness` (langkah 15)                                         |
| kesiapan sebelum rilis               | [`production-preflight-runbook.md`](production-preflight-runbook.md) (langkah 15) |

**Dan yang TIDAK tergantikan olehnya, dicatat apa adanya:** pengujian manusia
terhadap data yang mirip produksi, dan verifikasi perilaku pihak ketiga
(Cloudflare, Varnish, Traefik) di luar jalur produksi. Keduanya adalah harga
dari keputusan ini, bukan sesuatu yang hilang tanpa disadari — dan keduanya
alasan sah untuk meninjau ulang ADR-0083 kelak.

Menghidupkannya kembali tetap keputusan tingkat ADR, bukan sesuatu yang bisa
dibalik dokumen proses.

## 14. UAT Internal / Pengujian Manusia — **TIDAK BERLAKU untuk repo ini**

**Menjawab:** apakah yang dibangun benar-benar menyelesaikan pekerjaan
penggunanya.

Ia bergantung pada langkah 13, dan langkah 13 adalah keputusan untuk tidak ada.
Jadi ini bukan celah yang menunggu diisi; ia konsekuensi yang sudah diputuskan.

Yang paling mendekati perannya adalah verifikasi produksi (langkah 17), dengan
perbedaan yang harus dibaca jujur: **ia berjalan SESUDAH rilis, bukan
sebelumnya.** Untuk perubahan yang mempengaruhi jalur yang dilihat pelanggan,
itu berarti biaya kesalahan dibayar di produksi — dan bila ongkos itu terasa
terlalu mahal untuk sebuah perubahan tertentu, jawabannya adalah meninjau
ADR-0083 untuk perubahan itu, bukan melewatkan langkah 17.

## 15. Release Readiness / Go–No-Go

**Menjawab:** apakah ini aman dirilis, dan siapa yang mengatakan ya.

| Artefak                                                              | Peran                                |
| -------------------------------------------------------------------- | ------------------------------------ |
| [`production-readiness.md`](production-readiness.md)                 | gate kesiapan produksi               |
| [`production-preflight-runbook.md`](production-preflight-runbook.md) | checklist preflight                  |
| `bun run security:readiness`                                         | verifikasi terhadap basis data NYATA |
| [`resilience-dr-verification.md`](resilience-dr-verification.md)     | verifikasi disaster recovery         |

`security:readiness` adalah satu-satunya pemeriksaan di daftar ini yang
menjalankan query terhadap basis data sungguhan — dan ia yang menangkap kelas
kegagalan yang tak terlihat gerbang murni, mis. **role Postgres yang ternyata
superuser sehingga FORCE RLS menjadi inert**.

## 16. Deploy Produksi

**Menjawab:** bagaimana bit-nya sampai ke server.

[`release-process.md`](release-process.md) (SemVer + Changesets),
[`deploy-coolify.md`](deploy-coolify.md), dan `.github/workflows/release.yml`.

## 17. Validasi Produksi

**Menjawab:** apakah yang berjalan di sana benar-benar versi yang dimaksud, dan
benar-benar sehat.

[`production-preflight-runbook.md`](production-preflight-runbook.md) memuat
langkah pasca-deploy-nya.

**Aturan yang lahir dari pengalaman:** _200 di domain ≠ produksi hidup._
Verifikasi versi, migrasi terapan, dan jalur data — bukan hanya kode status
halaman depan.

## 18. Monitoring + Post-Release Review

**Menjawab:** apa yang terjadi setelahnya, dan apa yang dipelajari.

| Bagian                  | Artefak                                                           | Status |
| ----------------------- | ----------------------------------------------------------------- | ------ |
| Konvensi observability  | [`observability-metrics.md`](observability-metrics.md)            | ada    |
| Kapasitas basis data    | [`database-capacity-runbook.md`](database-capacity-runbook.md)    | ada    |
| **Post-release review** | [`post-release-reviews.md`](post-release-reviews.md) + templatnya | ada    |
| Putaran rekomendasi     | [`../PROJECT_STATE.md`](../PROJECT_STATE.md) §4                   | ada    |

Dua register, dan pembedaannya disengaja: §4 terikat **putaran kerja** dan
mencatat keputusan; register rilis terikat **rilis** dan mencatat apa yang
terjadi ketika rilis itu bertemu produksi. Sebelum yang kedua ada, ia diam-diam
ditulis sebagai yang pertama atau tidak ditulis sama sekali.

**Rilis yang mulus tetap mendapat entri** — register yang hanya memuat insiden
menghapus garis dasar yang membuat rilis buruk terlihat buruk. Dan satu baris di
templatnya menanggung beban khusus di repo ini: _"yang pertama kali terlihat di
produksi dan tidak terlihat di CI"_ adalah tempat harga keputusan ADR-0083
(langkah 13) dibayar, dan mengumpulkannya rilis demi rilis adalah satu-satunya
cara mengetahui apakah harganya masih pantas.

**Aturan yang sudah berlaku:** rekomendasi wajib ditulis ke §4, termasuk yang
DITOLAK beserta alasannya. Menurunkan ulang sebuah daftar rekomendasi memakan
satu audit penuh; menuliskannya memakan satu paragraf.

---

## Status tiap langkah yang pernah kosong

Daftar ini ada di sini supaya tidak perlu diturunkan ulang. Perhatikan kolom
terakhir: **celah dan keputusan bukan hal yang sama**, dan mencampurnya adalah
bagaimana pekerjaan yang belum dikerjakan memperoleh rupa penilaian.

| Langkah | Hal                           | Sifat                                      |
| ------- | ----------------------------- | ------------------------------------------ |
| 3       | Privacy analysis / DPIA       | **ditutup** 13 Agu 2026                    |
| 9       | Definition of Ready umum      | **ditutup** 13 Agu 2026                    |
| 13      | Deploy staging                | **keputusan** — ADR-0083, satu environment |
| 14      | UAT internal                  | **keputusan** — konsekuensi langkah 13     |
| 18      | Post-release review per rilis | **ditutup** 13 Agu 2026                    |

Celah yang tersisa setelah itu **ada di dalam** dokumen yang menutupnya, bukan
di tabel ini — terutama ketiadaan alur ekspor/penghapusan per subjek data
([`privacy-analysis.md`](privacy-analysis.md) §4). Ia dicatat di sana karena di
sanalah orang yang membutuhkannya akan mencari.
