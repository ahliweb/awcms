🇮🇩 Bahasa Indonesia · 🇬🇧 [English (source)](product-identity.md)

<!-- i18n-source-hash: sha256:99250d4ec517c3098c77d42656b1480ecb29eefee968440ccb4d83706c838a21 -->

# Identitas Produk Tingkat Deployment

Issue #1352. Satu identitas tingkat deployment menentukan bagaimana deployment
ini menyebut dirinya di shell admin, halaman auth, manifest aplikasi yang dapat
dipasang, dan pintu depan, sehingga produk turunan template ini tidak perlu
menambal `AdminLayout.astro`, `AuthBrandPanel.astro`, atau halaman auth. Sifatnya
opt-in: tanpa konfigurasi keluarannya persis seperti sebelumnya.

Resolver-nya `src/lib/product-identity.ts` (berkas bersama di `src/lib/`, sehingga
halaman milik `identity_access` bisa memakainya tanpa mengimpor modul domain).
Konfigurasinya variabel lingkungan, mekanisme yang sama dengan branding `PWA_*`
yang sudah ada (Issue #1105). Ini konfigurasi deployment: bukan `Host` permintaan,
bukan baris tenant. Branding per tenant di luar cakupan.

| Variabel                                                                                            | Default                       | Efek                                                                          |
| --------------------------------------------------------------------------------------------------- | ----------------------------- | ----------------------------------------------------------------------------- |
| `PRODUCT_NAME`                                                                                      | `AWCMS`                       | Judul halaman, nama merek di teks panel auth, nama manifest (`<nama> Admin`)  |
| `PRODUCT_WORDMARK`                                                                                  | nama produk                   | Tanda teks di shell, halaman auth, dan landing; huruf pertamanya mengisi ubin |
| `PRODUCT_VERSION`                                                                                   | versi paket                   | Hanya footer shell                                                            |
| `PRODUCT_FRONT_DOOR_PATH`                                                                           | tidak diatur (landing tampil) | `/` menjawab 302 ke path same-origin ini                                      |
| `PWA_ICON_192_PATH`, `PWA_ICON_512_PATH`, `PWA_ICON_MASKABLE_512_PATH`, `PWA_APPLE_TOUCH_ICON_PATH` | ikon bawaan                   | Ikon aplikasi yang dapat dipasang                                             |

`PWA_APP_NAME` dan `PWA_APP_SHORT_NAME` tetap menang atas nama manifest turunan
`PRODUCT_NAME`.

## Validasi

Nilai tidak valid diabaikan (default dipakai), bukan menggagalkan halaman.

- Nama: karakter kontrol dan format dibuang, panjang dibatasi (nama 60, wordmark
  30), dan ditolak bila memuat `<`, `>`, `&`, tanda kutip, atau backtick, sehingga
  nilai tidak pernah menjadi markup.
- `PRODUCT_VERSION`: huruf, angka, dan `. + _ -`, paling banyak 32 karakter.
- Path (pintu depan, ikon): path absolut same-origin berisi huruf, angka, dan
  `. _ ~ - /`. Tanpa skema, tanpa `//`, tanpa backslash, tanpa `..`, tanpa query
  atau fragmen. Pintu depan tidak pernah menunjuk `/` (akan berputar). Karena path
  ikon tetap same-origin, CSP tidak dilonggarkan.

## Yang tetap sama

- Versi kompatibilitas. `PRODUCT_VERSION` hanya tampilan; matriks modul dan
  siklus hidup modul tenant tetap membaca versi platform.
- Terjemahan. Identitas hanya memasok token merek. Kalimat di sekitarnya tetap di
  katalog gettext; di panel auth, nama platform di dalam kalimat terjemahan
  diganti `PRODUCT_NAME`.
- Pintu depan adalah 302, bukan 301, sehingga perubahan atau pencabutannya sampai
  ke peramban yang akan menyimpan redirect permanen.

## Tes

`tests/product-identity.test.ts` mengunci default (tanpa konfigurasi tetap string
dan manifest lama), validasi, dan gerbang yang gagal bila halaman auth menulis
nama platform langsung alih-alih memakai resolver.
