/**
 * `/admin/domain-events` gates against the endpoints it drives, and sends the
 * `Idempotency-Key` header to exactly the one endpoint that requires it.
 *
 * Sibling of `admin-data-lifecycle-page-contract.test.ts`,
 * `admin-reporting-page-contract.test.ts` and
 * `admin-approvals-page-contract.test.ts`.
 *
 * Two things are specific to this module:
 *
 * - **Pause and resume share ONE permission**, `consumers.manage`. They are
 *   opposite actions and read like they want `consumers.pause` /
 *   `consumers.resume`; neither of those is seeded anywhere, so a page that
 *   invented them would hide both buttons from every operator including the
 *   owner. This repo has shipped that exact bug twice.
 * - **The three mutations split three ways on idempotency**, and the split is
 *   load-bearing rather than incidental: `replay` requires a key because each
 *   call does new work; `pause` requires none because setting a flag twice has
 *   the same end state; `resume` requires none and takes no body at all. A
 *   screen that sent a key to `pause` would imply a replay contract that
 *   endpoint does not have, and one that omitted it on `replay` would render a
 *   button that always fails with `IDEMPOTENCY_REQUIRED`.
 *
 * Pure — no database, no network. Runs in `quality` on every PR.
 */
import { readFile } from "node:fs/promises";

import { describe, expect, test } from "bun:test";

import { listModules } from "../src/modules";

const PAGE = "src/pages/admin/domain-events.astro";
const REPLAY_ROUTE = "src/pages/api/v1/domain-events/deliveries/[id]/replay.ts";
const PAUSE_ROUTE = "src/pages/api/v1/domain-events/consumers/[name]/pause.ts";
const RESUME_ROUTE =
  "src/pages/api/v1/domain-events/consumers/[name]/resume.ts";
const ROUTES = [
  "src/pages/api/v1/domain-events/events/index.ts",
  "src/pages/api/v1/domain-events/events/[id].ts",
  "src/pages/api/v1/domain-events/deliveries/index.ts",
  "src/pages/api/v1/domain-events/deliveries/[id].ts",
  REPLAY_ROUTE,
  "src/pages/api/v1/domain-events/consumers/index.ts",
  PAUSE_ROUTE,
  RESUME_ROUTE
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

/**
 * Both spellings, and issue #450 is why the second exists: a screen routed
 * through `loadAdminScreen` states its guards as `AccessRequest` object
 * literals — the SAME shape the routes use — instead of `permissionKey(...)`.
 *
 * Reading only the old spelling would have made this test demand the screen
 * keep deciding access from the raw grant set, which is the defect it exists to
 * catch elsewhere. A contract test pins the PROPERTY, never the syntax.
 */
function pageTriplesFrom(source: string): Set<Triple> {
  const found = new Set<Triple>();

  for (const match of source.matchAll(
    /permissionKey\(\s*"([a-z_]+)",\s*"([a-z_]+)",\s*"([a-z_]+)"\s*\)/g
  )) {
    found.add(`${match[1]}.${match[2]}.${match[3]}` as Triple);
  }

  for (const match of source.matchAll(
    /moduleKey:\s*"([a-z_]+)",\s*activityCode:\s*"([a-z_]+)",\s*action:\s*"([a-z_]+)"/g
  )) {
    found.add(`${match[1]}.${match[2]}.${match[3]}` as Triple);
  }

  return found;
}

function declaredTriples(): Set<Triple> {
  return new Set<Triple>(
    (listModules()
      .find((module) => module.key === "domain_event_runtime")
      ?.permissions?.map(
        (permission) =>
          `domain_event_runtime.${permission.activityCode}.${permission.action}`
      ) ?? []) as Triple[]
  );
}

describe("/admin/domain-events permission gates", () => {
  test("every key the page gates on is one its endpoints actually enforce", async () => {
    const pageKeys = pageTriplesFrom(await readFile(PAGE, "utf8"));
    expect(pageKeys.size).toBe(5);

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
    expect(declared.size).toBe(5);

    const missing = [...pageTriplesFrom(await readFile(PAGE, "utf8"))].filter(
      (key) => !declared.has(key)
    );

    expect(missing).toEqual([]);
  });

  test("the page drives all five — a screen for four leaves a surface curl-only", async () => {
    const pageKeys = pageTriplesFrom(await readFile(PAGE, "utf8"));

    // Enumerated rather than compared as sets, so a NEW permission added later
    // fails here loudly and its author has to decide whether the screen should
    // drive it.
    expect([...pageKeys].sort()).toEqual([
      "domain_event_runtime.consumers.manage",
      "domain_event_runtime.consumers.read",
      "domain_event_runtime.deliveries.read",
      "domain_event_runtime.deliveries.replay",
      "domain_event_runtime.events.read"
    ]);
  });

  test("pause and resume share consumers.manage — there is no consumers.pause", async () => {
    const declared = declaredTriples();
    const pause = await readFile(PAUSE_ROUTE, "utf8");
    const resume = await readFile(RESUME_ROUTE, "utf8");

    expect(
      guardTriplesFrom(pause).has("domain_event_runtime.consumers.manage")
    ).toBe(true);
    expect(
      guardTriplesFrom(resume).has("domain_event_runtime.consumers.manage")
    ).toBe(true);
    expect(declared.has("domain_event_runtime.consumers.pause" as Triple)).toBe(
      false
    );
    expect(
      declared.has("domain_event_runtime.consumers.resume" as Triple)
    ).toBe(false);
  });

  test("the page never mutates directly — it posts to the guarded endpoints", async () => {
    const page = await readFile(PAGE, "utf8");

    // No SQL write anywhere in the screen: every change goes out over fetch, so
    // the endpoints' audit rows and idempotency records cannot be bypassed.
    expect(page).not.toMatch(
      /\b(INSERT\s+INTO|UPDATE\s+awcms_|DELETE\s+FROM)/i
    );

    expect(page).toContain("/pause`");
    expect(page).toContain("/resume`");
    expect(page).toContain("/api/v1/domain-events/deliveries/${id}/replay`");
  });

  test("replay carries an Idempotency-Key — pause and resume carry none", async () => {
    const page = await readFile(PAGE, "utf8");

    // Exactly one, and it is on the replay call. Slicing from the URL scopes
    // each assertion to its own request, so moving the header between them
    // turns this red rather than shuffling a global count.
    expect(
      page.match(/"Idempotency-Key": crypto\.randomUUID\(\)/g)
    ).toHaveLength(1);

    const replayCall = page.slice(
      page.indexOf("/api/v1/domain-events/deliveries/${id}/replay`")
    );
    expect(replayCall.slice(0, replayCall.indexOf(");"))).toContain(
      "Idempotency-Key"
    );

    const pauseCall = page.slice(page.indexOf("/pause`"));
    expect(pauseCall.slice(0, pauseCall.indexOf(");"))).not.toContain(
      "Idempotency-Key"
    );

    const resumeCall = page.slice(page.indexOf("/resume`"));
    expect(resumeCall.slice(0, resumeCall.indexOf(");"))).not.toContain(
      "Idempotency-Key"
    );
  });

  test("and the endpoints agree about which of them requires one", async () => {
    // The page's split is only correct if the routes really do differ. Assert
    // the source of that truth rather than trusting the page's comment.
    expect(await readFile(REPLAY_ROUTE, "utf8")).toContain(
      "IDEMPOTENCY_REQUIRED"
    );
    expect(await readFile(PAUSE_ROUTE, "utf8")).not.toContain(
      "IDEMPOTENCY_REQUIRED"
    );
    expect(await readFile(RESUME_ROUTE, "utf8")).not.toContain(
      "IDEMPOTENCY_REQUIRED"
    );
  });

  test("consumer names are encoded into the path", async () => {
    const page = await readFile(PAGE, "utf8");

    // A consumer name is a registry key, not user input — but it lands in a
    // URL path segment, and encoding it costs nothing while a future name
    // containing a `/` or `?` would otherwise silently address a different
    // endpoint.
    expect(page).toContain("encodeURIComponent(name)");
  });

  test("form bounds come from the constant the endpoints validate against", async () => {
    for (const route of [PAUSE_ROUTE, REPLAY_ROUTE]) {
      const source = await readFile(route, "utf8");
      expect(source).toContain("domain-event-runtime/domain/reason-bounds");
      expect(source).not.toContain("MAX_REASON_LENGTH = 500");
    }
  });

  test("the sidebar entry points at this page and is gated on a real permission", () => {
    const nav = listModules()
      .find((module) => module.key === "domain_event_runtime")
      ?.navigation?.find((entry) => entry.path === "/admin/domain-events");

    expect(nav).toBeDefined();
    expect(nav!.requiredPermission).toBe("domain_event_runtime.consumers.read");
    expect(declaredTriples().has(nav!.requiredPermission as Triple)).toBe(true);
    // `admin-navigation-registry.test.ts` already binds path→file and
    // labelKey→SIDEBAR_LABELS; this pins the gate specifically.
  });
});
