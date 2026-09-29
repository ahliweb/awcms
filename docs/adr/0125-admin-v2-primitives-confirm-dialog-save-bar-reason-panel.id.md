🇮🇩 Bahasa Indonesia · 🇬🇧 [English (source)](0125-admin-v2-primitives-confirm-dialog-save-bar-reason-panel.md)

<!-- i18n-source-hash: sha256:5e2e35414e01b65b720fa5f62da17bbd7fb8c0a75052697ae4d39eea9c474693 -->

# ADR-0125 — tiga primitif admin v2: dialog konfirmasi, save bar pengaturan, panel alasan

- **Status:** Diterima
- **Tanggal:** 2026-09-29
- **Pengambil keputusan:** ahliweb
- **Menggantikan:** tidak ada.
- **Terkait:** [Issue #854](https://github.com/ahliweb/awcms/issues/854) (bagian 1 dari 2 — sapuan i18n raw-enum/`data-label` pada issue yang sama adalah PR terpisah); `src/components/ConfirmDialog.astro`, `src/components/SettingsSaveBar.astro`, `src/components/ReasonPanel.astro`; `src/lib/ui/confirm-dialog-client.ts`, `src/lib/ui/settings-save-bar-client.ts`, `src/lib/ui/reason-panel-client.ts`; `src/layouts/AdminLayout.astro`; `docs/awcms/14_ui_ux_design_system.md`

## Konteks

`ahliweb/media-lenterakalteng` (LK) menyematkan repo ini sebagai `apps/cms`
dan, dalam epik admin v2-nya sendiri (LK #240, LK ADR-0123/0124), membangun
tiga primitif UX admin **secara lokal di salinan pohon kodenya sendiri**:

1. Dialog konfirmasi yang aksesibel (`initConfirmDialog`) menggantikan
   `window.confirm()`.
2. `SettingsSaveBar` — save bar sticky yang selalu dirender dan mengirim
   lewat `type="submit" form="…"`, sehingga bekerja tanpa JavaScript.
3. `ReasonPanel` — sebuah `<dialog>` dengan textarea alasan wajib,
   menggantikan `window.prompt()` untuk aksi yang endpoint-nya mencatat
   alasan.

Karena dibangun di salinan pohon kode LK, tidak ada konsumen lain template
ini — termasuk `ahliweb/awcms-one` — yang mendapatkannya lewat sinkronisasi
subtree. Sesuai `AGENTS.md` §"Di repo mana pekerjaan dilakukan", kapabilitas
yang dibutuhkan operator dibangun **di sini**, di `awcms`, dengan admission-nya
sendiri — bukan dibiarkan hanya hidup di fork downstream.

`window.confirm()` dan `window.prompt()` juga tidak memenuhi standar
aksesibilitas repo ini sendiri (`docs/awcms/14_ui_ux_design_system.md`
§Aksesibilitas — WCAG 2.2 AA): keduanya adalah chrome OS tanpa gaya (tidak
pernah theme-aware, sehingga dark mode rusak khusus untuk keduanya),
memblokir main thread, dan kata-kata serta urutan tombolnya berbeda-beda
antar browser dan platform.

LK menomori ADR lokalnya sendiri 0123 dan 0124, yang bentrok dengan ADR-0123
(enkripsi backup) dan ADR-0124 (lokasi vault Obsidian) milik repo ini sendiri
— adopsi upstream tetap membutuhkan nomor baru meskipun kodenya secara
material tidak berubah.

## Keputusan

Port ketiga primitif ke repo ini, diadaptasi ke penamaan AWCMS yang netral
dan token desain repo ini sendiri (`src/styles/tokens.css`) — tanpa branding
LK, tanpa warna baru.

1. **`ConfirmDialog.astro` + `confirm-dialog-client.ts`.** Satu
   `<dialog id="confirm-dialog" role="alertdialog">`, dirender **sekali, oleh
   `AdminLayout.astro`**, bukan per halaman — `AdminLayout` adalah satu-satunya
   komponen yang dirender setiap halaman `/admin/*`, sehingga ini adalah
   satu-satunya tempat yang menjamin dialog itu ada sebelum skrip halaman mana
   pun memanggil `confirmAction(message)`. `confirmAction` menghubungkan dan
   meng-cache dialog secara lazy pada pemanggilan pertama, sehingga sebuah
   layar tidak perlu panggilan setup sendiri — hanya konversi satu baris
   `if (!window.confirm(x)) return;` →
   `if (!(await confirmAction(x))) return;`. `showModal()` menyediakan focus
   trap, tertutup dengan Escape, `::backdrop`, dan pengembalian fokus ke
   pemanggil — semuanya bukan kode yang dimiliki repo ini.

2. **`SettingsSaveBar.astro` + `settings-save-bar-client.ts`.** Berbeda dari
   `ConfirmDialog`, ini dirender **per halaman**, oleh layar pengaturan
   masing-masing — tidak ada satu instance bersama, karena setiap layar
   mengirim form yang berbeda. Diadopsi di `site-profile.astro`,
   `blog-settings.astro`, dan `theming.astro` (tiga layar dengan tepat satu
   form pengaturan dan satu tombol submit). Tombol submit/reset membawa
   `form="<id>"` dan bekerja **tanpa JavaScript** — modul klien hanya
   men-toggle kelas dirty-state dan, bila pemanggil menginginkannya, menukar
   string status. `submitContext()` di `admin-form-client.ts` mendapat
   fallback pencarian (`button[type="submit"][form="<id>"]` di luar form)
   karena `form.querySelector('button[type="submit"]')` aslinya berasumsi
   tombol submit selalu keturunan form, yang dilanggar `SettingsSaveBar`
   secara sengaja.

3. **`ReasonPanel.astro` + `reason-panel-client.ts`.** Juga dirender per
   halaman (hanya layar dengan aksi ber-alasan-wajib yang membutuhkannya).
   Deklaratif, digerakkan atribut `data-reason-*` — tombol pembuka tidak
   butuh JavaScript khusus halaman kecuali satu panggilan
   `initReasonPanel()`. Dua mode kirim: `data-reason-action` (modul ini
   mengirim `{ [field]: reason }` sebagai JSON sendiri) dan
   `data-reason-form` (menulis alasan ke field tersembunyi pada form yang
   ada dan memanggil `requestSubmit()`). Opsi `data-reason-idempotent`
   mengirim `Idempotency-Key` baru per _pembukaan_ panel (bukan per klik —
   percobaan ulang yang gagal dalam pembukaan yang sama harus memakai ulang
   kunci yang sama). Ditambahkan satu field di luar versi LK:
   `data-reason-max-length`, yang mengatur `maxlength` native textarea —
   dibutuhkan karena alasan hapus `/admin/media` memiliki batas atas yang
   ditegakkan server yang tidak dimiliki dua konsumen asli LK (disable
   modul, suppress newsletter).

### Apa yang dikonversi, dan apa yang tidak

Setiap `window.confirm()` di `src/pages/admin/**` dan `src/lib/ui/*.ts`
(43 titik panggilan di 26 layar) dikonversi ke `confirmAction()` — ini
mekanis dan seragam aman: setiap titik sudah hidup di dalam handler `async`
(callback `onAction`), diverifikasi oleh `bun run check:astro-scripts:check`
yang meng-typecheck setiap blok `<script>` yang dikonversi (`await` di luar
fungsi `async` adalah error kompilasi, bukan runtime).

`window.prompt()` dikonversi ke `ReasonPanel` **hanya** ketika sebuah pembuka
memetakan tepat ke satu panggilan endpoint dengan tepat satu field teks
bebas, field itu benar-benar **wajib**, dan reload halaman biasa (atau
submit form yang sudah ada) adalah hal yang benar dilakukan saat berhasil:
disable modul (`modules.astro`), suppress subscriber newsletter
(`newsletter.astro`), hapus objek media (`media.astro`, satu-satunya titik
yang butuh `data-reason-idempotent` + `data-reason-max-length`), hapus
domain tenant (`tenant/domains.astro`), pencabutan assignment/exception SoD
business-scope (`business-scope.astro`, dua titik), dan jeda konsumer
domain-event / replay pengiriman (`domain-events.astro`, dua titik — jeda
juga sebelumnya punya `confirmAction()` terpisah di depannya, kini dilipat
ke teks deskripsi panel itu sendiri).

Dibiarkan sebagai `window.prompt()` — dievaluasi, tidak dikonversi, karena
tidak ada yang cocok dengan bentuk "satu endpoint, satu field wajib,
reload-atau-form-yang-ada saat berhasil" yang menjadi komitmen `ReasonPanel`:

- **Alasan opsional** (textarea `ReasonPanel` selalu `required` tanpa
  syarat): approve/reject exception di `business-scope.astro`, alasan hapus
  di `roles.astro`, catatan resolusi konflik di `sync.astro`.
- **Bukan alasan sama sekali — prompt nilai/identifier/keputusan**: rename
  di `roles.astro`, rename/add-member/remove-member di `user-groups.astro`,
  reassign-ke-id-pengguna dan teks force-decision di `approvals.astro`,
  next-effect/next-description di `abac-policies.astro`, prompt tanggal
  jadwal dan URL kanonis di `blog.astro`, prompt kode verifikasi di
  `admin-account-client.ts`.
- **Field body kedua yang tetap di endpoint, di samping alasan**
  (`ReasonPanel` mengirim tepat `{ [field]: reason }`, tidak ada yang lain):
  keputusan penghapusan di `subject-requests.astro`, yang juga membutuhkan
  `decision: "approve" | "reject"` tetap di body yang sama.
- **Jalur sukses yang bukan "reload" atau "submit form yang ada"**:
  hapus redirect di `seo.astro`, yang saat berhasil menavigasi ke
  `?recover=<id>` alih-alih reload di tempat.
- **Dispatcher generik multi-aksi di atas id per-baris yang dinamis**: kode
  alasan reject/spam di `comments.astro`, terikat lewat satu delegated
  listener yang mencakup empat aksi baris berbeda.

Ini dicatat di sini, bukan didiamkan begitu saja, sehingga PR masa depan
yang memperluas `ReasonPanel` (field kedua, aksi sukses yang bisa
dikonfigurasi) punya daftar konkret konsumen yang menunggunya alih-alih
audit baru dari nol.

## Konsekuensi

- Setiap layar admin kini punya tiga primitif aditif, server tidak berubah,
  yang tersedia; mengadopsi salah satunya adalah perubahan markup + satu
  impor, bukan endpoint baru, dan otorisasi/validasi tetap persis di tempat
  yang sudah ada (sisi server).
- `ConfirmDialog` yang dimiliki layout berarti layar admin masa depan
  mendapatkannya gratis — tanpa impor, tanpa render, cukup
  `confirmAction()`.
- 12 titik `window.prompt()` yang dibiarkan tidak dikonversi adalah backlog
  eksplisit, bukan celah yang tidak dicatat siapa pun.
- Padanan yang di-scope-commerce milik `awcms-one` (issue #249 miliknya
  sendiri) dapat bermigrasi ke primitif ini setelah sinkronisasi subtree
  berikutnya, sesuai kerangka asli issue.

## Alternatif yang dipertimbangkan

- **Biarkan `window.confirm()`/`window.prompt()` apa adanya dan hanya port
  `SettingsSaveBar`.** Ditolak: celah confirm/prompt adalah persis yang
  diminta issue untuk ditutup, dan `docs/awcms/14_ui_ux_design_system.md`
  sudah berkomitmen pada WCAG 2.2 AA, yang tidak dipenuhi dialog native OS.
- **`ReasonPanel` generik yang juga membawa langkah konfirmasi (tanpa
  `ConfirmDialog` terpisah)**, karena setiap pembuka `ReasonPanel` secara
  implisit juga adalah konfirmasi. Ditolak: sebagian besar titik
  `window.confirm()` sama sekali tidak butuh alasan (mis. "Hapus term ini?
  Tidak bisa dibatalkan."), sehingga melipat `ConfirmDialog` ke dalam
  `ReasonPanel` akan memaksakan field teks yang tidak diinginkan pada
  mayoritas titik panggilan.
- **Satu `<dialog>` bersama untuk konfirmasi maupun alasan**, men-toggle
  visibilitas textarea. Ditolak: `role="alertdialog"` (interupsi ya/tidak)
  dan mesin field-wajib/counter/max-length milik panel alasan sendiri adalah
  kontrak yang cukup berbeda sehingga menggabungkannya akan membuat
  keduanya lebih sulit dinalar demi penghematan markup yang marjinal.
