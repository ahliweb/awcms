---
name: awcms-form-drafts
description: Modul form_drafts SUDAH di-port ke repo ini (dari awcms-micro Issue #484; migrasi `sql/062` schema + `sql/063` permission, Gelombang-1 baris 1 `docs/awcms/absorb-awcms-micro-roadmap.md`). Draft store server-side generik & domain-agnostic untuk form multi-langkah — `type: system`, deps `[identity_access]`, tabel `awcms_form_drafts` (ENABLE+FORCE RLS), endpoint `/api/v1/form-drafts/*`, job retensi dua fase `bun run form-drafts:purge` dengan gerbang legal-hold. Gunakan saat menambah/mengubah penyimpanan progres form, aturan payload, atau retensi draft. CATATAN: pustaka KOMPONEN wizard (`WizardStepper`/`wizard-client.ts`) BELUM ADA di sini (baris Gelombang-0 `src/components/ui/` masih terbuka sebagai kebutuhan, bukan antrean port) — skill `awcms-wizard-form` tetap BACAAN SAJA.
---

🇮🇩 Bahasa Indonesia · 🇬🇧 [English (source)](SKILL.md)

<!-- i18n-source-hash: sha256:b5f771995cc6496e725220848fd288fcb4e53a6c5f52afcc304ccf9eeed9ae1b -->

# AWCMS — Server-Side Form Draft Persistence

Ikuti `src/modules/form-drafts/README.md`. Modul ini **ada dan bisa dipanggil**
di repo ini — diport dari awcms-micro Issue #484.

> **Yang TIDAK ikut di-port** (jangan klaim ada, sudah diverifikasi tidak ada):
>
> - Pustaka komponen wizard `src/components/ui/` (`WizardStepper`,
>   `WizardPanel`, `WizardActions`, `wizard-client.ts`) — baris Gelombang-0
>   yang masih terbuka. Skill `awcms-wizard-form` masih BACAAN SAJA.
> - `docs/awcms/examples/wizard-form-pattern.md` — tidak ada di repo ini.
> - `awcms-micro:src/pages/admin/examples/wizard.astro` (pilot micro) — tidak ada di repo
>   ini; `src/pages/admin/examples/` sendiri tidak ada.
>
> Store ini tetap berguna tanpa ketiganya: yang dipanggil sebuah wizard adalah
> API-nya, bukan sebaliknya.

## Kapan pakai server-side draft

Hanya bila user perlu resume lintas sesi/tab/perangkat, atau ada kebutuhan
audit atas progres form. Form pendek yang selesai sekali duduk cukup state
in-memory di klien — jangan tambah round-trip jaringan tanpa alasan itu.

## API

`GET/POST /api/v1/form-drafts`, `GET/PATCH/DELETE /api/v1/form-drafts/{id}`,
`POST /api/v1/form-drafts/{id}/submit`. Guard
`form_drafts.draft.{read,create,update,delete}` — generik, tidak per
`moduleKey` pembuat draft (RLS sudah mengisolasi tenant).

**Tidak ada action `submit`.** Submit menjaga `draft.update`. Menambah action
`submit` berarti melebarkan union `AccessAction` **dan** menanam
latent-authz trap: action yang tak pernah di-seed ke role akan men-deny
bahkan owner, sementara kodenya terlihat benar saat review.

## Aturan wajib

1. **`moduleKey`/`wizardKey`/`resourceType` milik modul Anda sendiri** —
   lowercase snake_case (`^[a-z][a-z0-9_]{1,63}$`). Pola ini di-CHECK di
   `sql/062` **dan** di `domain/form-draft-validation.ts`; ubah keduanya
   bersama (`tests/form-drafts-module.test.ts` menjaga kesamaannya).
2. **Payload tidak boleh berisi field menyerupai secret**
   (`password`/`token`/`secret`/`credential`/`api[_-]?key`/`private[_-]?key`,
   dicek rekursif termasuk di dalam array) — **DITOLAK 400, bukan
   di-redact diam-diam**. Alasannya penting: kalau di-strip diam-diam,
   pemanggil dapat 200 dan tak bisa membedakan field yang dibuang dari yang
   tersimpan. Jangan simpan data sensitif di draft sama sekali.
3. **Payload maksimum 32KB serialized** (`MAX_PAYLOAD_BYTES`) — scratch state,
   bukan penyimpan dokumen/lampiran.
4. **Create/update/delete TIDAK butuh `Idempotency-Key`; submit WAJIB.**
   Retry create = satu baris scratch bernilai rendah yang bisa dihapus;
   delete idempotent secara struktural (`deleted_at IS NULL`). Retry submit =
   menyerahkan payload ke aksi domain dua kali. Asimetri ini disengaja —
   mewajibkan key di mana-mana melatih pemanggil membuat key asal-asalan,
   yang justru melemahkan jaminan di tempat yang penting.
5. **Hanya `status = 'draft'` yang editable** — submitted/abandoned/expired
   membalas `404` dari PATCH (tidak membedakan "state salah" dari "tidak
   ada").
6. **Resume-on-load lewat application layer langsung dari SSR**
   (`listFormDrafts(tx, tenantId, { moduleKey, wizardKey, status: "draft" })`),
   bukan round-trip HTTP ke endpoint sendiri.

## Retensi dua fase + legal hold (jangan diubah tanpa membaca ini)

`bun run form-drafts:purge` (harian, cron/systemd/CronJob — bukan lewat HTTP):

1. `expireOverdueFormDrafts` — `draft` lewat `expires_at` → `status='expired'`.
   **Transisi, bukan delete**; baris masih ada untuk audit/debug.
2. `purgeExpiredFormDrafts` — DELETE fisik baris `expired`/`abandoned` yang
   lebih tua dari cutoff retensi (default 30 hari; `--retention-days=<n>`,
   lalu env `FORM_DRAFT_RETENTION_DAYS`).

**Titik enforcement legal hold ada di fase 2 di modul ini, BUKAN di mesin
`data_lifecycle`.** Descriptor modul ini `executionMode: "delegated"` — planner
`data_lifecycle` hanya MEMBACA tabel ini untuk visibilitas backlog dan tidak
pernah memutasinya, jadi hold yang ditegakkan hanya di mesin itu tidak
menghentikan apa pun. Fase 2 menanyai `LegalHoldGuardPort`
(`_shared/ports/legal-hold-guard-port.ts`, di-inject di composition root
`scripts/form-draft-purge.ts`) sebelum DELETE dan melewatkan seluruh batch bila
descriptor ditahan. **Fase 1 sengaja TIDAK digerbangi** — ia tak menghapus apa
pun, jadi tak memikul risiko kehilangan permanen yang jadi alasan legal hold
ada.

`FORM_DRAFTS_LIFECYCLE_KEY` di-export `module.ts` dan **di-import** oleh purge —
jangan menulis ulang literalnya. Kalau kunci descriptor dan kunci yang dicek
purge berbeda, hold **fail OPEN**: purge tak menemukan hold dan tetap menghapus,
tanpa error dan tanpa log.

## Verifikasi

- `tests/form-draft-validation.test.ts` — denylist, format key, ukuran payload.
- `tests/form-drafts-module.test.ts` — drift guard tiga-arah (descriptor
  `module.ts` ↔ seed `sql/063` ↔ guard route), kunci lifecycle di-pin sebagai
  literal, FORCE RLS, dan grant `awcms_worker` minimal (SELECT/UPDATE/DELETE,
  **tanpa INSERT**). Ketiga kelas mutasi ini sudah dibuktikan MERAH.
- **Belum ada** `tests/integration/form-drafts.integration.test.ts` di repo ini.
  Jangan mengklaim CRUD/RLS/idempotency sudah diuji end-to-end terhadap
  Postgres nyata — itu celah yang masih terbuka.

## Skill terkait

`awcms-idempotency` (submit), `awcms-abac-guard`, `awcms-data-lifecycle`
(descriptor/legal hold), `awcms-new-migration`, `awcms-wizard-form`
(BACAAN SAJA — komponen belum ada).
