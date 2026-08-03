/**
 * `POST /api/v1/profiles/{id}/restore` — the counterpart `softDeleteParty`
 * shipped without (ADR-0058 §A).
 *
 * What this file is for, and what it deliberately is not: it binds the SHAPE
 * of the restore path, in the two places where getting it wrong is invisible
 * at review time and expensive afterwards.
 *
 * - **The precondition lives in the `WHERE`.** A read-then-write reads exactly
 *   the same at review, passes every functional test, and lets two concurrent
 *   restores both succeed and audit two restorations of one profile. Only the
 *   `WHERE … deleted_at IS NOT NULL` makes the second one a no-op, and the
 *   behaviour was probed against real Postgres: the second `UPDATE` reports
 *   `UPDATE 0`.
 * - **`delete_reason` survives.** Clearing it alongside `deleted_at` is the
 *   tidy-looking choice and it destroys the only record of why the profile was
 *   deleted — after a restore, `restored_at` is what says the deletion no
 *   longer holds, not the absence of its reason.
 *
 * Pure — no database, no network. The DB-level behaviour is covered by CI's
 * integration job; this runs in `quality` on every PR.
 */
import { readFile } from "node:fs/promises";

import { describe, expect, test } from "bun:test";

import { listModules } from "../src/modules";

const ROUTE = "src/pages/api/v1/profiles/[id]/restore.ts";
const DIRECTORY = "src/modules/profile-identity/application/party-directory.ts";

const PERMISSION_KEY = "profile_identity.profile_management.restore";

async function read(path: string): Promise<string> {
  return readFile(path, "utf8");
}

/** The body of one exported function, from its signature to the next top-level `export`. */
function functionBody(source: string, name: string): string {
  const start = source.indexOf(`export async function ${name}(`);
  expect(start).toBeGreaterThan(-1);

  const rest = source.slice(start + 1);
  const end = rest.indexOf("\nexport ");

  return end === -1 ? rest : rest.slice(0, end);
}

describe("profile restore surface (ADR-0058 §A)", () => {
  test("the permission it enforces is one the descriptor actually declares", async () => {
    // The latent-authz trap this repo has shipped twice: an action that is not
    // seeded denies every caller including the tenant owner, and reads fine.
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

    expect(source).toContain('moduleKey: "profile_identity"');
    expect(source).toContain('activityCode: "profile_management"');
    expect(source).toContain('action: "restore"');
  });

  test("the route requires an Idempotency-Key", async () => {
    const source = await read(ROUTE);

    expect(source).toContain('request.headers.get("idempotency-key")');
    expect(source).toContain("IDEMPOTENCY_REQUIRED");
    expect(source).toContain("IDEMPOTENCY_CONFLICT");
  });

  test("missing and not-deleted answer the SAME 404, so the route is not an id oracle", async () => {
    const source = await read(ROUTE);

    // One `fail(404, …)` call site, one message. A second, differently worded
    // 404 is how a caller learns which ids exist.
    const notFounds = [...source.matchAll(/fail\(\s*404\s*,/g)];
    expect(notFounds).toHaveLength(1);
    expect(source).toContain("Profile not found, or is not soft-deleted.");
  });

  test("restoreParty puts its precondition in the WHERE, not in a read first", async () => {
    const body = functionBody(await read(DIRECTORY), "restoreParty");

    expect(body).toContain("deleted_at IS NOT NULL");

    // `updateParty` legitimately reads first (it merges partial input over the
    // existing row). A restore has no input to merge, so a read here would be
    // there only to check the precondition — which is the race.
    expect(body).not.toContain("fetchPartyById");
  });

  test("restoreParty clears the deletion but keeps its reason", async () => {
    const body = functionBody(await read(DIRECTORY), "restoreParty");

    expect(body).toContain("deleted_at = NULL");
    expect(body).toContain("restored_at = now()");
    expect(body).toContain("restored_by =");

    // The assertion that matters: `delete_reason` is never assigned in this
    // statement. Matching the SET list rather than the whole body, so the
    // audit payload's `deleteReason` reference does not mask a regression.
    const setClause = body.slice(body.indexOf("SET"), body.indexOf("WHERE"));
    expect(setClause).not.toContain("delete_reason");
  });

  test("the restore is audited, and as its own action", async () => {
    const body = functionBody(await read(DIRECTORY), "restoreParty");

    expect(body).toContain("recordAuditEvent");
    expect(body).toContain('action: "restore"');
  });
});
