
# User Management Documentation

## Purpose

Describe user identity, profile sync, and role assignment patterns.

## Audience

- Admin panel developers
- Operators managing user provisioning

## Prerequisites

- `docs/security/abac.md`
- `docs/security/overview.md`

## Authentication

AWCMS relies on **Supabase Auth** (GoTrue) for identity management.

- **Sign In**: Email & Password.
- **Session**: JWT (JSON Web Token) stored in LocalStorage/Cookies. Handled automatically by `@supabase/supabase-js`.

## User Profile Sync

Supabase separates Auth Users (`auth.users`) from Application Data. AWCMS bridges this using a public table:

1. **`auth.users`**: Stores credentials, encrypted passwords, and recovery data.
2. **`public.users`**: Stores application profile (Full Name, Role ID, Language).

**Sync Mechanism**:

- A Database Trigger `on_auth_user_created` automatically inserts a row into `public.users` when a new user signs up via Supabase Auth.

## Role Assignment

Roles are assigned via the `role_id` Foreign Key in `public.users`.

- **Default Role**: New users are assigned by `handle_new_user()` using role flags (`is_default_public_registration` or `is_default_invite`).
- **Changing Roles**: Only platform admins (full access) or tenant admins with `tenant.user.update` can update the `role_id` via the User Manager module.

## Tenant Roles (Multi-Tenancy)

Users are strictly scoped to a single `tenant_id`. Platform admin/full-access roles may be global (`tenant_id` NULL).

| Role | Scope | Default Permissions |
|------|-------|---------------------|
| **Owner** | Global | Full Access (Can create Tenants) |
| **Super Admin** | Global | Platform Management |
| **Admin** | Tenant | Manage Users, Content, Settings for *their* tenant. |
| **Editor** | Tenant | Can Edit/Publish content. Cannot manage users. |
| **Author** | Tenant | Can Create/Edit *own* content. |
| **Member** | Tenant | Read-only / Front-end access. |

> Platform admin access is determined by role flags (`is_platform_admin`/`is_full_access`), not role names.

### Invitation Flow

1. Admin enters email in **User Manager**.
2. System triggers `manage-users` Edge Function.
3. New user is created in `auth.users` with `tenant_id` metadata.
4. Invite email sent.

### Default Role Resolution

- Public registrations use the role flagged `is_default_public_registration` (fallback to `is_public`/`is_guest`).
- Invites use the role flagged `is_default_invite` (fallback to a tenant role).

## Security

- **Password Reset**: Handled via Supabase's built-in email recovery flow.
- **Account Locking**: Managed by Supabase (rate limiting).
- **Data Access**: Users can only see their own profile data unless they have `tenant.user.read` permission (Admin level).

## Registration & Approval Workflow

AWCMS implements a multi-stage approval process for new account requests (Option B).

1. **Public Registration**:
    - Users submit an application via `/register`.
    - Data is stored in `account_requests` table.
    - Status is initially `pending_admin`.

2. **Admin Approval**:
    - Tenant Admins (or Platform Admins) review applications in the CMS.
    - Approving moves status to `pending_super_admin` (platform admin).

3. **Platform Admin Approval**:
    - Platform Admins perform final review.
    - Upon approval, the system:
        - Creates a Supabase Auth user via `inviteUserByEmail`.
        - Sends an email invitation with a magic link/password setup.
        - Marks the request as `completed`.
        - Captures approval timestamps.

4. **Rejection**:
    - Admins can reject applications with a reason.
    - Status moves to `rejected`.

5. **User Onboarding**:
    - Users click the invitation link to set their password and gain access.
    - Access is strictly denied until this process is complete.

## Login Flow

The login process (`/login`) includes:

- Email/Password authentication via Supabase Auth.
- Turnstile CAPTCHA verification (skipped on localhost).
- Two-Factor Authentication (2FA) support if enabled.
- Checks for soft-deleted users (`deleted_at`).

## Password Reset

1. User navigates to `/forgot-password`.
2. Enters email and completes Turnstile verification.
3. Receives email with reset link.
4. Clicks link → redirected to `/cmspanel/update-password`.
5. Sets new password and logs in.

---

## Permissions and Access

- User management requires `tenant.user.*` permissions.
- User deletion is soft-delete only and validated via the `manage-users` Edge Function.

### Deletion Safety Check

Before deleting a user, the system checks if their role still has active permissions:

```javascript
const { count } = await supabaseAdmin
  .from('role_permissions')
  .select('*', { count: 'exact', head: true })
  .eq('role_id', targetUser.role_id);

if (count > 0) {
  throw new Error('User has active permissions. Change role first.');
}
```

## Security and Compliance Notes

- Soft delete applies to users.
- Service role access is restricted to edge functions.

## References

- `docs/modules/ROLE_HIERARCHY.md`
- `docs/security/overview.md`
