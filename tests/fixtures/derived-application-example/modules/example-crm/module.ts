/**
 * Minimal fixture module (Issue #178, epic #177 "Kesiapan fondasi ERP
 * turunan", Wave 1) — illustrates what a real derived repository's own
 * `src/modules/<domain>/module.ts` looks like. NOT part of the base registry:
 * never imported by `src/modules/index.ts`, only by
 * `tests/fixtures/derived-application-example/application-registry.ts` and the
 * composition tests that exercise it
 * (`tests/module-composition-fixture.test.ts`).
 *
 * Depends on two base modules (`tenant_admin`, `identity_access`) — the same
 * baseline a real derived application module declares
 * (`docs/awcms/derived-application-guide.md`) — to prove composition
 * correctly validates a lifecycle dependency edge from an APPLICATION module
 * onto a BASE module. Provides the `example_crm_directory` capability and
 * consumes an OPTIONAL capability (`reporting_projection`) to exercise the
 * capability-binding checks without introducing a hard failure. `type` is
 * `"domain"` (awcms's `ModuleType` union has no `"derived"`, and the DB
 * `awcms_modules_module_type_check` constraint only permits
 * base/system/domain/integration — a derived module uses `"domain"`).
 */
import { defineModule } from "../../../../../src/modules/_shared/module-contract";

export const exampleCrmModule = defineModule({
  key: "example_crm",
  name: "Example CRM (fixture)",
  version: "0.1.0",
  status: "experimental",
  description:
    "Minimal in-repo fixture derived-application module (Issue #178) — illustrates a contact directory a real derived application (e.g. AWPOS's own crm module) might own. Never registered in the base repository.",
  dependencies: ["tenant_admin", "identity_access"],
  type: "domain",
  // A derived module owns its OWN OpenAPI fragment (Issue #182) and points at
  // it here — the base bundle never lists it. A derived repository's build
  // feeds every registered module's `openApiPath` to `buildBundledDocument`'s
  // `extraFragmentFiles` seam, which merges the fragment into the published
  // bundle WITHOUT editing any base fragment. Exercised by
  // `tests/openapi-derived-fragment.test.ts`.
  api: {
    openApiPath:
      "tests/fixtures/derived-application-example/openapi/modules/example-crm.openapi.yaml",
    basePath: "/api/v1/example-crm"
  },
  compatibility: {
    // Declared purely to exercise Issue #178's deployment-profile composition
    // metadata; its own dependencies declare no `deploymentProfiles`
    // constraint, so this is compatible by construction (absence = every
    // profile), not a real restriction.
    deploymentProfiles: ["development", "offline-lan"]
  },
  capabilities: {
    // Issue #180 — a derived module PROVIDES the `business_scope_hierarchy`
    // capability that base `identity_access` optionally consumes. The
    // concrete adapter is `business-scope-hierarchy-adapter.ts` in this same
    // fixture directory (a dummy in-memory resolver); a real derived module
    // would walk its own effective-dated organization tables. Proves the
    // capability seam end-to-end without a real domain module in the base.
    provides: ["example_crm_directory", "business_scope_hierarchy"],
    consumes: [
      {
        capability: "reporting_projection",
        providedBy: "reporting",
        // Optional: never checked by composition — proves the "optional
        // consume degrades safely" branch of `capability_provider_missing`.
        optional: true
      }
    ]
  },
  permissions: [
    {
      activityCode: "contacts",
      action: "read",
      description: "Read example CRM contact directory entries (fixture)."
    },
    // Illustrative ERP-shaped permissions the SoD rules below pair off. A real
    // derived application declares its own real permissions; these exist only
    // so the fixture's `sodRules` reference coherent keys.
    {
      activityCode: "invoice",
      action: "create",
      description: "Create a customer invoice (fixture)."
    },
    {
      activityCode: "invoice",
      action: "approve",
      description: "Approve a customer invoice (fixture)."
    },
    {
      activityCode: "payment",
      action: "create",
      description: "Record a vendor payment (fixture)."
    },
    {
      activityCode: "payment",
      action: "approve",
      description: "Approve a vendor payment (fixture)."
    },
    {
      activityCode: "vendor",
      action: "create",
      description: "Create a vendor master record (fixture)."
    },
    {
      activityCode: "journal",
      action: "create",
      description: "Create an accounting journal entry (fixture)."
    },
    {
      activityCode: "journal",
      action: "post",
      description: "Post an accounting journal entry to the ledger (fixture)."
    },
    {
      activityCode: "requisition",
      action: "create",
      description: "Create a purchase requisition (fixture)."
    },
    {
      activityCode: "requisition",
      action: "approve",
      description: "Approve a purchase requisition (fixture)."
    }
  ],
  // ILLUSTRATIVE segregation-of-duties rules (Issue #181). These are examples
  // of what a DERIVED ERP application declares — NOT base rules (the base ships
  // none). They live here in the derived-application fixture precisely because
  // the issue requires "minimal lima contoh rule sebagai ilustrasi, bukan rule
  // base bawaan". Every rule is a GENERIC conflicting-permission-pair
  // declaration; none encodes what the permissions actually do. Validated by
  // `identity-access/domain/sod-rule-registry.ts` via
  // `tests/sod-rule-registry.test.ts` (base + this fixture composed).
  sodRules: [
    {
      // Same-scope maker/checker: whoever CREATES an invoice at a scope must
      // not also APPROVE one at that SAME scope (hierarchy-aware).
      ruleKey: "example_crm.invoice_maker_checker",
      ownerModuleKey: "example_crm",
      description:
        "A subject who can CREATE an invoice at a given business scope must not also be able to APPROVE an invoice at that SAME scope (maker/checker). Same-scope-only.",
      conflictingPermissionKeys: [
        "example_crm.invoice.create",
        "example_crm.invoice.approve"
      ],
      scopeApplicability: "same_scope_only",
      severity: "high",
      exceptionPolicy: {
        allowed: true,
        requiresApprovalPermission:
          "identity_access.business_scope_exceptions.approve",
        maxDurationDays: 30
      }
    },
    {
      // Critical maker/checker over money movement — NO exception allowed.
      ruleKey: "example_crm.payment_maker_checker",
      ownerModuleKey: "example_crm",
      description:
        "A subject who can RECORD a vendor payment must not also be able to APPROVE a vendor payment anywhere in the tenant (critical maker/checker over money movement). No exception permitted.",
      conflictingPermissionKeys: [
        "example_crm.payment.create",
        "example_crm.payment.approve"
      ],
      scopeApplicability: "global_within_tenant",
      severity: "critical",
      exceptionPolicy: { allowed: false }
    },
    {
      // Cross-activity conflict: creating a vendor AND approving its payments.
      ruleKey: "example_crm.vendor_payment_separation",
      ownerModuleKey: "example_crm",
      description:
        "A subject who can CREATE a vendor master record must not also be able to APPROVE vendor payments (vendor fraud separation). Global-within-tenant.",
      conflictingPermissionKeys: [
        "example_crm.vendor.create",
        "example_crm.payment.approve"
      ],
      scopeApplicability: "global_within_tenant",
      severity: "high",
      exceptionPolicy: {
        allowed: true,
        requiresApprovalPermission:
          "identity_access.business_scope_exceptions.approve",
        maxDurationDays: 14
      }
    },
    {
      // Journal create vs post — the classic accounting posting control.
      ruleKey: "example_crm.journal_posting_separation",
      ownerModuleKey: "example_crm",
      description:
        "A subject who can CREATE a journal entry must not also be able to POST it to the ledger (posting control). Critical, no exception permitted.",
      conflictingPermissionKeys: [
        "example_crm.journal.create",
        "example_crm.journal.post"
      ],
      scopeApplicability: "global_within_tenant",
      severity: "critical",
      exceptionPolicy: { allowed: false }
    },
    {
      // Same-scope requisition maker/checker.
      ruleKey: "example_crm.requisition_approval_separation",
      ownerModuleKey: "example_crm",
      description:
        "A subject who can CREATE a purchase requisition at a scope must not also be able to APPROVE one at that SAME scope (requester/approver separation). Same-scope-only.",
      conflictingPermissionKeys: [
        "example_crm.requisition.create",
        "example_crm.requisition.approve"
      ],
      scopeApplicability: "same_scope_only",
      severity: "medium",
      exceptionPolicy: {
        allowed: true,
        requiresApprovalPermission:
          "identity_access.business_scope_exceptions.approve",
        maxDurationDays: 7
      }
    },
    {
      // Cross-MODULE illustration: a derived app can declare a rule over BASE
      // permission keys — here, maker/checker over the SoD exception mechanism
      // itself (requesting vs approving an exception). No exception permitted
      // (allowing an override of the override control would be recursive).
      ruleKey: "example_crm.exception_override_maker_checker",
      ownerModuleKey: "example_crm",
      description:
        "A subject who can REQUEST a SoD conflict exception must not also be able to APPROVE one — maker/checker over the override mechanism itself. Global-within-tenant, no exception permitted.",
      conflictingPermissionKeys: [
        "identity_access.business_scope_exceptions.create",
        "identity_access.business_scope_exceptions.approve"
      ],
      scopeApplicability: "global_within_tenant",
      severity: "high",
      exceptionPolicy: { allowed: false }
    }
  ],
  navigation: [
    {
      labelKey: "fixture.example_crm.nav_contacts",
      path: "/admin/example-crm/contacts",
      order: 900,
      requiredPermission: "example_crm.contacts.read"
    }
  ],
  jobs: [
    {
      command: "bun run example-crm:reconcile",
      purpose:
        "Fixture-only job descriptor — proves composition validates contributed application modules' job shape (`validateJobDescriptor`); never actually registered as a real package.json script.",
      recommendedSchedule: "N/A — fixture only.",
      safeInOfflineLan: true
    }
  ]
});
