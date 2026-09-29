/**
 * Regression gate for Issue #861 (item 4 of #854): admin stacked tables must
 * show a TRANSLATED `data-label`, and closed-enum/status label maps must stay
 * exhaustive over their source-of-truth value set.
 *
 * ## Why `data-label` is scoped to `<td`/`<th`
 *
 * `admin.css`'s stacked-table mechanism is `.data-table--stack td::before {
 * content: attr(data-label); }` (`src/styles/admin.css`) — it reads
 * `data-label` off table CELLS only. `data-label` also appears, unrelated, on
 * a few `<button>` elements in `site-profile.astro`/`blog.astro`/
 * `blog-ads.astro` as a generic "id of the element this button updates"
 * attribute consumed by `src/lib/ui/media-picker-client.ts`
 * (`document.getElementById(button.dataset.label)`) — those values
 * ("profile-logo-label", …) are element ids, not display text, and
 * translating them would silently break the id lookup. Scoping the scan to
 * table cells is therefore not a narrower exemption, it is the accurate
 * description of the bug: an untranslated column name shown on a stacked
 * table on a phone.
 *
 * ## Why this is a source-text scan, not a DOM/render test
 *
 * Pure and synchronous, like `i18n:catalog:check` and `i18n:screens:check`:
 * no Astro render, no database. `data-label="…"` with a literal string is
 * unambiguous, so a regex scan over the same file list those gates already
 * walk is a strictly sufficient check — and, per `i18n-catalog-check.ts`'s
 * own header, a regex that reports a real violation is worth more than a
 * renderer that might not be reachable at gate time.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join, relative } from "node:path";

import { REPO_ROOT, listFilesRecursive } from "../scripts/lib/repo-files";
import { stripComments } from "../scripts/lib/source-text";
import {
  blogContentStatusLabel,
  blogContentVisibilityLabel
} from "../src/lib/i18n/labels/blog-content";
import { auditSeverityLabel } from "../src/lib/i18n/labels/audit-severity";
import { omesEnrollmentStatusLabel } from "../src/lib/i18n/labels/omes-enrollment";
import { omesOperationStatusLabel } from "../src/lib/i18n/labels/omes-operation";
import { getTranslator } from "../src/lib/i18n";
import {
  BLOG_CONTENT_STATUSES,
  BLOG_CONTENT_VISIBILITIES
} from "../src/modules/blog-content/domain/post-status";

const ADMIN_PAGES_ROOT = join(REPO_ROOT, "src/pages/admin");

/** A `data-label="…"` attribute on a `<td` or `<th` opening tag, literal text only. */
const CELL_DATA_LABEL = /<t[dh]\b(?:(?!>)[^"]|"[^"]*")*?data-label="([^"]*)"/g;

function listAdminAstroFiles(): string[] {
  return listFilesRecursive(ADMIN_PAGES_ROOT, {
    extensions: [".astro"]
  });
}

describe("admin stacked-table data-label is translated, not literal (Issue #861)", () => {
  const files = listAdminAstroFiles();

  test("the admin screen list is not empty (a vacuous pass is not a pass)", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const file of files) {
    const relPath = relative(REPO_ROOT, file);

    test(`${relPath} has no literal data-label="…" on a table cell`, () => {
      const source = stripComments(readFileSync(file, "utf8"));
      const matches = [...source.matchAll(CELL_DATA_LABEL)].map(
        (match) => match[1]
      );

      expect(matches).toEqual([]);
    });
  }
});

describe("shared enum label helpers stay exhaustive (Issue #861)", () => {
  const t = getTranslator("en").t;

  test("blogContentStatusLabel translates every BlogContentStatus away from its raw form", () => {
    for (const status of BLOG_CONTENT_STATUSES) {
      expect(blogContentStatusLabel(t, status)).not.toBe(status);
    }
  });

  test("blogContentStatusLabel falls back to the raw value for an unrecognised status", () => {
    expect(blogContentStatusLabel(t, "not_a_real_status")).toBe(
      "not_a_real_status"
    );
  });

  test("blogContentVisibilityLabel translates every BlogContentVisibility away from its raw form", () => {
    for (const visibility of BLOG_CONTENT_VISIBILITIES) {
      expect(blogContentVisibilityLabel(t, visibility)).not.toBe(visibility);
    }
  });

  test("auditSeverityLabel translates every known severity away from its raw form", () => {
    for (const severity of ["info", "warning", "critical"] as const) {
      expect(auditSeverityLabel(t, severity)).not.toBe(severity);
    }
  });

  test("auditSeverityLabel falls back to the raw value for an unrecognised severity", () => {
    expect(auditSeverityLabel(t, "not_a_real_severity")).toBe(
      "not_a_real_severity"
    );
  });

  test("omesEnrollmentStatusLabel translates every known status away from its raw form", () => {
    for (const status of [
      "pending",
      "enrolled",
      "revoked",
      "expired"
    ] as const) {
      expect(omesEnrollmentStatusLabel(t, status)).not.toBe(status);
    }
  });

  test("omesEnrollmentStatusLabel falls back to the raw value for an unrecognised status", () => {
    expect(omesEnrollmentStatusLabel(t, "not_a_real_status")).toBe(
      "not_a_real_status"
    );
  });

  test("omesOperationStatusLabel translates every known status away from its raw form", () => {
    for (const status of [
      "requested",
      "approved",
      "rejected",
      "dispatched",
      "completed",
      "failed"
    ] as const) {
      expect(omesOperationStatusLabel(t, status)).not.toBe(status);
    }
  });

  test("omesOperationStatusLabel falls back to the raw value for an unrecognised status", () => {
    expect(omesOperationStatusLabel(t, "not_a_real_status")).toBe(
      "not_a_real_status"
    );
  });
});
