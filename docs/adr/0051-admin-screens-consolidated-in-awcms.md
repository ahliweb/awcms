# ADR-0051 — Seluruh layar admin (tenant maupun owner/internal) dibangun di `awcms`

- **Status:** Accepted
- **Tanggal:** 2026-08-01
- **Pengambil keputusan:** @ahliweb
- **Men-supersede:** [ADR-0048](0048-frontend-role-split-awcms-astro-internal-admin.md) (pembagian peran frontend `awcms-astro` = admin owner/internal)
- **Terkait:** [ADR-0045](0045-jualanku-porting-awcms-system-of-record-astro-bff.md) (`awcms` system of record, `awcms-astro` experience layer + BFF), [ADR-0046](0046-idn-admin-regions-module-admission.md) (modul `idn_admin_regions`), [ADR-0047](0047-mini-micro-frozen-foundation-built-here.md) (pembekuan mini/micro), [ADR-0049](0049-machine-credentials-and-session-introspection.md) & [ADR-0050](0050-bff-session-handoff-code.md) (kontrak yang dulu memblokir layar internal)

## Konteks

ADR-0048 memisahkan frontend menurut audiens: layar **owner/internal** (master data global, rilis/rollback data, kesehatan lintas tenant) dibangun di `awcms-astro`; layar **tenant atas datanya sendiri** tetap di `awcms`. Tiga bulan berjalan, aturan itu menghasilkan tiga fakta yang tidak diantisipasi ADR tersebut.

**Pertama, aturannya tidak pernah diikuti oleh kode yang sudah ada.** ADR-0048 §"Yang TIDAK diputuskan" mengakuinya sendiri: `/admin/*` hari ini bercampur tenant dan platform (`/admin/modules`, `/admin/security`, `/admin/sidebar-menu` semuanya platform-ish), dan pemilahannya ditunda ke "pekerjaan tersendiri dengan ADR-nya sendiri" yang tidak pernah dimulai. Jadi aturan itu hanya mengikat layar **baru** — menciptakan dua kelas layar yang dibedakan bukan oleh sifatnya, melainkan oleh tanggal lahirnya.

**Kedua, biaya langsungnya adalah modul tanpa layar sama sekali.** Audit permukaan admin (2026-08-01) menemukan **13 dari 21 modul tidak punya satu pun layar** — 125 berkas route admin yang hanya bisa dipakai lewat `curl`. `idn_admin_regions` adalah kasus yang ADR-0048 pakai sebagai contoh utama, dan hasilnya modul itu mendarat tanpa `navigation` dan tanpa tanggal: layarnya menunggu repo lain yang belum punya satu pun layar admin.

**Ketiga — dan ini yang mengubah substansi — memindahkan layar tidak pernah menjadi kontrol keamanan yang diklaimkan.** ADR-0048 memindahkan _layar_ aktivasi dataset ke repo lain karena aksinya "mengganti data yang dilayani untuk semua tenant sekaligus". Tetapi _permission_-nya tetap tinggal:

```sql
-- sql/081_awcms_idn_admin_regions_permissions.sql
('idn_admin_regions', 'dataset', 'configure', 'Activate a validated … dataset version'),
('idn_admin_regions', 'dataset', 'restore',   'Roll back to the previously active … dataset version'),
```

Keduanya masuk katalog ABAC **global**, dan `POST /api/v1/setup/initialize` memberikan seluruh katalog ke role `owner` setiap tenant baru (owner = 197/197 permission). Artinya **owner sebuah tenant biasa hari ini memegang izin untuk mengganti dataset yang dilayani ke seluruh tenant** — persis risiko yang ADR-0048 ingin cegah — dan endpoint-nya (`POST /api/v1/idn-regions/datasets/{id}/activate`) menerimanya dari mana pun ia dipanggil, karena ABAC mengevaluasi permission, bukan asal-usul frontend.

ADR-0048 §"Yang membuat pembagian ini aman" sebenarnya sudah menyatakan ini tanpa menarik kesimpulannya: _"Memindahkan layar ke repo lain **tidak** memindahkan izinnya."_ Betul — dan karena itu memindahkan layar juga tidak memindahkan risikonya. Yang menahan aksi lintas-tenant adalah gerbang otorisasi, bukan alamat repo tempat tombolnya digambar.

Terakhir, alasan penundaan teknis ADR-0048 sudah gugur: dua kontrak yang ia sebut "masih buntu" — header tenant dan kredensial yang bisa dipegang build — telah diputuskan di [ADR-0049](0049-machine-credentials-and-session-introspection.md) dan [ADR-0050](0050-bff-session-handoff-code.md). Jadi keputusan ini diambil karena pilihan desain, bukan karena jalur ADR-0048 tersumbat.

## Keputusan

Kami memutuskan **seluruh layar admin AWCMS — tenant maupun owner/internal/platform — dibangun di repo `awcms`**, di bawah `/admin/*`, memakai satu shell admin, satu sesi, satu sidebar berbasis registry, dan satu postur CSP.

ADR-0048 **di-supersede**. Peran `awcms-astro` yang ditetapkan [ADR-0045](0045-jualanku-porting-awcms-system-of-record-astro-bff.md) **tidak berubah**: ia tetap experience layer + satu-satunya BFF untuk permukaan publik/Jualanku, dan tetap tidak menyentuh PostgreSQL `awcms` langsung. Yang dicabut hanya perannya sebagai rumah layar admin internal.

### Gerbang pengganti yang wajib ada (ini bagian yang tidak boleh dilewat)

Karena repo tidak lagi menjadi pembatas audiens, pembatasnya harus dinyatakan di tempat yang memang menegakkannya:

1. **Aksi yang efeknya melintasi batas tenant wajib punya gerbang platform-scoped di `awcms`**, bukan sekadar RBAC tenant. Permission yang di-seed ke role `owner` setiap tenant **tidak boleh** cukup untuk menjalankannya.
2. **Aksi lintas-tenant tidak boleh masuk katalog yang di-seed ke role tenant.** Bila sebuah aksi mengubah data yang dilayani ke tenant lain, permission-nya bukan permission tenant.
3. **Layar platform-scoped tetap tunduk pada gerbang itu**, dan `requiredPermission` pada entri `navigation`-nya harus permission platform tersebut — sehingga owner tenant biasa tidak melihat menunya dan, lebih penting, tetap ditolak endpoint-nya kalau ia menebak URL-nya.

Butir 1–3 berlaku untuk `idn_admin_regions.dataset.configure`/`.restore` **hari ini** dan merupakan prasyarat sebelum layar dataset-nya dibangun. Ini dicatat sebagai temuan terbuka, bukan sebagai bagian yang sudah selesai oleh ADR ini.

## Konsekuensi

- **Positif:**
  - Satu shell admin: satu login, satu sidebar, satu design system, satu postur CSP. Operator platform tidak perlu berpindah aplikasi (dan berpindah sesi) untuk mengelola satu sistem.
  - Layar sebuah modul hidup di repo yang sama dengan `module.ts`, permission, dan migrasinya — sehingga `tests/admin-navigation-registry.test.ts` benar-benar bisa menegakkan "setiap modul punya layar". Lintas repo, tidak ada yang menegakkannya.
  - Menghapus kelas layar "menunggu repo lain": 13 modul tanpa layar punya jalur yang jelas untuk dikerjakan.
  - Risiko lintas-tenant dipindahkan dari asumsi topologi ke gerbang otorisasi yang bisa diuji.
- **Negatif / trade-off:**
  - Permukaan `/admin/*` `awcms` kini melayani dua audiens. Tanpa gerbang di §Keputusan, itu **menurunkan** keamanan dibanding ADR-0048 — karena itu gerbangnya normatif, bukan saran.
  - `awcms-astro` kehilangan peran yang ADR-0048 berikan; pekerjaan BFF (ADR-0049/0050) tetap terpakai untuk perannya di ADR-0045, tetapi sebagian motivasinya berkurang.
  - Layar internal yang berat berbagi profil performa dengan admin tenant. Dapat diterima: keduanya terautentikasi, tidak pernah di belakang cache tepi, dan penggunanya sedikit.
- **Netral:**
  - Permukaan publik `awcms` (`/blog/*`, `robots`/`sitemap`/`feed`, `/search`) tidak tersentuh; ia tetap satu-satunya bagian yang boleh berada di belakang cache tepi (ADR-0042).
  - Aturan lama ADR-0048 tetap relevan sebagai catatan sejarah untuk memahami kenapa `idn_admin_regions` mendarat tanpa `navigation`.

## Alternatif yang dipertimbangkan

- **Pertahankan ADR-0048 apa adanya** — ditolak. Ia mengikat hanya layar baru, membiarkan `/admin/*` lama bercampur, dan (terbukti di atas) tidak menahan risiko lintas-tenant yang menjadi alasan utamanya. Mempertahankannya berarti menerima 13 modul tanpa layar untuk jaminan yang tidak diberikannya.
- **Pertahankan ADR-0048 dan segera bangun layar internal pertama di `awcms-astro`** — ditolak untuk saat ini. Secara teknis sudah mungkin (ADR-0049/0050 menutup blokirnya), tetapi biayanya adalah shell admin kedua lengkap dengan sesi, navigasi, design system, dan gate CI-nya sendiri, sebelum satu pun dari 13 modul tanpa layar terlayani.
- **Pisahkan berdasarkan permission saja, tanpa mengubah ADR-0048** — ditolak sebagai _keputusan_, tetapi **diadopsi sebagai mekanisme**: gerbang platform-scoped di §Keputusan persis itu. Yang ditolak adalah menyimpannya sambil tetap memaksa layarnya tinggal di repo lain — dua pembatas untuk satu risiko, satu di antaranya tidak menegakkan apa pun.
