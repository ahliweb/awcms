> **Documentation Authority**: [SYSTEM_MODEL.md](../../SYSTEM_MODEL.md) -> [AGENTS.md](../../AGENTS.md) -> [README.md](../../README.md) -> [DOCS_INDEX.md](../../DOCS_INDEX.md)
>
> **Status:** Maintained
>
> **Last Refreshed:** 2026-04-09

# User Management Documentation

## Purpose

Describe the current user-management model in AWCMS: auth, account-request approval flow, tenant scoping, role assignment, profile synchronization, encrypted admin-only profile fields, and the Worker-backed invite/delete contract.

This is a current-state guide, not a generic Supabase Auth overview.

## Current User Management Model

Current user management is split across:

- Supabase Auth for identity/session primitives
- `public.users` for tenant membership and role linkage
- `public.user_profiles` for extended profile data
- `public.user_profile_admin` for encrypted admin-only metadata
- `account_requests` for multi-stage registration approval
- Worker-backed `manage-users` compatibility routes for privileged operational actions

## Current Authentication Model

- email/password sign-in remains the standard path
- session handling is provided by Supabase Auth and the current auth context
- login flow still checks soft-deleted user state
- Turnstile and 2FA support may participate depending on the environment and enabled features

## Current Registration And Approval Model

AWCMS currently uses an approval-oriented registration flow rather than unrestricted client-side privileged account creation.

Current flow:

1. public registration creates an `account_requests` row
2. tenant admin review moves the request through tenant-stage approval
3. platform/admin final approval triggers the approved invite path
4. the invite path creates the Auth-side invitation and completes the onboarding state

Current important rule:

- privileged user creation/invite operations should go through approved server-side Worker handlers, not direct client-side privileged auth APIs

## Current Invite / Worker Model

Privileged user-management operations currently use the maintained Worker compatibility route pattern.

Example:

```javascript
await supabase.functions.invoke('manage-users', {
  body: { action: 'invite', email, role_id, tenant_id },
});
```

Current meaning of that example:

- in maintained clients this bridges to the Worker runtime
- it is not a recommendation to rely on Supabase-hosted Edge Functions as the maintained backend

## Current Profile Sync Model

Current separation of concerns:

- `auth.users`: credentials and identity primitives
- `public.users`: application-level user row with role/tenant linkage
- `public.user_profiles`: extended profile fields
- `public.user_profile_admin`: encrypted admin-only profile metadata

Current repo behavior still relies on database-side sync/creation mechanisms so that application profile rows exist after the auth/invite lifecycle completes.

## Current Admin-Only Profile Fields

Sensitive admin-only metadata remains stored in `user_profile_admin` and accessed through RPC rather than ordinary client-side direct table writes.

Example pattern:

```javascript
const { data, error } = await supabase.rpc('get_user_profile_admin_fields', {
  p_user_id: userId,
});

await supabase.rpc('set_user_profile_admin_fields', {
  p_user_id: userId,
  p_admin_notes: notes,
  p_admin_flags: flags,
});
```

## Current Role And Tenant Scope Rules

- ordinary tenant users are scoped to a single tenant
- platform admin/full-access roles may be global (`tenant_id` nullable)
- role-driven access is determined by role flags and ABAC permissions, not by role-name assumptions alone
- changing roles is a privileged user-management action and must respect current permission and RLS boundaries

## Current Region Assignment Notes

User records may still be associated with region hierarchies where the relevant module/configuration is enabled.

Current rule of thumb:

- region assignment belongs to tenant/user management workflows
- updates remain permission-gated through current user-management permissions

## Current ABAC Expectations

User-management actions should align with canonical permission families such as:

- `tenant.user.read`
- `tenant.user.update`
- `tenant.user.delete`

Current important rules:

- deletion remains a soft-delete workflow
- privileged operational actions should go through the approved Worker-backed path where required
- UI permission checks are not the final authority

## Current Routes

Important current admin user-management routes include:

- `/cmspanel/users`
- `/cmspanel/users/new`
- `/cmspanel/users/edit/:id/*`
- `/cmspanel/users/approvals/:status`

Current route-security note:

- edit/detail routes use signed route params and may use sub-slugs for refresh-safe tabs/views

## Current Deletion Safety Model

User deletion remains guarded.

Current expectations:

- use soft delete, not direct `DELETE`
- respect tenant scope
- if the delete path depends on Worker-managed safety logic, use the approved Worker-backed flow
- preserve permission checks and role/assignment guardrails before deletion completes

## Current Login / Recovery Notes

- login uses Supabase Auth sign-in flows
- password reset uses Supabase recovery flows
- Turnstile may participate in login/recovery flows depending on the environment and current runtime availability
- 2FA remains a supported security layer where enabled

## Security Notes

- do not create privileged users directly from client-only paths
- keep soft-deleted users from re-entering ordinary active flows
- keep admin-only profile metadata encrypted and RPC-mediated
- keep user-management actions aligned with ABAC and RLS, not role-name shortcuts

## Validation Guidance

| Surface | Validation |
| --- | --- |
| admin/user-management code | `cd awcms && npm run build` |
| Worker-backed invite/delete behavior | `cd awcms-edge && npm test && npm run typecheck` when relevant |
| maintained docs | `cd awcms && npm run docs:check` |

## Related Docs

- [docs/security/abac.md](../security/abac.md)
- [docs/security/overview.md](../security/overview.md)
- [docs/dev/admin.md](../dev/admin.md)
- [docs/tenancy/overview.md](../tenancy/overview.md)
