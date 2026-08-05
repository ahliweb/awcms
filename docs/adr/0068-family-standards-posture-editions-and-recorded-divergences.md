# ADR-0068 — Postur standar keluarga: edisi di-pin di sini, dan tiga selisih dicatat

- **Status:** Accepted
- **Tanggal:** 2026-08-04
- **Pengambil keputusan:** @ahliweb
- **Terkait:** [ADR-0032](0032-family-compatibility-manifest-and-ci-conformance.md) (manifest kompatibilitas keluarga + mekanisme divergence), [ADR-0055](0055-development-confined-to-awcms-and-awcms-astro.md) (pengembangan hanya di dua repo), [ADR-0062](0062-skills-are-gated-against-the-code-they-describe.md) (aturan tanpa pemeriksa akan dilanggar), `awcms-astro` ADR-0028 (repo itu menyatakan mengikuti edisi OWASP repo ini), `awcms-astro` ADR-0029 (HSTS tanpa `includeSubDomains` di sana)

## Konteks

### 1. Repo sebelah menunggu keputusan yang tidak pernah diambil di sini

`awcms-astro` ADR-0028 §A menyatakan, tertulis, bahwa ia **menyamakan edisi
OWASP dengan repo ini dan tidak akan mendahuluinya**. Alasannya benar: dua repo
keluarga yang memetakan diri ke dua edisi berbeda menghasilkan dua matriks yang
tidak bisa dijumlahkan, dan pembacanya akan membaca selisih penomoran sebagai
celah kontrol.

Masalahnya, keputusan yang ia ikuti **tidak pernah ada**. Pin OWASP Top 10
**2021** dan ASVS **4.0.3** di repo ini berasal dari skill
`awcms-security-hardening` — ditulis saat itu edisi terbaru, lalu diikuti karena
sudah tertulis. Tidak ada ADR, tidak ada tanggal tinjau, tidak ada pemilik.

Jadi salah satu repo menunggu sinyal dari repo lain yang tidak tahu bahwa ia
memegang sinyal itu. Itu bukan selisih teknis; itu keputusan yatim.

### 2. Dua selisih nyata dengan `awcms-astro`, dan daftar divergence-nya kosong

[`awcms-family-compatibility.yaml`](../../awcms-family-compatibility.yaml) punya
mekanisme divergence lengkap sejak ADR-0032 — `id`, `summary`, `reason`,
`owner`, `reviewDate`, `adr` — dengan gerbang yang **gagal saat `reviewDate`
lewat atau ADR-nya hilang. Daftarnya **kosong**, dan berkas itu sendiri menulis
bahwa "kontrak yang harus di-diverge-i repo ini — milik `awcms-astro`, misalnya
— akan mengisinya".

Sementara itu ada dua selisih yang nyata, disengaja, dan tidak tercatat di sisi
sini:

- **HSTS.** Repo ini mengirim `max-age=31536000; includeSubDomains`; `awcms-astro`
  mengirim `max-age=31536000` saja (ADR-0029 di sana). **Keduanya benar**: repo
  ini SATU deployment yang operatornya tahu subdomainnya, repo itu TEMPLATE yang
  berjalan di domain organisasi yang hampir pasti punya layanan lain di subdomain
  lain — dan `includeSubDomains` memaksa seluruhnya HTTPS-saja selama setahun di
  browser setiap pengunjung, akibat yang ditanggung layanan yang pemiliknya tidak
  ikut memutuskan.
- **Pemeriksaan tipe `.astro`.** `awcms-astro` menjalankan `astro check` di rantai
  `check`-nya. Repo ini **tidak bisa**, dan alasannya eksternal — lihat §3.

### 3. `astro check` tidak bisa dijalankan di sini, dan itu bukan kelalaian

Asesmen 4 Agustus 2026 §9.4 mencatat celah nyata: **42 berkas `.astro` (22.328
baris)** — seluruh 31 layar admin, halaman login, halaman publik — tidak pernah
diperiksa tipe. `tsc` tidak bisa mengurai `.astro` dan melewatinya diam-diam
meskipun `tsconfig.json` menulis `"include": ["src/**/*"]`, dan `astro build`
tidak memeriksa tipe.

Perbaikan yang jelas adalah menambahkan `astro check`. Dicoba, dan ia **menolak
berjalan**:

```
The TypeScript module loaded (found 7.0.2) does not expose the programmatic API
that `astro check` relies on. TypeScript's native compiler (7.0 and later) does
not ship this API yet.
```

Repo ini memakai TypeScript **7.0.2**; `@astrojs/check` menuntut API programatik
yang hanya ada di TypeScript **6.x**. `awcms-astro` memakai TypeScript `^6.0.3`,
dan itulah satu-satunya alasan ia bisa menjalankan gerbang yang repo ini tidak
bisa. Selisihnya **bukan disiplin**, melainkan versi toolchain.

Menurunkan TypeScript ke 6.x untuk memuaskan gerbang ini ditolak: ia meregresi
toolchain seluruh repo — 33 gerbang, ~156.000 baris, dan `tsc --noEmit` yang
hari ini bersih — demi satu pemeriksa yang bahkan belum tentu bersih saat
pertama dijalankan.

## Keputusan

### §A — Pin edisi standar adalah keputusan repo ini, dan sekarang tertulis

| Standar                   | Edisi           | Ditinjau ulang |
| ------------------------- | --------------- | -------------- |
| OWASP Top 10              | 2021            | 2027-02-04     |
| OWASP ASVS                | 4.0.3 (L1/L2)   | 2027-02-04     |
| OWASP API Security Top 10 | 2023            | 2027-02-04     |
| ISO/IEC 27001             | 2022, Annex A   | 2027-02-04     |
| NIST SSDF                 | SP 800-218 v1.1 | 2027-02-04     |

**Menaikkan edisi adalah keputusan tingkat keluarga dan butuh ADR-nya sendiri**,
karena ia memetakan ulang seluruh matriks di
[`standar-performa-dan-keamanan.md`](../awcms/standar-performa-dan-keamanan.md)
§3–§7 **dan** mewajibkan `awcms-astro` diberi tahu dalam napas yang sama.
Sampai ADR itu ditulis, pin di atas berlaku — dan yang berubah hari ini adalah
bahwa ia **terbaca sebagai pin**, bukan sebagai kemutakhiran.

Yang **tidak** diputuskan di sini: apakah edisi yang lebih baru layak diambil.
Itu pekerjaan pemetaan, bukan pekerjaan penamaan, dan mencampurnya ke ADR ini
akan membuat keputusan "kami memakai edisi X" dan keputusan "kami sudah
memetakan ulang ke edisi X" hidup di satu berkas padahal yang kedua jauh lebih
mahal.

### §B — Tiga divergence dicatat di manifest, dengan tanggal tinjau yang menggigit

`awcms-family-compatibility.yaml` mendapat entri untuk masing-masing. Gerbang
`bun run family:conformance:check` **sudah** menolak entri yang `reviewDate`-nya
lewat atau yang ADR-nya tidak ada, jadi ketiganya otomatis kembali ke meja pada
tanggalnya — tanpa seorang pun harus mengingat.

Yang membuat pencatatan ini bernilai bukan kerapian: sebuah selisih yang tidak
tercatat akan **ditemukan ulang sebagai temuan** enam bulan kemudian, dan
"diperbaiki" ke arah yang salah. `includeSubDomains` khususnya: menyalinnya ke
`awcms-astro` demi "paritas keluarga" adalah perubahan satu kata yang
memindahkan keputusan bergantung-konteks ke tempat yang tidak punya konteksnya.

### §C — `.astro` tetap tak-terperiksa, dan itu dinyatakan sebagai utang bertanggal

Bukan "akan dikerjakan nanti", melainkan divergence ber-`reviewDate` yang
memerahkan CI saat jatuh tempo. Yang ditunggu bersifat eksternal — dukungan
TypeScript 7 di `@astrojs/check` — jadi tanggalnya adalah kapan kita
**memeriksa ulang**, bukan kapan kita berjanji selesai.

Sampai itu terjadi, mitigasinya bukan berharap: skill `awcms-testing` dan
`awcms-pr-review` sudah memuat instruksi bahwa diff yang menyentuh `.astro`
harus dibaca tipenya dengan mata, beserta kelas cacat yang paling mungkin lolos
(`withTenant` di tempat `withTenantOrThrow`).

## Konsekuensi

**Yang didapat.** Repo sebelah berhenti menunggu keputusan yang tidak ada. Tiga
selisih punya nama, alasan, pemilik, dan tanggal — dan gerbang yang sudah ada
menegakkan ketiganya tanpa satu baris mekanisme baru.

**Yang dibayar.** Tiga `reviewDate` yang akan memerahkan CI pada harinya, dan
seseorang harus benar-benar menjawabnya. Itu biaya yang disengaja: alternatifnya
adalah catatan yang membusuk diam-diam, dan repo ini sudah punya cukup banyak
bukti tentang bagaimana itu berakhir.

**Yang TIDAK dilakukan.** Nol perubahan pada header, nol perubahan toolchain,
nol pemetaan ulang matriks. ADR ini menamai keadaan; ia tidak mengubahnya.

## Alternatif yang dipertimbangkan

- **Menurunkan TypeScript ke 6.x agar `astro check` jalan.** Ditolak — lihat §3.
  Meregresi toolchain seluruh repo demi satu pemeriksa adalah menukar cacat yang
  diketahui dengan risiko yang tidak diketahui.
- **Menaikkan edisi OWASP sekalian di ADR ini.** Ditolak: pemetaan ulang §3–§7
  adalah pekerjaan nyata dengan hasil yang harus diperiksa baris per baris, dan
  menggabungkannya membuat ADR ini tidak bisa dibedakan dari pekerjaan yang
  mengklaim lebih dari yang dilakukannya.
- **Menyalin `includeSubDomains` ke `awcms-astro` demi paritas.** Ditolak, dan
  ADR-0029 di repo itu sudah menuliskan alasannya lebih baik daripada yang bisa
  ditulis dari sini.
- **Membiarkan pin edisi hidup di skill saja.** Ditolak: skill DIIKUTI, bukan
  dinegosiasikan. Sebuah keputusan tingkat keluarga yang hanya hidup di dalam
  halaman panduan akan dibongkar oleh orang berikutnya yang menyunting halaman
  itu, tanpa menyadari repo lain terikat padanya.
