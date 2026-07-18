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
    provides: ["example_crm_directory"],
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
