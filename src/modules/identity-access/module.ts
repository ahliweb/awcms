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
    basePath: "/api/v1/auth",
    // Reclaimed from `tenant_admin`'s former `/api/v1` catch-all (Issue #256):
    // access control, roles, users, ABAC policies and identity/business-scope
    // are this module's surfaces, and its permissions are what guard them.
    // `/login` is the SSR page for the same session it issues, and
    // `/forgot-password` + `/reset-password` are the recovery pages for the
    // credential behind it — all three unauthenticated, all three this module's.
    routes: [
      "/api/v1/auth",
      "/api/v1/access",
      "/api/v1/roles",
      "/api/v1/users",
      "/api/v1/abac",
      "/api/v1/identity",
      "/api/v1/registration-requests",
      "/login",
      "/forgot-password",
      "/reset-password",
      "/register"
    ]
  },
  // Issue #180 / ADR-0060 — the generic business-scope layer CONSUMES a
  // hierarchy resolver through the ADR-0011 capability port
  // `_shared/ports/business-scope-hierarchy-port.ts`, and since ADR-0060 the
  // provider is a REAL base module: `tenant_admin`, resolving `office` scopes
  // against `awcms_offices`. It was `organization_structure` — a module
  // ADR-0016 accepted but no one ever wrote here — which, once ADR-0034
  // deleted the derived-application pathway, made the whole business-scope
  // subsystem unreachable: `createBusinessScopeAssignment` denied
  // `scope_unresolved` for every input in every deployment.
  //
  // `optional: true` stays. This module must keep working for a tenant that
  // has no offices at all, and the degradation is the same fail-closed one as
  // before (unresolved scope -> high-risk scope-gated actions default-deny).
  // The relationship stays SOURCE-level: the adapter arrives as an injected
  // parameter at composition roots, never as an import from here, so no
  // Core-depends-on-Optional edge is created. The test-support fixture
  // `tests/fixtures/example-domain-modules/` still provides a dummy resolver
  // for exercising heterogeneous (non-office) ancestry.
  //
  // Wave 2 delta auth — `auth_notification` (ADR-0011 capability port,
  // `_shared/ports/auth-notification-port.ts`) is how the password-reset flow
  // delivers its link. NOT optional and NOT a `dependencies` edge, for two
  // different reasons: `email` ships in this base and the forgot-password route
  // hard-imports its adapter, so a registry without a provider is a build error
  // that `modules:compose:check` should catch; and `email` already declares
  // `identity_access` as a dependency, so the reverse dependency edge would be a
  // cycle. `capabilities.consumes` carries no lifecycle ordering, which is
  // exactly right — nothing about issuing sessions waits on the mailer.
  capabilities: {
    consumes: [
      {
        capability: "business_scope_hierarchy",
        providedBy: "tenant_admin",
        optional: true
      },
      {
        capability: "auth_notification",
        providedBy: "email"
      }
    ]
  },
  /**
   * The first THREE admin screens below all gate their read on the SAME key.
   * `access_control` seeds only `read`/`assign`/`configure` (no per-screen
   * action), so a finer-grained link gate would name a permission that is
   * never granted and hide all three from everyone — the latent-authz trap
   * already recorded for the write surfaces on these pages. The two after them
   * name their own seeded keys, and each says why at its entry.
   */
  navigation: [
    {
      labelKey: "admin.layout.nav_users",
      path: "/admin/users",
      order: 20,
      requiredPermission: "identity_access.access_control.read"
    },
    {
      labelKey: "admin.layout.nav_roles",
      path: "/admin/roles",
      order: 21,
      requiredPermission: "identity_access.access_control.read"
    },
    {
      labelKey: "admin.layout.nav_abac_policies",
      path: "/admin/abac-policies",
      order: 22,
      requiredPermission: "identity_access.access_control.read"
    },
    // Gated on `registration_requests.read`, NOT the `access_control.read` the
    // three above share: this activity seeds its own `read`, so naming it is a
    // real gate rather than the never-granted invention the comment above warns
    // about — and an onboarding reviewer should reach this screen without also
    // being handed the RBAC catalog.
    {
      labelKey: "admin.layout.nav_registrations",
      path: "/admin/registrations",
      order: 23,
      requiredPermission: "identity_access.registration_requests.read"
    },
    // Same reasoning as the entry above, different key: `sso_policy` seeds its
    // own `read`. A caller holding only `mfa_admin.*` reaches the page by URL
    // and still sees its MFA section — the link is the coarser gate.
    {
      labelKey: "admin.layout.nav_security",
      path: "/admin/security",
      order: 24,
      requiredPermission: "identity_access.sso_policy.read"
    }
  ],
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
    },
    // Self-registration review (Wave 2 delta auth, sql/075). A separate
    // activity from `access_control` because approval is the only admin path
    // in this repo that materializes an identity, and `approve`/`reject` are
    // separate actions because only one of them creates an account.
    {
      activityCode: "registration_requests",
      action: "read",
      description: "Read the pending self-registration queue for this tenant"
    },
    {
      activityCode: "registration_requests",
      action: "approve",
      description:
        "Approve a self-registration request, creating a real account that can sign in — audited"
    },
    {
      activityCode: "registration_requests",
      action: "reject",
      description:
        "Reject a self-registration request (no account is created) — audited"
    },
    // Machine credentials (ADR-0049, sql/082/083). A separate activity from
    // `access_control` for the same reason `registration_requests` is:
    // minting a bearer that reads tenant data with no human behind it is its
    // own authority, and folding it into `access_control.configure` would make
    // every role editor a credential issuer by side effect. `create` and
    // `revoke` are split because only one of them creates a capability — during
    // an incident you want people who can kill a leaked credential without
    // being able to mint one.
    {
      activityCode: "machine_credentials",
      action: "read",
      description:
        "List machine credentials for this tenant (never their secrets)"
    },
    {
      activityCode: "machine_credentials",
      action: "create",
      description:
        "Issue a read-only machine credential bound to a service account — audited"
    },
    {
      activityCode: "machine_credentials",
      action: "revoke",
      description:
        "Revoke a machine credential, effective on its next request — audited"
    },
    // Other people's sessions (Gelombang 2 PR 2.2 of #423, sql/101). A separate
    // activity from `access_control` for the reason `registration_requests` and
    // `machine_credentials` are: folding it in would make every role editor an
    // observer of where their colleagues are signed in, by side effect.
    //
    // `read` and `revoke` split with the sides SWAPPED relative to
    // `machine_credentials`, and that is the point. Here `read` is the sensitive
    // one — a standing window into a colleague's movements — while `revoke`
    // destroys access rather than disclosing anything. The split buys the
    // direction that matters during an incident: sign a suspected-compromised
    // account out of everywhere WITHOUT also being handed the surveillance view.
    // The caller's own live session is never among the casualties; see
    // `admin-session-directory.ts`.
    {
      activityCode: "user_sessions",
      action: "read",
      description:
        "List another tenant user's live sessions (never their tokens, IPs, or User-Agents)"
    },
    {
      activityCode: "user_sessions",
      action: "revoke",
      description:
        "End every live session of another tenant user, effective on their next request — audited"
    }
  ],
  /**
   * `awcms_password_reset_tokens` (sql/073) is registered as a `generic`-execution
   * descriptor: the `data_lifecycle` engine owns the DELETE outright, because
   * unlike `form_drafts` or `comments` there is no module-owned sweep here to
   * delegate to — a spent reset token has no lifecycle after redemption.
   *
   * Retention is short and its floor is 1 day rather than 0 for a reason: rows
   * are what a `password_reset_failed` audit entry refers to, and purging them
   * the same hour would leave an incident investigation with the audit trail and
   * nothing it points at. The rows themselves hold no secret — `token_hash` is a
   * one-way sha256 of a value that is single-use and expired anyway.
   */
  dataLifecycle: [
    {
      key: "identity_access.password_reset_tokens",
      tableName: "awcms_password_reset_tokens",
      ownerModuleKey: "identity_access",
      scope: "tenant",
      cursorColumn: "created_at",
      retentionClass: "operational_queue",
      retentionMinDays: 1,
      retentionMaxDays: 90,
      defaultRetentionDays: 7,
      partition: {
        eligible: false,
        rationale:
          "One row per password-reset request, superseded on re-request and purged within days — a volume profile orders of magnitude below the audit/analytics tables partitioning exists for."
      },
      archive: {
        archivable: false,
        rationale:
          "A spent or expired single-use credential hash is not a business record. Archiving it would preserve a security artifact past the window its own short retention exists to close, with nothing recoverable from it — the raw token was never stored."
      },
      deletion: {
        mode: "hard_delete",
        rationale:
          "There is no status to transition to and nothing to anonymize: `used_at` already marks redemption, and the row's only identifying columns are a tenant/identity FK pair the identity tables hold anyway."
      },
      legalHold: {
        applicable: false,
        precedence: "not_applicable"
      },
      requiredIndexes: [
        {
          columns: ["tenant_id", "created_at"],
          purpose:
            "awcms_password_reset_tokens_tenant_created_idx (sql/073) — the engine's own cursor path (WHERE tenant_id = ? AND created_at < ?), added by this table's migration specifically for it rather than reused from a lookup index that happens to fit."
        }
      ],
      batchLimit: 5000,
      backupRestoreNotes:
        "Included in ordinary full-database backup/restore; no standalone archive artifact exists (archive.archivable is false above). Restoring an old backup can revive tokens that were already expired at backup time — they stay unusable, because expiry is evaluated against the clock, not against a flag.",
      executionMode: "generic"
    },
    /**
     * `awcms_registration_requests` (sql/074). Also `generic`: once a request
     * is reviewed there is no module-owned sweep to delegate to.
     *
     * The retention window is longer than the reset tokens' above (90d default
     * vs 7d) and deliberately so — a rejected applicant re-applying, or a
     * dispute about who was admitted and when, is answered by this table, and
     * the `registration_approved` audit row points AT it. It holds an email
     * address supplied by an anonymous submitter, which is exactly why it is
     * purged rather than kept indefinitely.
     */
    {
      key: "identity_access.registration_requests",
      tableName: "awcms_registration_requests",
      ownerModuleKey: "identity_access",
      scope: "tenant",
      cursorColumn: "created_at",
      retentionClass: "operational_queue",
      retentionMinDays: 7,
      retentionMaxDays: 730,
      defaultRetentionDays: 90,
      partition: {
        eligible: false,
        rationale:
          "One row per applicant, bounded by a public rate limit and purged within months — nowhere near the volume profile partitioning exists for."
      },
      archive: {
        archivable: false,
        rationale:
          "A reviewed request is an onboarding decision whose durable record is the audit event, not this row. Archiving would preserve an anonymous submitter's email address past the window this retention exists to close, duplicating what the audit trail already states without the address."
      },
      deletion: {
        mode: "hard_delete",
        rationale:
          "`status` already records the decision and there is nothing further to transition to; the row's only sensitive column is the submitted address, which anonymization would empty rather than preserve."
      },
      legalHold: {
        applicable: false,
        precedence: "not_applicable"
      },
      requiredIndexes: [
        {
          columns: ["tenant_id", "created_at"],
          purpose:
            "awcms_registration_requests_tenant_created_idx (sql/074) — the engine's own cursor path (WHERE tenant_id = ? AND created_at < ?), added by this table's migration for it rather than borrowed from the pending-queue index, whose leading `status` column does not serve a cursor scan."
        }
      ],
      batchLimit: 5000,
      backupRestoreNotes:
        "Included in ordinary full-database backup/restore; no standalone archive artifact exists (archive.archivable is false above). A restored backup can revive already-reviewed rows — harmless: `status` is not `pending`, so they never re-enter the queue.",
      executionMode: "generic"
    },
    /**
     * `awcms_abac_decision_logs` (sql/005) — Issue #427, ADR-0072.
     *
     * The largest unbounded table in the repo, and the only one that grows with
     * TRAFFIC rather than with customer data: one row per authorization
     * decision, allow and deny, ±8.6M rows/day at 100 req/s. It has had no
     * retention of any kind since `sql/005`, and it is also the table an
     * operator queries during an incident — precisely when it is slowest.
     *
     * 365 days rather than the 90 first proposed. The window is not chosen for
     * storage: it is the horizon over which `reporting`'s access-audit
     * projection can still be REBUILT (see ADR-0072 §Konsekuensi). A shorter
     * window would silently shrink what a rebuild can reconstruct, which is the
     * coupling this descriptor's arrival created and which the ADR resolves in
     * the open rather than by picking a number that hides it.
     */
    {
      key: "identity_access.abac_decision_logs",
      tableName: "awcms_abac_decision_logs",
      ownerModuleKey: "identity_access",
      scope: "tenant",
      cursorColumn: "created_at",
      retentionClass: "audit_security",
      retentionMinDays: 90,
      retentionMaxDays: 2555,
      defaultRetentionDays: 365,
      partition: {
        eligible: true,
        granularity: "monthly",
        rationale:
          "Volume profile is the same shape as awcms_audit_events (append-only, tenant + created_at, purged by a moving cutoff) but roughly two orders of magnitude larger, so monthly range partitions would turn each purge into a DROP PARTITION instead of a batched DELETE. Not automated here — declaring eligibility is a statement about the table, not a promise that partitioning exists."
      },
      archive: {
        archivable: false,
        rationale:
          "A decision row records that a check ran and what it answered; it carries no resource attribute VALUES and no subject identifiers beyond tenant_user_id (decision-log.ts's header states this deliberately). Nothing is recoverable from an archived copy that the audit trail does not already hold in business terms, and keeping a security-decision stream past the window its own retention exists to close is the opposite of the point."
      },
      deletion: {
        mode: "hard_delete",
        rationale:
          "There is no status to transition to and nothing left to anonymize — the row is already the minimum record of a decision. Soft-deleting would keep every byte while pretending otherwise, on the one table where byte count is the entire problem."
      },
      legalHold: {
        applicable: true,
        precedence: "overrides_retention"
      },
      requiredIndexes: [
        {
          columns: ["tenant_id", "created_at"],
          purpose:
            "awcms_abac_decision_logs_tenant_idx (sql/005) — (tenant_id, created_at DESC), and DESC is not a problem: PostgreSQL scans a btree backwards, so it already serves the engine's `WHERE tenant_id = ? AND created_at < ? ORDER BY created_at ASC` without a sort. An extra ascending index was considered and rejected in sql/091's header — it would add write amplification to the most-written table in the repo to buy nothing."
        }
      ],
      batchLimit: 5000,
      backupRestoreNotes:
        "Included in ordinary full-database backup/restore; no standalone archive artifact exists (archive.archivable is false above). Restoring a backup older than the retention window revives rows already purged — harmless for authorization (nothing reads this table to decide anything), but it will make `reporting`'s access-audit projection rebuildable further back than the live database allows, so the two can legitimately disagree after a restore.",
      executionMode: "generic"
    }
  ]
});
