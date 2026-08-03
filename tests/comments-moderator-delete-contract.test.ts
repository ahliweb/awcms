/**
 * `POST /api/v1/comments/admin/{id}/delete` — the moderator half of a
 * transition this module has implemented since ADR-0041 (ADR-0058 §B).
 *
 * The assertions here are the ones that protect a DECISION, not a mechanism.
 * `moderateComment` already handled `"delete"` end to end, so almost nothing
 * about this change can break functionally; what can go wrong is that the
 * deliberate limits quietly stop holding:
 *
 * - **`deleted` must stay terminal.** ADR-0058 §B accepts giving moderators one
 *   irreversible action precisely because the state was already reachable and
 *   already one-way. Someone adding `deleted: ["pending"]` to make restore
 *   "work" would be revising ADR-0041's moderation model inside a change that
 *   is not about it;
 * - **bulk must NOT gain it.** Bulk turns the cost of one mistake from a single
 *   comment into a page of the queue, and this mistake has no in-band undo.
 *   Absences are exactly what nothing catches, which is why the absence is
 *   asserted rather than trusted;
 * - **open reports must resolve.** Otherwise a deleted comment keeps inflating
 *   the queue's `report_count` forever, as reported content nobody can act on.
 *
 * Pure — no database, no network. Runs in `quality` on every PR.
 */
import { readFile } from "node:fs/promises";

import { describe, expect, test } from "bun:test";

import {
  applyModerationAction,
  isLegalTransition,
  type CommentStatus
} from "../src/modules/comments/domain/comment-status";
import { listModules } from "../src/modules";

const ROUTE = "src/pages/api/v1/comments/admin/[id]/delete.ts";
const BULK_ROUTE = "src/pages/api/v1/comments/admin/bulk-moderate.ts";
const MODERATION = "src/modules/comments/application/comment-moderation.ts";

const PERMISSION_KEY = "comments.moderation.delete";

const NON_TERMINAL: readonly CommentStatus[] = [
  "pending",
  "approved",
  "rejected",
  "spam"
];

async function read(path: string): Promise<string> {
  return readFile(path, "utf8");
}

describe("moderator soft delete (ADR-0058 §B)", () => {
  test("the permission it enforces is one the descriptor actually declares", async () => {
    const declared = new Set(
      listModules().flatMap((module) =>
        (module.permissions ?? []).map(
          (permission) =>
            `${module.key}.${permission.activityCode}.${permission.action}`
        )
      )
    );

    expect(declared.has(PERMISSION_KEY)).toBe(true);

    const source = await read(ROUTE);

    expect(source).toContain("COMMENTS_MODULE_KEY");
    expect(source).toContain("COMMENTS_MODERATION_ACTIVITY_CODE");
    expect(source).toContain('action: "delete"');
  });

  test("the route is built on defineTenantRoute, not a hand-rolled withTenant", async () => {
    // `archive`/`restore` predate the factory and sit in its allow-list. This
    // route was first written by copying `archive.ts`, and
    // `api:tenant-route:check` is what caught it — the assertion is here so a
    // future copy of THIS file inherits the right shape instead.
    const source = await read(ROUTE);

    expect(source).toContain("defineTenantRoute");
    expect(source).toContain('workClass: "interactive"');
    expect(source).not.toContain("withTenant(");
  });

  test("the route requires an Idempotency-Key", async () => {
    const source = await read(ROUTE);

    expect(source).toContain('request.headers.get("idempotency-key")');
    expect(source).toContain("IDEMPOTENCY_REQUIRED");
    expect(source).toContain("IDEMPOTENCY_CONFLICT");
  });

  test("delete is reachable from every non-terminal status", () => {
    for (const from of NON_TERMINAL) {
      expect(isLegalTransition(from, "deleted")).toBe(true);
      expect(applyModerationAction(from, "delete").status).toBe("deleted");
    }
  });

  test("`deleted` stays terminal — this change adds no way back in-band", () => {
    // The asymmetry ADR-0058 §B states plainly. If a later change makes
    // `deleted` recoverable, that is a revision of ADR-0041's moderation model
    // and needs its own decision, not a passing edit to this table.
    for (const to of [
      "pending",
      "approved",
      "rejected",
      "spam"
    ] as CommentStatus[]) {
      expect(isLegalTransition("deleted", to)).toBe(false);
    }
  });

  test("bulk moderation deliberately does NOT offer delete", async () => {
    const source = await read(BULK_ROUTE);

    // Bulk decides its action from `decision`, which is approve-or-reject. A
    // third branch, or the literal passed through, would be the regression.
    expect(source).not.toContain('"delete"');
    expect(source).toContain('decision === "approve" ? "approve" : "reject"');
  });

  test("a moderator delete resolves the comment's open reports", async () => {
    const source = await read(MODERATION);
    // Anchored at the comment and read FORWARD. Searching for the table name
    // from the start of the file finds the queue's `report_count` subquery
    // instead, which sits hundreds of lines earlier — the slice came back
    // empty and the assertion passed on nothing until this was fixed.
    const start = source.indexOf("// Resolve open reports");
    expect(start).toBeGreaterThan(-1);

    const clause = source.slice(start);
    const guarded = clause.slice(0, clause.indexOf("awcms_comments_reports"));

    // In the `if`, not merely somewhere between the comment and the UPDATE.
    expect(guarded).toContain("if (");
    expect(guarded).toContain('action === "delete"');
  });

  test("the delete is audited at warning severity, unlike archive/restore", async () => {
    const source = await read(ROUTE);

    expect(source).toContain('action: "comments.moderation.delete"');
    expect(source).toContain('severity: "warning"');

    // The neighbours it must NOT be confused with.
    const archive = await read(
      "src/pages/api/v1/comments/admin/[id]/archive.ts"
    );
    expect(archive).toContain('severity: "info"');
  });
});
