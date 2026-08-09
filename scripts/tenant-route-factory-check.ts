#!/usr/bin/env bun
/**
 * `bun run api:tenant-route:check` — Issue #255.
 *
 * Every NEW route under `src/pages/api` must open its tenant transaction
 * through `defineTenantRoute` (`src/modules/_shared/tenant-route.ts`), not by
 * calling `withTenant` directly.
 *
 * ## Why a gate
 *
 * Because the hand-copied opening was already wrong in four places and nothing
 * noticed. `/api/v1/reports/*` reimplemented the guard chain and called
 * `evaluateAccess` with three arguments of five, skipping the module-enabled
 * check and dynamic ABAC entirely — a tenant that disabled `reporting` was
 * still served, and a `deny` policy authored through the supported surface was
 * silently inert. Copy-paste was the only enforcement there was; it worked 184
 * times and failed 4, indistinguishably from a diff.
 *
 * The same duplication is why **176 of the 204 route files** that call
 * `withTenant` directly pass no work class at all: they share login's pool
 * budget by omission, not by decision. `defineTenantRoute` makes `workClass` a
 * compile error to omit; this gate is what keeps the count of hand-rolled
 * openings going DOWN while the migration proceeds module by module.
 *
 * ## The allowlist is a debt ledger, not an off switch
 *
 * Migration is deliberately incremental (one module per PR, no behaviour
 * change), so routes predating the factory are listed verbatim. Two rules make
 * the list one-directional:
 *
 * 1. A route under `src/pages/api` that calls `withTenant` directly and is NOT
 *    listed fails — that is a NEW hand-rolled opening, and new routes have no
 *    excuse.
 * 2. A listed route that no longer calls `withTenant` directly (migrated, or
 *    deleted) ALSO fails, with an instruction to delete the line. The list can
 *    only shrink; it can never quietly absorb a regression.
 *
 * Regex over comment-stripped lines rather than an AST, matching the idiom of
 * the other pure gates in `scripts/` — auditable in review, no new dependency.
 * The pattern deliberately matches `withTenant<T>(` as well as `withTenant(`:
 * `_shared/tenant-route.ts` itself writes the generic form, and a pattern that
 * missed it would let a copy of the factory's own body through.
 *
 * ## Why `src/pages/admin` is scanned too (Issue #424)
 *
 * All 32 admin screens open their own `withTenantOrThrow` and decide access
 * with `ssr.permissions.has()` alone — PROJECT_STATE §4 **R3**. They are
 * invisible to `access:chokepoint:check` (its root is `src/pages/api/v1`) and
 * they WERE invisible here, because this root stopped at `src/pages/api`.
 *
 * That is the whole change: this gate already matched `withTenantOrThrow(`. It
 * was simply never pointed at the directory where 32 of them live.
 *
 * The ledger cannot be migrated away yet — `defineAdminScreen` does not exist
 * (it is Gelombang 1 of #423). Seeding the 32 here is therefore a **ratchet,
 * not a migration**: from this commit a NEW admin screen cannot add to R3's
 * debt, months before the debt itself is paid down. A gate that only stops the
 * bleeding still stops the bleeding.
 */
import { readdir } from "node:fs/promises";
import path from "node:path";

/**
 * Each root carries its own extension set and its own remediation sentence,
 * because the answer differs: an API route must use `defineTenantRoute`, while
 * an admin screen has no factory to use yet.
 */
type ScanRoot = {
  root: string;
  extensions: readonly string[];
  /** Printed when an UNLISTED file under this root opens its own transaction. */
  remediation: string;
};

export const SCAN_ROOTS: readonly ScanRoot[] = [
  {
    root: "src/pages/api",
    extensions: [".ts"],
    remediation:
      "Rute baru WAJIB memakai defineTenantRoute (src/modules/_shared/tenant-route.ts), " +
      "yang membawa gerbang tenant/token, rantai guard penuh, dan work class yang WAJIB " +
      "ditulis. Jangan tambahkan berkas ini ke NOT_YET_MIGRATED."
  },
  {
    root: "src/pages/admin",
    extensions: [".astro"],
    remediation:
      "Layar admin baru TIDAK BOLEH membuka transaksi tenant sendiri: ia memutuskan akses " +
      "dengan ssr.permissions.has() saja, melewati evaluateAccess, resolveModuleEnabled, dan " +
      "recordDecisionLog (PROJECT_STATE §4 R3). Pakai loadAdminScreen dari " +
      "src/lib/auth/admin-screen.ts — ia membuka SATU transaksi dan menjalankan " +
      "authorizeInTransaction serta load() di dalamnya. JANGAN menambah baris di NOT_YET_MIGRATED."
  }
];

/** Matches `withTenant(`, `withTenant<T>(` AND `withTenantOrThrow(` — a route
 * that opens its own tenant transaction bypasses the factory under either
 * name, so neither may slip past this gate. */
const WITH_TENANT_CALL_PATTERN =
  /\bwithTenant(?:OrThrow)?\s*(?:<[^()]*>)?\s*\(/;

/**
 * Files that still open their own transaction. API routes measured at
 * `b9931594`; the 32 admin screens added by Issue #424 at the head of
 * Gelombang 0, shrinking as issue #450 migrates them to `loadAdminScreen`.
 *
 * The screen half is counted a SECOND time, from a different angle, by
 * `ADMIN_SCREEN_CHOKEPOINT_MIGRATION` in `access-chokepoint-check.ts`: this
 * gate asks "who opens their own transaction", that one asks "who decides a
 * permission outside the chokepoint". A migration PR must shrink BOTH, and
 * neither list may grow.
 *
 * ONLY REMOVE LINES FROM THIS LIST. Never add one: a new entry means a new
 * route skipped `defineTenantRoute`, or a new admin screen added to R3's debt
 * — which is what this gate exists to prevent.
 */
const NOT_YET_MIGRATED: readonly string[] = [
  // --- Layar admin (R3) — sedang dimigrasikan ke `loadAdminScreen`, Gelombang 1
  //     dari #423 (issue #450). Daftar ini menyusut tiap PR migrasi.
  "src/pages/admin/analytics.astro",
  "src/pages/admin/approvals.astro",
  "src/pages/admin/blog-presentation.astro",
  "src/pages/admin/blog.astro",
  "src/pages/admin/data-lifecycle.astro",
  "src/pages/admin/domain-events.astro",
  "src/pages/admin/idn-regions.astro",
  "src/pages/admin/reporting.astro",
  "src/pages/admin/security.astro",
  "src/pages/admin/seo.astro",
  "src/pages/admin/site-search.astro",
  "src/pages/admin/sync.astro",
  "src/pages/admin/tenants.astro",
  "src/pages/admin/theming.astro",

  // --- Rute API.
  "src/pages/api/v1/abac/policies/[id].ts",
  "src/pages/api/v1/abac/policies/index.ts",
  "src/pages/api/v1/access/assignments.ts",
  "src/pages/api/v1/access/evaluate.ts",
  "src/pages/api/v1/access/modules.ts",
  "src/pages/api/v1/access/policies/[id].ts",
  "src/pages/api/v1/access/policies/[id]/disable.ts",
  "src/pages/api/v1/access/policies/[id]/enable.ts",
  "src/pages/api/v1/access/policies/index.ts",
  "src/pages/api/v1/access/policies/simulate.ts",
  "src/pages/api/v1/analytics/devices.ts",
  "src/pages/api/v1/analytics/events.ts",
  "src/pages/api/v1/analytics/locations.ts",
  "src/pages/api/v1/analytics/pages.ts",
  "src/pages/api/v1/analytics/realtime.ts",
  "src/pages/api/v1/analytics/retention/purge.ts",
  "src/pages/api/v1/analytics/security.ts",
  "src/pages/api/v1/analytics/sessions.ts",
  "src/pages/api/v1/analytics/settings.ts",
  "src/pages/api/v1/analytics/summary.ts",
  "src/pages/api/v1/auth/login.ts",
  "src/pages/api/v1/auth/logout.ts",
  "src/pages/api/v1/auth/me.ts",
  "src/pages/api/v1/auth/mfa/admin/reset.ts",
  "src/pages/api/v1/auth/mfa/policy.ts",
  "src/pages/api/v1/auth/mfa/recovery-codes/regenerate.ts",
  "src/pages/api/v1/auth/mfa/status.ts",
  "src/pages/api/v1/auth/mfa/step-up.ts",
  "src/pages/api/v1/auth/mfa/totp/disable.ts",
  "src/pages/api/v1/auth/mfa/totp/enroll/start.ts",
  "src/pages/api/v1/auth/mfa/totp/enroll/verify.ts",
  "src/pages/api/v1/auth/mfa/totp/verify.ts",
  "src/pages/api/v1/auth/sso-policy.ts",
  "src/pages/api/v1/auth/sso-providers/[id].ts",
  "src/pages/api/v1/auth/sso-providers/index.ts",
  "src/pages/api/v1/auth/sso/[providerKey]/callback.ts",
  "src/pages/api/v1/auth/sso/[providerKey]/link.ts",
  "src/pages/api/v1/auth/sso/[providerKey]/start.ts",
  "src/pages/api/v1/auth/sso/[providerKey]/unlink.ts",
  "src/pages/api/v1/blog/ads/[id].ts",
  "src/pages/api/v1/blog/ads/index.ts",
  "src/pages/api/v1/blog/internal-tag-links/settings.ts",
  "src/pages/api/v1/blog/menus/[id].ts",
  "src/pages/api/v1/blog/menus/index.ts",
  "src/pages/api/v1/blog/pages/[id].ts",
  "src/pages/api/v1/blog/pages/[id]/quality-checklist.ts",
  "src/pages/api/v1/blog/pages/index.ts",
  "src/pages/api/v1/blog/posts/[id].ts",
  "src/pages/api/v1/blog/posts/[id]/archive.ts",
  "src/pages/api/v1/blog/posts/[id]/internal-links/preview.ts",
  "src/pages/api/v1/blog/posts/[id]/publish.ts",
  "src/pages/api/v1/blog/posts/[id]/purge.ts",
  "src/pages/api/v1/blog/posts/[id]/quality-checklist.ts",
  "src/pages/api/v1/blog/posts/[id]/restore.ts",
  "src/pages/api/v1/blog/posts/[id]/revisions/[revisionId].ts",
  "src/pages/api/v1/blog/posts/[id]/revisions/[revisionId]/restore.ts",
  "src/pages/api/v1/blog/posts/[id]/revisions/index.ts",
  "src/pages/api/v1/blog/posts/[id]/schedule.ts",
  "src/pages/api/v1/blog/posts/[id]/submit-review.ts",
  "src/pages/api/v1/blog/posts/index.ts",
  "src/pages/api/v1/blog/search/index.ts",
  "src/pages/api/v1/blog/settings/index.ts",
  "src/pages/api/v1/blog/templates/[id].ts",
  "src/pages/api/v1/blog/templates/index.ts",
  "src/pages/api/v1/blog/terms/[id].ts",
  "src/pages/api/v1/blog/terms/index.ts",
  "src/pages/api/v1/blog/theme/index.ts",
  "src/pages/api/v1/blog/widgets/[id].ts",
  "src/pages/api/v1/blog/widgets/index.ts",
  "src/pages/api/v1/comments/admin/[id]/archive.ts",
  "src/pages/api/v1/comments/admin/[id]/moderate.ts",
  "src/pages/api/v1/comments/admin/[id]/restore.ts",
  "src/pages/api/v1/comments/admin/bulk-moderate.ts",
  "src/pages/api/v1/comments/admin/queue.ts",
  "src/pages/api/v1/comments/admin/settings.ts",
  "src/pages/api/v1/data-lifecycle/dry-run.ts",
  "src/pages/api/v1/data-lifecycle/legal-holds.ts",
  "src/pages/api/v1/data-lifecycle/legal-holds/[id]/release.ts",
  "src/pages/api/v1/data-lifecycle/registry.ts",
  "src/pages/api/v1/data-lifecycle/runs.ts",
  "src/pages/api/v1/domain-events/consumers/[name]/pause.ts",
  "src/pages/api/v1/domain-events/consumers/[name]/resume.ts",
  "src/pages/api/v1/domain-events/consumers/index.ts",
  "src/pages/api/v1/domain-events/deliveries/[id].ts",
  "src/pages/api/v1/domain-events/deliveries/[id]/replay.ts",
  "src/pages/api/v1/domain-events/deliveries/index.ts",
  "src/pages/api/v1/domain-events/events/[id].ts",
  "src/pages/api/v1/domain-events/events/index.ts",
  "src/pages/api/v1/email/announcements/index.ts",
  "src/pages/api/v1/email/announcements/preview.ts",
  "src/pages/api/v1/email/messages/[id]/cancel.ts",
  "src/pages/api/v1/email/messages/index.ts",
  "src/pages/api/v1/email/suppressions/[id].ts",
  "src/pages/api/v1/email/suppressions/index.ts",
  "src/pages/api/v1/email/templates/[id].ts",
  "src/pages/api/v1/email/templates/[id]/preview.ts",
  "src/pages/api/v1/email/templates/[id]/restore.ts",
  "src/pages/api/v1/email/templates/index.ts",
  "src/pages/api/v1/form-drafts/[id].ts",
  "src/pages/api/v1/form-drafts/[id]/submit.ts",
  "src/pages/api/v1/form-drafts/index.ts",
  "src/pages/api/v1/identity/business-scope/assignments/[id]/revoke.ts",
  "src/pages/api/v1/identity/business-scope/assignments/index.ts",
  "src/pages/api/v1/identity/business-scope/conflicts/index.ts",
  "src/pages/api/v1/identity/business-scope/exceptions/[id]/approve.ts",
  "src/pages/api/v1/identity/business-scope/exceptions/[id]/reject.ts",
  "src/pages/api/v1/identity/business-scope/exceptions/[id]/revoke.ts",
  "src/pages/api/v1/identity/business-scope/exceptions/index.ts",
  "src/pages/api/v1/logs/audit.ts",
  "src/pages/api/v1/media/enforcement.ts",
  "src/pages/api/v1/media/news-images/upload-sessions/[id]/cancel.ts",
  "src/pages/api/v1/media/news-images/upload-sessions/index.ts",
  "src/pages/api/v1/modules/[moduleKey].ts",
  "src/pages/api/v1/modules/[moduleKey]/health.ts",
  "src/pages/api/v1/modules/[moduleKey]/health/check.ts",
  "src/pages/api/v1/modules/[moduleKey]/jobs.ts",
  "src/pages/api/v1/modules/[moduleKey]/permissions.ts",
  "src/pages/api/v1/modules/index.ts",
  "src/pages/api/v1/modules/sync.ts",
  "src/pages/api/v1/news-portal/ad-placements/[id].ts",
  "src/pages/api/v1/news-portal/ad-placements/index.ts",
  "src/pages/api/v1/news-portal/homepage-sections/[id].ts",
  "src/pages/api/v1/news-portal/homepage-sections/index.ts",
  "src/pages/api/v1/offices/[id].ts",
  "src/pages/api/v1/offices/[id]/restore.ts",
  "src/pages/api/v1/offices/index.ts",
  "src/pages/api/v1/profiles/[id].ts",
  "src/pages/api/v1/profiles/[id]/identifiers.ts",
  "src/pages/api/v1/profiles/[id]/links.ts",
  "src/pages/api/v1/profiles/index.ts",
  "src/pages/api/v1/profiles/resolve.ts",
  "src/pages/api/v1/reports/email-health.ts",
  "src/pages/api/v1/reports/exports/[id]/disable.ts",
  "src/pages/api/v1/reports/exports/index.ts",
  "src/pages/api/v1/reports/exports/runs.ts",
  "src/pages/api/v1/reports/exports/runs/[id]/download.ts",
  "src/pages/api/v1/reports/exports/trigger.ts",
  "src/pages/api/v1/reports/projections/[key]/index.ts",
  "src/pages/api/v1/reports/projections/[key]/rebuild/cancel.ts",
  "src/pages/api/v1/reports/projections/[key]/rebuild/index.ts",
  "src/pages/api/v1/reports/projections/[key]/reconcile.ts",
  "src/pages/api/v1/reports/projections/index.ts",
  "src/pages/api/v1/roles/[id].ts",
  "src/pages/api/v1/roles/[id]/permissions.ts",
  "src/pages/api/v1/roles/[id]/restore.ts",
  "src/pages/api/v1/roles/index.ts",
  "src/pages/api/v1/seo/config.ts",
  "src/pages/api/v1/seo/not-found/[id].ts",
  "src/pages/api/v1/seo/not-found/index.ts",
  "src/pages/api/v1/seo/redirects/[id].ts",
  "src/pages/api/v1/seo/redirects/[id]/lifecycle.ts",
  "src/pages/api/v1/seo/redirects/capture-url-change.ts",
  "src/pages/api/v1/seo/redirects/import.ts",
  "src/pages/api/v1/seo/redirects/index.ts",
  "src/pages/api/v1/seo/redirects/settings.ts",
  "src/pages/api/v1/seo/redirects/validate.ts",
  "src/pages/api/v1/settings/index.ts",
  "src/pages/api/v1/site-search/index/failures.ts",
  "src/pages/api/v1/site-search/index/rebuild.ts",
  "src/pages/api/v1/site-search/index/reconcile.ts",
  "src/pages/api/v1/site-search/index/status.ts",
  "src/pages/api/v1/site-search/settings.ts",
  "src/pages/api/v1/sync/conflicts/[id]/resolve.ts",
  "src/pages/api/v1/sync/conflicts/index.ts",
  "src/pages/api/v1/sync/nodes/[id].ts",
  "src/pages/api/v1/sync/nodes/index.ts",
  "src/pages/api/v1/sync/object-queue/[id]/retry.ts",
  "src/pages/api/v1/sync/object-queue/index.ts",
  "src/pages/api/v1/sync/objects/index.ts",
  "src/pages/api/v1/sync/objects/status.ts",
  "src/pages/api/v1/sync/pull.ts",
  "src/pages/api/v1/sync/push.ts",
  "src/pages/api/v1/sync/status.ts",
  "src/pages/api/v1/tenant/domains/[id].ts",
  "src/pages/api/v1/tenant/domains/[id]/set-primary.ts",
  "src/pages/api/v1/tenant/domains/[id]/verify.ts",
  "src/pages/api/v1/tenant/domains/index.ts",
  "src/pages/api/v1/tenant/modules/[moduleKey]/disable.ts",
  "src/pages/api/v1/tenant/modules/[moduleKey]/enable.ts",
  "src/pages/api/v1/tenant/modules/[moduleKey]/settings.ts",
  "src/pages/api/v1/tenant/modules/index.ts",
  "src/pages/api/v1/theming/draft.ts",
  "src/pages/api/v1/theming/index.ts",
  "src/pages/api/v1/theming/preview.ts",
  "src/pages/api/v1/theming/publish.ts",
  "src/pages/api/v1/theming/retire.ts",
  "src/pages/api/v1/theming/rollback.ts",
  "src/pages/api/v1/theming/validate.ts",
  "src/pages/api/v1/users/[id].ts",
  "src/pages/api/v1/users/index.ts",
  "src/pages/api/v1/workflows/definitions/[id].ts",
  "src/pages/api/v1/workflows/definitions/[id]/new-version.ts",
  "src/pages/api/v1/workflows/definitions/[id]/publish.ts",
  "src/pages/api/v1/workflows/definitions/[id]/retire.ts",
  "src/pages/api/v1/workflows/definitions/[id]/validate.ts",
  "src/pages/api/v1/workflows/definitions/index.ts",
  "src/pages/api/v1/workflows/delegations/[id]/revoke.ts",
  "src/pages/api/v1/workflows/delegations/index.ts",
  "src/pages/api/v1/workflows/instances/[id].ts",
  "src/pages/api/v1/workflows/instances/[id]/cancel.ts",
  "src/pages/api/v1/workflows/tasks/[id]/decisions.ts",
  "src/pages/api/v1/workflows/tasks/[id]/force-decision.ts",
  "src/pages/api/v1/workflows/tasks/[id]/reassign.ts",
  "src/pages/api/v1/workflows/tasks/index.ts"
];

async function* walk(
  directory: string,
  extensions: readonly string[]
): AsyncGenerator<string> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      yield* walk(full, extensions);
    } else if (extensions.some((ext) => entry.name.endsWith(ext))) {
      yield full;
    }
  }
}

/** Comment lines are skipped so a docblock MENTIONING `withTenant(` is not a call. */
function callsWithTenantDirectly(content: string): boolean {
  return content.split("\n").some((line) => {
    const trimmed = line.trim();

    if (
      trimmed.startsWith("*") ||
      trimmed.startsWith("//") ||
      trimmed.startsWith("/*")
    ) {
      return false;
    }

    return WITH_TENANT_CALL_PATTERN.test(line);
  });
}

export type TenantRouteMigrationResult = {
  /** Calls `withTenant` directly and is NOT on the allowlist — a newly hand-rolled opening. */
  unlisted: string[];
  /** Allowlist entries that no longer call `withTenant` directly — the list must only shrink. */
  stale: string[];
};

/** Pure over already-read contents, so both failure directions are unit-testable without a synthetic file tree. */
export function evaluateTenantRouteMigration(
  files: readonly { path: string; content: string }[],
  allowlist: readonly string[]
): TenantRouteMigrationResult {
  const allowed = new Set(allowlist);
  const unlisted: string[] = [];
  const stillDirect = new Set<string>();

  for (const file of files) {
    if (!callsWithTenantDirectly(file.content)) {
      continue;
    }

    if (allowed.has(file.path)) {
      stillDirect.add(file.path);
      continue;
    }

    unlisted.push(file.path);
  }

  return {
    unlisted,
    stale: allowlist.filter((entry) => !stillDirect.has(entry))
  };
}

/** Remediation sentence for the root that owns `file`, matched by longest prefix. */
export function remediationFor(file: string): string {
  const owner = SCAN_ROOTS.filter((scan) =>
    file.startsWith(`${scan.root}/`)
  ).sort((a, b) => b.root.length - a.root.length)[0];

  return owner?.remediation ?? SCAN_ROOTS[0]!.remediation;
}

async function main(): Promise<void> {
  const files: { path: string; content: string }[] = [];

  // Each root is counted SEPARATELY. A combined total would let one healthy
  // root mask a second that walked nothing — which is the exact "cheerful,
  // meaningless OK" this guard was written for, one directory later.
  for (const scan of SCAN_ROOTS) {
    let scanned = 0;

    for await (const file of walk(scan.root, scan.extensions)) {
      files.push({
        path: file.split(path.sep).join("/"),
        content: await Bun.file(file).text()
      });
      scanned += 1;
    }

    // Roots are repo-relative, so a run from the wrong working directory would
    // walk nothing and report success. This repo has already shipped gates that
    // passed while scanning zero files.
    if (scanned === 0) {
      console.error(
        `api:tenant-route:check GAGAL — scanned 0 files under ${scan.root} ` +
          `(${scan.extensions.join(", ")}). Run this from the repository root.`
      );
      process.exit(1);
    }
  }

  const { unlisted, stale } = evaluateTenantRouteMigration(
    files,
    NOT_YET_MIGRATED
  );

  if (unlisted.length === 0 && stale.length === 0) {
    console.log(
      `api:tenant-route:check OK — ${files.length} berkas di ` +
        `${SCAN_ROOTS.map((scan) => scan.root).join(" + ")}: memakai defineTenantRoute, ` +
        `atau salah satu dari ${NOT_YET_MIGRATED.length} berkas yang masih antre migrasi ` +
        "(rute API: Issue #255; layar admin: R3 / Issue #424)."
    );
    process.exit(0);
  }

  for (const file of unlisted) {
    console.error(
      `${file} — membuka transaksi tenant sendiri. ${remediationFor(file)}`
    );
  }

  for (const file of stale) {
    console.error(
      `${file} — terdaftar di NOT_YET_MIGRATED tapi sudah tidak membuka transaksi tenant ` +
        "sendiri (ter-migrasi atau terhapus). Hapus barisnya: daftar ini hanya boleh menyusut."
    );
  }

  console.error(
    `\napi:tenant-route:check GAGAL — ${unlisted.length} berkas membuka transaksinya sendiri tanpa terdaftar, ` +
      `${stale.length} entri allowlist basi.`
  );

  process.exit(1);
}

if (import.meta.main) {
  await main();
}
