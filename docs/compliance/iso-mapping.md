> **Documentation Authority**: [SYSTEM_MODEL.md](../../SYSTEM_MODEL.md) Section 2 (Data Integrity) and Section 2.3 (Permissions)

# ISO 27001 Mapping

## 1. Introduction

This appendix maps AWCMS security controls to ISO 27001/27002 controls.

## Prerequisites

- [SYSTEM_MODEL.md](../../SYSTEM_MODEL.md) - **Primary authority** for ISO 27001 control implementation
- [AGENTS.md](../../AGENTS.md) - Implementation patterns and Context7 references

## 2. Control Mapping

| ISO 27001 Control | AWCMS Implementation | Doc Ref |
| --- | --- | --- |
| **A.9.1.1 Access Control Policy** | ABAC System, Permission Keys | `docs/security/abac.md` |
| **A.9.2.1 User Registration** | Supabase Auth (Sign up/Invite flows) | `docs/tenancy/supabase.md` |
| **A.9.2.3 Privilege Management** | Role Hierarchy (Admin, Manager, Editor) | `docs/security/abac.md` |
| **A.9.4.1 Access to Information** | RLS Policies (Tenant Isolation) | `docs/security/rls.md` |
| **A.12.3.1 Backup** | Supabase PITR & Daily Backups | Supabase Dashboard |
| **A.12.4.1 Event Logging** | `audit_logs` table (Write Ops) | `docs/security/threat-model.md` |
| **A.13.1.1 Network Controls** | Cloudflare WAF, TLS 1.3 | `docs/deploy/cloudflare.md` |
| **A.14.2.1 Secure Development** | CI/CD Linting, Security Scanning | `docs/dev/ci-cd.md` |
| **A.5.34 Privacy and PII** | Consent notice + telemetry disclosure | `docs/dev/public.md` |
