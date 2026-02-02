# Security Threat Model (OWASP ASVS Aligned)

## 1. Introduction

This document outlines the security threat model for the AWCMS platform, aligned with the OWASP Application Security Verification Standard (ASVS). It identifies potential threats, assets, and the controls in place to mitigate risks.

## 2. Architecture Overview

AWCMS interacts with the following key components:

- **Supabase**: Authentication, Database, Realtime, Storage, Edge Functions.
- **Admin Panel**: React SPA for content management.
- **Public Portal**: Astro SSG/SSR for content delivery.
- **Mobile/IoT**: Specialized clients.

## 3. Trust Boundaries

- **Public Internet vs. Edge**: Cloudflare WAF protection.
- **Client vs. API**: Authenticated via JWT (Supabase Auth).
- **API vs. Database**: Protected by Postgres RLS.
- **Service-to-Service**: Validated via Service Keys (strictly limited).

## 4. Key Threats & Mitigations

### 4.1 Authentication (ASVS V2)

| Threat | Mitigation | Status |
| --- | --- | --- |
| Brute Force / Credential Stuffing | Supabase Auth rate limiting & CAPTCHA (Turnstile) | Implemented |
| Weak Passwords | Minimum length & complexity policies | Implemented |
| Session Hijacking | Supabase session handling with refresh tokens, HTTPS, Turnstile | Implemented |

### 4.2 Access Control (ASVS V4)

| Threat | Mitigation | Status |
| --- | --- | --- |
| Bypassing Tenant Isolation | RLS policies mandating `tenant_id` check | **Vital Invariant** |
| Privilege Escalation | ABAC system enforcing permission keys | Implemented |
| IDOR (Insecure Direct Object Reference) | UUIDs + RLS constraints | Implemented |

### 4.3 Data Protection (ASVS V6)

| Threat | Mitigation | Status |
| --- | --- | --- |
| SQL Injection | Parameterized queries via Supabase client / PostgREST | Native |
| XSS (Cross-Site Scripting) | React/Astro auto-escaping, CSP headers | Implemented |
| Sensitive Data Exposure | Encryption at rest (Supabase), TLS in transit | Native |

## 5. Logging & Monitoring (ASVS V7)

- **Audit Logs**: All write operations in the Admin Panel are logged to the `audit_logs` table.
- **Visitor Analytics**: Public telemetry is stored in `analytics_events` with tenant scoping and consent notice disclosure.
- **PII Redaction**: Sensitive fields (passwords, tokens) are never logged.

## 6. Input Validation (ASVS V5)

- **Client-side**: React Hook Form validation with schema checks where used.
- **Database**: Postgres constraints (types, foreign keys, check constraints).

## 7. Compliance Note

This architecture supports alignment with **ISO 27001** and **UU PDP** by ensuring data minimization, access control, and auditability.
