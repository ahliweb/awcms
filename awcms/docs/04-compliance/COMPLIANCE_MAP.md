# Compliance Mapping

## Purpose
Map AWCMS security controls to common compliance frameworks.

## Audience
- Compliance reviewers
- Security and platform teams

## Prerequisites
- `awcms/docs/00-core/SECURITY.md`

## Core Concepts

- Tenant isolation, ABAC, and RLS are core controls.
- Audit logs provide traceability for critical actions.
- Soft delete is used for data lifecycle control.

## Mapping

### ISO/IEC 27001:2022

| Control | AWCMS Feature | Reference |
| --- | --- | --- |
| A.5.1 Access Control Policy | ABAC system | `../03-features/ABAC_SYSTEM.md` |
| A.5.15 Access Control | RLS enforcement | `../02-reference/RLS_POLICIES.md` |
| A.5.17 Authentication | Supabase Auth + 2FA | `../00-core/SECURITY.md` |
| A.8.15 Logging | Audit trail | `../03-features/AUDIT_TRAIL.md` |
| A.8.16 Monitoring | Audit logs + platform logs | `../03-features/MONITORING.md` |

### ISO/IEC 27701:2019

| Control | AWCMS Feature | Reference |
| --- | --- | --- |
| Data subject access | RLS + profile access | `../00-core/SECURITY.md` |
| Right to erasure | Soft delete | `../00-core/SOFT_DELETE.md` |
| Processing boundaries | Tenant isolation | `../00-core/MULTI_TENANCY.md` |

### Indonesian PDP (Law 27/2022)

| Requirement | AWCMS Feature | Reference |
| --- | --- | --- |
| Access control | ABAC + RLS | `../03-features/ABAC_SYSTEM.md` |
| Activity logging | Audit logs | `../03-features/AUDIT_TRAIL.md` |
| Data security | HTTPS + RLS | `../00-core/SECURITY.md` |

## Security and Compliance Notes

- Compliance requirements must be validated against your hosting configuration.
- Supabase region selection affects data residency.

## References

- `../00-core/SECURITY.md`
