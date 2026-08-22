/**
 * `GET /api/v1/media/objects/list` (ADR-0056 §C) is a SEPARATE route, and the
 * batch resolver beside it stays exactly as strict as it was.
 *
 * The decision under test is the one §C rejects an alternative for: teaching
 * `GET /api/v1/media/objects` a "no `ids` means list everything" branch would
 * turn a request that is a **400 today** into a dump of the whole registry —
 * a contract change wearing the clothes of an addition, which no existing
 * caller could opt out of. So the resolver must keep failing without `ids`, and
 * the list must not live inside it.
 *
 * The second thing pinned here is the path ambiguity `/list` creates. It is a
 * static sibling of `[id].ts`; Astro resolves static before dynamic, but that
 * is a framework rule, and on its own it leaves "the list" and "the object
 * whose id is `list`" as two readings of one path. Requiring a uuid on the
 * dynamic routes closes it from the other side — there is no object `/list`
 * could otherwise address.
 *
 * Pure — no database, no network. The query itself is exercised against a real
 * PostgreSQL in `tests/integration/media-object-list.integration.test.ts`,
 * which is where the cursor-precision property actually lives.
 */
import { readFile } from "node:fs/promises";

import { describe, expect, test } from "bun:test";

import { isMediaObjectId } from "../src/modules/media-library/domain/media-object-id";
import { MEDIA_OBJECT_LIST_LIMIT } from "../src/modules/media-library/application/media-object-directory";

const LIST_ROUTE = "src/pages/api/v1/media/objects/list.ts";
const RESOLVER_ROUTE = "src/pages/api/v1/media/objects/index.ts";
const DIRECTORY =
  "src/modules/media-library/application/media-object-directory.ts";

const ID_ROUTES = [
  "src/pages/api/v1/media/objects/[id].ts",
  "src/pages/api/v1/media/objects/[id]/restore.ts",
  "src/pages/api/v1/media/objects/[id]/purge.ts"
];

describe("the list is a separate route, not a mode on the resolver", () => {
  test("the resolver still refuses a request without ids", async () => {
    const source = await readFile(RESOLVER_ROUTE, "utf8");

    expect(source).toContain('url.searchParams.get("ids")');
    expect(source).toContain("ids is required");
    // The branch §C rejects. Its absence is the whole decision.
    expect(source).not.toContain("listMediaObjects");
  });

  test("the resolver keeps its 100-id ceiling and uuid check", async () => {
    const source = await readFile(RESOLVER_ROUTE, "utf8");

    expect(source).toContain("const MAX_IDS = 100");
    expect(source).toContain("ids must all be uuids");
  });

  test("the list route gates on media.read, the same permission as the resolver", async () => {
    const list = await readFile(LIST_ROUTE, "utf8");

    expect(list).toContain("MEDIA_PERMISSION_ACTIVITY_CODE");
    expect(list).toContain('action: "read"');
    // Read-only: a listing must never carry a write guard, and a GET that
    // required `media.delete` would hide the screen from everyone who can only
    // look.
    expect(list).not.toContain('action: "delete"');
    expect(list).not.toContain('action: "purge"');
  });

  test("the list route is bounded and keyset-paged, never OFFSET", async () => {
    const list = await readFile(LIST_ROUTE, "utf8");
    const directory = await readFile(DIRECTORY, "utf8");
    const listFn = directory.slice(
      directory.indexOf("export async function listMediaObjects")
    );

    expect(list).toContain("decodeKeysetCursor");
    expect(list).toContain("MEDIA_OBJECT_LIST_LIMIT");
    expect(MEDIA_OBJECT_LIST_LIMIT).toBeLessThanOrEqual(100);

    // Full-precision cursor text, never a JS `Date` — Issue #158. A batch
    // upload writes many rows inside one millisecond, so this module is one of
    // the likeliest places to resurrect it.
    expect(listFn).toContain("keysetCursorCreatedAtSql()");
    expect(listFn).toContain("created_at_cursor");
    expect(listFn).not.toContain("toISOString");
    expect(listFn).not.toMatch(/\bOFFSET\b/);
    expect(listFn).toContain("ORDER BY created_at DESC, id DESC");
  });

  test("a malformed cursor is refused, not silently treated as page 1", async () => {
    const list = await readFile(LIST_ROUTE, "utf8");

    // Treating a corrupt cursor as absent serves page 1 to a caller who asked
    // for page 4, and the paging loop never terminates.
    expect(list).toContain("cursor is malformed");
  });

  test("unknown filter values are refused, not ignored", async () => {
    const list = await readFile(LIST_ROUTE, "utf8");

    expect(list).toContain("status must be one of");
    expect(list).toContain("deletion must be one of");
  });
});

describe("`/list` cannot collide with an object id", () => {
  test("`list` is not a valid media object id", () => {
    expect(isMediaObjectId("list")).toBe(false);
    expect(isMediaObjectId(undefined)).toBe(false);
    expect(isMediaObjectId("not-a-uuid")).toBe(false);
    expect(isMediaObjectId(crypto.randomUUID())).toBe(true);
  });

  test("every dynamic media object route validates the id as a uuid", async () => {
    for (const file of ID_ROUTES) {
      const source = await readFile(file, "utf8");

      expect(source).toContain("isMediaObjectId");
      // Without this the framework's static-before-dynamic rule is the ONLY
      // thing keeping the two paths apart.
      expect(source).toContain("Media object id must be a uuid");
    }
  });
});

describe("the listing deliberately outgrows the resolver's safety rule", () => {
  test("it does not filter on isNewsMediaObjectSafeForPublicReference", async () => {
    const directory = await readFile(DIRECTORY, "utf8");
    const listFn = directory.slice(
      directory.indexOf("export async function listMediaObjects"),
      directory.indexOf("export type MarkNewsMediaObjectUploadedInput")
    );

    // An administrator opens this list precisely because of the objects that
    // are NOT healthy — pending, failed, orphaned. Narrowing it to publicly
    // referenceable rows would make the lifecycle endpoints unreachable from a
    // screen, since their targets are exactly the excluded ones.
    expect(listFn).not.toContain("isNewsMediaObjectSafeForPublicReference");
    expect(listFn).not.toContain("'verified'");
  });

  test("but defaults to live rows, so deleted objects are opt-in", async () => {
    const directory = await readFile(DIRECTORY, "utf8");

    expect(directory).toContain('filter.deletion ?? "live"');
    // Three states, not a boolean: "show me what I deleted" is the question the
    // restore/purge endpoints exist to answer, and a boolean cannot ask it.
    expect(directory).toContain(
      'export type MediaObjectDeletionFilter = "live" | "deleted" | "all"'
    );
  });
});
