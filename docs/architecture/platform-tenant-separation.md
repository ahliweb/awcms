# Platform vs Tenant Admin Configuration Separation: Execution Guide

> **Authority Reference:** [SYSTEM_MODEL.md](../../SYSTEM_MODEL.md) Sections 2.1 (Multi-Tenancy) and 2.3 (Permissions)

## Overview

This guide details the exact steps to implement a clean separation between
**Platform-level** configuration and **Tenant-level** configuration in the
AWCMS admin. Currently, all configurations are tenant-scoped, and platform-level
settings leak into tenant views because the UI does not distinguish by scope.

The implementation is broken down into small, distinct execution phases to prevent monolithic PRs and integration timeouts.

---

## Phase 1: Database Foundation

**Goal:** Establish the database schema required for platform settings and update the existing schema scopes without breaking the current UI.

### Step 1.1: `auth_is_platform_admin()` Function

Create a `auth_is_platform_admin()` function. This must happen before table creation so RLS policies can use it.

- Defined as: `is_platform_admin = true` OR `is_full_access = true` in the authenticated user's assigned role.

### Step 1.2: `platform_settings` Table

Create the `platform_settings` table.

- **Columns:** `id`, `key` (UNIQUE), `value`, `type`, `description`, `category`, `is_overridable`, timestamps.
- **Note:** NO `tenant_id` column.
- **RLS:** `SELECT` allowed for all authenticated users; `INSERT/UPDATE/DELETE` restricted to `auth_is_platform_admin()`.

### Step 1.3: Update Existing Tables with Scopes

Add a `scope` column to existing tenant-scoped registry tables.

- **Tables:** `admin_menus`, `settings`, `resources_registry`.
- **Enum Values:** `platform`, `tenant`, `shared`.
- **Default:** `tenant`.

### Step 1.4: Cascade RPC (`get_effective_setting`)

Create the `get_effective_setting(p_key, p_tenant_id)` RPC function.

- **Logic:** Checks for a tenant-specific override in `settings`. If null, falls back to the global value in `platform_settings`.

---

## Phase 2: Role and Permissions System

**Goal:** Provide the necessary ABAC keys so the UI can lock down platform routes and queries appropriately without breaking the existing permission flows.

### Step 2.1: Seed New Permissions

Insert new permission keys into the `permissions` table:

- `platform.setting.*` (read, create, update, delete)
- `platform.tenant.*`
- `platform.module.manage`
- `platform.extensions.manage`

### Step 2.2: Update Context Definitions

Modify `awcms/src/contexts/PermissionContext.jsx` if necessary to explicitly handle `platform.*` scopes correctly in the `checkAccess` method, ensuring it falls back correctly for `isPlatformAdmin`.

---

## Phase 3: Update Existing UI Logic (Non-Breaking)

**Goal:** Update existing hooks and pages so they handle the new `scope` column gracefully, preparing the way for new platform-exclusive pages.

### Step 3.1: Refactor `useAdminMenu.js`

Modify `awcms/src/hooks/useAdminMenu.js` to filter the merged sidebar links based on the user's role and the item's scope.

- **Condition:** Do not render `scope === 'platform'` items unless the user satisfies `isPlatformAdmin` from `usePermissions()`.

### Step 3.2: Refactor `SettingsManager.jsx`

Update `awcms/src/components/dashboard/SettingsManager.jsx` to reflect that it exclusively manages tenant scope.

- Ensure it sends `scope = 'tenant'` for new rows via `GenericContentManager`.

---

## Phase 4: Platform-Specific UI Pages

**Goal:** Build new pages exclusively for Platform Admins to manage the `platform_settings` table and see global stats.

### Step 4.1: Create `PlatformSettingsManager.jsx`

Create a page at `awcms/src/components/dashboard/platform/PlatformSettingsManager.jsx`.

- **Features:** A `GenericContentManager` instance pointing to the `platform_settings` table instead of `settings`, secured by `platform.setting.read`.

### Step 4.2: Create `PlatformDashboard.jsx`

Create a landing page at `awcms/src/components/dashboard/platform/PlatformDashboard.jsx`.

- **Features:** Shows cumulative stats across all tenants (total tenants active, global extension status, etc.), secured by `platform.tenant.read`.

### Step 4.3: Route Registration

Register the new routes in the application router (usually `admin_routes` hooks or static routing) and add them to the `admin_menus` seed or configuration.

---

## Phase 5: RLS Hardening and Tenant UI Split

**Goal:** Make the split visually explicit for users who wear both hats (Tenant Admin and Platform Admin) and restrict rogue tenant access to platform routes via RLS.

### Step 5.1: Visual Split in Sidebar

Modify the Sidebar component rendering logic so that if a user is a Platform Admin, the menu visually separates "Platform Configuration" from "Tenant: {Current Tenant Name}".

### Step 5.2: RLS Final Hardening

Update RLS policies on `tenants`, `extensions`, and `modules`.

- Platform admins get `ALL` access across all tenants.
- Tenant admins are strictly restricted to rows where `tenant_id` matches their own via JWT `app_metadata` or strict session lookup.

---

## Verification Matrix

For every phase completed, agents must verify:

1. **Tenant Admin Profile:**
   - Cannot see `Platform` sidebar items.
   - Database prevents direct `POST/PATCH` to `platform_settings`.
   - Modifying a setting in `SettingsManager` only updates the local tenant value.

2. **Platform Admin Profile:**
   - Sees both `Platform` and `Tenant` sidebar sections.
   - Can edit `platform_settings` and `get_effective_setting()` updates correctly globally.

3. **CI/Build Passing:**
   - No React runtime errors due to missing hooks.
   - Post-migration unit tests and E2E Smoke paths pass.
