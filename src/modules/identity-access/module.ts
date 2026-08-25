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
      "/api/v1/user-groups",
      "/api/v1/invitations",
      // ADR-0089 — TWO partner surfaces, and this one prefix covers both
      // because `resolveOwner` matches by prefix. Named here so the second one
      // is a stated claim rather than a coincidence of spelling:
      //
      //   `/api/v1/partner/**`  — the partner's own view of its book. It reads
      //     nothing of any customer's data; acting inside a customer tenant
      //     happens through the delegated membership, under that tenant's own
      //     chokepoint.
      //   `/api/v1/partners`    — the platform's REGISTRY of who may be a
      //     partner at all. Platform-scoped, and deliberately unreadable by any
      //     customer: ADR-0089 refused a tenant-readable partner directory.
      "/api/v1/partner",
      "/login",
      "/forgot-password",
      "/reset-password",
      "/register",
      "/accept-invitation"
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
    // The DSL surface (ADR-0033), gated on its OWN permission rather than the
    // broad `access_control.read` above: `sql/032` created `abac_policies.*`
    // precisely so reading and simulating the evaluated policy set can be
    // granted or withheld independently of access-control administration.
    // 23, not 22.5 or a shared 22: two entries with the same order leave the
    // sidebar's sequence to whatever that build's sort happened to do.
    {
      labelKey: "admin.layout.nav_access_policies",
      path: "/admin/access-policies",
      order: 23,
      requiredPermission: "identity_access.abac_policies.read"
    },
    // Gated on `user_groups.read`, not the shared `access_control.read`: a group
    // is a subject with its own membership, and seeing who is in which group is
    // a different authority from reading the RBAC catalog (ADR-0081).
    {
      labelKey: "admin.layout.nav_user_groups",
      path: "/admin/user-groups",
      // 25, not 24: `nav_security` already holds 24, and two entries with the
      // same order leave the sidebar's sequence to whatever the sort happened
      // to do that build.
      order: 25,
      requiredPermission: "identity_access.user_groups.read"
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
    },
    // ADR-0089/0090. Its own key, not the shared `access_control.read`: who
    // from OUTSIDE the organisation can reach this tenant is a different
    // question from the RBAC catalogue, and an operator who should see one need
    // not see the other.
    {
      labelKey: "admin.layout.nav_partners",
      path: "/admin/partners",
      order: 26,
      requiredPermission: "identity_access.partner_access.read"
    },
    // ADR-0049/0092, #539. Gated on `machine_credentials.read`, which seeds its
    // own `read` — a caller who may see WHICH non-human bearers exist need not
    // also be handed the RBAC catalogue, and the reverse is more important:
    // this page can mint one, so it must not appear for everybody who can edit
    // a role.
    {
      labelKey: "admin.layout.nav_machine_credentials",
      path: "/admin/machine-credentials",
      order: 27,
      requiredPermission: "identity_access.machine_credentials.read"
    },
    // ADR-0082, #541. Gated on `invitations.read`, which seeds its own `read`
    // — an onboarding reviewer should reach the list of outstanding offers
    // without also being handed the RBAC catalogue. 28, and 28 is free: two
    // entries sharing an order leave the sidebar's sequence to whatever the
    // sort happened to do that build.
    {
      labelKey: "admin.layout.nav_invitations",
      path: "/admin/invitations",
      order: 28,
      requiredPermission: "identity_access.invitations.read"
    },
    // ADR-0060/ADR-0081, #545. Gated on `business_scope_assignments.read`, the
    // first of the page's three any-of entry keys — a link needs ONE key that
    // implies something to see, and the assignment register is the panel an
    // operator reaching this screen almost always wants. A holder of only
    // `business_scope_conflicts.read` still reaches the page by URL and sees
    // its own panel; the link is the coarser gate, the same shape
    // `/admin/security` records for `mfa_admin`.
    {
      labelKey: "admin.layout.nav_business_scope",
      path: "/admin/business-scope",
      order: 29,
      requiredPermission: "identity_access.business_scope_assignments.read"
    },
    // ADR-0089, #540. PLATFORM-scoped, and the link is gated on the platform
    // permission ITSELF for the reason `/admin/tenants` records: unlike
    // `/admin/idn-regions` there is no tenant-readable half of this screen, so
    // an ordinary tenant has nothing here to see. It is deliberately NOT a
    // section of `/admin/partners` — that page is the CUSTOMER's view of who
    // reaches its own tenant, and the registry there would put the platform's
    // list of every partnership in front of every customer.
    {
      labelKey: "admin.layout.nav_partner_registry",
      path: "/admin/partner-registry",
      order: 35,
      requiredPermission: "identity_access.partner_registry.read"
    }
  ],
  jobs: [
    {
      command: "bun run identity-access:business-scope:expiry",
      schedule: {
        mode: "cron",
        expression: "5 * * * *",
        backlog: "bounded"
      },
      purpose:
        "Transitions business-scope assignments and SoD conflict exceptions past their effective_to to expired, recording append-only lifecycle events and an aggregate audit entry per tenant (per-exception audit for exceptions).",
      recommendedSchedule: "Hourly via cron/systemd timer.",
      environmentNotes:
        "Database-only operation, no external network dependency. Safe to run alongside request traffic (bounded per-tenant passes, maintenance work class).",
      safeInOfflineLan: true
    },
    {
      command: "bun run identity-access:delegated-access:expiry",
      schedule: {
        mode: "cron",
        expression: "20 * * * *",
        backlog: "bounded"
      },
      purpose:
        "Ends delegated support episodes whose grant has run out (ADR-0090): the grant is revoked with reason `expired` and no actor, its delegated tenant user goes inactive, and its live sessions are revoked. CLEANUP, not the gate — an expired grant is already refused at the chokepoint from the instant on its row.",
      recommendedSchedule:
        "Hourly via cron/systemd timer, offset from the business-scope sweep so two identity_access passes do not contend for the same maintenance slots.",
      environmentNotes:
        "Database-only operation, no external network dependency. The work happens inside `awcms_expire_delegated_access_grants` (sql/142), a narrow SECURITY DEFINER function: `awcms_worker` holds EXECUTE on it and no UPDATE on awcms_tenant_users or awcms_sessions, so the job cannot re-activate a member or un-revoke a session. Safe to run alongside request traffic (bounded per-tenant passes, maintenance work class).",
      safeInOfflineLan: true
    },
    {
      command: "bun run entitlements:backfill",
      schedule: {
        mode: "manual",
        because:
          "A one-shot data migration, run once before merging the change that depends on it. Running it on a schedule would re-derive state that is already correct."
      },
      purpose:
        "Grandfathers every tenant that PREDATES an entitlement onto it (ADR-0084), and prints the blast radius — how many tenants would start receiving 403 ENTITLEMENT_REQUIRED — for each entitlement the registry requires. Dry-run by default; --commit writes; --tenant <code> stages the rollout.",
      recommendedSchedule:
        "NOT scheduled. Operator-run, and run BEFORE merging a descriptor that declares requiresEntitlement — run afterwards it describes an outage instead of preventing one. `bun run security:readiness` carries the same report for anyone who does not know this command exists.",
      environmentNotes:
        "Database-only, no external network dependency. Grandfathers only tenants OLDER than an entitlement's catalogue row; a newer tenant that lacks it is reported and never re-granted, because after the entitlement existed its absence may be a revocation.",
      safeInOfflineLan: true
    },
    {
      command: "bun run identity-access:subscription-lifecycle",
      schedule: {
        mode: "cron",
        expression: "30 2 * * *",
        backlog: "bounded"
      },
      purpose:
        "Walks each tenant's subscription one rung down the trialing -> active -> past_due -> grace -> suspended ladder when its own dates say so (ADR-0084), auditing every transition in that tenant's own trail. Never moves a subscription up — restoring service is a payment event, not a clock event — and never writes awcms_tenants: a run that would cost more than MAX_ENTITLEMENT_LOSSES_PER_RUN tenants their plan entitlements applies none of them and reports instead.",
      recommendedSchedule: "Daily via cron/systemd timer.",
      environmentNotes:
        "Database-only operation, no external network dependency. Inert until an operator creates subscriptions: a tenant with no row is 'nothing to do', not a lapse. Run with --dry-run before the first real schedule.",
      safeInOfflineLan: true
    }
  ],
  permissions: [
    /**
     * The DSL ABAC policy surface (`sql/032`, Issue #179). These three were
     * seeded straight into `awcms_permissions` and NEVER declared here, on the
     * reasoning recorded in that migration's header: "rather than via a module
     * descriptor `permissions` array which this module does not use". That was
     * true when it was written and stopped being true afterwards — this array
     * now declares every other identity_access permission.
     *
     * The cost of the omission was not that the endpoints broke. They work:
     * the catalog row is what `authorizeInTransaction` reads. It was that the
     * three became INVISIBLE to every gate whose authority is the descriptor —
     * `access:permissions:enforcement:check` (does each declared permission
     * have an enforcer?) and `admin:screen-coverage:check` (does each declared
     * permission have a screen?) both iterate what modules DECLARE, so a
     * permission that exists only in SQL is never asked either question.
     *
     * That blind spot is what let `/admin/abac-policies` gate on
     * `access_control.*` while the routes it drives gate on `abac_policies.*`
     * — a divergence a screen-coverage gate exists to catch and structurally
     * could not see. `access:permission-catalogue:check` now holds the two
     * registers to each other so the next one cannot hide the same way.
     *
     * Descriptions are copied VERBATIM from `sql/032`: `comparePermissions`
     * reports `mismatched_description` on any difference, so paraphrasing here
     * would turn a module's health signal red for a text edit.
     */
    {
      activityCode: "abac_policies",
      action: "read",
      description: "Read stored ABAC policies (DSL surface)"
    },
    {
      activityCode: "abac_policies",
      action: "configure",
      description:
        "Author (create/update/enable/disable) ABAC policies (DSL surface)"
    },
    {
      activityCode: "abac_policies",
      action: "analyze",
      description: "Run the read-only ABAC policy simulation/preview"
    },
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
    // The WRITE class (ADR-0092, sql/121/122) — a THIRD activity rather than a
    // fourth action on `machine_credentials`, and the reason is the same one
    // that separated `machine_credentials` from `access_control` in the first
    // place, applied to itself.
    //
    // Had the write class reused `machine_credentials.create`, every role that
    // already holds it would have gained the ability to mint credentials that
    // CHANGE data on the day this merged — a grant widening with no grant being
    // edited, and nothing in any diff to review. Issuance is a superset:
    // holding this key implies being able to mint a read-only credential too,
    // which is why there is no separate `read` or `revoke` here. `revoke` does
    // not split, deliberately — during an incident, whoever can kill a leaked
    // credential must be able to kill EVERY class of it.
    {
      activityCode: "machine_credentials_write",
      action: "create",
      description:
        "Issue a WRITE-capable machine credential (create/update only, IP-bound, at most 30 days) — audited"
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
    },
    // User groups (ADR-0081). A group is a SUBJECT that holds role grants, so
    // these four decide who may shape the membership — never what the group can
    // DO. Granting a group a role stays on `access_control.assign`, the
    // permission that already means "hand out a role". Folding them together
    // would create a privilege-escalation path with no obvious name: a group
    // administrator who could also grant roles to their own group could grant
    // `owner` to a group they belong to.
    //
    // There is deliberately no `delete`: retiring a group is three decisions
    // (its grants, its membership, an `external_id` the directory will present
    // again) and `sql/105` records why they get their own change.
    {
      activityCode: "user_groups",
      action: "read",
      description: "List user groups and their members"
    },
    {
      activityCode: "user_groups",
      action: "create",
      description: "Create a local user group"
    },
    {
      activityCode: "user_groups",
      action: "update",
      description: "Rename a local user group or change its description"
    },
    {
      activityCode: "user_groups",
      action: "assign",
      description:
        "Add or remove a tenant user from a group — audited, and a grant in everything but name (membership confers every role the group holds)"
    },
    // Invitations (ADR-0082, sql/106/107). A separate activity from
    // `registration_requests` because the two run in opposite directions:
    // registration is PULL (a stranger asks to be admitted, an admin decides),
    // an invitation is PUSH (an admin offers, a stranger decides). Both survive,
    // and each keeps its own permissions and its own audit story.
    //
    // None of these decides which ROLES an invitation carries — that stays on
    // `access_control.assign`, so an administrator holding only
    // `invitations.create` can admit a person and nothing more. ADR-0081 drew
    // that line for groups; it matters more here, because a grant carried by an
    // invitation reaches someone who does not exist yet.
    //
    // No `update` and no `delete`: editing an invitation after it was sent
    // would leave the link in someone's inbox describing something nobody
    // reviewed, and deleting one destroys the only record that an offer was
    // made. Revoke-and-reinvite is the operation, and it leaves two audit rows.
    // Resend is guarded by `create` — it mints a fresh token, which is the
    // authority `create` already names.
    {
      activityCode: "invitations",
      action: "read",
      description: "List this tenant's invitations and their status"
    },
    {
      activityCode: "invitations",
      action: "create",
      description:
        "Invite a person to this tenant, and resend an invitation — which rotates its token — audited"
    },
    {
      activityCode: "invitations",
      action: "revoke",
      description:
        "Revoke a pending invitation, killing its link immediately — audited"
    },
    // PLATFORM-scoped, and the only one this module declares. It gates
    // `skip_email_confirmation`, which removes the sole proof that the person
    // at the far end controls that mailbox. Held at tenant scope, any tenant
    // admin could manufacture an unverified account for another company's
    // address — and after Gelombang 7 that object is a GLOBAL principal, which
    // is the one place it matters (the ADR-0053/ADR-0054 reasoning).
    {
      activityCode: "invitations",
      action: "configure",
      scope: "platform",
      description: "PLATFORM: issue an invitation that skips email confirmation"
    },
    // ADR-0089/ADR-0090, Gelombang 8 PR 8.4. Three actions, all TENANT scope,
    // and the scope is the point: a partnership is the CUSTOMER's decision
    // about their own tenant, so `platform` would move it to the operator —
    // exactly the inversion ADR-0089 refused.
    //
    // No `create`/`delete` pair. Engaging and severing are two directions of one
    // authority over this tenant's shape, and splitting them produces the one
    // combination that must not exist: somebody who can let a partner in and
    // cannot put them out.
    {
      activityCode: "partner_access",
      action: "read",
      description:
        "See which partners reach this tenant, and every delegated-access grant they hold"
    },
    {
      activityCode: "partner_access",
      action: "configure",
      description:
        "Engage a partner for this tenant, and sever that engagement — audited"
    },
    // `assign`, not an action of its own: what approval DOES is hand a role to
    // somebody from outside, and that authority already has a name here
    // (ADR-0081, repeated by ADR-0082 for invitations).
    {
      activityCode: "partner_access",
      action: "assign",
      description:
        "Approve delegated access for a partner at a chosen role, and revoke it — audited"
    },
    // The partner REGISTRY (ADR-0089, sql/116 + sql/123) — a different activity
    // from `partner_access` above, and a different SCOPE, because they answer
    // the two questions ADR-0089 kept apart on purpose.
    //
    // `partner_access.*` is tenant-scoped and answers "which partners reach MY
    // tenant" — written by the customer. These two answer "who may be a partner
    // at all" — written by the platform, and never by a customer. Folding them
    // together would give one actor both halves, which is the merge the whole
    // ADR exists to prevent.
    //
    // `read` is platform-scoped for the same reason `tenant_provisioning.read`
    // is: it lists EVERY partner. A tenant-scoped read here would be the
    // cross-tenant directory ADR-0089 refused, rebuilt as a permission.
    {
      activityCode: "partner_registry",
      action: "read",
      scope: "platform",
      description: "PLATFORM: list every partner registered on the deployment"
    },
    {
      activityCode: "partner_registry",
      action: "create",
      scope: "platform",
      description:
        "PLATFORM: register an existing tenant as a partner — audited. Grants nothing; it is the precondition a customer's engagement checks"
    },
    // ADR-0093, #543. TWO permissions, not one, because they are two
    // authorities: an operator who may stop a partner reaching in need not
    // also be the one who lets them back. Platform-scoped like their two
    // siblings — suspension is a statement about who may be a partner on this
    // DEPLOYMENT, not a customer's decision about its own tenant, which
    // already has its own name (`partner_access.configure`).
    {
      activityCode: "partner_registry",
      action: "disable",
      scope: "platform",
      description:
        "PLATFORM: suspend a registered partner — every delegated actor it placed stops being served immediately, and no grant row is touched"
    },
    {
      activityCode: "partner_registry",
      action: "restore",
      scope: "platform",
      description:
        "PLATFORM: reinstate a suspended partner — the grants that survived start applying again"
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
  /**
   * ADR-0094 — how each of these tables answers about a data subject.
   *
   * The FIRST WAVE, deliberately small and deliberately the unambiguous ones.
   * `subject-data:coverage:check` holds every other table to answering too, on
   * a ledger that may only shrink, so the number below is a debt counter rather
   * than a claim of completeness.
   */
  subjectData: [
    {
      key: "identity_access.tenant_users",
      tableName: "awcms_tenant_users",
      ownerModuleKey: "identity_access",
      subjectColumns: [{ column: "id", references: "tenant_user" }],
      exportable: true,
      // NOT `hard_delete`, and this is the row that makes the default the
      // default: this id is the foreign key target of audit events, decision
      // logs, assignments and workflow history. Deleting it would either
      // cascade the evidence away or abort on the first constraint — and the
      // evidence includes the record that the erasure itself happened.
      // ADR-0108 moved this to `severed_with_subject_row` because the row
      // carried no personal detail of its own. ADR-0109 gives it one —
      // `public_byline_name`, the name a writer is PUBLISHED under — so it
      // returns to `anonymize`, naming exactly that column and nothing else.
      // The id itself is still never rewritten: it is the FK target of audit
      // events, decision logs, assignments and workflow history, including the
      // record of the erasure itself.
      //
      // A byline that survived an erasure would leave the person's name under
      // every article they wrote, which is the most visible place a name can
      // survive.
      erasure: "anonymize",
      anonymizedColumns: ["public_byline_name"],
      rationale:
        "The membership row itself: this is what 'a subject in this tenant' MEANS here, and the id every other table joins on. Its one personal field is the public byline (ADR-0109), which is anonymised; the id is not, because rewriting it would take the tenant's whole history down with it."
    },
    {
      key: "identity_access.identities",
      tableName: "awcms_identities",
      ownerModuleKey: "identity_access",
      subjectColumns: [{ column: "id", references: "identity" }],
      exportable: true,
      erasure: "anonymize",
      rationale:
        "The login identity behind the membership — the address a person signs in with, which is personal data in its own right. Anonymised rather than deleted for the same reason as the row above: it is an FK target, and a tenant's own audit trail names it.",
      // The credential itself is never portable. A subject-access export that
      // handed back a password hash would turn a privacy right into a
      // credential-disclosure channel, and the hash tells the subject nothing
      // they do not already know.
      redactedColumns: ["password_hash"],
      // The login address is the person. Before ADR-0108 the only list was
      // `redactedColumns`, and putting it there would have withheld a subject's
      // own sign-in address from their subject-access export — so it went
      // nowhere, and an "anonymised" identity kept the address it signs in
      // with. That mattered beyond this row: ~90 tables answer
      // `severed_with_subject_row` on the premise that anonymising THIS table
      // makes their stamps resolve to nobody, and a stamp pointing at a row
      // that still carries the address resolves to somebody.
      //
      // It is under `(tenant_id, login_identifier)` UNIQUE, which the executor
      // derives — so each erased identity gets its own sentinel instead of the
      // second one colliding.
      anonymizedColumns: ["password_hash", "login_identifier"]
    },
    {
      key: "identity_access.sessions",
      tableName: "awcms_sessions",
      ownerModuleKey: "identity_access",
      // Through `identity_id`, NOT a tenant user id — the distinction the
      // descriptor's two `references` values exist for. A planner that assumed
      // tenant-user everywhere would bind the wrong value here and return
      // nothing, silently.
      subjectColumns: [{ column: "identity_id", references: "identity" }],
      exportable: true,
      // Nothing references a session as evidence — the audit trail records what
      // was DONE, not which cookie carried it — and a live session is exactly
      // the thing an erasure request should end.
      erasure: "hard_delete",
      rationale:
        "Where and when the person signed in. Genuinely theirs and genuinely useful to them, which is why it exports; and referenced by nothing as evidence, which is why it is the one row here that is really deleted.",
      redactedColumns: ["token_hash"]
    },

    // ---- Wave 2 (Issue #557) ----------------------------------------------
    //
    // The three above are the rows that ARE the person. Everything below either
    // records what they did, what they were allowed to do, or a short-lived
    // security artifact issued to them — and most of it answers
    // `severed_with_subject_row`, because it carries their id and no copy of
    // any personal detail. Anonymising `identity_access.identities` makes every
    // one of those ids resolve to nobody; rewriting them here as well would
    // destroy the tenant's own record of who did what to remove a link that was
    // already unresolvable.

    {
      key: "identity_access.external_identities",
      tableName: "awcms_external_identities",
      ownerModuleKey: "identity_access",
      subjectColumns: [{ column: "identity_id", references: "identity" }],
      exportable: true,
      // The row's entire content is "this person at that IdP is this person
      // here". Nothing cites it as evidence — the audit trail records the
      // login, not the link — and an erasure that left it standing would let
      // the next SSO sign-in re-attach the same person to the anonymised
      // identity, quietly undoing the erasure.
      erasure: "hard_delete",
      rationale:
        "The link between this person's account here and their account at an external identity provider. `issuer` plus `subject` is their identifier at that provider, which is personal data of theirs and belongs in their export."
    },
    {
      key: "identity_access.abac_decision_logs",
      tableName: "awcms_abac_decision_logs",
      ownerModuleKey: "identity_access",
      subjectColumns: [{ column: "tenant_user_id", references: "tenant_user" }],
      exportable: true,
      erasure: "severed_with_subject_row",
      rationale:
        "Every authorization decision made about this person: what they asked for, and whether it was allowed. It is about them, so it exports; it holds their id and no other personal detail, so anonymising the identity row is what severs it."
    },
    {
      key: "identity_access.business_scope_assignments",
      tableName: "awcms_business_scope_assignments",
      ownerModuleKey: "identity_access",
      // Three ways to appear, and all three count. A descriptor naming only
      // `tenant_user_id` would answer nothing for a compliance officer who
      // never held an assignment and only ever approved other people's.
      subjectColumns: [
        { column: "tenant_user_id", references: "tenant_user" },
        { column: "granted_by_tenant_user_id", references: "tenant_user" },
        { column: "approved_by_tenant_user_id", references: "tenant_user" },
        { column: "revoked_by_tenant_user_id", references: "tenant_user" }
      ],
      exportable: true,
      erasure: "severed_with_subject_row",
      rationale:
        "Which parts of the business this person was given access to, and who granted, approved or revoked it. Theirs when they are the subject and theirs as an action when they are the grantor — both are answerable, and neither carries a detail beyond the ids."
    },
    {
      key: "identity_access.business_scope_assignment_events",
      tableName: "awcms_business_scope_assignment_events",
      ownerModuleKey: "identity_access",
      subjectColumns: [
        { column: "actor_tenant_user_id", references: "tenant_user" }
      ],
      exportable: true,
      erasure: "severed_with_subject_row",
      rationale:
        "The append-only history behind the assignments above — one row per grant, approval or revocation this person performed."
    },
    {
      key: "identity_access.delegated_access_grants",
      tableName: "awcms_delegated_access_grants",
      ownerModuleKey: "identity_access",
      subjectColumns: [
        { column: "granted_tenant_user_id", references: "tenant_user" },
        { column: "approved_by_tenant_user_id", references: "tenant_user" },
        { column: "revoked_by_tenant_user_id", references: "tenant_user" }
      ],
      exportable: true,
      erasure: "severed_with_subject_row",
      rationale:
        "Cross-tenant delegated access this person was granted, or approved for somebody else. Held to the same rule as the assignments above."
    },
    {
      key: "identity_access.sod_conflict_evaluations",
      tableName: "awcms_sod_conflict_evaluations",
      ownerModuleKey: "identity_access",
      subjectColumns: [
        { column: "subject_tenant_user_id", references: "tenant_user" }
      ],
      exportable: true,
      erasure: "severed_with_subject_row",
      rationale:
        "The segregation-of-duties decision log: each time this person's own permissions were tested for a conflict, and how it resolved. A decision recorded about them, so it is theirs to see."
    },
    {
      key: "identity_access.sod_conflict_exceptions",
      tableName: "awcms_sod_conflict_exceptions",
      ownerModuleKey: "identity_access",
      subjectColumns: [
        { column: "subject_tenant_user_id", references: "tenant_user" },
        { column: "requested_by_tenant_user_id", references: "tenant_user" },
        { column: "approved_by_tenant_user_id", references: "tenant_user" }
      ],
      exportable: true,
      erasure: "severed_with_subject_row",
      rationale:
        "Approved exceptions letting this person hold a conflicting pair of duties, plus the exceptions they requested or approved for others. Maker and checker are both named on purpose — the record is worthless if either half can disappear."
    },
    {
      key: "identity_access.user_group_members",
      tableName: "awcms_user_group_members",
      ownerModuleKey: "identity_access",
      subjectColumns: [
        { column: "tenant_user_id", references: "tenant_user" },
        { column: "added_by_tenant_user_id", references: "tenant_user" }
      ],
      exportable: true,
      erasure: "severed_with_subject_row",
      rationale:
        "ADR-0081 — which groups this person belongs to, and therefore which roles reach them indirectly. Membership is a fact about them, and one they cannot otherwise see."
    },
    {
      key: "identity_access.user_groups",
      tableName: "awcms_user_groups",
      ownerModuleKey: "identity_access",
      subjectColumns: [
        { column: "created_by_tenant_user_id", references: "tenant_user" }
      ],
      exportable: false,
      erasure: "severed_with_subject_row",
      rationale:
        "A group is the tenant's own access structure; this person appears only as the author stamp. Exporting it would hand a subject the tenant's group catalogue because they once created one of them."
    },
    {
      key: "identity_access.machine_credentials",
      tableName: "awcms_machine_credentials",
      ownerModuleKey: "identity_access",
      subjectColumns: [
        { column: "tenant_user_id", references: "tenant_user" },
        { column: "created_by_tenant_user_id", references: "tenant_user" },
        { column: "revoked_by_tenant_user_id", references: "tenant_user" }
      ],
      exportable: true,
      // ADR-0092. The one table here whose erasure is an ACT rather than a
      // consequence: a machine credential acts on the person's behalf, so
      // leaving it live after they have been erased leaves a working key
      // attached to somebody the system has agreed to forget. Revocation is
      // already modelled (`revoked_at`), so the status transition is the
      // existing mechanism rather than a new one.
      erasure: "status_transition_then_purge",
      rationale:
        "Non-interactive credentials issued to this person, which act with their authority. They export because knowing which keys exist in their name is exactly what a subject needs to check; the secret itself never leaves.",
      redactedColumns: ["token_hash"]
    },
    {
      key: "identity_access.invitations",
      tableName: "awcms_invitations",
      ownerModuleKey: "identity_access",
      subjectColumns: [
        { column: "accepted_tenant_user_id", references: "tenant_user" },
        { column: "invited_by_tenant_user_id", references: "tenant_user" },
        { column: "revoked_by_tenant_user_id", references: "tenant_user" }
      ],
      exportable: true,
      // `login_identifier` and `display_name` are the invitee's own contact
      // details, copied into this row before they had an account. Severing the
      // identity does NOT reach them, which is exactly why this is the answer
      // and `severed_with_subject_row` would be a lie.
      erasure: "anonymize",
      rationale:
        "How this person came to be in the tenant, and the invitations they sent or revoked. Note the honest limit of a per-tenant answer: an invitation that was never accepted names an email address belonging to somebody who never became a tenant user, and ADR-0094 gives them no subject request to make here.",
      redactedColumns: ["token_hash"],
      // The two columns the comment above already argued for, now actually
      // written. `token_hash` is globally UNIQUE and `login_identifier` is
      // unique among pending rows, so both take a per-row sentinel: a person
      // who sent two invitations used to abort the whole erasure on a 23505,
      // mid-transaction, with the request already claimed.
      anonymizedColumns: ["token_hash", "login_identifier", "display_name"]
    },
    {
      key: "identity_access.registration_requests",
      tableName: "awcms_registration_requests",
      ownerModuleKey: "identity_access",
      subjectColumns: [
        { column: "created_identity_id", references: "identity" },
        { column: "reviewed_by_tenant_user_id", references: "tenant_user" }
      ],
      exportable: true,
      // Same reason as invitations: `login_identifier`/`display_name` are a
      // copy taken before the identity existed.
      erasure: "anonymize",
      rationale:
        "The self-registration request this person's account was created from, and the requests they reviewed. Carries the name and address they supplied themselves, which no other table holds in that original form.",
      // "Carries the name and address they supplied themselves" — and until
      // ADR-0108 this descriptor named no column, so the erasure wrote nothing
      // at all here. `login_identifier` is unique among pending rows.
      anonymizedColumns: ["login_identifier", "display_name"]
    },
    {
      key: "identity_access.mfa_challenges",
      tableName: "awcms_mfa_challenges",
      ownerModuleKey: "identity_access",
      subjectColumns: [{ column: "identity_id", references: "identity" }],
      // A challenge is a few minutes of protocol state, superseded on the next
      // attempt. There is nothing in it a subject could act on, and handing
      // back live challenge material would be a credential-disclosure channel
      // dressed as a privacy right.
      exportable: false,
      erasure: "hard_delete",
      rationale:
        "Short-lived step-up challenge state. Not exported because it says nothing about the person that outlives the minute it existed for, and deleted outright because nothing cites a challenge as evidence.",
      redactedColumns: ["challenge_token_hash"]
    },
    {
      key: "identity_access.oidc_auth_requests",
      tableName: "awcms_oidc_auth_requests",
      ownerModuleKey: "identity_access",
      subjectColumns: [{ column: "identity_id", references: "identity" }],
      exportable: false,
      erasure: "hard_delete",
      rationale:
        "In-flight OIDC state/nonce for a sign-in that is either finishing or abandoned. Held for the same reason as an MFA challenge and discarded on the same grounds.",
      redactedColumns: ["state_hash", "nonce", "code_verifier"]
    },
    {
      key: "identity_access.session_handoff_codes",
      tableName: "awcms_session_handoff_codes",
      ownerModuleKey: "identity_access",
      subjectColumns: [{ column: "identity_id", references: "identity" }],
      exportable: false,
      erasure: "hard_delete",
      rationale:
        "Single-use codes that move an authenticated session between origins. A live one is a bearer credential, so it is neither exported nor kept.",
      redactedColumns: ["code_hash"]
    },
    {
      key: "identity_access.password_reset_tokens",
      tableName: "awcms_password_reset_tokens",
      ownerModuleKey: "identity_access",
      subjectColumns: [{ column: "identity_id", references: "identity" }],
      exportable: false,
      erasure: "hard_delete",
      rationale:
        "Single-use reset tokens. The row already has a short retention of its own (ADR-0037); an erasure ends it immediately rather than waiting, and the hash is never exported.",
      redactedColumns: ["token_hash"]
    },
    {
      key: "identity_access.auth_providers",
      tableName: "awcms_auth_providers",
      ownerModuleKey: "identity_access",
      subjectColumns: [
        { column: "created_by", references: "tenant_user" },
        { column: "updated_by", references: "tenant_user" },
        { column: "deleted_by", references: "tenant_user" }
      ],
      exportable: false,
      erasure: "severed_with_subject_row",
      rationale:
        "Tenant SSO configuration. This person appears only as the administrator who configured it — `allowed_email_domains` is a rule about addresses, not an address belonging to anyone."
    },
    {
      key: "identity_access.tenant_auth_policies",
      tableName: "awcms_tenant_auth_policies",
      ownerModuleKey: "identity_access",
      subjectColumns: [
        { column: "updated_by", references: "tenant_user" },
        // The reason `jsonb_array_contains` exists. This column is a jsonb
        // LIST of the identities exempt from SSO, and holding a break-glass
        // exemption is a fact about a person that appears nowhere else. Named
        // with `updated_by` rather than instead of it — the same person is
        // rarely both.
        {
          column: "break_glass_identity_ids",
          references: "identity",
          match: "jsonb_array_contains"
        }
      ],
      exportable: true,
      erasure: "anonymize",
      rationale:
        "Whether this person holds a break-glass exemption from the tenant's SSO requirement — a standing privilege they are entitled to know about. Anonymised rather than severed because their id sits INSIDE a jsonb list that anonymising the identity row does not reach: the entry has to be removed, or an erased person keeps a bypass.",
      redactedColumns: ["allowed_email_domains"],
      // Deliberately EMPTY, and this is the descriptor that shows why the two
      // lists had to be separated in the other direction too.
      // `allowed_email_domains` is withheld from the export because it is the
      // TENANT's policy rather than the subject's data — and for exactly that
      // reason an erasure must not wipe it. One list meant "never export" and
      // "destroy on erasure" were the same declaration; here they are opposite
      // answers about one column. The erasure that DOES happen on this row is
      // the `jsonb_array_contains` removal of the person's break-glass entry.
      anonymizedColumns: []
    },
    {
      key: "identity_access.tenant_mfa_policies",
      tableName: "awcms_tenant_mfa_policies",
      ownerModuleKey: "identity_access",
      subjectColumns: [{ column: "updated_by", references: "tenant_user" }],
      exportable: false,
      erasure: "severed_with_subject_row",
      rationale:
        "The tenant's MFA requirement. A policy about everyone is not personal data about anyone; the only link is the administrator stamp."
    },
    {
      key: "identity_access.tenant_entitlements",
      tableName: "awcms_tenant_entitlements",
      ownerModuleKey: "identity_access",
      subjectColumns: [
        { column: "granted_by_tenant_user_id", references: "tenant_user" }
      ],
      exportable: false,
      erasure: "severed_with_subject_row",
      rationale:
        "ADR-0084. Which commercial capabilities the TENANT has bought. The subject appears only as the operator who granted one."
    },
    {
      key: "identity_access.partner_managed_tenants",
      tableName: "awcms_partner_managed_tenants",
      ownerModuleKey: "identity_access",
      subjectColumns: [
        { column: "engaged_by_tenant_user_id", references: "tenant_user" }
      ],
      exportable: false,
      erasure: "severed_with_subject_row",
      rationale:
        "ADR-0089/ADR-0093. A commercial relationship between two tenants; the subject appears only as the person who recorded the engagement."
    },

    {
      key: "identity_access.access_assignments",
      tableName: "awcms_access_assignments",
      ownerModuleKey: "identity_access",
      subjectColumns: [
        { column: "tenant_user_id", references: "tenant_user" },
        { column: "assigned_by", references: "tenant_user" }
      ],
      exportable: true,
      erasure: "severed_with_subject_row",
      // RETIRED by ADR-0079/sql/103, and the descriptor has to exist anyway:
      // the rows are still there and still say which roles a person once held.
      // `access:grant-readers:check` forbids naming this table precisely so no
      // reader drifts back onto it, and that gate allows this ONE shape — a
      // `tableName:` field — because declaring a table is not reading it.
      rationale:
        "Historical role assignments. ADR-0079 retired this table: nothing writes it and `activeRoleGrants` is the definition of a live grant, so these rows answer 'which roles this person was given BEFORE the cut-over' and never 'what they can do now'. Frozen history is still personal data, which is why it is answered rather than passed over."
    },
    {
      key: "identity_access.access_policies",
      tableName: "awcms_access_policies",
      ownerModuleKey: "identity_access",
      subjectColumns: [
        { column: "tenant_user_id", references: "tenant_user" },
        { column: "granted_by_tenant_user_id", references: "tenant_user" },
        { column: "revoked_by_tenant_user_id", references: "tenant_user" }
      ],
      exportable: true,
      erasure: "severed_with_subject_row",
      rationale:
        "ADR-0078 — scoped, time-bounded grants naming this person as subject, plus the ones they granted or revoked. `reason` and `revoke_reason` are free text an administrator wrote ABOUT them, which is precisely the kind of thing a subject-access request exists to surface."
    },
    {
      key: "identity_access.access_policy_events",
      tableName: "awcms_access_policy_events",
      ownerModuleKey: "identity_access",
      subjectColumns: [
        { column: "actor_tenant_user_id", references: "tenant_user" }
      ],
      exportable: true,
      erasure: "severed_with_subject_row",
      rationale:
        "The append-only history behind the grants above — every grant, revocation and expiry this person performed."
    },
    {
      key: "identity_access.roles",
      tableName: "awcms_roles",
      ownerModuleKey: "identity_access",
      subjectColumns: [
        { column: "deleted_by", references: "tenant_user" },
        { column: "restored_by", references: "tenant_user" }
      ],
      exportable: false,
      erasure: "severed_with_subject_row",
      rationale:
        "A role is the tenant's own access vocabulary, not anybody's personal data; this person appears only as the administrator who retired or restored one. `delete_reason` is about the ROLE."
    },
    {
      key: "identity_access.identity_mfa_factors",
      tableName: "awcms_identity_mfa_factors",
      ownerModuleKey: "identity_access",
      subjectColumns: [{ column: "identity_id", references: "identity" }],
      exportable: true,
      // NOT `hard_delete`, and the correction is worth the comment: ADR-0087 /
      // `sql/114` RETIRED this table to read-only history and revoked
      // INSERT/UPDATE/DELETE from `awcms_app`, asserting it in BOTH directions
      // — "regaining INSERT fails as loudly as losing SELECT". An erasure that
      // tried to delete here would take a 42501 mid-transaction, after the
      // request had already been claimed, and granting the privilege back to
      // fix it would undo the control ADR-0087 exists to impose.
      //
      // Severance is also the truthful answer: the rows reach the person only
      // through `identity_id`, so anonymising the identity makes this history
      // resolve to nobody without anything being written.
      erasure: "severed_with_subject_row",
      rationale:
        "Which second factors this person enrolled in THIS tenant before ADR-0087 moved MFA to the principal. Read-only history since `sql/114`: exported because knowing an authenticator was enrolled in their name is theirs to know, and written by nothing because the runtime may not write it at all. The shared secret never leaves.",
      redactedColumns: ["secret_ciphertext"]
    },
    {
      key: "identity_access.identity_mfa_recovery_codes",
      tableName: "awcms_identity_mfa_recovery_codes",
      ownerModuleKey: "identity_access",
      subjectColumns: [{ column: "identity_id", references: "identity" }],
      // How many codes are left is useful; the codes are bearer credentials,
      // and an export that carried them would be a privacy right handing out a
      // way past the second factor it belongs to.
      exportable: true,
      // Retired read-only alongside the factor table above (ADR-0087,
      // `sql/114`) — same reasoning, and the codes are inert anyway: nothing
      // verifies against this table any more.
      erasure: "severed_with_subject_row",
      rationale:
        "Recovery codes for the retired per-tenant factors above — exported as the FACT of them (issued, used, unused) with the code itself redacted. Nothing is written: `sql/114` made this history, and no login path consults it, so a surviving row is a record rather than a bypass.",
      redactedColumns: ["code_hash"]
    },

    // ---- Global tables (ADR-0094 Decision 1) --------------------------------
    //
    // These hold personal data and are NOT answered here, because they have no
    // tenant column and a per-tenant request has no standing to read them.
    // Named rather than omitted: a report that silently skips
    // `awcms_principals` is indistinguishable from one written before that
    // table existed. `SubjectPlan.globalEntries` carries them to the operator.
    {
      key: "identity_access.principals",
      tableName: "awcms_principals",
      ownerModuleKey: "identity_access",
      tenantColumn: null,
      subjectColumns: [{ column: "id", references: "principal" }],
      exportable: false,
      erasure: "retain_under_obligation",
      rationale:
        "ADR-0087 — the global person behind every tenant membership, holding the normalised email they sign in with. One tenant may not hand over, or destroy, the record that spans all the others: erasing it here would silently log the same human out of tenants this controller has no relationship with. Answering it needs a platform-level request, which ADR-0094 deliberately does not create."
    },
    {
      key: "identity_access.principal_mfa_factors",
      tableName: "awcms_principal_mfa_factors",
      ownerModuleKey: "identity_access",
      tenantColumn: null,
      subjectColumns: [{ column: "principal_id", references: "principal" }],
      exportable: false,
      erasure: "retain_under_obligation",
      rationale:
        "ADR-0087 — MFA factors belong to the global principal, not to a membership. Same boundary as the row above, and the same reason: a tenant that could delete these could lock a person out of every other tenant.",
      redactedColumns: ["secret_ciphertext"]
    },
    {
      key: "identity_access.principal_mfa_recovery_codes",
      tableName: "awcms_principal_mfa_recovery_codes",
      ownerModuleKey: "identity_access",
      tenantColumn: null,
      subjectColumns: [{ column: "principal_id", references: "principal" }],
      exportable: false,
      erasure: "retain_under_obligation",
      rationale:
        "ADR-0087 — recovery codes for the factors above, global for the same reason and out of a per-tenant answer's reach for the same reason.",
      redactedColumns: ["code_hash"]
    },
    {
      key: "identity_access.principal_preferences",
      tableName: "awcms_principal_preferences",
      ownerModuleKey: "identity_access",
      tenantColumn: null,
      subjectColumns: [{ column: "principal_id", references: "principal" }],
      exportable: false,
      erasure: "retain_under_obligation",
      rationale:
        "ADR-0095 — the human's UI locale and colour theme. Personal data (it is a statement about a person), and global for the reason ADR-0095 §\"Keputusan 1\" gives: the language someone reads is a property of them, not of one membership, and ADR-0088's tenant-selection screen renders before any tenant exists to scope it to. Held back from a per-tenant answer on the same boundary as the three rows above — a tenant that could erase this would silently change how the same human reads every OTHER tenant's admin, and one that could export it would be handing over a choice the person made to the platform rather than to them. The row is not, however, a secret: it holds no hash, token or address, so nothing here is redacted, and a platform-level request could answer it in full whenever ADR-0094's deliberate omission of one is revisited."
    },

    // ---- Reaching nobody ---------------------------------------------------
    //
    // Six tables in this module have no person on them at all: rules, policies
    // and catalogues. They answer here rather than in `NO_SUBJECT_DATA`
    // because this module owns them, and because the day one of them gains a
    // `created_by` the entry that must change should sit next to the schema
    // that changed.
    {
      key: "identity_access.abac_policies",
      tableName: "awcms_abac_policies",
      ownerModuleKey: "identity_access",
      unreachableBySubject: true,
      subjectColumns: [],
      exportable: false,
      erasure: "retain_under_obligation",
      rationale:
        "ADR-0079 — attribute rules evaluated against a request. A policy describes CONDITIONS, not the people they happen to match; who it was applied to is recorded in the decision log, which answers for itself."
    },
    {
      key: "identity_access.invitation_policies",
      tableName: "awcms_invitation_policies",
      ownerModuleKey: "identity_access",
      unreachableBySubject: true,
      subjectColumns: [],
      exportable: false,
      erasure: "retain_under_obligation",
      rationale:
        "Per-tenant rules about who may be invited and on what terms. A standing rule with no author column and no invitee on it — the invitations themselves carry the people."
    },
    {
      key: "identity_access.role_permissions",
      tableName: "awcms_role_permissions",
      ownerModuleKey: "identity_access",
      unreachableBySubject: true,
      subjectColumns: [],
      exportable: false,
      erasure: "retain_under_obligation",
      rationale:
        "Which permission keys a role carries. Two keys per row; the people are in the assignments that grant those roles, and those answer for themselves."
    },
    {
      key: "identity_access.partners",
      tableName: "awcms_partners",
      ownerModuleKey: "identity_access",
      unreachableBySubject: true,
      subjectColumns: [],
      exportable: false,
      erasure: "retain_under_obligation",
      rationale:
        "ADR-0089 — the platform registry of partner ORGANISATIONS. `display_name` is a company, and the row links two tenants rather than naming any person; the individuals acting under a partnership are in the delegated grants."
    },
    {
      key: "identity_access.tenant_subscriptions",
      tableName: "awcms_tenant_subscriptions",
      ownerModuleKey: "identity_access",
      unreachableBySubject: true,
      subjectColumns: [],
      exportable: false,
      erasure: "retain_under_obligation",
      rationale:
        "ADR-0084 — which plan a tenant is on. A commercial fact about the organisation, with no purchaser column and a statutory-billing reason to keep it."
    },
    {
      key: "identity_access.bff_clients",
      tableName: "awcms_bff_clients",
      ownerModuleKey: "identity_access",
      unreachableBySubject: true,
      subjectColumns: [],
      exportable: false,
      erasure: "retain_under_obligation",
      rationale:
        "Registered backend-for-frontend clients — a key, a secret hash and allowed redirect URIs. A client is an APPLICATION, not a person, and no column records who registered it.",
      redactedColumns: ["secret_hash"]
    }
  ],
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
     * `awcms_invitations` (sql/106) — ADR-0082. `generic` for the same reason
     * the two above are: once an invitation is accepted, revoked, or aged out
     * there is no module-owned sweep to delegate to.
     *
     * The window matches `awcms_registration_requests` (90d default, 7d floor)
     * because the rows answer the same question from the other direction — who
     * was offered membership, by whom, and what became of it — and the
     * `invitation_accepted` audit row points AT this row. The floor exists so
     * an investigation opened days after the fact still finds what its audit
     * trail refers to.
     *
     * Two consequences of `generic` that are stated rather than discovered:
     *
     * A purge deletes by AGE alone, with no status predicate, so a 90-day-old
     * row still marked `pending` goes too. That is correct — its link expired
     * long before, and `evaluateInvitation` answers from `expires_at` rather
     * than from the status value, so nothing was holding it open.
     *
     * And `awcms_invitation_policies` is removed WITH its parent, by the
     * `ON DELETE CASCADE` in `sql/106`. Without that cascade this purge would
     * abort on the child's foreign key and the retention would silently never
     * run — a failure the descriptor's own validation cannot see, because it
     * checks shape rather than executability.
     */
    {
      key: "identity_access.invitations",
      tableName: "awcms_invitations",
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
          "One row per offer, issued only by a permission holder and capped at five resends per row — nowhere near the volume profile partitioning exists for."
      },
      archive: {
        archivable: false,
        rationale:
          "An accepted invitation's durable record is the audit event and the membership it produced, not this row. Archiving would preserve an address belonging to someone who may never have accepted, past the window this retention exists to close."
      },
      deletion: {
        mode: "hard_delete",
        rationale:
          "`status` already records the outcome and there is nothing further to transition to; the row's only sensitive column is the invitee's address, which anonymization would empty rather than preserve. `token_hash` is a one-way sha256 of a value that is single-use and expired anyway."
      },
      legalHold: {
        applicable: false,
        precedence: "not_applicable"
      },
      requiredIndexes: [
        {
          columns: ["tenant_id", "created_at"],
          purpose:
            "awcms_invitations_tenant_created_idx (sql/106) — the engine's own cursor path (WHERE tenant_id = ? AND created_at < ?), added by this table's migration for it rather than borrowed from the queue index, whose leading `status` column does not serve a cursor scan."
        }
      ],
      batchLimit: 5000,
      backupRestoreNotes:
        "Included in ordinary full-database backup/restore; no standalone archive artifact exists (archive.archivable is false above). Restoring an old backup can revive invitations that had already expired — they stay unusable, because `evaluateInvitation` decides against the clock rather than against the status value. A revived `accepted` row is likewise harmless: the membership it names either exists in the same backup or the row's foreign key would not have restored.",
      executionMode: "generic"
    },
    /**
     * `awcms_delegated_access_grants` (sql/117) — ADR-0090.
     *
     * A descriptor rather than a `BOUNDED_BY_DESIGN` entry, and the difference
     * is real: the two partner tables one migration earlier hold the PRESENT
     * (one row per engagement, deleted when severed), while this table
     * accumulates one row per support episode and keeps them after they end.
     * That grows with how often a customer asks for help, which is traffic
     * wearing a slower clock.
     *
     * 365 days, matching `awcms_abac_decision_logs` below rather than the 90 of
     * the invitation tables above, and for the same reason that one is 365: this
     * row is what a cross-organisation access question is answered FROM. "Who
     * from our vendor could see our data last March, approved by whom, until
     * when" is asked during an audit or a breach, both of which arrive late. An
     * `audit_security`, not `operational_queue` — the rows are evidence, not a
     * work queue, and legal hold overrides the purge for the same reason.
     *
     * `generic` is safe here in a way it is NOT for most tables in this list,
     * and the reason is `revoked_at`: an age-only purge with no status predicate
     * deletes live grants everywhere else, but a grant older than 365 days
     * CANNOT be live — `sql/117` caps its TTL at 31. There is no live row old
     * enough for the sweep to reach.
     */
    {
      key: "identity_access.delegated_access_grants",
      tableName: "awcms_delegated_access_grants",
      ownerModuleKey: "identity_access",
      scope: "tenant",
      cursorColumn: "created_at",
      retentionClass: "audit_security",
      retentionMinDays: 90,
      retentionMaxDays: 2555,
      defaultRetentionDays: 365,
      partition: {
        eligible: false,
        rationale:
          "One row per support episode granted to a partner — a volume set by how often customers ask for help, orders of magnitude below the decision-log and analytics tables partitioning exists for."
      },
      archive: {
        archivable: false,
        rationale:
          "The row's evidentiary content is already duplicated into `awcms_audit_events` at approval and at revocation, and those carry their own retention. Archiving a second copy would extend the life of a partner's identity data past the window this retention exists to close."
      },
      deletion: {
        mode: "hard_delete",
        rationale:
          "Nothing to anonymize that is not a foreign key the identity tables hold anyway, and no status to transition to — `revoked_at` already records the end of the reach. The membership the grant printed is deactivated at revocation, not at purge, so deleting the row removes a record rather than an access path."
      },
      legalHold: {
        applicable: true,
        precedence: "overrides_retention"
      },
      requiredIndexes: [
        {
          columns: ["tenant_id", "created_at"],
          purpose:
            "awcms_delegated_access_grants_tenant_created_idx (sql/117) — the engine's own cursor path (WHERE tenant_id = ? AND created_at < ?), added by this table's migration for it rather than reused from a lookup index that happens to fit."
        }
      ],
      batchLimit: 1000,
      backupRestoreNotes:
        "Included in ordinary full-database backup/restore. Restoring an old backup CAN revive a revoked grant row, and that is inert: the reach it describes lived in `awcms_tenant_users`, whose row restores deactivated, and in sessions, which restore revoked and expired. A revived grant with a non-NULL `access_code_hash` is likewise dead — every redemption path re-checks `expires_at`, and `sql/117` caps it at 31 days.",
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
