---
name: awcms-security-review
description: Run a security review of an AWCMS module against the security checklist. Use before merging a sensitive module or when asked to "security review <module>". Checks secrets, auth, tenant/ABAC/RLS, audit, idempotency, masking, HMAC, and AI read-only per doc 12.
---

🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](SKILL.id.md)

# AWCMS — Module Security Review

Follow `docs/awcms/12_generator_prompt.md` (Security Review Prompt) and `docs/awcms/13_final_master_index_traceability.md` (security control matrix).

## Checklist (per module)

- [ ] No hardcoded secrets; provider credentials come from env.
- [ ] Auth required except on explicitly public endpoints.
- [ ] Tenant context is set; tenant-scoped queries filter on `tenant_id`.
- [ ] ABAC default deny + deny overrides allow (`awcms-abac-guard`). Mechanical verification: run `bun run access:chokepoint:check` and `bun run access:permissions:enforcement:check`.
- [ ] RLS active on every tenant-scoped table.
- [ ] High-risk audit written + redaction (`awcms-audit-log`).
- [ ] Idempotency on high-risk mutations (`awcms-idempotency`).
- [ ] Soft-delete default filter active for deletable resources; restore/purge is permissioned, audited, and does not apply to posted/append-only entities.
- [ ] Sensitive data is masked (`awcms-sensitive-data`); it does not leak into responses/logs/events.
- [ ] Errors are safe, without a stack trace.
- [ ] Sync HMAC + anti-replay if it is a sync module (`awcms-sync-hmac`).
- [ ] AI read-only: no raw SQL, no mutation, no raw PII/tax identity, tool calls audited.
- [ ] Stock lock (`FOR UPDATE`) & immutable posted transactions where relevant.
- [ ] Consent checked before sending (CRM); receipt token non-sequential.
- [ ] File checksums verified (sync/R2, tax export).

## Focus per area

| Area        | Main checks                                                                  |
| ----------- | ---------------------------------------------------------------------------- |
| Identity    | modern password hash, login lockout, failed login audit                      |
| POS         | idempotency, stock lock, atomic, immutable                                   |
| Tax         | NPWP/NIK/NITKU masked, export approval + audit                               |
| CRM         | consent, provider key from env, phone/email masked                           |
| Sync        | HMAC, anti-replay, inactive node rejected                                    |
| AI          | read-only, safe aggregate views, no raw PII                                  |
| Master data | soft delete hidden by default, restore conflict check, purge retention/legal |

## Output

Verdict (Approve / Request changes / Comment) + a list of findings: critical, security, functional, data/migration, contract, testing gap, docs gap, suggested patch. A critical finding **blocks** go-live.
