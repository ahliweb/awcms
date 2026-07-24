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
import { mediaLibraryModule } from "./media-library/module";
import { blogContentModule } from "./blog-content/module";
import { newsPortalModule } from "./news-portal/module";
import { tenantDomainModule } from "./tenant-domain/module";
import { visitorAnalyticsModule } from "./visitor-analytics/module";

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
  // ADR-0036 media-library ownership inversion (adapting awcms-micro ADR-0026):
  // the tenant media registry + presigned-upload flow + reconciliation job,
  // EXTRACTED out of news_portal, plus the managed-media enforcement switch.
  // Depends only on tenant_admin/identity_access (both above); PROVIDES the
  // `media_library` capability (consumed by blog_content optionally + news_portal
  // required), but capability edges are not DAG edges, so the graph stays
  // acyclic. Listed BEFORE blog_content/news_portal for readability (they consume
  // it). See src/modules/media-library/module.ts's `description`.
  mediaLibraryModule,
  // Ported from awcms-mini (tenant-scoped blog/content management). Depends
  // on tenant_admin/identity_access/module_management/logging, all already
  // above in this list, so the DAG stays acyclic. See
  // src/modules/blog-content/module.ts and module.ts's own `description`
  // field for what was ported vs. dropped.
  blogContentModule,
  // Ported from awcms-mini (editorial homepage sections, R2-only ad placements).
  // ADR-0036 moved the media registry + presigned upload flow + reconciliation
  // job OUT of this module into media_library. Depends on
  // tenant_admin/identity_access/module_management/logging (all above); no longer
  // PROVIDES `news_media` (retired) and now CONSUMES `media_library` (required —
  // ad placements FK a media object) + blog_content's `public_content`, but
  // capability edges are not DAG edges, so the graph stays acyclic. See
  // src/modules/news-portal/module.ts's `description` for what was ported/moved.
  newsPortalModule,
  // Ported from awcms-micro (epic #555): tenant hostname/subdomain -> tenant
  // mapping for host-based public routing, plus a SECURITY DEFINER host-lookup
  // bootstrap function and the additive public host resolver. Depends only on
  // tenant_admin/identity_access (both above), so the DAG stays acyclic. See
  // src/modules/tenant-domain/module.ts's `description` for what was ported vs.
  // deferred.
  tenantDomainModule,
  // Ported from awcms-micro (epic #617-#624): privacy-first human visitor
  // analytics. Standalone/additive — depends only on
  // tenant_admin/identity_access/logging/reporting (all above), so the DAG
  // stays acyclic. Collection is an additive PUBLIC ingest endpoint (not
  // middleware); the data_lifecycle legal-hold coupling and the news_portal
  // preset wiring are dropped/deferred. See
  // src/modules/visitor-analytics/module.ts's `description`.
  visitorAnalyticsModule
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
