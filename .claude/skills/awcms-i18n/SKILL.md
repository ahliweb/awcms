---
name: awcms-i18n
description: Tambah/ubah string UI atau konten multi-bahasa AWCMS yang benar. Gunakan saat menambah teks UI baru, menambah locale, memformat angka/mata uang/tanggal, atau menambah field konten yang perlu multi-bahasa. Menegakkan katalog .po gettext (default en, min en+id), resolusi locale via middleware, dan konvensi konten multi-bahasa doc 04 sesuai Issue #433.
---

# AWCMS — i18n (String UI & Konten Multi-bahasa)

Sumber kebenaran: **`docs/awcms/14_ui_ux_design_system.md`** §Internationalization dan **`docs/awcms/04_erd_data_dictionary.md`** §Konten multi-bahasa. Implementasi referensi: `src/lib/i18n/`, `i18n/{messages.pot,en.po,id.po}` (Issue #433).

## Dua lapisan — jangan campur

1. **String UI statis** (label, tombol, pesan error, navigasi) → katalog `.po`/`.pot` gettext, **bukan** database. Kunci `namespace.key` (mis. `admin.settings.save_button`, `error.access_denied`).
2. **Konten data multi-bahasa** (input pengguna — nama produk, deskripsi, dst.) → disimpan di database **per locale aktif** (JSONB per-locale atau tabel translasi `(entity_id, locale, field, value)`), **bukan** di `.po`. Sudah ada contoh nyata untuk dicontek, bukan cuma pola abstrak: `awcms_email_templates.subject_template`/`text_body_template`/`html_body_template` (`sql/021`, Issue #498) — JSONB per-locale `{"en": "...", "id": "..."}`, minimal salah satu locale terisi, fallback locale yang sama (`locale → en → key mentah`) dengan katalog `.po` di atas. Modul domain baru (mis. `blog_content`, epic #536) yang butuh field konten multi-bahasa (judul/isi post, dsb.) ikuti pola ini persis, jangan bikin skema translasi baru yang berbeda tanpa alasan kuat.

## Menambah string UI baru

1. Pakai di server: `const t = await createTranslator(locale)` (`src/lib/i18n/translate.ts`), lalu `t("namespace.key", params?)`. Fallback chain: `locale → en → key mentah` — tidak pernah crash pada key hilang.
2. Jalankan `bun run i18n:extract` (`scripts/i18n-extract.ts`, Issue #694) — men-scan seluruh `t("...")` di `src/` dan menulis ulang `i18n/messages.pot` secara **deterministik** (terurut alfabetis, `#: file:line` per key). Key barumu otomatis masuk template ini; **jangan** edit `messages.pot` dengan tangan lagi.
3. Isi `msgstr` untuk key baru itu di `i18n/en.po` **dan** `i18n/id.po` — ini tetap langkah manual (extraction cuma mengurus inventaris key, bukan menerjemahkan).
4. Commit ketiga berkas (`messages.pot`, `en.po`, `id.po`) bersamaan. `bun run i18n:pot:check` (bagian `bun run check`) gagal kalau `messages.pot` yang di-commit tidak identik dengan hasil regenerasi dari source — tanda kamu lupa langkah 2.
5. Pakai di client script (`<script>` inline di halaman `.astro`): **tidak bisa** memanggil `createTranslator` (katalog server-side only) — injeksikan string yang dibutuhkan lewat `<script type="application/json" set:html={JSON.stringify(clientStrings)} />` di frontmatter, baca di client script (pola `login.astro`, `admin/access-users.astro`).
6. Pesan error banner: petakan kode error (doc 05) ke key ter-lokalisasi via `translateErrorCode`/`buildClientErrorMessages` (`src/lib/i18n/error-messages.ts`) — jangan hardcode pesan per kode error di tiap halaman.

## Dynamic key (t(\`ns.${var}\`), t(entry.labelKey), t(key) dari map)

Sebuah literal-string scan tidak bisa menemukan key yang dipakai secara dinamis. Tiga pola nyata di codebase ini ditangani eksplisit oleh `scripts/i18n-extract.ts` supaya key yang benar-benar dipakai tidak salah ditandai "obsolete":

- `t(\`admin.blog.status.${post.status}\`)`(template-literal interpolation) — resolusi lewat`DYNAMIC_KEY_FAMILIES`table di`scripts/i18n-extract.ts`, memetakan prefix ke suffix konkret dari domain enum aslinya (pola sama seperti `CONFIG_EXEMPTIONS`, Issue #689). **Menambah pola baru ini di source WAJIB diikuti entry baru di tabel itu** — kalau tidak, `bun run i18n:extract`/`i18n:pot:check` gagal (bukan diam-diam under-extract).
- `t(entry.labelKey)` (nav menu) — resolusi dari definisi literal `labelKey: "admin.layout.nav_x"` di tiap `src/modules/*/module.ts`, bukan dari call site-nya.
- `t(key)` dari `ERROR_CODE_KEYS` (`src/lib/i18n/error-messages.ts`) — resolusi dari value map itu sendiri.

## Placeholder parity, obsolete key, plural forms (Issue #694)

- **Placeholder**: `{name}`-style adalah satu-satunya format placeholder yang dipakai katalog ini (tidak ada `%s`/`%d`). `bun run i18n:parity:check` gagal kalau `en.po` dan `id.po` punya set placeholder berbeda untuk key yang sama — translator yang lupa menyalin `{name}` akan tertangkap di CI, bukan diam-diam tampil sebagai teks `{name}` mentah.
- **Obsolete key**: `bun run i18n:extract` melaporkan (bukan menghapus) key yang ada di `en.po` tapi tidak ditemukan di source manapun. Sebelum dihapus, pastikan bukan dynamic key (lihat bagian di atas); kalau memang tidak dipakai, tandai `#~ ` (gettext obsolete marker) di ketiga berkas alih-alih dihapus langsung.
- **Plural forms**: katalog ini **tidak** memakai `msgid_plural`/`msgstr[n]` sama sekali (keputusan desain saat ini, bukan kelalaian — `po-parser.ts` juga belum mengimplementasikan parsing plural). `bun run i18n:parity:check` menyertakan tripwire yang gagal kalau `msgid_plural` pernah muncul.

## Resolusi locale — WAJIB di middleware, bukan di layout

**Gotcha nyata (Issue #433)**: frontmatter sebuah halaman Astro berjalan **lebih dulu** daripada frontmatter layout yang membungkusnya. Me-resolve locale (cookie → `default_locale` tenant → `en`) di dalam layout (`AdminLayout.astro`) membuat shell ter-render benar tapi konten halaman tetap bahasa default — bug nyata yang pernah terjadi dan sudah diperbaiki.

- Resolusi locale **HARUS** terjadi di `src/middleware.ts` (`resolveRequestLocale`/`resolveLocale`, `src/lib/i18n/locale.ts`), disimpan di `Astro.locals.locale`, dan setiap halaman/layout membaca `Astro.locals.locale` langsung — **jangan** re-resolve locale sendiri di layout atau halaman manapun.
- Precedence: cookie `awcms_locale` → `SsrContext.tenantDefaultLocale` (dibawa dari query yang sudah ada di `resolveSsrContext`, tanpa round-trip DB baru) → fallback `en`.

## Language switcher

`src/components/LanguageSwitcher.astro` — set cookie lalu **reload penuh** (`window.location.reload()`), **bukan** swap instan seperti theme toggle. Alasan: locale mengubah teks yang di-render SSR, bukan cuma CSS — swap instan tidak bisa membaca ulang katalog server-side. Tampilkan ikon bendera + nama asli bahasa (`LOCALE_FLAGS`/`LOCALE_LABELS`, `src/lib/i18n/locale.ts`), bukan kode locale mentah (`en`/`id`).

## Formatter locale-aware

`src/lib/i18n/format.ts` — `formatNumber`/`formatCurrencyIDR`/`formatDate`/`formatDateTime` (`Intl.NumberFormat`/`DateTimeFormat`, tag `en-US`/`id-ID`, timezone tetap `Asia/Jakarta`). **Gotcha**: `Intl.NumberFormat` currency style menyisipkan U+00A0 (no-break space) antara simbol dan angka, bukan spasi biasa — assertion test harus pakai karakter itu persis, bukan `" "`.

## Menambah locale baru (`ms`/`ar`, dst.)

1. Tambah ke `SUPPORTED_LOCALES` (`src/lib/i18n/locale.ts`) + `LOCALE_LABELS`/`LOCALE_FLAGS` + tag `INTL_LOCALE_TAG` (`format.ts`).
2. Tambah `i18n/<locale>.po` dengan keyset identik ke `en.po`.
3. Kolom DB `default_locale` mungkin sudah menerima nilai itu (doc 04 §ERD) untuk kompatibilitas mundur — tapi UI (`LanguageSwitcher`, dropdown Settings) hanya boleh menawarkan locale yang **benar-benar punya katalog** (`SUPPORTED_LOCALES`), jangan tawarkan locale tanpa terjemahan nyata.

## Verifikasi

- Ganti locale (switcher/cookie/`default_locale` tenant) → seluruh UI berpindah bahasa tanpa string tersisa hardcode, **termasuk konten halaman**, bukan cuma shell layout.
- Tidak ada flash bahasa salah saat SSR.
- `bun run check` hijau (termasuk `i18n:pot:check` dan `i18n:parity:check`); keyset + placeholder `.po` identik di tiga berkas.
- Formatter IDR/tanggal mengikuti locale/timezone yang benar.

## Skill terkait

`awcms-ui-screen` (memakai `t()`/formatter saat membangun layar), `awcms-ux-review` (audit string hardcode yang lolos ekstraksi).
