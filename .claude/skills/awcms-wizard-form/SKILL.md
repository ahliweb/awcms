---
name: awcms-wizard-form
description: BACAAN SAJA — reusable wizard-form component library (WizardStepper/WizardPanel/WizardActions, `wizard-client.ts`) BELUM di-port ke repo ini (ada di awcms-mini; `find src -iname "*wizard*"` tidak menemukan apa pun di sini, `src/components/ui` bahkan tidak ada). Jangan disamakan dengan "Setup Wizard" (`/setup`, onboarding tenant pertama) yang memang ada di repo ini tapi merupakan fitur berbeda. Pakai skill ini sebagai spesifikasi target saat MEM-PORT (via `awcms-port-from-mini`) form multi-step, bukan panduan implementasi kode yang bisa dipanggil hari ini — verifikasi dulu.
---

# AWCMS — Reusable Wizard Form (belum di-port)

> **STATUS — BACAAN SAJA: pola/komponen wizard form multi-step ini BELUM
> ada di repo ini.** Seluruh komponen (`src/components/ui/WizardStepper.astro`,
> `WizardPanel.astro`, `WizardActions.astro`), state helper
> (`src/lib/ui/wizard-client.ts`), dokumen
> (`docs/awcms/examples/wizard-form-pattern.md`,
> `wizard-derived-module-example.md`), fixture
> (`src/pages/admin/examples/wizard.astro`), dan test
> (`tests/wizard-accessibility.test.ts`, `tests/wizard-client.test.ts`) yang
> dirujuk di bawah adalah artefak **awcms-mini** — repo ini bahkan tidak
> punya `src/components/ui` sama sekali (verifikasi:
> `find src -iname "*wizard*"` kosong, `find src/components -type d` gagal
> "No such file or directory"). **Jangan disamakan dengan "Setup Wizard"**
> (`/setup`, onboarding owner+tenant pertama kali — lihat
> `src/modules/tenant-admin/README.md` §Setup wizard, skill
> `awcms-tenant-admin`) — itu fitur berbeda yang memang ada di repo ini.
> Pakai skill ini sebagai spesifikasi target port (via
> `awcms-port-from-mini`), bukan peta kode yang bisa dipanggil — verifikasi
> `find src -iname "*wizard*"` sebelum mengklaim apa pun ada di sini.

Spesifikasi asal (di repo **awcms-mini**, belum di-port):
`docs/awcms-mini/examples/wizard-form-pattern.md` (spesifikasi komponen +
pola i18n) dan `docs/awcms-mini/examples/wizard-derived-module-example.md`
(contoh end-to-end pada modul domain). Fixture rujukan di awcms-mini:
`src/pages/admin/examples/wizard.astro` (`/admin/examples/wizard`).

## Kapan pakai wizard, bukan form biasa (spesifikasi target)

Salah satu: banyak field lintas kategori, urutan input jelas dibutuhkan,
perlu review akhir sebelum submit, atau field-nya cukup banyak sehingga
satu form besar rawan salah input. Tetap pakai form biasa untuk input
sederhana (ganti nama, ubah status, satu-dua field) — form biasa di repo
ini sendiri memakai hand-rolled markup + `lockElement`/`sendJson`/`postJson`
(`src/lib/ui/admin-form-client.ts`, lihat skill `awcms-ui-screen`), bukan
komponen wizard apa pun.

## Komponen (spesifikasi target — ada di awcms-mini, BELUM di sini)

`src/components/ui/WizardStepper.astro` (progress + status step) +
`WizardPanel.astro` (satu step, `hidden` untuk step tidak aktif — bukan
di-unmount, supaya input tidak hilang) + `WizardActions.astro`
(Back/Next/Submit/Save-draft) + `src/lib/ui/wizard-client.ts` (state
murni: `createWizardState`, `advanceWizard`, `rewindWizard`,
`toFieldErrorMap`, `mapValidationDetailsToFieldErrors`,
`createWizardIdempotencyKey`) — **semuanya hanya ada di awcms-mini**.
Kalau membangun wizard di repo ini sebelum port selesai, ini adalah
spesifikasi untuk di-port, bukan sesuatu yang bisa langsung diimpor.

## Aturan wajib (spesifikasi porting — pertahankan keputusan ini saat port)

1. **Semua string via prop** — komponen wizard tidak pernah menerjemahkan
   sendiri; halaman pemanggil wajib `createTranslator(locale)` lalu isi
   tiap prop label (`label`/`currentLabel`/`completedLabel`/`pendingLabel`
   di `WizardStepper`, `errorSummaryHeading` di `WizardPanel`,
   `backLabel`/`nextLabel`/`submitLabel` di `WizardActions`) — skill
   `awcms-i18n`.
2. **Validasi client hanya UX** — server tetap sumber kebenaran; peta
   `VALIDATION_ERROR.details` balik ke field via
   `mapValidationDetailsToFieldErrors`, jangan validasi ulang terpisah.
3. **Submit final high-risk** — `createWizardIdempotencyKey()` sekali per
   attempt submit (bukan per klik tombol) — skill `awcms-idempotency`.
4. **Anti-double-submit** — di awcms-mini pakai `lockElement`/`submitJson`/
   `showBanner` (`src/lib/ui/admin-form-client.ts` versi awcms-mini, yang
   punya export lebih banyak daripada versi repo ini). **Repo ini sendiri
   hari ini hanya punya `lockElement`/`sendJson`/`postJson`** (verifikasi:
   `grep -n "^export" src/lib/ui/admin-form-client.ts`) — kalau port
   dikerjakan sebelum fungsi tambahan itu ikut di-port, adaptasi ke tiga
   fungsi yang ada, jangan asumsikan `submitJson`/`showBanner` sudah ada di
   sini.
5. **Fokus berpindah ke judul panel** setiap step berubah (`tabindex="-1"`
   sesaat lalu `.focus()`) — lihat `focusPanelHeading()` di fixture
   awcms-mini.
6. **Stepper butuh `data-step-key`** pada tiap item bila halaman
   memperbarui state stepper via JS setelah render awal (SSR-only, tidak
   reaktif sendiri).
7. **Draft client-side hanya data non-sensitif**, dan tidak persisten
   (tidak ada `localStorage`). Butuh resume lintas sesi/perangkat, atau
   payload mengandung apa pun yang lebih dari UX scratch state? Pola
   target adalah server-side draft persistence — skill `awcms-form-drafts`
   (juga BACAAN SAJA, modul `form_drafts` belum di-port — verifikasi
   sendiri sebelum mengklaim endpointnya ada).

## Verifikasi (ada di awcms-mini — belum ada padanannya di repo ini)

Regression guard atribut aksesibilitas: `tests/wizard-accessibility.test.ts`.
Test state helper: `tests/wizard-client.test.ts`. Walkthrough
keyboard-only manual: `wizard-form-pattern.md` §Walkthrough manual
keyboard-only. Saat port ke repo ini, port juga kedua test ini beserta
implementasinya sebelum menganggap port selesai.

## Skill terkait

`awcms-port-from-mini` (alur port modul/fitur dari awcms-mini),
`awcms-ui-screen` (pola layar/token/a11y/markup nyata yang ADA di repo
ini hari ini), `awcms-i18n` (katalog `.po`), `awcms-idempotency` (submit
final high-risk), `awcms-new-endpoint` (endpoint domain target submit),
`awcms-form-drafts` (resume-on-load lintas sesi via server — juga BACAAN
SAJA), `awcms-tenant-admin` (Setup Wizard yang berbeda dan memang ada di
repo ini).
