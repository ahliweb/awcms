---
"awcms": patch
---

Sapu drift docs/skill terhadap kode, dan pasang dua gate supaya kelasnya tidak
kembali.

Lima klaim yang **salah**, bukan sekadar usang:

- `awcms-data-lifecycle` menyebut `form_drafts`/`comments` "DITUNDA (modul belum
  di-port)" — keduanya sudah di-port dan keduanya adopter `delegated`. Skill itu
  juga menyebut 2 adopter padahal ada **10 deskriptor di 7 modul**; agen yang
  mengikutinya akan melewatkan guard legal-hold pada tabel yang mewajibkannya.
- `awcms-theming` menyebut `media_library` "di-drop — belum ada di base", dan
  menerangkan ketiadaan purge preview dengan "`data_lifecycle` tidak ada di base
  ini; tak ada `awcms_worker`". Ketiganya ada.
- `awcms-wizard-form` menyebut `form_drafts` belum di-port.
- `awcms-module-management` melaporkan "17 modul (dari 23)" mendeklarasikan
  `permissions`, dengan daftar yang tujuh di antaranya milik awcms-mini. Angka
  nyata: **20 dari 21**, dan satu-satunya pengecualian adalah `email`.
- Lima dokumen menyatakan total yang tertinggal (`sql/001`–`067`, "65 migrasi",
  "20 modul") — termasuk paragraf di `repo-inventory.md` yang tugasnya justru
  MENGOREKSI klaim usang. Koreksi yang ikut usang lebih buruk dari aslinya: ia
  terbaca seperti baru saja diverifikasi.

`src/lib/theming/theme-media.ts` punya kembaran klaim itu **di kode** — header
seam-nya menerangkan resolusi asset no-op karena `media_library` tidak ada.
Modulnya ada, lengkap dengan adapter nyata yang sudah dipakai `blog_content` dan
`news_portal`. Akibat yang terlihat pengguna dan sebelumnya tidak tercatat di
mana pun: tenant bisa mengunggah logo, id-nya tersimpan, dan tema tetap merender
fallback nama-tema. Header-nya kini menyatakan itu; wiring adapternya tetap
pekerjaan tersendiri.

`domain-event-runtime/infrastructure/consumer-registry.ts` juga: header-nya
menyatakan consumer `reporting` "intentionally NOT ported (they would import
modules that are absent)" sementara berkas yang sama meng-import `reporting` di
baris 8. Sekaligus mencatat cycle level-modul yang tak terlihat gate mana pun —
`reporting` mendeklarasikan `domain_event_runtime`, dan modul ini meng-import
`reporting`; `modules:dag:check` memvalidasi deklarasi saja (registry murni,
tanpa I/O by design), jadi import tak-terdeklarasi tak terlihat, dan
mendeklarasikannya secara jujur justru membuat gate itu merah karena cycle.

Dua gate baru, keduanya mutation-proven:
`tests/module-absence-claims.test.ts` (tidak ada dokumen/skill yang boleh
menyangkal modul terdaftar) dan `tests/doc-inventory-counts.test.ts` (total modul
dan rentang `sql/001`–`NNN` harus cocok dengan repo).
