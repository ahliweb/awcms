🇮🇩 Bahasa Indonesia · 🇬🇧 [English (source)](0095-the-interface-speaks-the-readers-language.md)

<!-- i18n-source-hash: sha256:2e331ec056675847009ec57576c40c7c56267ff77c1c3c88f2ffa7806f602bce -->

# ADR-0095 — Antarmuka berbicara dalam bahasa PEMBACANYA, dan katalognya ikut masuk ke `dist/`

- **Status:** Diterima (2026-08-14).
- **Konteks:** Permintaan produk — admin harus bisa dibaca dalam Bahasa
  Indonesia dan Inggris. Repo ini menargetkan pasar Indonesia (lihat
  [ADR-0046](0046-idn-admin-regions-module-admission.md), yang mem-vendor
  hierarki wilayah Kemendagri), namun **seluruh 40 layar admin mengirim
  literal Inggris** dan `src/components/LocaleBadge.astro` adalah lencana
  MATI yang komentarnya sendiri menyatakan alasannya: "awcms has NO i18n
  module … so a switcher would be a control with nothing behind it".
- **Admisi:** [ADR-0055](0055-development-confined-to-awcms-and-awcms-astro.md)
  §3 — kapabilitas baru DIBANGUN di repo ini dengan ADR sendiri, bukan
  di-port dari arsip. `awcms-micro` punya `LanguageSwitcher` + katalog
  gettext; ia dibaca sebagai spesifikasi, tidak disalin.
- **Membangun di atas:**
  [ADR-0085](0085-one-human-one-credential-many-tenants.md) (principal itu
  GLOBAL — satu manusia, satu kredensial),
  [ADR-0087](0087-mfa-moves-to-the-principal.md) (properti MANUSIA pindah ke
  principal; tabel global, empat kontrol menggantikan RLS),
  [ADR-0088](0088-tenant-selection-and-switching.md) (ada layar yang dirender
  SEBELUM sebuah tenant dipilih), dan
  [ADR-0042](0042-varnish-edge-cache-auto-activation.md) (cache tepi di depan
  aplikasi multi-tenant).

## Kenapa ADR, dan kenapa bukan "tambahkan saja `t()`"

Tiga hal di bawah ini tidak bisa disimpulkan dari kode, dan ketiganya salah
kalau ditebak:

1. **Di mana preferensi bahasa TINGGAL.** Jawaban yang jelas (`awcms_identities`,
   tenant-scoped) melahirkan satu manusia yang memilih bahasanya berulang kali
   di tiap tenant — dan tak bisa melokalkan layar pemilihan tenant sama sekali.
2. **Bagaimana katalog SAMPAI ke produksi.** Repo ini baru saja membayar
   pelajaran ini dengan 29 job yang mati diam-diam.
3. **Apa yang terjadi pada cache tepi** ketika satu URL punya dua badan
   jawaban.

## Keputusan 1 — Preferensi bahasa milik PRINCIPAL, bukan identitas per-tenant

Tabel baru `awcms_principal_preferences` (sql/128): GLOBAL, tanpa `tenant_id`,
tanpa RLS, ber-kunci `principal_id`. Bentuknya menyalin
`awcms_principal_mfa_factors` ([ADR-0087](0087-mfa-moves-to-the-principal.md))
persis, termasuk pendaftaran privilese eksplisit di
`GLOBAL_TABLE_FORBIDDEN_PRIVILEGES`.

Alasannya sama dengan alasan MFA pindah, satu lapis lebih dangkal: **bahasa
yang dibaca seseorang adalah properti orang itu, bukan properti keanggotaan
tenantnya.** Seorang manusia yang membaca Bahasa Indonesia membacanya di tiga
tenant sekaligus; menyimpannya per-identitas berarti ia menyetelnya tiga kali
dan kehilangan setelan itu tiap kali diundang ke tenant keempat.

Tapi argumen yang MEMUTUSKAN bukan kenyamanan itu — melainkan
[ADR-0088](0088-tenant-selection-and-switching.md). Layar pemilihan tenant
dirender **saat belum ada tenant**. Preferensi yang ber-`tenant_id` secara
struktural tidak bisa dibaca di sana, jadi layar pertama yang dilihat seorang
pengguna Indonesia setelah login akan selamanya berbahasa Inggris. Itu bukan
kekurangan yang bisa ditambal belakangan; itu konsekuensi dari memilih kunci
yang salah.

### Kenapa ini BUKAN pembacaan lintas-tenant yang dilarang

[ADR-0094](0094-a-data-subject-is-answered-per-tenant.md) memperingatkan
dengan tepat bahwa "ADR-0087 dan ADR-0088 sama-sama merencanakan pembacaan
lintas-tenant yang FORCE RLS larang, dan keduanya baru ketahuan saat
implementasi". Peringatan itu dibaca dan **tidak berlaku di sini**, dan
perbedaannya harus tertulis supaya tidak dibaca ulang sebagai preseden yang
salah:

- Yang dilarang FORCE RLS adalah membaca **tabel ber-`tenant_id`** untuk tenant
  lain. Itu yang membuat ekspor subjek lintas-tenant mustahil.
- Tabel ini **tidak punya `tenant_id`**, persis seperti `awcms_principals` dan
  `awcms_principal_mfa_factors`. Tidak ada kebijakan RLS yang dilewati, karena
  tidak ada kebijakan RLS yang berlaku — sama seperti `awcms_permissions`.

Yang menggantikan RLS adalah kontrol ADR-0085, dipakai ulang tanpa
dilonggarkan: privilese menyempit (`DELETE` ditahan permanen — preferensi
di-RESET dengan menulis nilai default, tidak pernah dihapus), penulisan
terkurung di satu modul store, dan **batas otorisasi yang tidak bergerak:
memegang satu baris preferensi tidak memberi hak apa pun.** Baris ini adalah
sebuah string `"id"`; ia bukan kredensial dan bukan daftar sasaran, jadi ia
TIDAK ditambahkan ke `identity:principal-access:check` — gerbang itu menjaga
hash kata sandi dan daftar siapa-punya-faktor-kedua, dan melebarkannya untuk
sebuah pilihan bahasa akan mengaburkan apa yang sebenarnya dijaganya.

## Keputusan 2 — `msgid` ADALAH teks sumber Inggris

Katalog memakai bentuk gettext (`locales/en.po`, `locales/id.po`) dengan
`msgid` berupa **string Inggris yang sudah ada di kode**, bukan kunci yang
diciptakan (`admin.nav.posts`).

Ini bukan selera. Label sidebar dirender dari `ModuleDescriptor.navigation[].label`
di 24 modul; skema kunci buatan menuntut tiap deskriptor tumbuh sebuah field
kunci baru, yang berarti menyentuh registry modul dan setiap gerbang yang
memvalidasi bentuknya. Dengan `msgid` = teks sumber, `t(entry.label)`
menerjemahkan label yang sudah ada **tanpa satu pun deskriptor berubah**, dan
sebuah string yang belum diterjemahkan menurun ke bahasa Inggris yang benar
alih-alih ke `admin.nav.posts` yang bocor ke layar.

Konsekuensi yang diterima dengan sadar: mengubah kalimat Inggris memutus
terjemahannya. Itu perilaku gettext yang memang diinginkan — kalimat yang
berubah maknanya HARUS diterjemahkan ulang, dan gerbang di Keputusan 4 yang
membuat pemutusan itu terlihat.

### Ekspresi `Plural-Forms` TIDAK dievaluasi

Header `.po` membawa `Plural-Forms: … plural=(n != 1)`. Itu adalah ekspresi C
di dalam **berkas data**, dan repo ini tidak mengeksekusi ekspresi yang datang
dari data. Pemilih bentuk jamak adalah tabel `Record<Locale, (n) => number>`
di dalam kode (`en` → 2 bentuk, `id` → 1 bentuk — Bahasa Indonesia tidak
mem-infleksi jamak), dan `i18n:catalog:check` menolak katalog yang
`nplurals`-nya tidak cocok dengan tabel itu. Header dibaca untuk
DIVERIFIKASI, bukan untuk dijalankan.

## Keputusan 3 — Katalog DI-KOMPILASI menjadi modul TS yang ikut ter-bundle

`bun run i18n:compile` mengubah `locales/*.po` menjadi
`src/lib/i18n/catalogs/*.generated.ts`. Runtime **tidak pernah** membaca
`locales/` dari disk.

Alasannya tertulis di `docs/PROJECT_STATE.md` §4 dengan darah: stage `runtime`
`Dockerfile.production` hanya menyalin `dist/`, `node_modules/`, dan
`package.json`. Tidak ada `scripts/`, tidak ada `src/` — dan **29 job yang
terdaftar rapi semuanya keluar dengan `Script not found` di dalam container
produksi**, senyap, selama berminggu-minggu. Katalog yang dibaca dari
`locales/` pada saat request adalah cacat yang PERSIS SAMA, satu subsistem ke
samping: hijau di dev, hijau di CI, dan di produksi setiap layar mendadak
berbahasa Inggris tanpa satu pun error.

Berkas ter-generate hanya sah bila generatornya ada dan dijalankan CI —
pelajaran `.generated` tanpa generator adalah "klaim palsu". Karena itu
Keputusan 4.

## Keputusan 4 — Satu gerbang: `bun run i18n:catalog:check`

Masuk ke rantai `bun run check`. PURE (tanpa DB, tanpa jaringan). Ia menolak:

1. **Katalog ter-generate yang basi** — kompilasi ulang `.po` dan bandingkan
   byte. Ini yang membuat berkas `.generated` sebuah fakta, bukan klaim.
2. **`msgid` yang dipakai kode tapi tak ada di katalog** — dipungut dari
   pemanggilan `t()`/`tn()` ber-literal.
3. **`nplurals` yang tak cocok** dengan tabel bentuk jamak di kode.
4. **Entri `id` yang kosong atau `fuzzy`** — dilaporkan sebagai cakupan yang
   belum selesai, dengan ambang yang hanya boleh MENGECIL (pola ledger
   ADR-0094 §139→0). Sebuah layar yang belum diterjemahkan adalah utang yang
   terlihat, bukan utang yang tersembunyi.

Gerbang ini sengaja TIDAK mengklaim menemukan literal Inggris yang lupa
di-`t()`. Itu pertanyaan lain (cakupan, bukan konsistensi), ambangnya ada di
§4 poin 4, dan menggabungkan keduanya akan menghasilkan gerbang yang hijau
sambil semua jawabannya salah — kelas cacat yang sudah dicatat di memori
proyek.

## Keputusan 5 — Urutan resolusi locale, dan yang TIDAK ikut ter-cache

Middleware menyetel `Astro.locals.locale` untuk **setiap** request:

1. Cookie override `awcms_locale` (ditulis pemilih bahasa; berlaku sebelum
   login, di layar pemilihan tenant, dan bagi pembaca anonim).
2. Preferensi principal yang tersimpan (hanya bila sesi sudah resolve).
3. `awcms_tenants.default_locale` — kolom yang **sudah ada** sejak sql/001 dan
   dibaca `seo_distribution` untuk hreflang; ini pembaca keduanya.
4. Negosiasi `Accept-Language`.
5. `en`.

**Bahaya cache tepi, dinyatakan di muka.** Satu URL publik yang badannya
berubah menurut cookie adalah mesin penyajian-silang: Varnish akan menyajikan
halaman Indonesia kepada pembaca Inggris. Karena itu ADR ini **tidak**
melokalkan satu pun surface publik. Ia menyetel `locale` (yang belum dibaca
siapa pun di jalur publik) dan melokalkan `/admin`, yang `private, no-store`
oleh konstruksi ADR-0042. Melokalkan permukaan publik menuntut kunci cache
ikut membawa locale, dan itu keputusannya sendiri di ADR berikutnya —
didaftar sebagai prasyarat, bukan sebagai detail implementasi.

## Konsekuensi

- Tiap layar admin baru mengirim string lewat `t()`; yang lupa akan terlihat
  di ambang cakupan, bukan hilang.
- `LocaleBadge` DIHAPUS dan digantikan `LanguageSwitcher` yang benar-benar
  mengubah bahasa. Lencana itu jujur ketika ditulis; ia jadi tidak jujur pada
  menit kapabilitasnya mendarat.
- `awcms_tenants.default_theme` — kolom yang ADA namun tak pernah dibaca siapa
  pun — mendapat pembaca pertamanya lewat seam `data-tenant-default-theme`
  yang sudah didokumentasikan `theme-init-script.ts`. Komentar di berkas itu
  yang menyatakan kolomnya "tidak ada" adalah salah dan dikoreksi.
- Locale publik, hreflang yang benar (`seo_distribution` kini
  meneruskan `locale: null`), dan konten multi-bahasa TIDAK termasuk di sini.
  Semuanya menuntut keputusan kunci-cache di atas lebih dulu.
