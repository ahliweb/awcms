/**
 * Static wiring of the Mission Control replay routes (Issue
 * ahliweb/omes#266, ADR-0031 rule 4): `GET .../replay` and the `as_of` mode of
 * `GET .../scene`. The behaviour — a window over 24 h or an unknown query
 * parameter is a 400, authorization decides before validation, per-source
 * permission — needs a real route handler over a real database and is proved in
 * `integration/omes-control-mission-control-replay-route.integration.test.ts`;
 * the validators themselves are pure and covered by
 * `omes-control-mission-control-replay-domain.test.ts`. The permission pin is in
 * `omes-control-route-permissions.test.ts`. This file pins what a source-text
 * test CAN: that both routes stay read-only, validate before the transaction,
 * map a rejection to the 400 `VALIDATION_ERROR` envelope, and never write SQL.
 */
import { readFile } from "node:fs/promises";

import { describe, expect, test } from "bun:test";

const read = (file: string) =>
  readFile(`src/pages/api/v1/omes/mission-control/${file}`, "utf8");

describe("Mission Control replay routes (static)", () => {
  test("both routes are tenant routes gated by servers.read, validate in `prepare`, and build `can` through the shared helper", async () => {
    for (const file of ["replay.ts", "scene.ts"]) {
      const source = await read(file);
      expect(source, file).toContain("defineTenantRoute");
      expect(source, file).toContain("authorize: OMES_GUARDS.servers.read");
      expect(source, file).toMatch(/prepare:\s*\(/);
      expect(source, file).toContain("createMissionControlCan");
      expect(source, file).toContain('workClass: "interactive"');
      expect(source, file).toContain(
        'fail(400, "VALIDATION_ERROR", parsed.message)'
      );
      // Read-only: GET only, no body, no mutation, no SQL of its own.
      expect(source, file).not.toMatch(
        /export const (POST|PUT|PATCH|DELETE)\b/
      );
      expect(source, file).not.toMatch(/\btx`|\.unsafe\(/);
    }
    expect(await read("replay.ts")).toContain("parseReplayQuery");
    expect(await read("scene.ts")).toContain("parseSceneQuery");
  });

  test("the scene route switches on the validated as_of and keeps the live composition for an absent one", async () => {
    const source = await read("scene.ts");
    expect(source).toContain("composeHistoricalMissionControlSceneForViewer");
    expect(source).toContain("composeMissionControlSceneForViewer");
    expect(source).toMatch(/prepared\.asOf\s*\?/);
  });

  test("an invalid composition fails closed with a generic 500 and logs JSON paths only", async () => {
    const replaySource = await read("replay.ts");
    expect(replaySource).toContain("MISSION_CONTROL_REPLAY_INVALID");
    expect(replaySource).toContain("invalidPaths");
    expect(replaySource).not.toContain("error.message");
    const sceneSource = await read("scene.ts");
    expect(sceneSource).toContain("MISSION_CONTROL_SCENE_INVALID");
    expect(sceneSource).not.toContain("error.message");
  });
});
