🇮🇩 Bahasa Indonesia · 🇬🇧 [English (source)](0070-peran-keluarga-awcms-astro-memikul-publik-dan-admin-user.md)

<!-- i18n-source-hash: sha256:30e3bd92a1ed4f47bd92b239b50420dea68ce9af599f528342e3c106b9cc0001 -->

# ADR-0070 — Peran keluarga: `awcms-astro` memikul halaman publik dan permukaan admin USER

- **Status:** Accepted
- **Tanggal:** 2026-08-08
- **Pengambil keputusan:** @ahliweb
- **Mempersempit:** [ADR-0051](0051-admin-screens-consolidated-in-awcms.md) — kata "seluruh layar admin" dipersempit menjadi "seluruh layar admin **SISTEM**". ADR-0051 **tidak** di-supersede: keputusan intinya berlaku utuh dan ketiga gerbang penggantinya tidak dilonggarkan sedikit pun. Berkasnya mendapat banner penanda; kalimatnya tidak ditulis ulang (Aturan 2 indeks ADR).
- **Menyempurnakan:** [ADR-0055](0055-development-confined-to-awcms-and-awcms-astro.md) — kolom `awcms-astro` pada tabel peran dua repo di sana mendapat isi yang benar, lewat banner penanda dengan cara yang sama. Butir 1–5 §Keputusan-nya tidak berubah.
- **Terkait:** [ADR-0045](0045-jualanku-porting-awcms-system-of-record-astro-bff.md) (`awcms` system of record, `awcms-astro` experience layer + BFF), [ADR-0050](0050-bff-session-handoff-code.md) (kode serah-terima sesi), [ADR-0065](0065-awcms-astro-consumer-contract-is-frozen.md) (kontrak konsumen beku), [ADR-0068](0068-family-standards-posture-editions-and-recorded-divergences.md) (mekanisme pencatatan divergence keluarga), `awcms-astro` ADR-0034 ([`docs/adr/0034-publik-secara-bawaan-admin-hanya-bila-dinyatakan.md`](https://github.com/ahliweb/awcms-astro/blob/main/docs/adr/0034-publik-secara-bawaan-admin-hanya-bila-dinyatakan.md))

## Konteks

Pada 8 Agustus 2026, `awcms-astro` mendaratkan ADR-0034: repo itu adalah situs
**publik** sebagai fungsi utama, dan **boleh** membawa permukaan admin untuk
seorang **USER** — penulis, peninjau, kontributor — bila situsnya menyatakannya
lewat `permukaanAdmin` di `src/config/site.ts`. Peran `owner` **ditolak gerbang**
di sana, dan template-nya sendiri menyatakan nol permukaan terautentikasi.

ADR itu tidak diambil diam-diam. §Hubungan-nya menuliskan ketegangannya dengan
repo ini secara terbuka, dan menutupnya dengan permintaan yang tidak bisa
dipenuhi dari sana — sebagaimana berbunyi sebelum sisi sana memperbaruinya pada
8 Agustus 2026:

> **Yang harus dilakukan di sisi sana, dan belum:** selisih ini pantas dicatat
> sebagai divergence keluarga di `awcms-family-compatibility.yaml` milik
> `awcms`, mengikuti pola `awcms` ADR-0068 — dengan pemilik dan `reviewDate`,
> sehingga ia kembali ke meja alih-alih ditemukan ulang sebagai temuan. Repo ini
> tidak bisa menulisnya sendiri; yang bisa dilakukan di sini adalah tidak
> berpura-pura selisih itu tidak ada.

ADR ini adalah jawabannya.

### Apa yang sebenarnya bertabrakan

ADR-0051 §Keputusan berbunyi:

> Kami memutuskan **seluruh layar admin AWCMS — tenant maupun
> owner/internal/platform — dibangun di repo `awcms`**, di bawah `/admin/*`,
> memakai satu shell admin, satu sesi, satu sidebar berbasis registry, dan satu
> postur CSP.

Sumbu kalimat itu adalah **audiens** — tenant versus owner/internal/platform.
Istilah "admin USER" tidak muncul di dalamnya sama sekali, dan itu bukan
kelalaian: pada 1 Agustus 2026 pertanyaannya memang belum ada. Yang ditolak
ADR-0051 adalah pembagian ADR-0048, yang menaruh layar **owner/internal** di
`awcms-astro` — persis peran yang hari ini **ditolak gerbang** di sana.

Paragraf berikutnya di ADR yang sama sudah lebih sempit daripada judul
keputusannya:

> Yang dicabut hanya perannya sebagai rumah layar admin **internal**.

Dua kalimat itu tidak sepenuhnya sama, dan selisih di antara keduanya persis
ruang tempat permukaan admin USER berdiri. Tetapi **selisih yang hanya bisa
dilihat dengan membandingkan dua paragraf bukan aturan** — ia bacaan. Kata
"seluruh" harus dipersempit secara tertulis, atau ia akan dipakai untuk menolak
pekerjaan yang sah, oleh pembaca yang benar-benar mengikuti aturan.

### Kenapa ini bukan pelonggaran keamanan

ADR-0051 sendiri yang menyediakan alasannya:

> Yang menahan aksi lintas-tenant adalah gerbang otorisasi, bukan alamat repo
> tempat tombolnya digambar.

Karena repo bukan pembatas audiens, memindahkan sebuah layar tidak memindahkan
izinnya — ke arah mana pun. Itu yang membuat penyempitan ini murah: yang
menentukan siapa boleh melakukan apa tetap RBAC/ABAC default-deny di sini, dan
sebuah tombol yang digambar `awcms-astro` untuk peran yang ditolak `awcms` tetap
tombol yang ditolak.

## Keputusan

**Kami memutuskan mengganti sumbu pembagian layar dari AUDIENS menjadi APA YANG
DIKELOLA**, dan menyatakan peran keluarga sebagai berikut.

| Repo                                                            | Peran                                                                                                                                                                                         |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`ahliweb/awcms`](https://github.com/ahliweb/awcms)             | **System of record** — modular monolith, seluruh permukaan otorisasi, seluruh API, dan **seluruh layar admin SISTEM** (modul, peran, tenant, jejak audit, apa pun yang efeknya lintas-tenant) |
| [`ahliweb/awcms-astro`](https://github.com/ahliweb/awcms-astro) | **Halaman publik sebagai fungsi utama**, dan **permukaan admin USER bila situsnya menyatakannya**; tetap experience layer + BFF, dan **tak pernah sumber kebenaran**                          |

`awcms-mini` dan `awcms-micro` tetap **ARSIP**, tanpa perubahan dari
[ADR-0055](0055-development-confined-to-awcms-and-awcms-astro.md) §1. Kedua repo
di atas adalah seluruh keluarga yang dikembangkan, dan pasangan keduanya adalah
pengganti multiguna dari ketiga template lama — bukan salah satunya sendirian.

### 1. Batasnya APA YANG DIKELOLA, bukan siapa yang memakainya

Ini kalimat yang menentukan, dan ia sengaja tidak menyebut jabatan:

- **Admin SISTEM** — layar yang mengubah sesuatu **di luar isi satu situs**:
  modul, peran dan izin, tenant, konfigurasi platform, jejak audit, dataset yang
  dilayani ke banyak tenant. Dibangun **di sini**, di bawah satu shell
  `/admin/*`, satu sesi, satu sidebar registry, satu postur CSP. Tidak berubah.
- **Admin USER** — layar yang dipakai seorang pengguna untuk mengerjakan
  **bagiannya sendiri di satu situs**: menulis sebuah artikel, mengajukannya
  untuk ditinjau, mengelola profilnya sendiri. **Boleh** hidup di
  `awcms-astro`, dan hanya bila situs itu menyatakannya.

Ukurannya bukan siapa yang memakai layarnya melainkan **apa yang diubahnya**.
Seorang `owner` yang menulis artikel sedang melakukan pekerjaan USER; seorang
penulis yang bisa menyunting daftar peran tidak sedang melakukan pekerjaan USER,
apa pun nama jabatannya.

### 2. `owner` tidak pernah masuk lewat sana, dan itu digerbangi di sana

`awcms-astro` menolak `owner` di `permukaanAdmin.peran` secara mekanis, bukan
sebagai saran. Repo ini tidak perlu menegakkannya kedua kali — tetapi repo ini
**mencatatnya sebagai syarat**: penyempitan di ADR ini berlaku selama gerbang
itu ada di sana. Bila ia dicabut, selisihnya berubah sifat dan entri
divergence-nya (§6) yang membawanya kembali ke meja.

### 3. Ketiga gerbang pengganti ADR-0051 TIDAK berubah

Dikutip utuh, karena ini bagian yang paling mungkin dikira ikut dilonggarkan:

> 1. **Aksi yang efeknya melintasi batas tenant wajib punya gerbang
>    platform-scoped di `awcms`**, bukan sekadar RBAC tenant. Permission yang
>    di-seed ke role `owner` setiap tenant **tidak boleh** cukup untuk
>    menjalankannya.
> 2. **Aksi lintas-tenant tidak boleh masuk katalog yang di-seed ke role
>    tenant.** Bila sebuah aksi mengubah data yang dilayani ke tenant lain,
>    permission-nya bukan permission tenant.
> 3. **Layar platform-scoped tetap tunduk pada gerbang itu**, dan
>    `requiredPermission` pada entri `navigation`-nya harus permission platform
>    tersebut — sehingga owner tenant biasa tidak melihat menunya dan, lebih
>    penting, tetap ditolak endpoint-nya kalau ia menebak URL-nya.

Ketiganya berlaku penuh. Temuan terbuka ADR-0051 untuk
`idn_admin_regions.dataset.configure`/`.restore` sudah **ditutup**:
[ADR-0052](0052-idn-region-dataset-lifecycle-is-an-operator-job.md) mencabut
permukaan HTTP keduanya (`sql/084`), lalu
[ADR-0053](0053-platform-scoped-permissions.md) mengembalikannya sebagai
permission ber-`scope: platform` (`sql/085`) dan menyatakan dirinya memenuhi
butir 1–3 di atas. ADR ini tidak mengubah apa pun dari itu.

### 4. Tidak ada kemampuan yang hanya ada di sana

Setiap kemampuan yang dijangkau seorang USER lewat `awcms-astro` **wajib juga
bisa dikelola dari `/admin/*` di sini**. Ini aturan cermin dari §2 dan menutup
pintu yang sama dari arah berlawanan: penolakan `owner` menjaga platform tidak
bisa dicapai DARI sana, dan aturan ini menjaga tidak ada yang LEPAS ke sana.

Urutan kerjanya mengikuti: **`awcms` dulu, selalu.** Sebuah fitur yang mendarat
di `awcms-astro` sebelum layar pengelolanya ada di sini adalah fitur yang tidak
bisa dimatikan siapa pun.

### 5. Yang TIDAK berubah, dinyatakan supaya tidak ditafsirkan ikut berubah

- **`awcms-astro` tak pernah sumber kebenaran.** ADR-0045 §2 berlaku penuh: BFF
  mengorkestrasi dan memproyeksikan; ia tidak pernah memutuskan. Penyempitan ini
  soal siapa yang boleh melihat sebuah layar, bukan soal siapa yang memutuskan
  apa yang boleh dilihatnya.
- **`awcms-astro` tidak menyentuh PostgreSQL `awcms` langsung.** Tidak ada basis
  data di sana, dan ADR ini tidak membuka satu pun jalur baru ke sana.
- **[ADR-0050](0050-bff-session-handoff-code.md) kini punya audiens yang
  dinyatakan.** Kode serah-terima sesi ditulis saat ADR-0048 memberi
  `awcms-astro` layar owner/internal; ADR-0051 mencabut peran itu dan
  menyisakannya dengan **motivasi berkurang** — §Konsekuensi ADR-0051 menyatakan
  pekerjaan BFF (ADR-0049/0050) "tetap terpakai untuk perannya di ADR-0045",
  tetapi tanpa menyebut layar mana. Sekarang layarnya punya nama, dan audiensnya
  dinyatakan eksplisit: **USER, tidak pernah `owner`.**
- **[ADR-0065](0065-awcms-astro-consumer-contract-is-frozen.md) tidak diperluas
  di sini, dan itu disengaja.** `CONSUMER_PATHS` punya dua bagian:
  `CONSUMED_PATHS` (dipanggil hari ini) dan `COMMITTED_PATHS` (dijanjikan lewat
  ADR, sengaja dibekukan sebelum ada pemanggil — syaratnya "no ADR, no entry").
  Jadi mekanisme untuk menjanjikan sebuah permukaan lebih dulu memang ada; yang
  belum ada adalah **bentuk yang bisa dijanjikan**. Permukaan admin USER belum
  punya satu pun endpoint yang diputuskan, sehingga ia belum masuk keduanya. Ia
  menyusul lewat jalur ADR-0065 sendiri saat bentuknya diputuskan.
- **[ADR-0052](0052-idn-region-dataset-lifecycle-is-an-operator-job.md)
  §"`awcms-astro` belum punya layar admin sama sekali"** adalah fakta bertanggal
  1 Agustus 2026 dan **tidak disunting**. Ia benar pada hari itu, dan hari ini
  pun template `awcms-astro` masih menyatakan nol permukaan admin — yang mendarat
  di sana adalah izinnya, bukan layarnya.

### 6. Selisihnya dicatat sebagai divergence keluarga, dengan tanggal tinjau

Mengikuti pola [ADR-0068](0068-family-standards-posture-editions-and-recorded-divergences.md)
dan [ADR-0069](0069-cross-origin-isolation-divergence-with-awcms-astro.md):
entri `admin-user-surface-in-awcms-astro` di
[`awcms-family-compatibility.yaml`](../../awcms-family-compatibility.yaml),
dengan `owner: "@ahliweb"` dan `reviewDate: "2027-02-04"` — sekohort dengan
empat entri lain sehingga seluruh postur keluarga ditinjau dalam satu duduk.

Kenapa selisih ini perlu tanggal tinjau sementara keputusan di atas sudah tegas:
yang ditinjau bukan "apakah admin USER boleh di sana" melainkan **apakah
batasnya masih di tempat yang sama**. Permukaan yang tumbuh satu layar per
kuartal adalah cara paling wajar sebuah "admin USER" berubah menjadi admin
sistem tanpa ada yang memutuskannya.

## Konsekuensi

- **Positif:**
  - Kata "seluruh" di ADR-0051 berhenti dipakai untuk menolak pekerjaan yang
    sah. Seorang agen yang membaca `AGENTS.md` mendapat aturan yang cocok dengan
    keputusan yang benar-benar berlaku di kedua repo.
  - Selisih antar-repo berhenti menjadi keputusan yatim. Ia punya berkas,
    pemilik, dan tanggal yang mengembalikannya ke meja — bentuk kegagalan yang
    ADR-0068 lahir untuk mencegahnya.
  - ADR-0050 berhenti menggantung. Pekerjaan serah-terima sesi punya audiens
    yang dinyatakan namanya, bukan sekadar "tetap terpakai" tanpa layar yang
    menunjuknya.
  - Sumbu "apa yang dikelola" bisa diterapkan pada layar yang belum ada.
    Sumbu "audiens" tidak bisa: ia menuntut daftar jabatan, dan daftar jabatan
    menua setiap kali sebuah peran ditambahkan.
- **Negatif / trade-off yang diterima:**
  - **Satu kemampuan kini bisa punya dua layar** — satu untuk USER di
    `awcms-astro`, satu untuk pengelolanya di sini. Itu biaya nyata, dan §4
    yang membuatnya disengaja alih-alih tak terlihat.
  - **Batas "SISTEM versus USER" adalah penilaian, bukan gerbang.** Tidak ada
    tes yang bisa memutuskan sebuah layar termasuk yang mana; yang bisa
    digerbangi hanya izinnya. Karena itu §6 memberinya tanggal tinjau alih-alih
    berpura-pura ia terjaga mesin.
  - Sebagian motivasi ADR-0051 ("satu shell, satu sesi, satu postur CSP")
    berlaku untuk permukaan SISTEM saja. Sebuah situs yang menyalakan
    `permukaanAdmin` memikul sesi dan CSRF-nya sendiri di sana — biaya yang
    `awcms-astro` ADR-0034 nyatakan eksplisit supaya dipilih, bukan diwarisi.
- **Netral:**
  - **Nol perubahan kode berjalan di repo ini.** Ini keputusan tata kelola;
    seluruh gerbang teknis tetap utuh, dan tidak ada satu pun izin yang
    berpindah.
  - Permukaan publik `awcms` sendiri (`/blog/{tenantCode}/**`, keluarga
    host-resolved `/news/**`, `robots`/`sitemap`/`feed`, `/search`) tidak
    tersentuh — ADR-0059/ADR-0061 tetap berlaku apa adanya.
    Sebuah situs boleh disajikan dari sini, dari `awcms-astro`, atau dari
    keduanya; yang diputuskan ADR ini adalah di mana LAYAR dibangun.

## Alternatif yang dipertimbangkan

- **Men-supersede ADR-0051** — ditolak. Keputusan intinya berlaku utuh, dan
  men-supersede-nya akan mencabut ketiga gerbang pengganti di §Keputusan-nya
  bersama keputusan itu. Gerbang-gerbang itu justru bagian yang paling ingin
  dipertahankan; mencabutnya untuk melebarkan satu pengecualian adalah harga
  yang tidak sebanding dengan apa pun.
- **Membiarkan selisih ini hidup sebagai bacaan** atas §Keputusan ADR-0051 —
  kalimat pembukanya versus paragraf "Yang dicabut hanya perannya sebagai rumah
  layar admin internal" — ditolak. Aturan yang hanya bisa dilihat dengan membandingkan dua paragraf akan
  dibaca sebagai konflik oleh orang berikutnya, dan orang berikutnya akan
  memilih paragraf yang lebih tegas. Yang paling mungkin terjadi bukan
  pelanggaran, melainkan **penolakan pekerjaan yang sah** oleh pembaca yang
  benar-benar patuh.
- **Mencatat divergence tanpa ADR** — tidak mungkin secara mekanis, dan itu
  disengaja: `scripts/family-conformance-check.ts` menuntut berkas ADR yang
  dirujuk sebuah entri benar-benar ada, sehingga sebuah selisih tidak bisa
  dicatat tanpa alasan yang tertulis lengkap.
- **Memindahkan permukaan admin USER ke sini juga** (mis. `/admin/tulis`) —
  ditolak. Ia menuntut setiap penulis di setiap situs turunan punya sesi di
  `awcms` dan menavigasi shell admin platform untuk menulis satu artikel,
  sementara yang dikerjakannya seluruhnya milik situsnya sendiri. Itu
  memindahkan orang, bukan risiko — dan risikonya sudah ditahan gerbang
  otorisasi, bukan oleh alamat repo.
- **Membolehkan permukaan admin USER tanpa deklarasi di sisi sana**, mengandalkan
  review — ditolak di sana, dan repo ini setuju: bentuk kegagalannya adalah
  build hijau dengan permukaan terautentikasi yang tidak pernah diputuskan
  siapa pun.
- **Menyatakan ulang bahwa `awcms-mini`/`awcms-micro` dihentikan lewat ADR
  ketiga** — ditolak. [ADR-0047](0047-mini-micro-frozen-foundation-built-here.md)
  membekukannya dan [ADR-0055](0055-development-confined-to-awcms-and-awcms-astro.md)
  §1 menutup jalur port keluar; keduanya final dan tidak dibantah siapa pun.
  Yang tertinggal bukan keputusannya melainkan **penerapannya** di berkas-berkas
  yang belum menyusul — dan itu pekerjaan menyunting, bukan pekerjaan
  memutuskan. ADR ketiga yang mengulang keputusan yang sama justru membuat
  pembaca berikutnya mengira ada tiga aturan berbeda.
