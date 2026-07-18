import type { ModuleDescriptor } from "./_shared/module-contract";
import { applicationModuleRegistry } from "./application-registry";
import { mergeModuleRegistries } from "./module-management/domain/module-composition";
import { loggingModule } from "./logging/module";
import { tenantAdminModule } from "./tenant-admin/module";
import { profileIdentityModule } from "./profile-identity/module";
import { identityAccessModule } from "./identity-access/module";
import { moduleManagementModule } from "./module-management/module";
import { domainEventRuntimeModule } from "./domain-event-runtime/module";
import { syncStorageModule } from "./sync-storage/module";
import { workflowApprovalModule } from "./workflow-approval/module";
import { emailModule } from "./email/module";
import { reportingModule } from "./reporting/module";

/**
 * The reviewed BASE registry — unchanged in shape/order/content by Issue
 * #178. Every module below is reviewed, in-repo code; nothing here is
 * conditional on a derived repository's own contribution.
 */
const baseModules: ModuleDescriptor[] = [
  loggingModule,
  tenantAdminModule,
  profileIdentityModule,
  identityAccessModule,
  moduleManagementModule,
  domainEventRuntimeModule,
  syncStorageModule,
  workflowApprovalModule,
  emailModule,
  reportingModule
];

/** Base-only registry, regardless of any application registry — Issue #178's composition API. */
export function listBaseModules(): readonly ModuleDescriptor[] {
  return baseModules;
}

/**
 * Final, effective registry — `baseModules` merged with an optional
 * build-time application registry (`./application-registry.ts`, Issue #178).
 * Merge only, never validated here: `index.ts` stays pure data, exactly like
 * before this issue (`listModules()` used to be `return modules` with zero
 * validation) — the composed registry's VALIDITY is a separate, explicit
 * check (`bun run modules:compose:check`, `bun run modules:dag:check`,
 * `bun run extension:check`, tests), never something module load itself
 * throws on. In this base repository, `applicationModuleRegistry` is always
 * `undefined`, so `modules` below is a byte-identical pass-through of
 * `baseModules` — the exact same effective registry as before this change.
 *
 * NOTE: `modules` is a single stable module-level array reference (returned
 * as-is by `listModules()`, never rebuilt per call) — `descriptor-sync.ts`
 * relies on `descriptors === listModules()` identity to distinguish "syncing
 * the real global registry" from "syncing a synthetic/test array".
 */
export const modules: ModuleDescriptor[] = [
  ...mergeModuleRegistries(baseModules, applicationModuleRegistry)
];

export function listModules(): ModuleDescriptor[] {
  return modules;
}

export function getModuleByKey(
  moduleKey: string
): ModuleDescriptor | undefined {
  return modules.find((module) => module.key === moduleKey);
}
