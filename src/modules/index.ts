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
import { tenantDomainModule } from "./tenant-domain/module";
import { visitorAnalyticsModule } from "./visitor-analytics/module";
import { dataLifecycleModule } from "./data-lifecycle/module";
import { seoDistributionModule } from "./seo-distribution/module";
import { formDraftsModule } from "./form-drafts/module";
import { siteSearchModule } from "./site-search/module";
import { newsletterModule } from "./newsletter/module";
import { siteProfileModule } from "./site-profile/module";
import { commentsModule } from "./comments/module";
import { idnAdminRegionsModule } from "./idn-admin-regions/module";
import { pushDeliveryModule } from "./push-delivery/module";

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
  // ADR-0044 retired `news_portal`; the comment block that stood here described
  // that entry and outlived it. What it recorded is not lost: the editorial
  // homepage sections and R2-only ad placements it named now belong to
  // `blogContentModule` above (and say so in its own `description`), and the
  // media registry ADR-0036 moved out of it belongs to `mediaLibraryModule`.
  //
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
  // middleware); the news_portal preset wiring is deferred. The data_lifecycle
  // legal-hold coupling (dropped at its original port) is RE-WIRED by
  // dataLifecycleModule below (ADR-0037). See
  // src/modules/visitor-analytics/module.ts's `description`.
  visitorAnalyticsModule,
  // Ported from awcms-micro (Issue #745, ADR-0037): System Foundation retention
  // governance + legal-hold engine (module-contributed high-volume table
  // registry, dry-run planning, bounded archive/purge on the worker runner,
  // provider-neutral archive port). Depends only on
  // tenant_admin/identity_access/logging (all above), so the DAG stays acyclic.
  // Provides the source-level LegalHoldGuardPort that logging and
  // visitor_analytics consume at their purge composition roots (NOT a
  // capability-registry entry). See src/modules/data-lifecycle/module.ts's
  // `description`.
  dataLifecycleModule,
  // Ported from awcms-micro (ADR-0038, adapting awcms-micro ADR-0028): the DISCOVERY
  // scope of `seo_distribution` — the central SEO metadata renderer + public
  // discovery/syndication surfaces (robots.txt, sitemap index/child, RSS/Atom/JSON
  // feeds) + the tenant SEO config admin API. Depends only on
  // tenant_admin/identity_access (both above), so the DAG stays acyclic. It is the
  // CONSUMER/aggregator of the frozen `seo_facts` capability (`blog_content`
  // provides it, optional) + `media_library` (optional); capability edges are not
  // DAG edges. Redirect governance + 404 telemetry are DEFERRED to a follow-up PR.
  // See src/modules/seo-distribution/module.ts's `description`.
  seoDistributionModule,
  // Ported from awcms-micro (Issue #484), Gelombang-1 row 1 of
  // docs/awcms/absorb-awcms-micro-roadmap.md: a generic, domain-agnostic
  // server-side draft store for multi-step forms. Net-new and additive —
  // depends only on identity_access (above), so the DAG stays acyclic, and
  // nothing consumes it yet. Registers a `delegated` data_lifecycle descriptor
  // whose real purge (and legal-hold check) stays in this module's own
  // `purgeExpiredFormDrafts`. The awcms-micro wizard COMPONENT library is a
  // separate, still-open Gelombang-0 row and is not part of this port. See
  // src/modules/form-drafts/module.ts's `description`.
  formDraftsModule,
  // Ported from awcms-micro (Issue #270, ADR-0040), Gelombang-1 of
  // docs/awcms/absorb-awcms-micro-roadmap.md: the tenant-scoped, cross-content
  // PostgreSQL full-text search index + public query/suggest surface + admin
  // index/settings/diagnostics API. Depends only on tenant_admin/identity_access
  // (both above), so the DAG stays acyclic, and no existing module depends on
  // it: content modules CONTRIBUTE reviewed, pure-data `searchSources`
  // descriptors (blog_content declares `blog_content.post`) that this module's
  // generic engine reads through `listModules()` — a descriptor-list seam, not a
  // capability `provides`, precisely because many providers are expected. See
  // src/modules/site-search/module.ts's `description`.
  siteSearchModule,
  // Issue #596 / ADR-0102 — per-tenant SITE CHROME (masthead, footer,
  // editorial address, contact details, social links). Listed after
  // `site_search` because it depends on `seo_distribution` and
  // `media_library`, both of which appear above it; the DAG check enforces
  // that ordering rather than trusting this comment.
  newsletterModule,
  siteProfileModule,
  // Ported from awcms-micro (Issue #271, ADR-0041), Gelombang-1 of
  // docs/awcms/absorb-awcms-micro-roadmap.md: moderation-first commenting over
  // PUBLISHED, PUBLIC resources. Depends only on tenant_admin/identity_access
  // (both above), so the DAG stays acyclic, and no existing module depends on
  // it: content modules CONTRIBUTE reviewed, pure-data `commentableResources`
  // descriptors (blog_content declares `blog_content.post`) that this module's
  // generic engine reads through `listModules()` — a descriptor-list seam, not a
  // capability `provides`, precisely because many providers are expected. The
  // same shape site_search uses one entry up. See
  // src/modules/comments/module.ts's `description`.
  commentsModule,
  // Admitted by ADR-0046 (adapted from awcms-mini's epic #654 scaffold, whose
  // import/lookup half was never built there): versioned master data for
  // Indonesia's administrative hierarchy, imported from a vendored third-party
  // dump under `data/idn-admin-regions/`. Depends only on
  // tenant_admin/identity_access (both above), so the DAG stays acyclic, and
  // nothing depends on it — consumers read its lookup API rather than importing
  // it. Its two tables are the first GLOBAL, non-tenant-scoped domain tables in
  // this base: the rows are identical for every tenant, which is why they carry
  // no `tenant_id`/RLS and are instead registered in
  // `GLOBAL_TABLE_FORBIDDEN_PRIVILEGES` with per-role privileges spelled out.
  // See src/modules/idn-admin-regions/module.ts's `description`.
  idnAdminRegionsModule,
  // Admitted by ADR-0074 (epic #463): a transactional outbox for device push
  // notifications. It is a SECOND outbox deliberately — `domain_event_runtime`
  // above calls its consumers INSIDE the claim transaction by design, and
  // ADR-0006 forbids the external HTTP call a push provider needs from inside a
  // transaction, so hanging push off domain events would violate that rule
  // without a single gate going red. Depends on tenant_admin/logging, both
  // already above, so the DAG stays acyclic; nothing depends on it yet.
  // See src/modules/push-delivery/module.ts's `description`.
  pushDeliveryModule
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
