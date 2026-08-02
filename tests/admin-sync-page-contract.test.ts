/**
 * `/admin/sync` gates against the endpoints it drives, and stays off the ones
 * no browser may legitimately call.
 *
 * Sibling of `admin-data-lifecycle-page-contract.test.ts`,
 * `admin-reporting-page-contract.test.ts`,
 * `admin-approvals-page-contract.test.ts` and
 * `admin-domain-events-page-contract.test.ts`.
 *
 * Three things are specific to this module:
 *
 * - **Resolving a conflict is `conflict_resolution.approve`.**
 *   `conflict_resolution.resolve` and `.update` both read better than the
 *   permission that exists, and neither is seeded, so a page inventing one
 *   would hide every resolution button from every operator including the
 *   owner. This repo has shipped that class of bug twice.
 * - **None of the three mutations takes an `Idempotency-Key`.** All three are
 *   state transitions that are naturally idempotent — `status = 'active'`,
 *   `status = 'resolved'`, `status = 'pending'` — rather than requests that do
 *   fresh work per call. Sending a key would imply a replay contract these
 *   endpoints do not have, and the test asserts the routes still agree.
 * - **`push`/`pull`/`objects`/`status` are the NODE protocol.** They are
 *   authenticated by HMAC signature, not by a session, so a screen offering
 *   buttons for them would render controls no browser can legitimately use.
 *
 * Pure — no database, no network. Runs in `quality` on every PR.
 */
import { readFile } from "node:fs/promises";

import { describe, expect, test } from "bun:test";

import { listModules } from "../src/modules";

const PAGE = "src/pages/admin/sync.astro";
const RESOLVE_ROUTE = "src/pages/api/v1/sync/conflicts/[id]/resolve.ts";
const NODE_ROUTE = "src/pages/api/v1/sync/nodes/[id].ts";
const RETRY_ROUTE = "src/pages/api/v1/sync/object-queue/[id]/retry.ts";
const ROUTES = [
  "src/pages/api/v1/sync/nodes/index.ts",
  NODE_ROUTE,
  "src/pages/api/v1/sync/conflicts/index.ts",
  RESOLVE_ROUTE,
  "src/pages/api/v1/sync/object-queue/index.ts",
  RETRY_ROUTE
];

/** The node protocol: HMAC-signed, machine-to-machine, never a browser. */
const NODE_PROTOCOL_PATHS = [
  "/api/v1/sync/push",
  "/api/v1/sync/pull",
  "/api/v1/sync/objects",
  "/api/v1/sync/status"
];

type Triple = `${string}.${string}.${string}`;

function guardTriplesFrom(source: string): Set<Triple> {
  const found = new Set<Triple>();
  const pattern =
    /moduleKey:\s*"([a-z_]+)",\s*activityCode:\s*"([a-z_]+)",\s*action:\s*"([a-z_]+)"/g;

  for (const match of source.matchAll(pattern)) {
    found.add(`${match[1]}.${match[2]}.${match[3]}` as Triple);
  }

  return found;
}

function pageTriplesFrom(source: string): Set<Triple> {
  const found = new Set<Triple>();
  const pattern =
    /permissionKey\(\s*"([a-z_]+)",\s*"([a-z_]+)",\s*"([a-z_]+)"\s*\)/g;

  for (const match of source.matchAll(pattern)) {
    found.add(`${match[1]}.${match[2]}.${match[3]}` as Triple);
  }

  return found;
}

function declaredTriples(): Set<Triple> {
  return new Set<Triple>(
    (listModules()
      .find((module) => module.key === "sync_storage")
      ?.permissions?.map(
        (permission) =>
          `sync_storage.${permission.activityCode}.${permission.action}`
      ) ?? []) as Triple[]
  );
}

describe("/admin/sync permission gates", () => {
  test("every key the page gates on is one its endpoints actually enforce", async () => {
    const pageKeys = pageTriplesFrom(await readFile(PAGE, "utf8"));
    expect(pageKeys.size).toBe(6);

    const enforced = new Set<Triple>();
    for (const route of ROUTES) {
      for (const triple of guardTriplesFrom(await readFile(route, "utf8"))) {
        enforced.add(triple);
      }
    }

    // Guards really were parsed — an empty `enforced` would make the subset
    // check pass vacuously, the shape of gate this repo has been burned by.
    expect(enforced.size).toBeGreaterThan(0);
    expect([...pageKeys].filter((key) => !enforced.has(key))).toEqual([]);
  });

  test("and is declared by the module descriptor, so a migration seeds it", async () => {
    const declared = declaredTriples();
    expect(declared.size).toBe(6);

    const missing = [...pageTriplesFrom(await readFile(PAGE, "utf8"))].filter(
      (key) => !declared.has(key)
    );

    expect(missing).toEqual([]);
  });

  test("the page drives all six — a screen for five leaves a surface curl-only", async () => {
    const pageKeys = pageTriplesFrom(await readFile(PAGE, "utf8"));

    // Enumerated rather than compared as sets, so a NEW permission added later
    // fails here loudly and its author has to decide whether the screen should
    // drive it.
    expect([...pageKeys].sort()).toEqual([
      "sync_storage.conflict_resolution.approve",
      "sync_storage.conflict_resolution.read",
      "sync_storage.node_management.read",
      "sync_storage.node_management.update",
      "sync_storage.object_queue.read",
      "sync_storage.object_queue.retry"
    ]);
  });

  test("resolving is gated on approve — resolve and update are seeded nowhere", async () => {
    const declared = declaredTriples();
    const resolve = await readFile(RESOLVE_ROUTE, "utf8");

    expect(
      guardTriplesFrom(resolve).has("sync_storage.conflict_resolution.approve")
    ).toBe(true);
    expect(
      declared.has("sync_storage.conflict_resolution.resolve" as Triple)
    ).toBe(false);
    expect(
      declared.has("sync_storage.conflict_resolution.update" as Triple)
    ).toBe(false);
  });

  test("the page never mutates directly — it posts to the guarded endpoints", async () => {
    const page = await readFile(PAGE, "utf8");

    // No SQL write anywhere in the screen: every change goes out over fetch, so
    // the endpoints' audit rows cannot be bypassed by a screen that writes for
    // itself.
    expect(page).not.toMatch(
      /\b(INSERT\s+INTO|UPDATE\s+awcms_|DELETE\s+FROM)/i
    );

    expect(page).toContain("/api/v1/sync/nodes/${nodeId}`");
    expect(page).toContain("/api/v1/sync/conflicts/${conflictId}/resolve`");
    expect(page).toContain("/api/v1/sync/object-queue/${id}/retry`");
  });

  test("no mutation carries an Idempotency-Key, and no endpoint asks for one", async () => {
    const page = await readFile(PAGE, "utf8");

    // Unlike every other admin console in this repo, ALL of this module's
    // mutations are naturally idempotent state transitions. A key here would
    // imply a replay contract the endpoints do not have — and the second half
    // asserts that is still true of the endpoints, not just of the page.
    // Matched in its DOUBLE-QUOTED code form, so the page's own prose about
    // why it sends none (which spells the header in backticks) does not make
    // this assertion unsatisfiable.
    expect(page).not.toContain('"Idempotency-Key"');

    for (const route of [NODE_ROUTE, RESOLVE_ROUTE, RETRY_ROUTE]) {
      expect(await readFile(route, "utf8")).not.toContain(
        "IDEMPOTENCY_REQUIRED"
      );
    }
  });

  test("the node protocol endpoints get no controls — they are HMAC, not session", async () => {
    const page = await readFile(PAGE, "utf8");

    // `push`/`pull`/`objects`/`status` authenticate a NODE by signature. A
    // button for them would be a control no browser can legitimately use, and
    // its failure would look like a bug rather than a category error.
    for (const path of NODE_PROTOCOL_PATHS) {
      expect(page).not.toContain(path);
    }
  });

  test("the conflicts endpoint and the page read through the SAME function", async () => {
    const route = await readFile(
      "src/pages/api/v1/sync/conflicts/index.ts",
      "utf8"
    );
    const page = await readFile(PAGE, "utf8");

    // The query used to be inline in the route. Two readers of one table, each
    // with its own SQL, is how a screen quietly stops mirroring the endpoint it
    // is supposed to mirror — the drift `sync-directory.ts`'s header comment
    // already anticipated for nodes and the object queue.
    expect(route).toContain("fetchSyncConflicts");
    expect(page).toContain("fetchSyncConflicts");
    expect(route).not.toContain("FROM awcms_sync_conflicts");
    expect(page).not.toContain("FROM awcms_sync_conflicts");
  });

  test("the endpoint still omits an unresolved conflict's null fields", async () => {
    const route = await readFile(
      "src/pages/api/v1/sync/conflicts/index.ts",
      "utf8"
    );

    // `fetchSyncConflicts` returns `null` for them, which is what a page wants;
    // this endpoint has always omitted the keys instead. A `null` where a
    // client expects an absent key is a wire-format change, not a refactor.
    expect(route).toContain("conflict.resolution ?? undefined");
    expect(route).toContain("conflict.resolvedAt ?? undefined");
  });

  test("the sidebar entry points at this page and is gated on a real permission", () => {
    const nav = listModules()
      .find((module) => module.key === "sync_storage")
      ?.navigation?.find((entry) => entry.path === "/admin/sync");

    expect(nav).toBeDefined();
    expect(nav!.requiredPermission).toBe("sync_storage.node_management.read");
    expect(declaredTriples().has(nav!.requiredPermission as Triple)).toBe(true);
    // `admin-navigation-registry.test.ts` already binds path→file and
    // labelKey→SIDEBAR_LABELS; this pins the gate specifically.
  });
});
