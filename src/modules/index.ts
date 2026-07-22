import type { ModuleDescriptor } from "./_shared/module-contract";
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
import { themingModule } from "./theming/module";
import { blogContentModule } from "./blog-content/module";
import { newsPortalModule } from "./news-portal/module";

/**
 * The reviewed BASE registry. Every module below is reviewed, in-repo code.
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
  reportingModule,
  // ADR-0034 Fase 3 — the first website module implemented directly in the base
  // (depends only on the two Core modules; provides no capability, so the DAG is
  // unchanged). See src/modules/theming/README.md.
  themingModule,
  // Ported from awcms-mini (tenant-scoped blog/content management). Depends
  // on tenant_admin/identity_access/module_management/logging, all already
  // above in this list, so the DAG stays acyclic. See
  // src/modules/blog-content/module.ts and module.ts's own `description`
  // field for what was ported vs. dropped.
  blogContentModule,
  // Ported from awcms-mini (R2-only news media registry + presigned upload
  // flow, editorial homepage sections, R2-only ad placements, and the
  // news-media reconciliation job). Depends on
  // tenant_admin/identity_access/module_management/logging (all above);
  // PROVIDES `news_media` (consumed by blog_content) and CONSUMES
  // blog_content's `public_content`, but capability edges are not DAG edges,
  // so the graph stays acyclic. See src/modules/news-portal/module.ts's
  // `description` for what was ported vs. dropped.
  newsPortalModule
];

/**
 * Base registry accessor. Retained as a distinct name from `listModules()`
 * for the composition/SoD/reporting gates that validate the reviewed base
 * registry explicitly.
 */
export function listBaseModules(): readonly ModuleDescriptor[] {
  return baseModules;
}

/**
 * The effective module registry. `index.ts` stays pure data — module load
 * never validates or throws; the registry's VALIDITY is a separate, explicit
 * check (`bun run modules:compose:check`, `bun run modules:dag:check`,
 * tests). Each entry keeps its own object identity from `baseModules`.
 *
 * NOTE: `modules` is a single stable module-level array reference (returned
 * as-is by `listModules()`, never rebuilt per call) — `descriptor-sync.ts`
 * relies on `descriptors === listModules()` identity to distinguish "syncing
 * the real global registry" from "syncing a synthetic/test array".
 */
export const modules: ModuleDescriptor[] = [...baseModules];

export function listModules(): ModuleDescriptor[] {
  return modules;
}

export function getModuleByKey(
  moduleKey: string
): ModuleDescriptor | undefined {
  return modules.find((module) => module.key === moduleKey);
}
