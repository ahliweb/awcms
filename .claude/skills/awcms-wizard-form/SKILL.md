---
name: awcms-wizard-form
description: Bangun form multi-step di modul domain memakai reusable wizard pattern AWCMS. Gunakan saat input data panjang/bertahap butuh lebih dari satu layar (identitas, detail, lampiran, review) sebelum submit final. Sesuai docs/awcms/examples/wizard-form-pattern.md.
---

# AWCMS — Reusable Wizard Form

Ikuti `docs/awcms/examples/wizard-form-pattern.md` (spesifikasi
komponen + pola i18n) dan
`docs/awcms/examples/wizard-derived-module-example.md` (contoh
end-to-end pada modul domain). Fixture yang bisa langsung dijalankan:
`src/pages/admin/examples/wizard.astro` (`/admin/examples/wizard`).

## Kapan pakai wizard, bukan form biasa

Salah satu: banyak field lintas kategori, urutan input jelas dibutuhkan,
perlu review akhir sebelum submit, atau field-nya cukup banyak sehingga
satu form besar rawan salah input. Tetap pakai form biasa untuk input
sederhana (ganti nama, ubah status, satu-dua field).

## Komponen

`src/components/ui/WizardStepper.astro` (progress + status step) +
`WizardPanel.astro` (satu step, `hidden` untuk step tidak aktif — bukan
di-unmount, supaya input tidak hilang) + `WizardActions.astro`
(Back/Next/Submit/Save-draft) + `src/lib/ui/wizard-client.ts` (state
murni: `createWizardState`, `advanceWizard`, `rewindWizard`,
`toFieldErrorMap`, `mapValidationDetailsToFieldErrors`,
`createWizardIdempotencyKey`).

## Aturan wajib

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
4. **Anti-double-submit** — pakai `lockElement`/`submitJson`/`showBanner`
   yang sudah ada (`src/lib/ui/admin-form-client.ts`), jangan duplikasi.
5. **Fokus berpindah ke judul panel** setiap step berubah (`tabindex="-1"`
   sesaat lalu `.focus()`) — lihat `focusPanelHeading()` di fixture.
6. **Stepper butuh `data-step-key`** pada tiap item bila halaman
   memperbarui state stepper via JS setelah render awal (SSR-only, tidak
   reaktif sendiri).
7. **Draft client-side hanya data non-sensitif**, dan tidak persisten
   (tidak ada `localStorage`). Butuh resume lintas sesi/perangkat, atau
   payload mengandung apa pun yang lebih dari UX scratch state? Pakai
   server-side draft persistence — skill `awcms-form-drafts`
   (tersedia sejak Issue #484, `/api/v1/form-drafts`).

## Verifikasi

Regression guard atribut aksesibilitas: `tests/wizard-accessibility.test.ts`.
Test state helper: `tests/wizard-client.test.ts`. Walkthrough
keyboard-only manual: `wizard-form-pattern.md` §Walkthrough manual
keyboard-only.

## Skill terkait

`awcms-ui-screen` (pola layar/token/a11y umum), `awcms-i18n`
(katalog `.po`), `awcms-idempotency` (submit final high-risk),
`awcms-new-endpoint` (endpoint domain target submit),
`awcms-form-drafts` (resume-on-load lintas sesi via server).
