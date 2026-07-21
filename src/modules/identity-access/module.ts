import { defineModule } from "../_shared/module-contract";

export const identityAccessModule = defineModule({
  key: "identity_access",
  name: "Identity & Access",
  version: "1.0.0",
  status: "active",
  description:
    "Login identity, password hashing, tenant user membership, session-based authentication, and RBAC/ABAC access control (roles, permissions, assignments, decision log).",
  dependencies: ["tenant_admin", "profile_identity"],
  api: {
    openApiPath: "openapi/modules/identity-access.openapi.yaml",
    basePath: "/api/v1/auth"
  },
  // Issue #180 — the generic business-scope layer CONSUMES a hierarchy
  // resolver from a DERIVED application (ADR-0011 capability port,
  // `_shared/ports/business-scope-hierarchy-port.ts`). `optional: true`: the
  // base ships a default no-op adapter, so identity_access degrades safely
  // (scope resolution returns `resolved: false`, high-risk scope-gated
  // actions default-deny) when no provider is composed in — the base
  // registry therefore has no provider for this capability and
  // `modules:compose:check` skips the missing-provider check for an optional
  // consume. `providedBy` names the canonical derived provider
  // (a legal-entity/organization-unit module that provides the
  // `business_scope_hierarchy` capability, NOT part of this base); the
  // test-support fixture `tests/fixtures/example-domain-modules/` provides a
  // working dummy resolver for the same capability to exercise the binding
  // end-to-end.
  capabilities: {
    consumes: [
      {
        capability: "business_scope_hierarchy",
        providedBy: "organization_structure",
        optional: true
      }
    ]
  },
  jobs: [
    {
      command: "bun run identity-access:business-scope:expiry",
      purpose:
        "Transitions business-scope assignments and SoD conflict exceptions past their effective_to to expired, recording append-only lifecycle events and an aggregate audit entry per tenant (per-exception audit for exceptions).",
      recommendedSchedule: "Hourly via cron/systemd timer.",
      environmentNotes:
        "Database-only operation, no external network dependency. Safe to run alongside request traffic (bounded per-tenant passes, maintenance work class).",
      safeInOfflineLan: true
    }
  ],
  permissions: [
    {
      activityCode: "business_scope_assignments",
      action: "read",
      description: "Read business-scope assignments for the caller's tenant"
    },
    {
      activityCode: "business_scope_assignments",
      action: "create",
      description: "Create a business-scope assignment"
    },
    {
      activityCode: "business_scope_assignments",
      action: "revoke",
      description: "Revoke an active business-scope assignment"
    },
    // Segregation of duties (Issue #181) — conflict evaluation log + the
    // exception lifecycle. `create`/`approve` are deliberately separate (maker/
    // checker over the override mechanism).
    {
      activityCode: "business_scope_conflicts",
      action: "read",
      description: "Read segregation-of-duties conflict evaluation history"
    },
    {
      activityCode: "business_scope_exceptions",
      action: "read",
      description: "Read segregation-of-duties conflict exceptions"
    },
    {
      activityCode: "business_scope_exceptions",
      action: "create",
      description: "Request a segregation-of-duties conflict exception"
    },
    {
      activityCode: "business_scope_exceptions",
      action: "approve",
      description: "Approve a segregation-of-duties conflict exception"
    },
    {
      activityCode: "business_scope_exceptions",
      action: "reject",
      description: "Reject a segregation-of-duties conflict exception"
    },
    {
      activityCode: "business_scope_exceptions",
      action: "revoke",
      description:
        "Revoke a previously approved segregation-of-duties conflict exception"
    },
    {
      activityCode: "access_control",
      action: "read",
      description: "Read roles, permissions, and decision logs"
    },
    {
      activityCode: "access_control",
      action: "assign",
      description: "Assign roles to tenant users"
    },
    {
      activityCode: "access_control",
      action: "configure",
      description: "Manage roles and role permissions"
    },
    {
      activityCode: "mfa_admin",
      action: "reset",
      description: "Administratively reset (disable) another user's MFA factor"
    },
    {
      activityCode: "mfa_admin",
      action: "configure",
      description: "Configure the tenant MFA enforcement policy"
    },
    {
      activityCode: "sso_providers",
      action: "read",
      description: "Read tenant OIDC SSO provider configuration"
    },
    {
      activityCode: "sso_providers",
      action: "create",
      description: "Add a tenant OIDC SSO provider"
    },
    {
      activityCode: "sso_providers",
      action: "update",
      description: "Update a tenant OIDC SSO provider"
    },
    {
      activityCode: "sso_providers",
      action: "delete",
      description: "Soft delete a tenant OIDC SSO provider"
    },
    {
      activityCode: "sso_policy",
      action: "read",
      description:
        "Read tenant authentication policy (password/SSO/break-glass)"
    },
    {
      activityCode: "sso_policy",
      action: "update",
      description:
        "Update tenant authentication policy (password/SSO/break-glass)"
    }
  ]
});
