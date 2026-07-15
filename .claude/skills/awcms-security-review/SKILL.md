---
name: awcms-security-review
description: Jalankan security review modul AWCMS terhadap checklist keamanan. Gunakan sebelum merge modul sensitif atau saat diminta "security review <modul>". Memeriksa secret, auth, tenant/ABAC/RLS, audit, idempotency, masking, HMAC, dan AI read-only sesuai doc 12.
---

# AWCMS — Security Review Modul

Ikuti `docs/awcms/12_generator_prompt.md` (Prompt Security Review) dan `docs/awcms/13_final_master_index_traceability.md` (matrix security control).

## Checklist (per modul)

- [ ] Tidak ada hardcoded secret; provider credential dari env.
- [ ] Auth required kecuali endpoint public eksplisit.
- [ ] Tenant context diset; query tenant-scoped filter `tenant_id`.
- [ ] ABAC default deny + deny overrides allow (`awcms-abac-guard`).
- [ ] RLS aktif pada semua tabel tenant-scoped.
- [ ] Audit high-risk tertulis + redaksi (`awcms-audit-log`).
- [ ] Idempotency pada mutation high-risk (`awcms-idempotency`).
- [ ] Soft delete default filter aktif untuk resource deletable; restore/purge berizin, diaudit, dan tidak berlaku pada posted/append-only entity.
- [ ] Data sensitif dimasking (`awcms-sensitive-data`); tidak bocor ke response/log/event.
- [ ] Error aman, tanpa stack trace.
- [ ] Sync HMAC + anti-replay bila modul sync (`awcms-sync-hmac`).
- [ ] AI read-only: no raw SQL, no mutation, no raw PII/tax identity, tool call diaudit.
- [ ] Stock lock (`FOR UPDATE`) & immutable posted transaction bila relevan.
- [ ] Consent dicek sebelum kirim (CRM); receipt token non-sequential.
- [ ] File checksum diverifikasi (sync/R2, tax export).

## Fokus per area

| Area        | Cek utama                                                                    |
| ----------- | ---------------------------------------------------------------------------- |
| Identity    | password hash modern, login lockout, failed login audit                      |
| POS         | idempotency, stock lock, atomic, immutable                                   |
| Tax         | NPWP/NIK/NITKU masked, export approval + audit                               |
| CRM         | consent, provider key env, phone/email masked                                |
| Sync        | HMAC, anti-replay, node inactive ditolak                                     |
| AI          | read-only, safe aggregate views, no raw PII                                  |
| Master data | soft delete hidden by default, restore conflict check, purge retention/legal |

## Output

Verdict (Approve / Request changes / Comment) + daftar temuan: critical, security, functional, data/migration, contract, testing gap, docs gap, saran patch. Critical finding **memblokir** go-live.
