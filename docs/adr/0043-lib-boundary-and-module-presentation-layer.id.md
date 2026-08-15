🇮🇩 Bahasa Indonesia · 🇬🇧 [English (source)](0043-lib-boundary-and-module-presentation-layer.md)

<!-- i18n-source-hash: sha256:cc49317b2957a918d0351db14e9f94a2b129c29d82fd20d8d6f4bfef6e64d824 -->

# ADR-0043 — Batas `src/lib` dan lapisan presentasi modul

- Status: Accepted
- Tanggal: 2026-07-26
- Issue: #257
- Terkait: ADR-0025 (komposisi modul saat build), ADR-0034 (template keluarga
  dipakai-langsung); awcms-micro ADR-0038 memutuskan pertanyaan yang sama di sana.

## Konteks

`src/lib` telah menjadi sistem modul kedua yang tidak dijaga gerbang mana pun.

Empat namespace — `src/lib/{seo,theming,comments,search}` — membawa nama modul
yang sudah ada dan menampung kode yang dimiliki modul tersebut.
Lapisan application `seo_distribution` bahkan merujuk KE ATAS ke `src/lib/seo/`
lewat jalur yang tidak bisa dilihat `modules:dag:check`, karena validator itu
membaca graf yang DIDEKLARASIKAN dan tidak pernah sebuah pernyataan import.

`tests/module-boundary.test.ts` memang membaca import, tetapi hanya di bawah
`src/modules/*`. Jadi dua lapisan yang sebenarnya menampung pengabelan
lintas-modul — `src/lib` dan `src/pages` (38 ribu baris, lebih besar daripada
tiga modul terbesar digabung) — dua-duanya tanpa gerbang.

Penyebabnya struktural, bukan kecerobohan. Kontrak modul tidak punya tempat
untuk menaruh kode presentasi/pengiriman, sehingga `src/lib/<nama-modul>/`
adalah satu-satunya rumah yang tersedia.

## Keputusan

1. **`src/lib` adalah infrastruktur teknis yang tidak membawa nama domain.**
   `database`, `auth`, `security`, `redis`, `edge-cache`, `jobs`,
   `observability`, `semver`, `html`, `tenant`, `ui`, `integration`, `logging`.

2. **Kode presentasi/pengiriman modul tinggal di
   `src/modules/<module>/presentation/`** — akar komposisi rute, lem middleware,
   skrip klien browser.

3. **Lapisan ini tidak dienumerasi di dalam kode.** Tidak ada field baru di
   `module-contract.ts`; tiga lapisan lainnya (`domain`, `application`,
   `infrastructure`) juga tidak dienumerasi. Yang ditegakkan mesin adalah
   GERBANGNYA, bukan penamaannya.

4. **`modules:dag:check` GAGAL pada namespace `src/lib/<x>/` yang bertabrakan
   dengan sebuah `moduleKey`** — persis, atau lewat alias domain terdaftar
   (`seo` → `seo_distribution`, `search` → `site_search`, dan empat lainnya).
   Tanpa alias, dua dari empat kasus nyata akan lolos.

5. **Satu pengecualian tercatat: `src/lib/logging/`.** Primitif logger bebas
   basis data, diimpor oleh ~139 berkas termasuk `src/lib` sendiri; MODUL
   `logging` adalah layanan jejak audit. Dicatat sebagai pengecualian alih-alih
   sebagai eksklusi supaya test bisa membuktikan bahwa ia TERDETEKSI dan sekadar
   dimaafkan.

6. **`tests/module-boundary.test.ts` diperluas ke `src/pages`**, mengatribusikan
   setiap rute ke modul pemiliknya lewat `api.routes` (Issue #256) dan menuntut
   setiap import lintas-modul dideklarasikan oleh pemilik itu. `identity_access`
   bergabung dengan `logging` sebagai fondasional KHUSUS UNTUK RUTE — chokepoint
   otorisasi dijangkau dari 184 berkas rute, dan mendeklarasikannya di mana-mana
   tidak akan memberi tahu pembaca apa pun sambil menjadikannya dependensi
   hampir seluruh registry.

## Konsekuensi

Delapan berkas dipindahkan dengan `git mv`; perilaku, API, migrasi, event,
permission, dan registry tidak berubah (tetap 21 modul,
`MODULE_CONTRACT_VERSION` tidak disentuh oleh ADR ini).

Membuat batas itu terlihat memunculkan empat edge yang selama ini tersembunyi:

| edge                                      | resolusi                                                                                                                                                                                                                              |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `theming` → `module_management`           | DIDEKLARASIKAN. Rute CSS-token publik memasang gerbang pada `fetchTenantModuleEntry`; `seo_distribution` dan `site_search` sudah mendeklarasikan edge yang sama untuk panggilan yang sama.                                            |
| `visitor_analytics` → `data_lifecycle`    | DIDEKLARASIKAN. `/api/v1/analytics/retention/purge` berjalan di balik guard legal-hold yang tak bisa dilewati.                                                                                                                        |
| `visitor_analytics` → `module_management` | DIDEKLARASIKAN. `/api/v1/analytics/settings` membaca lewat layanan module-settings.                                                                                                                                                   |
| `seo_distribution` → `visitor_analytics`  | DIHAPUS, bukan dideklarasikan. `extractReferrerDomain` adalah fungsi murni string→hostname; memindahkannya ke `_shared` menghapus edge itu. Mendeklarasikannya akan membuat telemetri 404 bergantung pada modul analytics yang AKTIF. |

Baris terakhir itu adalah aturan umumnya: edge yang muncul hanya karena sebuah
helper murni duduk di tempat yang salah harus dihapus, bukan didokumentasikan.

## Alternatif yang ditolak

**Allow-list akar komposisi di dalam `src/lib`.** Ini desain pertamanya. Ia
mendokumentasikan ambiguitasnya lalu menegakkan dokumentasi itu; ia tidak
menghilangkan alasan `src/lib/<nama-modul>/` terus muncul kembali. Menyebut
rumah yang sebenarnya-lah yang menghilangkannya.
