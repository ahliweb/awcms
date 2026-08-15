🇮🇩 Bahasa Indonesia · 🇬🇧 [English (source)](0048-frontend-role-split-awcms-astro-internal-admin.md)

<!-- i18n-source-hash: sha256:a14f82ff230113968aedfacff7f88d15ce056ae729d3e1a0bb9109e9a4dc08ed -->

# ADR-0048 — Pembagian peran frontend: `awcms-astro` = admin OWNER/INTERNAL, `awcms` = frontend PUBLIK + admin PUBLIK

- **Status:** Superseded by [ADR-0051](0051-admin-screens-consolidated-in-awcms.md)
- **Tanggal:** 2026-07-31
- **Pengambil keputusan:** @ahliweb
- **Melengkapi:** [ADR-0047](0047-mini-micro-frozen-foundation-built-here.md) (pembekuan `awcms-mini`/`awcms-micro`; dua repo yang dikembangkan adalah repo ini dan `awcms-astro`)
- **Mengoreksi premis:** ADR-0047 §Alternatif menolak "bangun kredensial mesin di `awcms-astro`" dengan alasan repo itu "situs publik statis tanpa basis data dan tanpa identity store". Alasannya tetap benar untuk **kredensial**, tetapi deskripsi perannya tidak lagi lengkap: ADR ini memberi `awcms-astro` peran kedua yang eksplisit.
- **Terkait:** [ADR-0045](0045-jualanku-porting-awcms-system-of-record-astro-bff.md) (`awcms` system of record, `awcms-astro` experience layer + satu-satunya BFF), [ADR-0042](0042-varnish-edge-cache-auto-activation.md) (cache tepi), ADR-0034/0035 (tata kelola & positioning keluarga).

## Konteks

ADR-0047 memusatkan pengembangan pada dua repo, tetapi tidak menyatakan **layar mana milik siapa**. Kekosongan itu langsung terasa: repo ini sudah memuat rute publik (`/blog/{tenantCode}/*`, `robots`/`sitemap`/`feed`, `/search`) **dan** `/admin/*`, sementara `awcms-astro` berdiri sebagai experience layer + BFF (ADR-0045) tanpa batas tertulis soal admin.

Tanpa garis itu, layar admin berikutnya mendarat di repo yang kebetulan paling dekat dengan tangan penulisnya — dan pilihan itu sulit dibalik setelah ada penggunanya.

Contoh konkret yang memaksa keputusan ini diambil sekarang, bukan nanti: modul `idn_admin_regions` ([ADR-0046](0046-idn-admin-regions-module-admission.md)) mengapalkan aksi **aktivasi/rollback versi dataset wilayah** — mengganti data yang dilayani untuk **semua tenant sekaligus**. Itu bukan layar tenant; itu layar operator platform. Modulnya sengaja mendarat **tanpa** `navigation` karena pertanyaan ini belum punya jawaban tertulis.

## Keputusan

| Repo          | Peran frontend                              | Audiens                                  |
| ------------- | ------------------------------------------- | ---------------------------------------- |
| `awcms-astro` | **Halaman admin OWNER / INTERNAL**          | operator platform, staf internal         |
| `awcms`       | **Frontend PUBLIK + frontend ADMIN PUBLIK** | pengunjung situs, dan admin milik tenant |

Operasionalnya:

- Layar yang mengurus **platform** — master data global, operasi rilis/rollback data, kesehatan lintas tenant, alat internal — dibangun di **`awcms-astro`**.
- Layar yang dipakai **tenant atas datanya sendiri** (konten, komentar, media, domain, pengguna tenant) tetap di **`awcms`**, berdampingan dengan rute publiknya.
- `awcms` tetap **system of record**. `awcms-astro` tidak punya basis data sendiri dan tidak pernah menyentuh PostgreSQL `awcms` langsung — ia memanggil `/api/v1/*` lewat BFF-nya (ADR-0045).

### Yang membuat pembagian ini aman, bukan sekadar rapi

1. **Permukaan otorisasi tetap SATU.** Memindahkan layar ke repo lain **tidak** memindahkan izinnya: setiap panggilan tetap melewati sesi + konteks tenant + RBAC/ABAC default-deny milik `awcms`. Frontend internal tidak boleh menjadi jalur kedua yang lebih longgar — kalau sebuah aksi butuh permission, ia butuh permission dari mana pun ia dipanggil.
2. **Kredensial tidak berpindah ke browser.** Konsekuensi langsung ADR-0045: browser internal berbicara ke BFF `awcms-astro`, BFF yang memegang sesi/token ke `awcms`. Ini juga alasan penolakan ADR-0047 tetap berlaku — `awcms-astro` bukan penerbit identitas, ia pemakai.
3. **Cache tidak dibagi lintas audiens.** Situs publik `awcms` boleh berada di belakang cache tepi (ADR-0042, default mati). Permukaan admin — tenant maupun internal — **tidak pernah** ikut di dalamnya: cache bersama di depan permukaan multi-tenant adalah mesin kebocoran lintas-tenant.
4. **Performa dibayar di tempat yang benar.** Layar internal boleh berat dan interaktif karena penggunanya sedikit dan terautentikasi; permukaan publik dioptimalkan untuk pengunjung anonim. Menyatukan keduanya memaksa satu profil performa melayani dua kebutuhan yang berlawanan.

### Yang TIDAK diputuskan di sini

- **Pemilahan `/admin/*` yang sudah ada.** Layar admin hari ini bercampur tenant dan platform (mis. `/admin/modules`, `/admin/security`). Memindahkannya adalah pekerjaan tersendiri dengan ADR-nya sendiri. Aturan ini mengikat layar **baru**, dan menjadi acuan saat layar lama disentuh.
- **Bentuk autentikasi internal di `awcms-astro`.** ADR-0047 mencatat dua kontrak yang masih buntu (header tenant dan kredensial yang bisa dipegang build); keduanya harus selesai sebelum layar internal pertama bisa memanggil `awcms`. ADR ini menetapkan **di mana** layar itu tinggal, bukan bagaimana ia login.

## Konsekuensi

**Positif**

- "Layar ini seharusnya di mana?" punya jawaban tertulis sebelum kode ditulis, termasuk untuk layar dataset wilayah yang sedang menunggu.
- `awcms` tetap satu-satunya sumber kebenaran data dan izin, apa pun frontend-nya.
- Permukaan publik dan permukaan internal bisa dioptimalkan (dan di-cache) menurut kebutuhannya masing-masing tanpa berkompromi.

**Negatif / biaya yang diterima**

- Dua repo aktif berarti satu kontrak API lintas-repo yang harus dijaga tetap sinkron. Itu beban nyata — dan alasan `awcms-astro` wajib memanggil `/api/v1` alih-alih menumbuhkan jalur datanya sendiri.
- Sebagian layar internal akan terasa "jauh" dari kodenya (aksinya di `awcms`, tampilannya di `awcms-astro`). Biaya itu diterima karena alternatifnya — admin platform yang hidup di dalam aplikasi tenant — jauh lebih mahal untuk dipisahkan belakangan.
- `awcms-astro` yang tadinya murni statis kini memikul permukaan terautentikasi. Setiap penambahan di sana harus dinilai sebagai permukaan keamanan, bukan sekadar halaman.
