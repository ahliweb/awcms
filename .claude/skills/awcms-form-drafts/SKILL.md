---
name: awcms-form-drafts
description: Simpan progress form/wizard di server (resume lintas sesi/perangkat) memakai API generik form-drafts AWCMS. Gunakan saat wizard-client.ts's in-memory state saja tidak cukup — user perlu melanjutkan draft setelah menutup tab, ganti perangkat, atau payload draft mengandung lebih dari UX scratch state murni. Sesuai src/modules/form-drafts/README.md.
---

# AWCMS — Server-Side Form Draft Persistence

Ikuti `src/modules/form-drafts/README.md` (modul) dan
`docs/awcms/examples/wizard-form-pattern.md` §Server-side draft
(kapan ini vs client-only state). Contoh pemakaian nyata:
`src/pages/admin/examples/wizard.astro` (pilot, Issue #484).

## Kapan pakai ini vs client-only `wizard-client.ts` state

Server-side draft **hanya** bila: user perlu resume lintas sesi/tab/
perangkat, atau ada kebutuhan audit/observability atas progress form
(bukan sekadar UX). Jangan default ke ini untuk setiap wizard — form
pendek yang selesai dalam satu duduk cukup pakai state in-memory
`wizard-client.ts` (skill `awcms-wizard-form`) tanpa network round-trip
tambahan.

## API

`GET/POST /api/v1/form-drafts`, `GET/PATCH/DELETE /api/v1/form-drafts/{id}`,
`POST /api/v1/form-drafts/{id}/submit`. Guard
`form_drafts.draft.{read,create,update,delete}` — permission generik,
tidak per `moduleKey` pembuat draft (RLS sudah isolasi tenant).

## Aturan wajib

1. **`moduleKey`/`wizardKey`/`resourceType` milik modul Anda sendiri** —
   format lowercase snake_case (`^[a-z][a-z0-9_]{1,63}$`), unik per
   modul/wizard supaya query resume-on-load (`?moduleKey=&wizardKey=`)
   tidak bentrok dengan modul lain.
2. **Payload tidak boleh berisi field yang menyerupai secret**
   (`password`/`token`/`secret`/`credential`/`apiKey`/`privateKey`,
   dicek rekursif) — ditolak `400 VALIDATION_ERROR`, bukan direduksi
   diam-diam. Jangan simpan data sensitif di draft sama sekali, bukan
   hanya menghindari nama field yang jelas menyerupai secret.
3. **Payload maksimum 32KB serialized** (`MAX_PAYLOAD_BYTES`) — draft
   adalah scratch state form, bukan penyimpan dokumen/lampiran.
4. **Create/update/delete TIDAK butuh `Idempotency-Key`** — create
   worst-case menghasilkan draft duplikat berisiko rendah, update/delete
   idempotent secara struktural. **Submit WAJIB `Idempotency-Key`** —
   transisi status yang berarti, sama seperti mutation high-risk lain
   (skill `awcms-idempotency`).
5. **Hanya draft `status = 'draft'` yang editable** — submitted/
   abandoned/expired mengembalikan `404` dari PATCH, bukan mengizinkan
   edit riwayat.
6. **Resume-on-load lewat application layer langsung dari SSR**
   (`listFormDrafts(tx, tenantId, {moduleKey, wizardKey, status: "draft"})`),
   bukan round-trip HTTP ke endpoint sendiri — pola sama seperti
   `admin/index.astro`'s dashboard reports.
7. **Retensi** — jadwalkan `bun run form-drafts:purge` (cron/systemd
   timer/k8s CronJob, tidak lewat HTTP) untuk expire draft overdue lalu
   purge draft expired/abandoned lama. Default retention 30 hari,
   override `--retention-days=<n>` atau env `FORM_DRAFT_RETENTION_DAYS`.

## Verifikasi

`tests/form-draft-validation.test.ts` (denylist, format, ukuran payload).
`tests/integration/form-drafts.integration.test.ts` (CRUD+submit
end-to-end, RLS tenant isolation, ABAC default-deny, submit idempotency,
retention/expiry) — jalankan terhadap Postgres nyata sebelum PR yang
menyentuh modul ini dianggap selesai.

## Skill terkait

`awcms-wizard-form` (komponen UI wizard yang biasanya memakai ini),
`awcms-idempotency` (submit), `awcms-abac-guard`,
`awcms-observability` (pola retensi/purge terjadwal yang sama).
