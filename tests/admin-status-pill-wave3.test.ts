/**
 * Source-contract test for Issue #862 (parent epic #858, wave 3 of
 * `docs/awcms/admin-ui-parity-matrix.md` §7): the list-management screens
 * migrate their per-row lifecycle status from the legacy, single-file
 * `.status-badge`/`.status-dot` pair (`src/styles/admin.css`) onto the shared
 * `.admin-status-pill`/`.admin-status-pill-dot` primitive (upstreamed from
 * `ahliweb/awcms-one#170`, PR #813) — and `comments.astro` additionally
 * adopts `.admin-segmented` for its status filter and `.admin-bulk-bar` over
 * the existing `bulk-moderate` endpoint (§5 of the parity matrix).
 *
 * Pure source-text assertions — no database, no rendering. What this pins:
 *
 *   1. Every migrated screen contains at least one `.admin-status-pill` site.
 *   2. None of them contains the legacy `status-badge`/`status-dot` class
 *      tokens anymore — a partial migration that leaves both systems mixed
 *      on one screen is exactly the "two competing central definitions"
 *      duplication the parity matrix audit (§4) flags.
 *   3. The legacy `.status-badge`/`.status-dot` declarations were retired
 *      from `src/styles/admin.css` once Issue #866 (wave 7) migrated the
 *      last consumers — this test now pins their ABSENCE rather than their
 *      presence (see tests/admin-legacy-classes-retired.test.ts for the
 *      repo-wide gate).
 *   4. `comments.astro` specifically: no `.filter-bar` status-tab nav left,
 *      `.admin-segmented`/`.admin-segmented-option` present, and
 *      `.admin-bulk-bar` wired to row checkboxes + the `bulk-moderate`
 *      endpoint (never a NEW endpoint — the issue is UI-only).
 */
import { readFile } from "node:fs/promises";

import { describe, expect, test } from "bun:test";

// 3a (flagship) + 3b (status-pill sweep) + the 5 read-first 3c screens that
// did carry a real per-row status (`email-suppression.astro`,
// `registrations.astro` and `user-groups.astro` had no status concept at all
// — confirmed by reading them — so they are deliberately NOT in this list;
// forcing a pill onto a reason-code column or a queue with no status column
// would misrepresent something that isn't a lifecycle state).
const MIGRATED_SCREENS = [
  "src/pages/admin/comments.astro",
  "src/pages/admin/abac-policies.astro",
  "src/pages/admin/audit-trail.astro",
  "src/pages/admin/blog-ads.astro",
  "src/pages/admin/blog.astro",
  "src/pages/admin/blog-homepage.astro",
  "src/pages/admin/blog-institutions.astro",
  "src/pages/admin/blog-pages.astro",
  "src/pages/admin/blog-presentation.astro",
  "src/pages/admin/blog-taxonomy.astro",
  "src/pages/admin/domain-events.astro",
  "src/pages/admin/email-templates.astro",
  "src/pages/admin/form-drafts.astro",
  "src/pages/admin/idn-regions.astro",
  "src/pages/admin/modules.astro",
  "src/pages/admin/newsletter.astro",
  "src/pages/admin/offices.astro",
  "src/pages/admin/profiles.astro",
  "src/pages/admin/roles.astro",
  "src/pages/admin/security.astro",
  "src/pages/admin/seo.astro",
  "src/pages/admin/site-search.astro",
  "src/pages/admin/sync.astro",
  "src/pages/admin/tenant/domains.astro",
  "src/pages/admin/tenants.astro",
  "src/pages/admin/theming.astro",
  "src/pages/admin/users.astro",
  "src/pages/admin/invitations.astro",
  "src/pages/admin/machine-credentials.astro",
  "src/pages/admin/partner-registry.astro",
  "src/pages/admin/partners.astro",
  "src/pages/admin/subject-requests.astro"
] as const;

// Read-first 3c screens confirmed to have NO per-row lifecycle status at all
// — they must stay untouched (no `.admin-status-pill` forced onto them).
const NO_CHANGE_SCREENS = [
  "src/pages/admin/email-suppression.astro",
  "src/pages/admin/registrations.astro",
  "src/pages/admin/user-groups.astro"
] as const;

const LEGACY_TOKENS = ["status-badge", "status-dot"] as const;

function legacyClassPattern(token: string): RegExp {
  // Whole space-separated class token inside a `class="..."` attribute value
  // — excludes `admin-status-pill` (no leading `-` after the match) and any
  // unrelated component whose name merely contains the substring.
  return new RegExp(`class="([^"]*\\s)?${token}(\\s[^"]*)?"`);
}

describe("admin-status-pill-wave3 (#862): list-screen status migration", () => {
  for (const screenPath of MIGRATED_SCREENS) {
    test(`${screenPath} uses .admin-status-pill`, async () => {
      const source = await readFile(screenPath, "utf8");

      expect(source).toMatch(
        /class="admin-status-pill"|class=\{`admin-status-pill/
      );
    });

    for (const legacyToken of LEGACY_TOKENS) {
      test(`${screenPath} no longer uses the legacy .${legacyToken}`, async () => {
        const source = await readFile(screenPath, "utf8");

        expect(source).not.toMatch(legacyClassPattern(legacyToken));
      });
    }
  }

  for (const screenPath of NO_CHANGE_SCREENS) {
    test(`${screenPath} was never a .status-badge/.admin-status-pill site (no forced fit)`, async () => {
      const source = await readFile(screenPath, "utf8");

      expect(source).not.toMatch(legacyClassPattern("status-badge"));
      expect(source).not.toContain('class="admin-status-pill"');
    });
  }

  test("legacy .status-badge/.status-dot are retired from admin.css (#866, wave 7)", async () => {
    const css = await readFile("src/styles/admin.css", "utf8");

    expect(css).not.toContain(".status-badge {");
    expect(css).not.toContain(".status-badge .status-dot {");
  });

  test(".admin-status-pill/.admin-status-pill-dot stay defined in admin.css", async () => {
    const css = await readFile("src/styles/admin.css", "utf8");

    expect(css).toContain(".admin-status-pill {");
    expect(css).toContain(".admin-status-pill-dot {");
  });

  describe("comments.astro flagship (segmented filter + bulk bar)", () => {
    test("no legacy .filter-bar status-tab nav left", async () => {
      const source = await readFile("src/pages/admin/comments.astro", "utf8");

      expect(source).not.toContain('class="filter-bar"');
    });

    test("uses .admin-segmented for the status filter, preserving the ?status= query semantics", async () => {
      const source = await readFile("src/pages/admin/comments.astro", "utf8");

      expect(source).toContain('class="admin-segmented"');
      expect(source).toContain('class="admin-segmented-option"');
      expect(source).toContain("/admin/comments?status=");
      // Still a plain <a href>, so the filter works with no JavaScript.
      expect(source).toMatch(/<a\s+class="admin-segmented-option"/);
    });

    test("navigating filter links are a <nav> with aria-current, never tablist/tab roles", async () => {
      const source = await readFile("src/pages/admin/comments.astro", "utf8");
      // Strip JSX comments so the rationale comment itself does not match.
      const markup = source.replace(/\{\/\*[\s\S]*?\*\/\}/g, "");

      expect(markup).toMatch(/<nav\s+class="admin-segmented"\s+aria-label=/);
      expect(markup).toContain('aria-current={tab === activeStatus ? "page"');
      expect(markup).not.toContain('role="tablist"');
      expect(markup).not.toContain('role="tab"');
    });

    test("uses .admin-bulk-bar over the EXISTING bulk-moderate endpoint, never a new one", async () => {
      const source = await readFile("src/pages/admin/comments.astro", "utf8");

      expect(source).toContain('class="admin-bulk-bar"');
      expect(source).toContain("/api/v1/comments/admin/bulk-moderate");
      expect(source).toContain("data-select-all");
      expect(source).toContain("data-row-select");
      expect(source).toContain("aria-live");
    });

    test("does not introduce a new comments bulk endpoint file", async () => {
      const { readdirSync } = await import("node:fs");
      const files = readdirSync("src/pages/api/v1/comments/admin");

      expect(files).toContain("bulk-moderate.ts");
      // Exactly the files this repo already had before #862 — a fresh
      // bulk-* sibling would mean the issue grew a new endpoint, which its
      // own scope forbids ("No other list screen ... every other 'adopt
      // bulk bar' temptation ... is a no").
      const bulkFiles = files.filter((name) => name.includes("bulk"));
      expect(bulkFiles).toEqual(["bulk-moderate.ts"]);
    });
  });
});
