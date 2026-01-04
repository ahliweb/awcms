
# Security Guide

## Overview

AWCMS implements multiple layers of security to protect your application and data.

---

## OWASP Top 10 (2021) Alignment

| Risk | Implementation |
| ---- | -------------- |
| A01: Broken Access Control | ✅ ABAC + RLS + ProtectedRoute |
| A02: Cryptographic Failures | ✅ Supabase (AES-256 at rest) |
| A03: Injection (XSS) | ✅ TipTap sanitization |
| A04: Insecure Design | ✅ Multi-layer architecture |
| A05: Security Misconfiguration | ✅ CSP headers configured |
| A06: Vulnerable Components | ✅ npm audit = 0 vulnerabilities |
| A07: Auth Failures | ✅ 2FA + JWT + session timeout |
| A08: Software Integrity | ✅ Supabase signed tokens |
| A09: Logging Failures | ✅ Audit trail + extension logs |
| A10: SSRF | ✅ No external server calls |

---

## Security Architecture

```text
┌─────────────────────────────────────────────────────────────┐
│                    SECURITY LAYERS                          │
├─────────────────────────────────────────────────────────────┤
│  1. CLIENT LAYER                                            │
│     • XSS Prevention (TipTap sanitization)                  │
│     • Input validation                                      │
│     • CSRF protection (Supabase tokens)                     │
├─────────────────────────────────────────────────────────────┤
│  2. TRANSPORT LAYER                                         │
│     • HTTPS only                                            │
│     • Secure cookies                                        │
│     • CORS configuration                                    │
├─────────────────────────────────────────────────────────────┤
│  3. API LAYER                                               │
│     • JWT authentication                                    │
│     • Row Level Security (RLS)                              │
│     • Rate limiting (Supabase)                              │
├─────────────────────────────────────────────────────────────┤
│  4. DATABASE LAYER                                          │
│     • PostgreSQL roles                                      │
│     * Column-level permissions                              │
│     * Encrypted at rest                                     │
│     * Secure 'search_path' for functions                    │
└─────────────────────────────────────────────────────────────┘
```

---

## XSS Prevention

### TipTap Editor

The TipTap WYSIWYG editor is XSS-safe by default:

- All HTML is sanitized before rendering
- Only allowed tags/attributes are preserved
- No `<script>` injection possible

### Input Sanitization

```javascript
// All user inputs are escaped before display
import { sanitizeHTML } from '@/lib/utils';
```

---

## Authentication Security

### Password Requirements

- Minimum 8 characters
- Enforced by Supabase Auth

### Session Management

| Feature | Implementation |
| :--- | :--- |
| Token Storage | Secure localStorage |
| Token Refresh | Automatic via Supabase |
| Session Timeout | Configurable in Supabase |
| Concurrent Sessions | Allowed (configurable) |

### Two-Factor Authentication (2FA)

AWCMS supports robust database-backed TOTP 2FA:

- **Provider Agnostic**: Works with Google Authenticator, Authy, etc.
- **Backup Codes**: Generated upon setup for emergency access.
- **Secure Storage**: Secrets stored in `two_factor_auth` table (RLS protected).
- **Enforcement**: Optional for standard users, recommended for Admins.

 ```javascript
 // Core logic in src/pages/cmspanel/LoginPage.jsx
 // Uses: otpauth library + server-side validation
 ```

---

## Single Sign-On (SSO)

AWCMS supports OpenID Connect (OIDC) through Supabase Auth (Google, GitHub, Azure AD, Okta).

**Configuration**:

1. Enable provider in Supabase Dashboard.
2. Add `Client ID` and `Secret`.
3. Map external provider roles in SSO Manager.

---

## Authorization (ABAC)

### Permission Checks

```javascript
// Protected component example
const { hasPermission } = usePermission();

if (!hasPermission('tenant.article.update')) {
  return <AccessDenied />;
}
```

### Row Level Security (RLS)

All database tables have RLS enabled:

```sql
-- Example: Users can only see their own data
CREATE POLICY "Users view own data"
ON public.users
FOR SELECT
USING (auth.uid() = id);

-- Example: Only admins can delete
CREATE POLICY "Only admins can delete"
ON public.articles
FOR DELETE
USING (auth.jwt() ->> 'role' = 'admin');
```

---

## Tenant Isolation (Multi-Tenancy)

AWCMS is a strict multi-tenant system. Data isolation is enforced at the lowest level (Database & Storage) to prevent cross-tenant data leaks.

### 1. Database Isolation (RLS)

Row Level Security (RLS) is the primary defense. Every table (except global system tables) includes a `tenant_id` column.

- **Strict Scoping**: Policies enforce `tenant_id = current_tenant_id()` for all operations.
- **No Global Leaks**: "Public" read policies are removed for sensitive tables (e.g., `files`, `users`, `orders`).
- **Triggers**: `trg_set_tenant_id` automatically assigns the correct tenant on INSERT, acting as a failsafe.

### 2. Storage Isolation

Supabase Storage buckets (`cms-uploads`) are secured via Policy-based Path Validation:

- **Upload Path**: Files MUST be uploaded to `{tenant_id}/{filename}`.
- **Policy Enforcement**:

  ```sql
  -- Example Policy
  ((bucket_id = 'cms-uploads') AND (name LIKE (current_tenant_id() || '/%')))
  ```

- **Result**: Authenticated users can ONLY modify files within their tenant's folder.

### 3. Edge Function Security

Server-side logic (`manage-users`) enforces context:

- **Context Check**: Functions verify the requester's `tenant_id` matches the target resource.
- **Privilege Containment**: Non-admins cannot create "Global" resources (forced `tenant_id` assignment).

---
---

## HTTP Security Headers

Implemented via Vite config and hosting:

```javascript
// vite.config.js
server: {
  headers: {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'X-XSS-Protection': '1; mode=block'
  }
}
```

### Recommended Production Headers

```http
Strict-Transport-Security: max-age=31536000; includeSubDomains
Content-Security-Policy: default-src 'self'; ...
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Referrer-Policy: strict-origin-when-cross-origin
```

---

## Dependency Security

### Regular Audits

```bash
# Check for vulnerabilities
npm audit

# Current status
found 0 vulnerabilities ✓
```

### Update Policy

- Critical: Immediate update
- High: Within 24 hours
- Moderate: Within 1 week
- Low: Next release cycle

---

## Data Protection

### Soft Delete Pattern

All deletions are soft deletes:

```sql
UPDATE articles SET deleted_at = NOW() WHERE id = $1;
-- Data is never permanently lost
```

### Backup Strategy

- Supabase provides automatic backups
- Point-in-time recovery available
- Custom backup scripts in `docs/BACKUP.md`

---

## Security Checklist

Before deploying to production:

- [ ] All secrets in environment variables (not hardcoded)
- [ ] `.env.local` in `.gitignore`
- [ ] HTTPS enabled
- [ ] RLS enabled on all tables
- [ ] npm audit shows 0 vulnerabilities
- [ ] Security headers configured
- [ ] Rate limiting enabled in Supabase
- [ ] 2FA available for admin users
- [ ] Regular backup schedule configured

---

## Reporting Vulnerabilities

If you discover a security vulnerability, please:

1. **Do NOT** create a public GitHub issue
2. Email: <security@ahliweb.com>
3. Include: Description, steps to reproduce, potential impact

We aim to respond within 48 hours and provide a fix within 7 days.
