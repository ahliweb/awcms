# Compliance Mapping

## Purpose

Map AWCMS security controls to common compliance frameworks.

## Audience

- Compliance reviewers
- Security and platform teams

## Prerequisites

- `docs/security/overview.md`

## Core Concepts

- Tenant isolation, ABAC, and RLS are core controls.
- Audit logs provide traceability for critical actions.
- Soft delete is used for data lifecycle control.

## Mapping

### ISO/IEC 27001:2022

| Control | AWCMS Feature | Reference |
| --- | --- | --- |
| A.5.1 Access Control Policy | ABAC system | `docs/security/abac.md` |
| A.5.15 Access Control | RLS enforcement | `../02-reference/RLS_POLICIES.md` |
| A.5.17 Authentication | Supabase Auth + 2FA | `docs/security/overview.md` |
| A.8.15 Logging | Audit trail | `docs/modules/AUDIT_TRAIL.md` |
| A.8.16 Monitoring | Audit logs + platform logs | `docs/modules/MONITORING.md` |

### ISO/IEC 27701:2019

| Control | AWCMS Feature | Reference |
| --- | --- | --- |
| Data subject access | RLS + profile access | `docs/security/overview.md` |
| Right to erasure | Soft delete | `docs/architecture/database.md` |
| Processing boundaries | Tenant isolation | `docs/tenancy/overview.md` |

### Indonesian PDP (Law 27/2022)

| Requirement | AWCMS Feature | Reference |
| --- | --- | --- |
| Access control | ABAC + RLS | `docs/security/abac.md` |
| Activity logging | Audit logs | `docs/modules/AUDIT_TRAIL.md` |
| Data security | HTTPS + RLS | `docs/security/overview.md` |

## Security and Compliance Notes

- Compliance requirements must be validated against your hosting configuration.
- Supabase region selection affects data residency.

## References

- `docs/security/overview.md`
