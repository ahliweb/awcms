---
name: awcms-i18n
description: Tambah/ubah string UI atau konten multi-bahasa AWCMS yang benar. Gunakan saat menambah teks UI baru, menambah locale, memformat angka/mata uang/tanggal, atau menambah field konten yang perlu multi-bahasa. Menegakkan katalog .po gettext di locales/ (default en, min en+id), resolusi locale via middleware, dan konvensi konten multi-bahasa doc 04 sesuai ADR-0095.
---

🇮🇩 Bahasa Indonesia · 🇬🇧 [English (source)](SKILL.md)

<!-- i18n-source-hash: sha256:b6126789cca44590666480d9ad41f8322fb1e7f2f23cb4c0ac822299953bd841 -->

# AWCMS — i18n (String UI & Konten Multi-bahasa)

Sumber kebenaran: **[ADR-0095](../../../docs/adr/0095-the-interface-speaks-the-readers-language.id.md)**, `docs/awcms/14_ui_ux_design_system.id.md` §Internasionalisasi, dan `docs/awcms/04_erd_data_dictionary.id.md` §Konten multi-bahasa. Implementasi: `src/lib/i18n/`, katalog di `locales/{en,id}.po`.

> **Skill ini ditulis ulang 2 September 2026 karena menjelaskan sistem yang tidak pernah dibangun.** Ia menyebut direktori `i18n/`, template `messages.pot`, `bun run i18n:extract`, `i18n:pot:check`, `i18n:parity:check`, `scripts/i18n-extract.ts`, `src/lib/i18n/translate.ts`, `src/lib/i18n/locale.ts`, dan `src/lib/i18n/error-messages.ts` — **tak satu pun ada**. Yang benar-benar dikirim ADR-0095 lebih kecil dan berbeda jenisnya: katalog yang dirawat tangan, dikompilasi, dengan dua gerbang pemverifikasi dan tanpa langkah ekstraksi. Kalau ada yang bertentangan dengan `package.json` atau `grep -n "^export" src/lib/i18n/index.ts`, percayai kodenya.

## Dua lapis — jangan dicampur

1. **String UI statis** (label, tombol, pesan error, navigasi) → katalog `.po` gettext di `locales/`, **bukan** database.
2. **Konten data multi-bahasa** (input pengguna — nama produk, deskripsi) → disimpan di database **per locale aktif** (JSONB per-locale atau tabel translation `(entity_id, locale, field, value)`), **bukan** di `.po`. Contoh nyata yang bisa dicontoh: `awcms_email_templates.subject_template`/`text_body_template`/`html_body_template` (`sql/014`) — JSONB per-locale `{"en": "…", "id": "…"}`, minimal satu locale terisi, rantai fallback yang sama. Modul domain baru mengikuti ini persis; jangan menciptakan skema translation kedua.

## msgid ITU kalimat Inggrisnya

**Tidak ada identifier `namespace.key`**. `t("Skip to main content")`, bukan `t("admin.layout.skip_link")`. Tiga konsekuensi yang perlu dipahami:

- Locale yang belum diterjemahkan turun ke bahasa Inggris yang terbaca, bukan ke sebuah key.
- Reviewer membaca kalimat sesungguhnya di dalam diff, jadi copy yang buruk bisa tertangkap.
- Mengubah teks Inggrisnya **mengubah msgid-nya**, yang membuat terjemahannya yatim. Itu memang disengaja — kalimat yang diubah biasanya perlu diterjemahkan ulang — tetapi artinya sekadar merapikan copy pun berarti menyunting katalog.

Pakai `tx("konteks", "Order")` bila satu kata Inggris yang sama butuh dua terjemahan berbeda (nomina vs verba). Tanpanya, salah satunya selalu keliru.

## Menambah string UI baru

1. **Sisi server:** `const { t, tn, tx } = getTranslator(locale)` (`src/lib/i18n`), lalu `t("Kalimat Inggrisnya", { name })`. Placeholder hanya `{name}` — tidak ada `%s`/`%d`. Placeholder tanpa nilai padanan dibiarkan apa adanya, bukan dikosongkan.
2. **Tambahkan pasangannya dengan tangan** ke `locales/en.po` **dan** `locales/id.po`. Tak ada yang perlu diekstrak; gerbang di bawah inilah yang memberitahu kalau kamu lupa.
3. **`bun run i18n:compile`** lalu commit `src/lib/i18n/catalogs/*.generated.ts` hasil regenerasi bersama berkas `.po`-nya. `i18n:catalog:check` mengompilasi ulang dan membandingkan byte, jadi berkas generated yang basi = gerbang merah, bukan perbedaan senyap.
4. **Script klien tidak bisa menerjemahkan.** Katalognya modul server, dan mengirimkannya berarti mengirim kedua bahasa ke setiap browser. Kirim string yang sudah diterjemahkan sebagai atribut `data-*` — pola yang dipakai `AdminLayout.astro` untuk label busy tombol keluar, dan `ThemeToggle` untuk tiga label mode-nya.
5. **Pesan per error code** saat ini dipetakan **per layar, inline** (`blog-ads.astro`, `blog-homepage.astro`). Tidak ada `translateErrorCode`/`buildClientErrorMessages` dan tidak ada `src/lib/i18n/error-messages.ts`, apa pun kata dokumen lama. Peta terpusat layak dibangun; sampai itu ada, ikuti pola lokalnya dan jaga konsistensi kalimatnya dengan tangan.

## Dua gerbang, sengaja dipisah

- **`bun run i18n:catalog:check` — konsistensi.** Mengompilasi ulang setiap `.po` dan membandingkan byte; memastikan setiap msgid yang diminta kode sudah dideklarasikan; mencocokkan `nplurals` tiap katalog dengan `PLURAL_FORM_COUNT`; memeriksa paritas `{placeholder}` antara msgid dan msgstr; melaporkan jumlah `id` yang belum diterjemahkan terhadap **ledger yang hanya boleh MENGECIL**.
- **`bun run i18n:screens:check` — cakupan.** Mencari layar admin yang masih merender teks Inggris literal, terhadap ledger-nya sendiri berisi nama-nama layar yang juga hanya boleh mengecil. Layar yang baru ditambahkan wajib diterjemahkan karena ia tidak bisa bergabung ke daftar yang tidak pernah bertambah.

Menyatukan keduanya akan menghasilkan gerbang yang hijau sementara semua jawabannya salah; header kedua skrip itu menjelaskannya panjang lebar. **Jangan menaikkan ledger mana pun** — begitulah utang terjemahan menjadi permanen.

Yang sengaja **tidak** dipindai gerbang cakupan: atribut. `aria-label="Close"` sama butuhnya diterjemahkan, tetapi `class="admin-card"` terlihat identik bagi pemindai, dan gerbang yang melaporkan nama kelas melatih pembacanya untuk mengabaikannya. Jadi layar yang lolos masih bisa punya `placeholder`, `aria-label`, atau `title` yang belum diterjemahkan — periksa itu dengan tangan.

## Bentuk jamak SUDAH diimplementasikan

`tn("1 file", "%d files", count)` — dengan `PLURAL_FORM_COUNT` dan `PLURAL_SELECTOR` di `src/lib/i18n/locales.ts`. Bahasa Indonesia mendeklarasikan `nplurals=1` karena tidak berinfleksi untuk jumlah ("satu berkas" / "dua berkas"). Ekspresi `plural=` di header `.po` **dibaca untuk DIVERIFIKASI, tidak pernah dievaluasi** — `i18n:catalog:check` memastikan ia setuju dengan tabel di kode, bukan menjalankannya.

## Resolusi locale — WAJIB di middleware, bukan di layout

**Jebakan nyata:** frontmatter sebuah halaman Astro berjalan **sebelum** frontmatter layout yang membungkusnya. Meresolusi locale di dalam `AdminLayout.astro` membuat shell benar sementara isi halaman tetap di bahasa default — bug yang benar-benar pernah terjadi.

- Resolusi terjadi di `src/middleware.ts` lewat `resolveRequestLocale` (`src/lib/i18n/request-locale.ts`), disimpan di `Astro.locals`, dan setiap halaman/layout membacanya dari sana. **Jangan meresolusi ulang locale di layout atau halaman.**
- Presedensi: cookie `awcms_locale` (`LOCALE_COOKIE_NAME`) → `default_locale` tenant yang dibawa `SsrContext` (tanpa round-trip DB baru) → `DEFAULT_LOCALE` (`en`).

## Language switcher

`src/components/LanguageSwitcher.astro` menyetel cookie lalu melakukan **reload penuh**, bukan pertukaran instan seperti theme toggle — locale mengubah teks yang dirender SSR, dan hanya cookie yang sampai ke server sebelum render. Tampilkan `LOCALE_FLAG` + `LOCALE_ENDONYM` (nama bahasa itu sendiri), bukan kode mentahnya.

## Formatter locale-aware

`src/lib/i18n/format.ts` — `formatNumber`/`formatCurrency`/`formatDate`/`formatDateTime`, di atas `Intl` dengan `LOCALE_INTL_TAG` dan timezone dipatok `Asia/Jakarta`. **Jebakan**: gaya currency `Intl.NumberFormat` menyisipkan U+00A0 (spasi tanpa-putus) antara simbol dan angka, bukan spasi biasa — test yang mengasersikan `" "` gagal karena alasan yang tak terlihat di diff.

## Menambah locale baru (`ms`/`ar`, dst.)

1. Tambahkan ke `SUPPORTED_LOCALES` + `LOCALE_ENDONYM`/`LOCALE_FLAG`/`LOCALE_INTL_TAG` + `PLURAL_FORM_COUNT`/`PLURAL_SELECTOR` (`src/lib/i18n/locales.ts`).
2. Tambahkan `locales/<locale>.po` dengan himpunan msgid sama seperti `en.po`, lalu `bun run i18n:compile`.
3. **Periksa fontnya.** Subset yang di-self-host di `public/fonts/` hanya latin/latin-ext (ADR-0120); locale beraksara lain butuh subsetnya ditambahkan, dan `FONT_BUDGET_BYTES` di `scripts/client-asset-budget.ts` adalah tempat biaya itu jadi terlihat.
4. Kolom DB `default_locale` bertipe `text` bebas, jadi tak perlu migration — tetapi UI hanya boleh menawarkan locale yang benar-benar punya katalog.

## Verifikasi

- Ganti locale (switcher/cookie/`default_locale` tenant) → seluruh UI berganti bahasa, **termasuk isi halaman**, bukan cuma shell-nya.
- Tidak ada kedipan bahasa yang salah saat SSR.
- `bun run i18n:catalog:check` dan `bun run i18n:screens:check` hijau, tanpa satu pun ledger dinaikkan.
- Formatter IDR/tanggal mengikuti locale dan timezone yang benar.

## Skill terkait

`awcms-ui-screen` (memakai `t()`/formatter saat membangun layar), `awcms-ux-review` (mengaudit string hardcode), `awcms-module-management` (`labelKey` → `SIDEBAR_LABELS` → diterjemahkan layout).
