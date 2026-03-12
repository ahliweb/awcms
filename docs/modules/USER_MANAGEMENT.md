> **Documentation Authority**: [SYSTEM_MODEL.md](../../SYSTEM_MODEL.md) Section 2.3 (Permissions)

# User Management Documentation

## Purpose

Describe user identity, profile sync, and role assignment patterns.

## Audience

- Admin panel developers
- Operators managing user provisioning

## Prerequisites

- [SYSTEM_MODEL.md](../../SYSTEM_MODEL.md) - **Primary authority** for user management and role system
- [AGENTS.md](../../AGENTS.md) - Implementation patterns and Context7 references
- `docs/security/abac.md`
- `docs/security/overview.md`

## Authentication

AWCMS relies on **Supabase Auth** (GoTrue) for identity management.

- **Sign In**: Email & Password.
- **Session**: JWT (JSON Web Token) stored in LocalStorage/Cookies. Handled automatically by `@supabase/supabase-js`.

## Benchmark-Ready Login and Registration Flow

### Objective

Implement a secure login and registration flow that respects tenant context, approval gates, and RLS policies.

### Required Inputs

| Field | Source | Required | Notes |
| --- | --- | --- | --- |
| Email/Password | Login form | Yes | Turnstile validated in admin UI |
| `tenant_id` | Tenant resolver | Yes | Required for registration requests |
| `account_requests` | Public registration | Yes | Approval workflow table |
| Admin invite | Approved server-side Worker handler | Optional | `manage-users` is invoked through the maintained Cloudflare Worker compatibility route |

### Workflow

1. Login uses Supabase Auth (`signInWithPassword`) and checks for soft-deleted users.
2. Public registration writes to `account_requests` with `pending_admin` status.
3. Tenant admin approval moves status to `pending_super_admin`.
4. Platform admin approval invokes `inviteUserByEmail` and marks request `completed`.
5. DB triggers create `public.users` and `public.user_profiles` for the invited user.

### Reference Implementation

```javascript
// Login
const { data, error } = await supabase.auth.signInWithPassword({
  email,
  password,
});

if (error) throw error;
```

```javascript
// Public registration request
await supabase.from("account_requests").insert({
  tenant_id,
  email,
  full_name,
  status: "pending_admin",
});
```

```javascript
// Admin invite (Worker-backed compatibility route)
await supabase.functions.invoke("manage-users", {
  body: { action: "invite", email, role_id, tenant_id },
});
```

### Validation Checklist

- Users cannot access the admin portal until approved and invited.
- `public.users` and `user_profiles` are created after invite acceptance.
- Soft-deleted users cannot sign in.

### Failure Modes and Guardrails

- Direct client creation of privileged users: enforce invites via approved server-side Worker handlers (currently `manage-users`).
- Missing default role flags: ensure `is_default_invite` and `is_default_public_registration` are set.
- Approval bypass: restrict `account_requests` updates to admins via RLS.

## User Profile Sync

Supabase separates Auth Users (`auth.users`) from Application Data. AWCMS bridges this using a public table:

1. **`auth.users`**: Stores credentials, encrypted passwords, and recovery data.
2. **`public.users`**: Stores application profile (Full Name, Role ID, Language).
3. **`public.user_profiles`**: Stores extended profile details (bio, job title, contact, socials).
4. **`public.user_profile_admin`**: Stores admin-only profile metadata (encrypted).

**Sync Mechanism**:

- A Database Trigger `on_auth_user_created` automatically inserts a row into `public.users` when a new user signs up via Supabase Auth.
- A Database Trigger `create_user_profile` ensures `public.user_profiles` is created for each user.

### Admin-Only Profile Fields

Sensitive administrative fields are stored in `user_profile_admin` and encrypted via pgcrypto. The passphrase is derived from the user profile description and a per-user salt, with re-keying on description updates.

```javascript
// Read admin-only fields (requires tenant.user.update)
const { data, error } = await supabase.rpc('get_user_profile_admin_fields', {
  p_user_id: userId,
});

// Update admin-only fields (encrypted server-side)
await supabase.rpc('set_user_profile_admin_fields', {
  p_user_id: userId,
  p_admin_notes: notes,
  p_admin_flags: flags,
});
```

### Region Assignment (Hierarchy)

To support administrative boundaries, users can be assigned to a specific **Region** (Level 1-10) or **Administrative Region** (Indonesia specifics) via the `users` table.

- **Field**: `users.region_id` (Standard 10-level)
- **Field**: `users.administrative_region_id` (Indonesian specific)
- **Lookup Tables**: `regions`, `administrative_regions`
- **Validation**:
  - Users can only be assigned to *one* region at a time.
  - Assignment is controlled by the `tenant.user.update` permission.

### ABAC Enforcement

User management actions are strictly controlled by Attribute-Based Access Control (ABAC) permissions.

| Action | Permission Required | RLS Policy |
| :--- | :--- | :--- |
| **View Users** | `tenant.user.read` | `users_select_hierarchy` |
| **Update User (Profile)** | `tenant.user.update` | `users_update_hierarchy` |
| **Assign Region** | `tenant.user.update` | `users_update_hierarchy` |
| **Admin Profile Fields** | `tenant.user.update` | `user_profile_admin_*` policies |
| **Delete User** | `tenant.user.delete` | Soft-delete via update workflow (no direct `DELETE` policy path) |

> **Security Note**: The RLS policy `users_update_hierarchy` explicitly checks for the `tenant.user.update` permission for any intra-tenant user modification.

## Role Assignment

Roles are assigned via the `role_id` Foreign Key in `public.users`.

- **Default Role**: New users are assigned by `handle_new_user()` using role flags (`is_default_public_registration` or `is_default_invite`).
- **Changing Roles**: Only platform admins (full access) or tenant admins with `tenant.user.update` can update the `role_id` via the User Manager module.

## Admin Routes

| Route | Purpose | Notes |
| --- | --- | --- |
| `/cmspanel/users` | User list | Default tab for active users. |
| `/cmspanel/users/new` | Create user | Opens the user editor. |
| `/cmspanel/users/edit/:id` | Edit user | `:id` uses signed route params (`{uuid}.{signature}`). |
| `/cmspanel/users/approvals/:status` | Registration approvals | Status values: `pending`, `completed`, `rejected`. |

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
2. System triggers the approved server-side invite handler (`manage-users` through the Cloudflare Worker compatibility route).
3. New user is created in `auth.users` with `tenant_id` metadata.
4. Invite email sent.

### Default Role Resolution

- Public registrations use the role flagged `is_default_public_registration` (fallback to `is_public`/`is_guest`).
- Invites use the role flagged `is_default_invite` (fallback to a tenant role).

## Security

- **Password Reset**: Handled via Supabase's built-in email recovery flow.
- **Account Locking**: Managed by Supabase (rate limiting).
- **Data Access**: Users can only see their own profile data unless they have `tenant.user.read` permission (Admin level).
- **Admin Notes**: Encrypted at rest via pgcrypto; access is only via RPC and admin permissions.

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
- Turnstile CAPTCHA verification (server-side Worker verification in normal environments; localhost test-key flow skips Worker verification when the local edge runtime is unavailable).
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
- User deletion is soft-delete only and validated via the approved server-side Worker-backed user-management handler (`manage-users`).

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
- Secret-key access is restricted to approved server-side edge runtimes.

## References

- `docs/modules/ROLE_HIERARCHY.md`
- `docs/security/overview.md`
