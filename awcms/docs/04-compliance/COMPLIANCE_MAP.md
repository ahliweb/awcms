# AWCMS Compliance Mapping

This document maps AWCMS security and privacy features to relevant international standards and Indonesian regulatory requirements.

---

## ISO/IEC 27001:2022 - Information Security Management

### Core Controls Alignment

| ISO Control | AWCMS Feature | Implementation Reference |
| ----------- | ------------- | ------------------------ |
| **A.5.1** Access Control Policy | ABAC System with role hierarchy | [ABAC_SYSTEM.md](../03-features/ABAC_SYSTEM.md) |
| **A.5.15** Access Control | RLS enforcement on all tables | [RLS_POLICIES.md](../02-reference/RLS_POLICIES.md) |
| **A.5.17** Authentication | Supabase Auth + 2FA support | [SECURITY.md](../00-core/SECURITY.md) |
| **A.8.2** Privileged Access | `is_platform_admin()` function | `supabase/migrations/*.sql` |
| **A.8.3** Information Access | Tenant isolation via `tenant_id` | [MULTI_TENANCY.md](../00-core/MULTI_TENANCY.md) |
| **A.8.15** Logging | `audit_logs` table with triggers | [AUDIT_TRAIL.md](../03-features/AUDIT_TRAIL.md) |
| **A.8.16** Monitoring | Supabase Dashboard + custom alerts | [MONITORING.md](../03-features/MONITORING.md) |
| **A.8.24** Cryptography | AES-256 at rest (Supabase) | Supabase infrastructure |
| **A.8.25** Secure Development | CI/CD pipeline with lint/test | `.github/workflows/ci.yml` |

---

## ISO/IEC 27701:2019 - Privacy Information Management

| Privacy Control | AWCMS Feature | Notes |
| --------------- | ------------- | ----- |
| Data Subject Access | User can view own data via RLS | `users_select_unified` policy |
| Data Portability | Export via Admin Panel | Audit logs export (CSV/JSON) |
| Right to Erasure | Soft delete pattern | `deleted_at` column on all tables |
| Processing Boundaries | Tenant isolation | `current_tenant_id()` enforced |

---

## UU PDP (Law 27/2022) - Indonesian Personal Data Protection

### Chapter IV: Personal Data Controller Obligations

| Article | Requirement | AWCMS Implementation |
| ------- | ----------- | -------------------- |
| **Art. 16** | Legal basis for processing | Consent via Supabase Auth signup |
| **Art. 25** | Access control measures | ABAC + RLS multi-layer protection |
| **Art. 26** | Data security measures | Encryption at rest, HTTPS transport |
| **Art. 27** | Activity logging | `audit_logs` table captures all CRUD |
| **Art. 28** | Data breach notification | Supabase alerts + custom webhooks |
| **Art. 35** | Data subject rights | Self-service via profile management |

### Chapter V: Cross-Border Transfer

| Requirement | Status |
| ----------- | ------ |
| Adequate protection | Supabase regions include Singapore (AP-Southeast-1) |
| Contractual safeguards | Supabase DPA available |

---

## PP PSTE (Reg 71/2019) - Electronic System Regulation

| Requirement | AWCMS Feature | Implementation |
| ----------- | ------------- | -------------- |
| System Reliability | High Performance (UDM) | Online-First with Local Storage Caching |
| Data Center Location | Configurable Supabase region | Project settings |
| Audit Trail | Immutable logging | Trigger-based inserts, no UPDATE/DELETE |
| Incident Response | Error tracking integration | Sentry (optional) |

---

## ISO 22301 - Business Continuity

| Control | AWCMS Feature |
| ------- | ------------- |
| BCM Policy | Supabase automatic backups |
| Recovery Procedures | Point-in-time recovery available |
| Offline Capability | UnifiedDataManager (UDM) with SQLite |

---

## ISO 20000-1 - IT Service Management

| Requirement | Implementation |
| ----------- | -------------- |
| Service Design | Modular extension architecture |
| Change Management | Git-based migrations, CI/CD |
| Incident Management | Error boundaries, health checks |

---

## OWASP Top 10 (2021) Alignment

| Risk | Mitigation | Reference |
| ---- | ---------- | --------- |
| A01: Broken Access Control | ABAC + RLS + ProtectedRoute | [SECURITY.md](../00-core/SECURITY.md) |
| A02: Cryptographic Failures | Supabase AES-256 | Infrastructure |
| A03: Injection | TipTap sanitization | [SECURITY.md](../00-core/SECURITY.md) |
| A05: Security Misconfiguration | CSP headers | `vite.config.js` |
| A07: Auth Failures | 2FA + JWT + session timeout | [SECURITY.md](../00-core/SECURITY.md) |
| A09: Logging Failures | Comprehensive audit trail | [AUDIT_TRAIL.md](../03-features/AUDIT_TRAIL.md) |

---

## Practical Controls Summary

### Access Control

- ✅ Role-based with attribute extensions (ABAC)
- ✅ Tenant isolation at database level
- ✅ Platform admin bypass for cross-tenant ops

### Logging & Audit

- ✅ Who/What/When/Where/Old/New captured
- ✅ 365-day retention (configurable)
- ✅ Export capability for compliance audits

### Incident Handling

- ✅ Error tracking (Sentry optional)
- ✅ Health check endpoints
- ✅ Supabase alerting integration

---

## Verification Checklist

- [ ] Annual RLS policy review
- [ ] Quarterly audit log retention check
- [ ] Bi-annual penetration testing
- [ ] Annual ISO 27001 internal audit
- [ ] UU PDP data mapping register update
