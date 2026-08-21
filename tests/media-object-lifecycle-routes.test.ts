/**
 * ADR-0056 §B — the three media object lifecycle endpoints gate on the three
 * permissions that were seeded with no surface at all.
 *
 * This is the inverse of the usual page contract: there is no screen yet, so
 * what has to be proven is that the permissions the catalog has been handing
 * out since `sql/052` are now enforced by real guards, and enforced on the
 * SAME keys the descriptor declares. A guard naming an action nothing seeds
 * denies everyone including the owner, and the endpoint would look perfectly
 * correct in review — this repo has shipped that defect twice.
 *
 * Four things specific to this trio:
 *
 * - **`purge` deletes the registry row, never R2 bytes** (§B). A future edit
 *   that reaches for the R2 client from the route would silently make the
 *   endpoint a second writer on a bucket the reconciliation job owns.
 * - **`purge` runs inside a SAVEPOINT.** `awcms_news_portal_ad_placements`
 *   holds a hard NOT NULL FK here, and a `23503` aborts the transaction — so
 *   catching it without the savepoint turns a caller-actionable 409 into a
 *   500 at COMMIT time.
 * - **All three require `Idempotency-Key`**, unlike `cancel` beside them.
 * - **`media_library` must not import `blog_content`** to validate a delete
 *   reason, which is why the shared blog validator is duplicated rather than
 *   reused.
 *
 * Pure — no database, no network. Runs in `quality` on every PR.
 */
import { readFile } from "node:fs/promises";

import { describe, expect, test } from "bun:test";

import { mediaLibraryModule } from "../src/modules/media-library/module";
import {
  MAX_DELETE_REASON_LENGTH,
  validateSoftDeleteMediaObjectInput
} from "../src/modules/media-library/domain/media-lifecycle-validation";

const DELETE_ROUTE = "src/pages/api/v1/media/objects/[id].ts";
const RESTORE_ROUTE = "src/pages/api/v1/media/objects/[id]/restore.ts";
const PURGE_ROUTE = "src/pages/api/v1/media/objects/[id]/purge.ts";
const DIRECTORY =
  "src/modules/media-library/application/media-object-directory.ts";

const ROUTES = [
  { file: DELETE_ROUTE, action: "delete" },
  { file: RESTORE_ROUTE, action: "restore" },
  { file: PURGE_ROUTE, action: "purge" }
] as const;

function guardActionsFrom(source: string): Set<string> {
  const found = new Set<string>();
  const pattern =
    /moduleKey:\s*"([a-z_]+)",\s*activityCode:\s*MEDIA_PERMISSION_ACTIVITY_CODE,\s*action:\s*"([a-z_]+)"/g;

  for (const match of source.matchAll(pattern)) {
    if (match[1] === "media_library") found.add(match[2]!);
  }

  return found;
}

function declaredMediaActions(): Set<string> {
  return new Set(
    (mediaLibraryModule.permissions ?? [])
      .filter((permission) => permission.activityCode === "media")
      .map((permission) => permission.action)
  );
}

describe("ADR-0056 §B — the three ungated permissions now have guards", () => {
  test("each route gates on its own action, and on a key the descriptor declares", async () => {
    const declared = declaredMediaActions();

    // Non-vacuous: if the descriptor stopped declaring `media.*` entirely, the
    // subset assertions below would all pass while proving nothing.
    expect(declared.size).toBe(8);

    for (const { file, action } of ROUTES) {
      const actions = guardActionsFrom(await readFile(file, "utf8"));

      // `objects/[id].ts` carries TWO methods since Issue #615 — DELETE and the
      // rights PATCH — so the assertion is that this route's action is present
      // and that every action it gates on is declared, not that the file holds
      // exactly one. Anything stricter would forbid a second method on a file
      // for no reason connected to what this test is about.
      expect(actions.has(action)).toBe(true);
      for (const found of actions) {
        expect(declared.has(found)).toBe(true);
      }
    }
  });

  test("the guards use the shared activity-code constant, not a re-typed string", async () => {
    for (const { file } of ROUTES) {
      const source = await readFile(file, "utf8");

      expect(source).toContain("MEDIA_PERMISSION_ACTIVITY_CODE");
      // A literal `activityCode: "media"` would still work today and would
      // silently survive a rename of the activity code.
      expect(source).not.toContain('activityCode: "media"');
    }
  });

  test("all three require Idempotency-Key — every one is a HIGH_RISK_ACTION", async () => {
    for (const { file } of ROUTES) {
      const source = await readFile(file, "utf8");

      expect(source).toContain("IDEMPOTENCY_REQUIRED");
      expect(source).toContain("findIdempotencyRecord");
      expect(source).toContain("saveIdempotencyRecord");
      expect(source).toContain("IDEMPOTENCY_CONFLICT");
    }
  });

  test("each route has its OWN idempotency scope", async () => {
    const scopes = new Set<string>();

    for (const { file } of ROUTES) {
      const source = await readFile(file, "utf8");
      const match = source.match(/IDEMPOTENCY_SCOPE = "([a-z_]+)"/);

      expect(match).not.toBeNull();
      scopes.add(match![1]!);
    }

    // Sharing one scope would let a delete's key collide with a purge's, so a
    // replayed key could return the wrong action's stored response.
    expect(scopes.size).toBe(ROUTES.length);
  });

  test("delete's request hash covers the reason, restore's and purge's cannot", async () => {
    const deleteSource = await readFile(DELETE_ROUTE, "utf8");

    // Otherwise replaying one key with a different reason returns the first
    // response while the audit row records a reason the caller never sent.
    expect(deleteSource).toMatch(
      /computeRequestHash\(\{[\s\S]*?reason: prepared\.reason[\s\S]*?\}\)/
    );

    // Scoped to the hash call, not the whole file — both siblings discuss
    // reasons in prose, and asserting over that would fail for the wrong cause.
    for (const file of [RESTORE_ROUTE, PURGE_ROUTE]) {
      const source = await readFile(file, "utf8");
      const call = source.slice(source.indexOf("computeRequestHash("));

      expect(call.slice(0, call.indexOf(");"))).not.toContain("reason");
    }
  });
});

describe("purge clears the registry, not the bucket", () => {
  test("the route never reaches for R2", async () => {
    const source = await readFile(PURGE_ROUTE, "utf8");

    // The reconciliation job owns the bucket. A second writer here is the
    // failure mode §B names explicitly.
    expect(source).not.toContain("media-r2-client");
    expect(source).not.toContain("deleteObject");
    expect(source).not.toMatch(/\bR2Client\b/);
  });

  test("the hard delete runs inside a savepoint and maps 23503 to a reason", async () => {
    const directory = await readFile(DIRECTORY, "utf8");
    const purgeFn = directory.slice(
      directory.indexOf("export async function purgeNewsMediaObject")
    );

    expect(purgeFn).toContain("SAVEPOINT ${PURGE_SAVEPOINT}");
    expect(purgeFn).toContain("ROLLBACK TO SAVEPOINT ${PURGE_SAVEPOINT}");
    expect(purgeFn).toContain("RELEASE SAVEPOINT ${PURGE_SAVEPOINT}");
    expect(directory).toContain('const FOREIGN_KEY_VIOLATION = "23503"');
    expect(purgeFn).toContain('reason: "still_referenced"');

    // Eligibility stays in the WHERE clause: a live object must answer 404,
    // never be destroyed by a purge call that skipped the soft-delete step.
    expect(purgeFn).toContain("deleted_at IS NOT NULL");
  });

  test("the route surfaces the FK case as 409, distinct from 404", async () => {
    const source = await readFile(PURGE_ROUTE, "utf8");

    expect(source).toContain("MEDIA_OBJECT_REFERENCED");
    expect(source).toContain('result.reason === "still_referenced"');
    expect(source).toContain("RESOURCE_NOT_FOUND");
  });
});

describe("the delete-reason validator", () => {
  test("does not import blog_content — media must not depend on its consumers", async () => {
    const source = await readFile(
      "src/modules/media-library/domain/media-lifecycle-validation.ts",
      "utf8"
    );

    // `blog-content/domain/content-validation.ts` exports an equivalent
    // validator, and reusing it would be a System Foundation module importing
    // one of its own consumers. Asserted over IMPORTS only: the file's header
    // names `blog_content` while explaining why it does not import it.
    const imports = source
      .split("\n")
      .filter((line) => line.startsWith("import "));

    expect(imports.join("\n")).not.toContain("blog-content");
    expect(source).not.toMatch(/from\s+"[^"]*blog[^"]*"/);

    // Same rule at the route: the reason validator must come from this module.
    expect(await readFile(DELETE_ROUTE, "utf8")).not.toMatch(
      /from\s+"[^"]*blog[^"]*"/
    );
  });

  test("requires a reason, trims it, and bounds its length", () => {
    expect(validateSoftDeleteMediaObjectInput({}).valid).toBe(false);
    expect(validateSoftDeleteMediaObjectInput({ reason: "" }).valid).toBe(
      false
    );
    // Whitespace-only must fail as "required", not pass as a long reason.
    expect(validateSoftDeleteMediaObjectInput({ reason: "   " }).valid).toBe(
      false
    );
    expect(validateSoftDeleteMediaObjectInput({ reason: 42 }).valid).toBe(
      false
    );

    const tooLong = validateSoftDeleteMediaObjectInput({
      reason: "x".repeat(MAX_DELETE_REASON_LENGTH + 1)
    });
    expect(tooLong.valid).toBe(false);

    const atLimit = validateSoftDeleteMediaObjectInput({
      reason: "x".repeat(MAX_DELETE_REASON_LENGTH)
    });
    expect(atLimit.valid).toBe(true);

    const trimmed = validateSoftDeleteMediaObjectInput({
      reason: "  policy violation  "
    });
    expect(trimmed.valid).toBe(true);
    expect(trimmed.valid && trimmed.value.reason).toBe("policy violation");
  });

  test("the route uses it rather than reading request.reason directly", async () => {
    const source = await readFile(DELETE_ROUTE, "utf8");

    expect(source).toContain("validateSoftDeleteMediaObjectInput");
    expect(source).toContain("readJsonBody");
    // Without the size guard an unbounded body reaches JSON.parse before any
    // validation runs.
    expect(source).toContain("bodyTooLargeResponse");
  });
});
