---
name: awcms-audit-log
description: Tulis audit log untuk aksi high-risk AWCMS dengan redaction. Gunakan pada login, access assignment, profile merge, price change, transaction posted/cancel/return, stock adjustment, warehouse transfer, Coretax export, sync conflict resolution, AI tool call, dan security readiness decision. Sesuai doc 03 & 10.
---

# AWCMS — Audit Log (High-Risk)

Ikuti `docs/awcms/03_srs_detail_per_modul.md` dan `docs/awcms/10_template_kode_coding_standard.md`.

## Bentuk input

```ts
type AuditEventInput = {
  tenantId: string;
  actorTenantUserId?: string;
  moduleKey: string;
  action: string;
  resourceType: string;
  resourceId?: string;
  severity?: "info" | "warning" | "critical";
  message: string;
  attributes?: Record<string, unknown>; // WAJIB sudah diredaksi
  correlationId?: string;
};
```

## Aksi yang WAJIB diaudit

Login failed/success · access assignment · profile merge · product price change · soft delete/restore/purge · transaction posted/cancel/return · stock adjustment · warehouse transfer · Coretax export · sync conflict resolution · AI tool call · security readiness decision · workflow task decision/reassign/retire/revoke (`src/pages/api/v1/workflows/tasks/[id]/decisions.ts:197`) · document void/reclassify (`document-infrastructure/application/document-directory.ts:354,672`) · data-exchange export/import commit — bukan cuma Coretax, semua export/import job (`export-execute-job.ts:197`, `import-commit-job.ts:220`) · legal hold create/release (`data-lifecycle/application/legal-hold-service.ts:130,200`).

## Aturan

1. Audit **tenant-scoped** (`tenant_id`), tulis ke `awcms_audit_events`.
2. **Redaksi dulu** attributes — jangan pernah masukkan: password, token, API key, `authorization`, NPWP/NIK penuh, phone/WhatsApp/email penuh, receipt token.
3. Audit **melengkapi**, bukan menggantikan, domain event & structured log.
4. Sertakan `correlationId` untuk trace.
5. Untuk denial high-risk, koordinasikan dengan decision log (`awcms-abac-guard`).
6. Soft delete/restore/purge wajib menyertakan reason dan tidak boleh membawa PII mentah di attributes.

## Redaction keys

`password`, `passwordHash`, `token`, `accessToken`, `refreshToken`, `apiKey`, `secret`, `credential`, `authorization`, `npwp`, `nik`, `phone`, `whatsapp`, `email`, `cookie` (Issue #687), plus allowlist exact-match untuk key IP address (`ip`, `ipAddress`, `clientIp`, `remoteAddr`, `x-forwarded-for`, dst — sengaja BUKAN substring seperti key lain di atas, lihat `src/modules/_shared/redaction.ts` untuk kenapa: substring `"ip"` akan ikut meredaksi `description`/`shipping`/`recipient`).

## Verifikasi

- Aksi high-risk menghasilkan satu audit event.
- Soft delete, restore, dan purge menghasilkan audit event terpisah.
- Tidak ada secret/PII mentah di kolom attributes.
- Retention audit: 1–5 tahun sesuai kebutuhan — mekanisme purge nyata (`purgeExpiredAuditEvents`, default 730 hari, `bun run logs:audit:purge`) sudah tersedia sejak Issue #447, JANGAN buat mekanisme purge baru untuk `awcms_audit_events`, lihat `awcms-observability`.

## console.error/console.warn dengan raw exception — DILARANG (Issue #687)

`redactSensitiveAttributes` di atas hanya bekerja pada KEY objek — pesan
exception (`.message`/`.stack`, termasuk rantai `.cause`) adalah teks bebas
tanpa key, dan bisa saja mengandung secret (connection string, token) yang
lolos dari redaksi berbasis key. **Jangan** pernah menulis
`console.error(label, error)` mentah atau
`error instanceof Error ? error.message : String(error)` lalu mencetaknya
langsung di `src/pages/admin/**`, `src/pages/api/v1/**`, atau `scripts/*.ts`
— pakai `logAdminPageError`/`logScriptFailure`
(`src/lib/logging/error-log.ts`, dibangun di atas `sanitizeErrorForLog`/
`safeErrorDetail` di `src/lib/logging/error-sanitizer.ts`, yang keduanya
memanggil `redactSecretsInText` baru). Gate `bun run logging:lint:check`
(`scripts/logging-lint-check.ts`, bagian dari `bun run check`) menolak pola
lama ini secara otomatis — lihat doc 20 §Standar tambahan Issue #687 untuk
detail lengkap dan panduan troubleshooting operator-safe.

## Correlation ID & extension point

Sejak Issue #447: `correlationId` pada `AuditEventInput` cukup diisi dari `context.locals.correlationId` (jangan generate UUID baru sendiri); dan setiap `recordAuditEvent` sukses otomatis memanggil extension point `AuditExportHook` bila terpasang (default no-op) — lihat `awcms-observability` untuk aturan lengkap sebelum memasang/mengimplementasikan consumer di titik itu.
