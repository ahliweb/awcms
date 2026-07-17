---
name: awcms-email
description: Kirim email transaksional (password reset, announcement, workflow notification) via modul email reusable AWCMS — provider-neutral (Mailketing adapter), template management, dan dispatcher outbox. Gunakan saat modul domain turunan perlu mengirim email, atau saat menambah kategori/template baru.
---

# AWCMS — Email Module

Ikuti `src/modules/email/README.md` (arsitektur lengkap: kontrak provider, adapter Mailketing, dispatcher, template management, i18n). Modul ini generik — analog `sync_storage`'s object storage: Mailketing adalah _satu_ adapter, bukan alasan modul jadi domain-spesifik (lihat README §Relationship to historical issue #390).

## Cara pakai (untuk modul domain turunan yang ingin kirim email)

1. **Pastikan template ada** untuk kategori Anda — kategori base (6 fixed:
   `auth.password_reset`, `system.announcement`, `system.security_notice`,
   `system.maintenance`, `workflow.task_assigned`,
   `workflow.decision_required`) sudah punya allowlist variabel bawaan
   (`domain/email-template-categories.ts`'s `BASE_EMAIL_TEMPLATE_CATEGORIES`).
   Kategori sendiri harus `derived.*` dan didaftarkan dulu:
   ```ts
   registerDerivedEmailTemplateCategory("derived.order_confirmation", [
     "orderNumber",
     "total",
     "trackingUrl"
   ]);
   ```
   Kategori yang tidak dikenal ditolak saat create template (fail-closed) —
   **jangan** coba pakai kategori base yang sudah ada untuk kebutuhan lain,
   daftar kategori `derived.*` baru sendiri.
2. **Buat/pastikan template** via `POST /api/v1/email/templates`
   (`{templateKey, name, subjectTemplate: {en, id?}, textBodyTemplate?, htmlBodyTemplate?}`)
   atau `seedDefaultEmailTemplates` untuk kategori base bawaan
   (`bun run email:templates:seed-defaults -- --tenant=<id> --actor=<tenantUserId>`).
3. **Enqueue** — dua opsi:
   - **Bulk/announcement ke user/role/tenant** — pakai
     `POST /api/v1/email/announcements` (Issue #497) alih-alih menulis
     manual: sudah menangani targeting (`{type: "users"|"role"|"tenant"}`),
     filter suppression list, ABAC dua-tingkat, `Idempotency-Key` wajib,
     dan audit satu baris per request. `POST .../preview` untuk dry-run
     (jumlah + sampel render, tidak pernah daftar penerima nyata).
   - **Kasus lain (mis. modul domain turunan sendiri)** — INSERT langsung
     ke `awcms_email_messages` (`sql/014`) di dalam transaksi bisnis
     Anda sendiri (ADR-0006: pemanggilan provider **tidak boleh** di dalam
     transaction — outbox pattern yang memisahkan ini). Isi
     `to_address`/`to_address_hash`/`to_address_masked` pakai
     `normalizeIdentifier("email", ...)`/`hashIdentifier`/`maskIdentifier`
     (`profile-identity/domain/identifier.ts` — reuse, jangan bikin ulang),
     `template_key` = kategori Anda, `variables` (jsonb) = hanya nilai yang
     akan lolos allowlist kategori itu (nilai lain diam-diam tidak pernah
     disubstitusi saat render), `subject` = subjek final
     (dirender/ditentukan saat enqueue, bukan saat dispatch).
4. **Dispatcher** (`bun run email:dispatch`, dijadwalkan cron/systemd
   timer/k8s CronJob) yang mengirim sungguhan — Anda tidak pernah memanggil
   provider langsung.

## Aturan wajib

- **Jangan** simpan raw secret/token jangka panjang di `variables` — token
  reset password sendiri di-hash saat disimpan di tabel auth-nya (Issue
  #496), bukan disimpan mentah di outbox.
- **Jangan** buat adapter provider baru di luar `EmailProvider` port
  (`domain/email-provider-contract.ts`) — provider baru (bila benar-benar
  dibutuhkan) mengimplementasikan port yang sama, di-resolve lewat
  `infrastructure/email-provider-resolver.ts`, tidak pernah di-import by
  name di kode pemanggil.
- **Jangan** panggil provider (Mailketing) di dalam DB transaction —
  selalu lewat outbox + dispatcher terpisah.
- Body template **tidak** disimpan rendered — dispatcher me-render dari
  `template_key`+`variables` saat kirim; jangan menambah kolom
  `rendered_html_body`/`rendered_text_body` ke `email_messages`.
- Preview (`POST /api/v1/email/templates/{id}/preview`) hanya untuk admin
  melihat hasil render dengan data sampel sintetis — jangan pernah kirim
  alamat penerima nyata ke endpoint ini, dan endpoint ini sendiri **tidak**
  menyentuh `email_messages`/antrean.

## Observability & ops (Issue #499)

- **Antrean gagal/tertunda**: `GET /api/v1/email/messages?status=failed|retry_wait`
  (permission `email.message.read`) — diagnostik admin, `to_address_masked`
  saja, tidak pernah alamat mentah.
- **Batalkan pesan yang belum terkirim**: `POST /api/v1/email/messages/{id}/cancel`
  (permission `email.message.cancel`, diseed `sql/014`) — hanya
  `queued`/`retry_wait` yang bisa dibatalkan; mitigasi teknis untuk
  insiden "accidental bulk send".
- **Kesehatan antrean**: `GET /api/v1/reports/email-health` — hitungan
  queued/retry_wait/failed/suppressed + `isHealthy`.
- **Suppression list manual**: `GET/POST /api/v1/email/suppressions`,
  `DELETE /api/v1/email/suppressions/{id}` (permission
  `email.suppression.{read,create,delete}`, diseed `sql/014`,
  endpoint-nya baru ada di Issue #499). Dispatcher juga re-check
  suppression list tepat sebelum kirim (bukan hanya saat enqueue) —
  penerima yang baru disuppress setelah enqueue tetap dikecualikan.
- **Provider outage**: circuit breaker (`email-mailketing`) membuka
  otomatis setelah 5 kegagalan beruntun, dispatcher berhenti meng-claim
  (`email.dispatch.breaker_open` log) — tidak perlu intervensi manual.
  `bun run security:readiness` memblokir go-live (critical) bila
  `EMAIL_ENABLED=true` tapi config provider tidak lengkap
  (`checkEmailProviderConfigReady`, reuse `validate-env.ts`'s
  `checkEmailConfig`).
- Runbook insiden lengkap (provider outage, rotasi kredensial, accidental
  bulk send): `src/modules/email/README.md` §Incident response.

## Verifikasi

- Kirim dengan `EMAIL_PROVIDER=log` dulu (tanpa kredensial Mailketing) —
  lihat log `email.log_provider.send` (alamat ter-mask) untuk konfirmasi
  alur end-to-end sebelum menyalakan Mailketing nyata.
- `bun run email:provider:health` — cek konektivitas Mailketing nyata
  (live network call, jalankan manual/smoke-test, bukan bagian CI).
- `bun test tests/integration/email-*.integration.test.ts` terhadap
  Postgres nyata untuk regresi schema/dispatcher/template.

## Skill terkait

`awcms-integration` (pola outbox/retry/circuit-breaker generik),
`awcms-sensitive-data` (normalize/hash/mask alamat email),
`awcms-idempotency` (`POST /email/announcements` mewajibkan
`Idempotency-Key` di setiap request, bukan hanya bulk), `awcms-abac-guard`
(permission `email.template.*`/`email.notification.create`/
`email.announcement.create`/`email.message.{read,cancel}`/
`email.suppression.{read,create,delete}` sudah diseed — `announcement.create`
**selalu tambahan** di atas `notification.create` untuk target role/tenant,
contoh nyata pola "permission bertingkat untuk aksi bulk vs tunggal"),
`awcms-observability` (`security:readiness` gate, structured log per
tahap dispatch, `GET /reports/email-health`).
