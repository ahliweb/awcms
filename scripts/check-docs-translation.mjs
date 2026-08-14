#!/usr/bin/env bun
/**
 * check-docs-translation.mjs — documentation translation gates (ADR-0097).
 *
 * ENGLISH at the bare path is the source; Indonesian at `<name>.id.md` is the
 * mirror, and the mirror records the hash of the English it was translated from.
 * ADR-0023 ran this the other way; ADR-0097 inverts it and widens the scope from
 * three front-door documents to the whole corpus.
 *
 * Two questions, kept separate on purpose (see `lib/docs-i18n-checks.mjs`):
 * whether an existing mirror is CURRENT, and which documents have NO mirror yet.
 *
 * Pure logic lives in `scripts/lib/docs-i18n-checks.mjs`; this file does I/O and
 * exit codes. Run: `bun run check:docs:translation`.
 */
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import {
  checkMirrorCoverage,
  checkTranslationPair,
  deriveSourcePath
} from "./lib/docs-i18n-checks.mjs";

const ROOT = resolve(import.meta.dirname, "..");

/** @typedef {import("./lib/docs-i18n-checks.mjs").Problem} Problem */

/**
 * Documents whose language is decided by a GENERATOR or by an upstream spec, so
 * hand-translating the artefact would be overwritten on the next run.
 *
 * These are not exempt from being English — they are exempt from being mirrored
 * BY HAND. `api-reference.md` is regenerated from the OpenAPI `description`
 * fields (ADR-0023 already scoped it out for this reason, and ADR-0097 keeps
 * that carve-out); the other two are emitted by scripts in `scripts/`. Making
 * them English is a change to the generator or the spec, not to the file.
 */
const GENERATED_NOT_HAND_MIRRORED = new Set([
  "docs/awcms/api-reference.md",
  "docs/awcms/repo-inventory.md",
  "docs/awcms/agent-memory.md"
]);

/**
 * Documents still awaiting their Indonesian mirror.
 *
 * **This list may only SHRINK.** Removing an entry is how the migration records
 * progress; the gate rejects an entry whose mirror now exists, so the ledger
 * cannot overstate the debt and quietly stop being believed. Nothing new may be
 * added: a document written after ADR-0097 is written in English and mirrored in
 * the same change.
 *
 * It starts at 253 — the whole corpus minus the four documents ADR-0023 had
 * already paired and the three generated artefacts above.
 */
export const DOCS_AWAITING_MIRROR = [
  "docs/ARCHITECTURE.md",
  "docs/PROJECT_STATE.md",
  "docs/adr/0000-template.md",
  "docs/adr/0001-rebuild-on-awcms-foundation-erp-scope.md",
  "docs/adr/0002-bun-only-runtime.md",
  "docs/adr/0003-postgresql-rls-multi-tenant.md",
  "docs/adr/0004-rbac-abac-default-deny.md",
  "docs/adr/0005-soft-delete-and-immutability.md",
  "docs/adr/0006-offline-first-sync-outbox.md",
  "docs/adr/0007-openapi-asyncapi-contracts.md",
  "docs/adr/0008-independent-contract-and-module-versioning.md",
  "docs/adr/0009-public-tenant-scoped-routes.md",
  "docs/adr/0010-public-host-tenant-routing.md",
  "docs/adr/0011-capability-ports-for-cross-module-collaboration.md",
  "docs/adr/0012-module-admission-and-trusted-registry-boundary.md",
  "docs/adr/0013-extension-layers-and-boundary-model.md",
  "docs/adr/0014-deterministic-build-time-module-composition.md",
  "docs/adr/0015-derived-application-compatibility-manifest.md",
  "docs/adr/0016-organization-structure-module-admission.md",
  "docs/adr/0017-document-infrastructure-module-admission.md",
  "docs/adr/0018-data-exchange-module-admission.md",
  "docs/adr/0019-integration-hub-module-admission.md",
  "docs/adr/0020-erp-extension-readiness-contracts.md",
  "docs/adr/0021-reference-data-module-admission.md",
  "docs/adr/0022-erp-modules-live-in-extension-repos.md",
  "docs/adr/0023-bilingual-docs-indonesian-source-english-default.md",
  "docs/adr/0024-semver-numbering-continues-legacy-major-line.md",
  "docs/adr/0025-implement-deterministic-build-time-module-composition.md",
  "docs/adr/0026-modular-openapi-ownership-and-composition.md",
  "docs/adr/0027-mfa-totp-session-assurance-step-up.md",
  "docs/adr/0028-oidc-sso-tenant-aware-account-linking-break-glass.md",
  "docs/adr/0029-deployment-profile-aware-turnstile-bot-protection.md",
  "docs/adr/0030-business-scope-hierarchy-generic-authorization-layer.md",
  "docs/adr/0031-segregation-of-duties-conflict-enforcement.md",
  "docs/adr/0032-family-compatibility-manifest-and-ci-conformance.md",
  "docs/adr/0033-abac-dynamic-policy-evaluator.md",
  "docs/adr/0034-awcms-family-direct-use-templates-and-derived-pathway-removal.md",
  "docs/adr/0035-awcms-online-first-erp-saas-superset-repositioning.md",
  "docs/adr/0036-media-library-module-admission-ownership-inversion.md",
  "docs/adr/0037-data-lifecycle-module-admission.md",
  "docs/adr/0038-seo-distribution-module-admission-discovery-scope.md",
  "docs/adr/0039-seo-distribution-redirect-governance.md",
  "docs/adr/0040-site-search-module-admission.md",
  "docs/adr/0041-comments-module-admission.md",
  "docs/adr/0042-varnish-edge-cache-auto-activation.md",
  "docs/adr/0043-lib-boundary-and-module-presentation-layer.md",
  "docs/adr/0044-merge-news-portal-into-blog-content.md",
  "docs/adr/0045-jualanku-porting-awcms-system-of-record-astro-bff.md",
  "docs/adr/0046-idn-admin-regions-module-admission.md",
  "docs/adr/0047-mini-micro-frozen-foundation-built-here.md",
  "docs/adr/0048-frontend-role-split-awcms-astro-internal-admin.md",
  "docs/adr/0049-machine-credentials-and-session-introspection.md",
  "docs/adr/0050-bff-session-handoff-code.md",
  "docs/adr/0051-admin-screens-consolidated-in-awcms.md",
  "docs/adr/0052-idn-region-dataset-lifecycle-is-an-operator-job.md",
  "docs/adr/0053-platform-scoped-permissions.md",
  "docs/adr/0054-tenant-provisioning.md",
  "docs/adr/0055-development-confined-to-awcms-and-awcms-astro.md",
  "docs/adr/0056-media-library-admin-surface.md",
  "docs/adr/0057-blog-page-lifecycle.md",
  "docs/adr/0058-unenforced-permissions-disposition.md",
  "docs/adr/0059-host-resolved-public-content-routes.md",
  "docs/adr/0060-business-scope-hierarchy-provided-by-tenant-admin.md",
  "docs/adr/0061-host-resolved-public-surfaces-are-edge-cacheable.md",
  "docs/adr/0062-skills-are-gated-against-the-code-they-describe.md",
  "docs/adr/0063-ownership-grants-run-through-the-authorization-chokepoint.md",
  "docs/adr/0064-foreign-key-columns-must-be-index-reachable.md",
  "docs/adr/0065-awcms-astro-consumer-contract-is-frozen.md",
  "docs/adr/0066-shared-rate-limiting-and-full-auth-surface-coverage.md",
  "docs/adr/0067-core-web-vitals-collection.md",
  "docs/adr/0068-family-standards-posture-editions-and-recorded-divergences.md",
  "docs/adr/0069-cross-origin-isolation-divergence-with-awcms-astro.md",
  "docs/adr/0070-peran-keluarga-awcms-astro-memikul-publik-dan-admin-user.md",
  "docs/adr/0071-kosakata-url-publik-dibelah-blog-di-sini-news-di-awcms-astro.md",
  "docs/adr/0072-decision-log-retention-and-projection-authority.md",
  "docs/adr/0073-suspension-is-a-service-state-not-a-login-state.md",
  "docs/adr/0074-push-delivery-is-a-second-outbox.md",
  "docs/adr/0075-sse-reauthorizes-every-tick.md",
  "docs/adr/0076-infrastructure-tables-may-hold-lifecycle-descriptors.md",
  "docs/adr/0077-one-outbox-sync-pull-reads-domain-events.md",
  "docs/adr/0078-a-grant-carries-its-own-scope.md",
  "docs/adr/0079-the-legacy-grant-table-becomes-read-only-history.md",
  "docs/adr/0080-a-scoped-grant-covers-only-what-its-role-confers.md",
  "docs/adr/0081-a-user-group-is-a-subject-that-grants-roles.md",
  "docs/adr/0082-an-invitation-carries-its-own-policy.md",
  "docs/adr/0083-this-template-deploys-to-one-environment.md",
  "docs/adr/0084-an-entitlement-refuses-it-never-grants.md",
  "docs/adr/0085-one-human-one-credential-many-tenants.md",
  "docs/adr/0086-the-lockout-counter-is-global.md",
  "docs/adr/0087-mfa-moves-to-the-principal.md",
  "docs/adr/0088-tenant-selection-and-switching.md",
  "docs/adr/0089-a-partner-is-an-ordinary-tenant.md",
  "docs/adr/0090-delegated-access-prints-a-real-tenant-user.md",
  "docs/adr/0091-two-sided-attribution.md",
  "docs/adr/0092-machine-credentials-may-write.md",
  "docs/adr/0093-a-suspended-partner-stops-reaching-in.md",
  "docs/adr/0094-a-data-subject-is-answered-per-tenant.md",
  "docs/adr/0095-the-interface-speaks-the-readers-language.md",
  "docs/adr/0096-your-own-account-is-not-an-administrative-surface.md",
  "docs/awcms/01_canvas_induk.md",
  "docs/awcms/02_prd_detail_per_modul.md",
  "docs/awcms/03_srs_detail_per_modul.md",
  "docs/awcms/04_erd_data_dictionary.md",
  "docs/awcms/05_openapi_asyncapi_detail.md",
  "docs/awcms/06_github_issues_detail.md",
  "docs/awcms/07_sprint_testing_production_readiness.md",
  "docs/awcms/08_sop_operasional_user_guide.md",
  "docs/awcms/09_roadmap_repository_commit.md",
  "docs/awcms/10_template_kode_coding_standard.md",
  "docs/awcms/11_implementation_blueprint.md",
  "docs/awcms/12_generator_prompt.md",
  "docs/awcms/13_final_master_index_traceability.md",
  "docs/awcms/14_ui_ux_design_system.md",
  "docs/awcms/15_frontend_architecture_integration.md",
  "docs/awcms/16_backend_data_access_integration.md",
  "docs/awcms/17_default_seed_rbac_abac.md",
  "docs/awcms/18_configuration_env_reference.md",
  "docs/awcms/19_glossary_terminology.md",
  "docs/awcms/20_threat_model_security_architecture.md",
  "docs/awcms/21_module_admission_governance.md",
  "docs/awcms/AUDIT_STANDAR_PENGEMBANGAN_2026-07-04.md",
  "docs/awcms/absorb-awcms-micro-roadmap.md",
  "docs/awcms/absorb-awcms-mini-backbone-roadmap.md",
  "docs/awcms/alur-pengembangan-mini-first.md",
  "docs/awcms/alur-pengembangan.md",
  "docs/awcms/api-contribution-guide.md",
  "docs/awcms/branch-protection.md",
  "docs/awcms/data-lifecycle.md",
  "docs/awcms/database-capacity-runbook.md",
  "docs/awcms/database-migrations.md",
  "docs/awcms/database-pooling.md",
  "docs/awcms/deploy-coolify.md",
  "docs/awcms/deployment-profiles.md",
  "docs/awcms/derived-app-pilot-plan.md",
  "docs/awcms/derived-app-pilot-purchase-requisition-execution.md",
  "docs/awcms/derived-app-pilot-purchase-requisition-plan.md",
  "docs/awcms/derived-application-guide.md",
  "docs/awcms/edge-cache-architecture.md",
  "docs/awcms/environments.md",
  "docs/awcms/erp-extension-contracts.md",
  "docs/awcms/examples/minimal-domain-module.md",
  "docs/awcms/extension-compatibility-policy.md",
  "docs/awcms/jualanku/01-arsitektur-porting.md",
  "docs/awcms/jualanku/02-model-tenant-merchant-otorisasi.md",
  "docs/awcms/jualanku/03-bounded-context-dan-model-data.md",
  "docs/awcms/jualanku/04-kontrak-api.md",
  "docs/awcms/jualanku/05-kontrak-sesi-dan-bff.md",
  "docs/awcms/jualanku/06-porting-uiux.md",
  "docs/awcms/jualanku/07-roadmap-gates-kepatuhan.md",
  "docs/awcms/jualanku/08-koreksi-dokumen-validasi.md",
  "docs/awcms/jualanku/README.md",
  "docs/awcms/knowledge-graph.md",
  "docs/awcms/mfa-totp-step-up.md",
  "docs/awcms/observability-metrics.md",
  "docs/awcms/oidc-sso.md",
  "docs/awcms/performance-suite.md",
  "docs/awcms/post-release-reviews.md",
  "docs/awcms/privacy-analysis.md",
  "docs/awcms/production-preflight-runbook.md",
  "docs/awcms/production-readiness.md",
  "docs/awcms/program-model-keanggotaan-2026-08-09.md",
  "docs/awcms/redis-readiness.md",
  "docs/awcms/release-process.md",
  "docs/awcms/repo-assessment-2026-08-04.md",
  "docs/awcms/resilience-dr-verification.md",
  "docs/awcms/sejarah-repo.md",
  "docs/awcms/standar-performa-dan-keamanan.md",
  "docs/awcms/templates/definition-of-ready.md",
  "docs/awcms/templates/module-admission-decision-checklist.md",
  "docs/awcms/templates/module-proposal-template.md",
  "docs/awcms/templates/post-release-review-template.md",
  "docs/awcms/templates/privacy-analysis-template.md",
  "docs/awcms/turnstile-bot-protection.md",
  "docs/awcms/visitor-analytics.md",
  "scripts/README.md",
  "src/lib/README.md",
  "src/modules/blog-content/README.md",
  "src/modules/comments/README.md",
  "src/modules/data-lifecycle/README.md",
  "src/modules/domain-event-runtime/README.md",
  "src/modules/email/README.md",
  "src/modules/form-drafts/README.md",
  "src/modules/identity-access/README.md",
  "src/modules/idn-admin-regions/README.md",
  "src/modules/media-library/README.md",
  "src/modules/module-management/README.md",
  "src/modules/profile-identity/README.md",
  "src/modules/push-delivery/README.md",
  "src/modules/reporting/README.md",
  "src/modules/seo-distribution/README.md",
  "src/modules/site-search/README.md",
  "src/modules/sync-storage/README.md",
  "src/modules/tenant-admin/README.md",
  "src/modules/tenant-domain/README.md",
  "src/modules/theming/README.md",
  "src/modules/visitor-analytics/README.md",
  "src/modules/workflow-approval/README.md"
];

/** Tracked markdown in scope: docs, skills, module READMEs, front-door READMEs. */
function listSources() {
  // `--others --exclude-standard` so a document added in THIS change is checked
  // before it is committed. Plain `git ls-files` sees only tracked files, so a
  // brand-new document would pass unexamined and fail for whoever ran the gate
  // next — `check-docs.mjs` already enumerates this way for the same reason.
  const out = execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "*.md"],
    { cwd: ROOT, encoding: "utf8" }
  );
  return out
    .split("\n")
    .filter(Boolean)
    .filter((file) => !file.endsWith(".id.md"))
    .filter((file) => !file.startsWith(".changeset/"))
    .filter((file) => file !== "CHANGELOG.md")
    .filter((file) =>
      /^(docs\/|\.claude\/skills\/|README\.md$|scripts\/README\.md$|src\/.*README\.md$)/.test(
        file
      )
    )
    .filter((file) => !GENERATED_NOT_HAND_MIRRORED.has(file));
}

/** @returns {string[]} tracked `.id.md` mirrors that exist on disk. */
function listMirrors() {
  // Untracked mirrors included, for the same reason as `listSources`: a pair
  // created in this change must be judged now. Enumerating sources one way and
  // mirrors the other is worse than either — the coverage check would then
  // report a brand-new document as unmirrored while its mirror sat right there.
  const out = execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "*.id.md"],
    { cwd: ROOT, encoding: "utf8" }
  );
  return out.split("\n").filter(Boolean);
}

/**
 * Read a file, or return null when it is not there.
 *
 * Not `existsSync` + `readFileSync`: that pair is a time-of-check/time-of-use
 * race. Here the consequence is a spurious finding rather than a corrupt write,
 * but the sibling writer (`docs-i18n-stamp.mjs`) had the same shape and CodeQL
 * `js/file-system-race` flagged it — leaving the twin in place would be knowing
 * about a defect and keeping it.
 *
 * @param {string} path
 * @returns {string | null}
 */
function readFileIfPresent(path) {
  try {
    return readFileSync(path, "utf8");
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      /** @type {NodeJS.ErrnoException} */ (error).code === "ENOENT"
    ) {
      return null;
    }
    throw error;
  }
}

/** @returns {Problem[]} */
export function runChecks() {
  /** @type {Problem[]} */
  const problems = [];
  const mirrors = listMirrors();

  for (const mirrorPath of mirrors) {
    const sourcePath = deriveSourcePath(mirrorPath);
    if (!sourcePath) continue;

    const mirrorContent = readFileIfPresent(join(ROOT, mirrorPath));
    if (mirrorContent === null) continue;
    const sourceContent = readFileIfPresent(join(ROOT, sourcePath));

    problems.push(
      ...checkTranslationPair(
        sourcePath,
        sourceContent,
        mirrorPath,
        mirrorContent
      )
    );
  }

  problems.push(
    ...checkMirrorCoverage(
      listSources(),
      new Set(mirrors),
      DOCS_AWAITING_MIRROR
    )
  );

  return problems;
}

if (import.meta.main) {
  const problems = runChecks();
  if (problems.length > 0) {
    console.error(
      `check:docs:translation FAILED — ${problems.length} finding(s):`
    );
    for (const p of problems) console.error(`  - ${p.file}: ${p.message}`);
    process.exit(1);
  }
  const mirrored = listMirrors().length;
  console.log(
    `check:docs:translation OK — ${mirrored} mirror(s) current against their English source; ${DOCS_AWAITING_MIRROR.length} document(s) on the shrink-only translation ledger.`
  );
}
