---
name: awcms-audit-log
description: Write audit logs for AWCMS high-risk actions with redaction. Use on login, access assignment, profile merge, price change, transaction posted/cancel/return, stock adjustment, warehouse transfer, Coretax export, sync conflict resolution, AI tool call, and security readiness decision. Per doc 03 & 10.
---

🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](SKILL.id.md)

# AWCMS — Audit Log (High-Risk)

Follow `docs/awcms/03_srs_detail_per_modul.md` and `docs/awcms/10_template_kode_coding_standard.md`.

## Input shape

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
  attributes?: Record<string, unknown>; // MUST already be redacted
  correlationId?: string;
};
```

## Actions that MUST be audited

Login failed/success · access assignment · profile merge · product price change · soft delete/restore/purge · transaction posted/cancel/return · stock adjustment · warehouse transfer · Coretax export · sync conflict resolution · AI tool call · security readiness decision · workflow task decision/reassign/retire/revoke (`src/pages/api/v1/workflows/tasks/[id]/decisions.ts:197`) · document void/reclassify (`document-infrastructure/application/document-directory.ts:354,672`) · data-exchange export/import commit — not just Coretax, every export/import job (`export-execute-job.ts:197`, `import-commit-job.ts:220`) · legal hold create/release (`data-lifecycle/application/legal-hold-service.ts:130,200`).

## Rules

1. Audit is **tenant-scoped** (`tenant_id`), written to `awcms_audit_events`.
2. **Redact first** — never put into attributes: password, token, API key, `authorization`, full NPWP/NIK, full phone/WhatsApp/email, receipt token.
3. Audit **complements**, it does not replace, domain events & structured logs.
4. Include the `correlationId` for tracing.
5. For high-risk denials, coordinate with the decision log (`awcms-abac-guard`).
6. Soft delete/restore/purge must include a reason and must not carry raw PII in attributes.

## Redaction keys

`password`, `passwordHash`, `token`, `accessToken`, `refreshToken`, `apiKey`, `secret`, `credential`, `authorization`, `npwp`, `nik`, `phone`, `whatsapp`, `email`, `cookie` (Issue #687), plus an exact-match allowlist for IP address keys (`ip`, `ipAddress`, `clientIp`, `remoteAddr`, `x-forwarded-for`, etc — deliberately NOT a substring like the other keys above, see `src/modules/_shared/redaction.ts` for why: the substring `"ip"` would also redact `description`/`shipping`/`recipient`).

## Verification

- A high-risk action produces exactly one audit event.
- Soft delete, restore, and purge each produce a separate audit event.
- No raw secret/PII in the attributes column.
- Audit retention: 1–5 years as needed — a real purge mechanism (`purgeExpiredAuditEvents`, default 730 days, `bun run logs:audit:purge`) has existed since Issue #447, DO NOT build a new purge mechanism for `awcms_audit_events`, see `awcms-observability`.

## console.error/console.warn with a raw exception — FORBIDDEN (Issue #687)

`redactSensitiveAttributes` above only works on object KEYS — an exception
message (`.message`/`.stack`, including the `.cause` chain) is free text
without keys, and may well contain a secret (connection string, token) that
escapes key-based redaction. **Never** write a raw
`console.error(label, error)` or
`error instanceof Error ? error.message : String(error)` and then print it
directly in `src/pages/admin/**`, `src/pages/api/v1/**`, or `scripts/*.ts`
— use `logAdminPageError`/`logScriptFailure`
(`src/lib/logging/error-log.ts`, built on top of `sanitizeErrorForLog`/
`safeErrorDetail` in `src/lib/logging/error-sanitizer.ts`, both of which call
the new `redactSecretsInText`). The `bun run logging:lint:check` gate
(`scripts/logging-lint-check.ts`, part of `bun run check`) rejects this old
pattern automatically — see doc 20 §Standar tambahan Issue #687 for the full
details and operator-safe troubleshooting guidance.

## Correlation ID & extension point

Since Issue #447: the `correlationId` on `AuditEventInput` just needs to be filled from `context.locals.correlationId` (do not generate a new UUID yourself); and every successful `recordAuditEvent` automatically calls the `AuditExportHook` extension point if one is installed (no-op by default) — see `awcms-observability` for the full rules before installing/implementing a consumer at that point.
