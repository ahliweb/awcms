/**
 * Mission Control contextual-action availability route (Issue
 * ahliweb/omes#267, ADR-0031 rule 3): `GET .../mission-control/actions`.
 *
 * The behaviour that needs a database (cross-tenant ids -> not_found, a viewer
 * without a permission -> permission_denied, the real mutation endpoints still
 * returning 403 to a forged POST) is proved in
 * `integration/omes-control-mission-control-actions.integration.test.ts`. This
 * file pins what a pure test CAN: the strict query validator (any unknown
 * parameter — `command`, `shell`, `target`, `url`, ... — is rejected, never
 * ignored), the vendored-map-only id/kind vocabulary, and that the route is
 * read-only, advisory and shells out to nothing.
 */
import { readFile } from "node:fs/promises";

import { describe, expect, test } from "bun:test";

import {
  MISSION_CONTROL_ACTION_ID_PATTERN,
  parseActionsQuery
} from "../src/modules/omes-control/domain/mission-control-actions";
import { MISSION_CONTROL_KINDS } from "../src/modules/omes-control/domain/mission-control-types";

const ROUTE = "src/pages/api/v1/omes/mission-control/actions.ts";
const parse = (query: string) => parseActionsQuery(new URLSearchParams(query));

describe("parseActionsQuery — strict, no free-form field", () => {
  test("accepts exactly kind + id for every known kind", () => {
    for (const kind of MISSION_CONTROL_KINDS) {
      const parsed = parse(`kind=${kind}&id=srv-1.a:b_c`);
      expect(parsed.ok, kind).toBe(true);
      if (parsed.ok) {
        expect(parsed.value).toEqual({ kind, sourceId: "srv-1.a:b_c" });
      }
    }
  });

  test("rejects every other parameter, including command/shell/target/url, even alongside valid ones", () => {
    for (const extra of [
      "command=reboot",
      "shell=ls",
      "target=10.0.0.1",
      "url=http%3A%2F%2Fevil.example",
      "argv=--x",
      "operation=stop",
      "as_of=2026-10-02T08:00:00Z",
      "limit=5"
    ]) {
      const parsed = parse(`kind=server&id=srv-1&${extra}`);
      expect(parsed.ok, extra).toBe(false);
    }
    expect(parse("command=x").ok).toBe(false);
  });

  test("rejects a missing, empty, unknown, repeated or non-vocabulary kind", () => {
    for (const query of [
      "id=srv-1",
      "kind=&id=srv-1",
      "kind=host&id=srv-1",
      "kind=Server&id=srv-1",
      "kind=server&kind=job&id=srv-1",
      "kind=__proto__&id=srv-1",
      "kind=constructor&id=srv-1"
    ]) {
      expect(parse(query).ok, query).toBe(false);
    }
  });

  test("rejects a missing, over-long, repeated or out-of-alphabet id", () => {
    const rejected = [
      "kind=server",
      "kind=server&id=",
      `kind=server&id=${"a".repeat(129)}`,
      "kind=server&id=a&id=b",
      "kind=server&id=a%20b",
      "kind=server&id=a%2Fb",
      "kind=server&id=..%2F..",
      "kind=server&id=a%3Bb",
      "kind=server&id=a%0Ab",
      "kind=server&id=%24(id)"
    ];
    for (const query of rejected) expect(parse(query).ok, query).toBe(false);
    expect(parse(`kind=server&id=${"a".repeat(128)}`).ok).toBe(true);
    expect(MISSION_CONTROL_ACTION_ID_PATTERN.source).toBe(
      "^[A-Za-z0-9_.:-]{1,128}$"
    );
  });
});

describe("GET /api/v1/omes/mission-control/actions (static)", () => {
  test("is a read-only tenant route gated by servers.read, validating in `prepare` and building `can` through the shared helper", async () => {
    const source = await readFile(ROUTE, "utf8");

    expect(source).toContain("defineTenantRoute");
    expect(source).toContain("authorize: OMES_GUARDS.servers.read");
    expect(source).toMatch(/prepare:\s*\(/);
    expect(source).toContain("parseActionsQuery");
    expect(source).toContain('fail(400, "VALIDATION_ERROR", parsed.message)');
    expect(source).toContain("createMissionControlCan");
    expect(source).toContain('workClass: "interactive"');
    expect(source).not.toMatch(/export const (POST|PUT|PATCH|DELETE)\b/);
    // No SQL, subprocess, file or network access of its own.
    expect(source).not.toMatch(
      /\btx`|\.unsafe\(|Bun\.spawn|child_process|fetch\(/
    );
  });

  test("documents itself as advisory and never lets the answer authorize anything", async () => {
    const source = await readFile(ROUTE, "utf8");
    expect(source).toContain("ADVISORY ONLY");
    expect(source).toContain("re-authorizes");
  });
});
