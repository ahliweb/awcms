/**
 * Contract tests for `/admin/omes/arsitektur`, Issue ahliweb/omes#246
 * part 3.
 *
 * Pure — no database, no network. Unlike every other `/admin/omes/*` page
 * contract test, this screen has no tenant-scoped table behind it, so there
 * is no accompanying integration suite for row-level isolation: what this
 * file pins is (a) the screen's own permission-guard contract, (b) that it
 * is a NEW permission rather than a reuse of `hermes_orchestration.read`,
 * and (c) that the screen states plainly, in both `id` and `en`, that it
 * renders a pinned snapshot rather than live host state.
 */
import { readFile } from "node:fs/promises";

import { describe, expect, test } from "bun:test";

import { listModules } from "../src/modules";
import { fetchArchitectureSnapshot } from "../src/modules/omes-control/application/architecture-directory";
import {
  OMES_CONTRACT_PIN,
  validateOmesContract
} from "../src/modules/omes-control/domain/contracts";

const PAGE = "src/pages/admin/omes/arsitektur.astro";
const APPLICATION_FILE =
  "src/modules/omes-control/application/architecture-directory.ts";
const DOMAIN_FILE = "src/modules/omes-control/domain/architecture.ts";
const PERMISSIONS_MIGRATION = "sql/165_awcms_omes_architecture_permissions.sql";

type Triple = `omes_control.${string}.${string}`;

function guardReferenceTriples(source: string): Set<Triple> {
  const found = new Set<Triple>();

  for (const match of source.matchAll(
    /moduleKey:\s*"omes_control",\s*activityCode:\s*"([a-zA-Z_]+)",\s*action:\s*"([a-zA-Z]+)"/g
  )) {
    found.add(`omes_control.${match[1]}.${match[2]}` as Triple);
  }

  return found;
}

function declaredTriples(): Set<Triple> {
  return new Set<Triple>(
    (listModules()
      .find((module) => module.key === "omes_control")
      ?.permissions?.map(
        (permission) =>
          `omes_control.${permission.activityCode}.${permission.action}`
      ) ?? []) as Triple[]
  );
}

describe("the architecture screen gates on its OWN architecture.read permission", () => {
  test("the page's guard is exactly omes_control.architecture.read, not hermes_orchestration.read", async () => {
    const source = await readFile(PAGE, "utf8");
    const triples = guardReferenceTriples(source);
    expect(triples.size).toBeGreaterThan(0);
    expect(triples).toContain("omes_control.architecture.read");
    for (const triple of triples) {
      expect(triple).toBe("omes_control.architecture.read");
    }
  });

  test("architecture.read is declared by the module descriptor, so sql/165 seeds it", async () => {
    const declared = declaredTriples();
    expect(declared.has("omes_control.architecture.read")).toBe(true);

    const sql165 = await readFile(PERMISSIONS_MIGRATION, "utf8");
    expect(sql165).toContain("('omes_control', 'architecture', 'read',");
  });

  test("the nav entry requires exactly architecture.read", async () => {
    const nav = listModules().find(
      (module) => module.key === "omes_control"
    )?.navigation;
    const entry = (nav ?? []).find(
      (item) => item.path === "/admin/omes/arsitektur"
    );
    expect(entry).toBeDefined();
    expect(entry?.requiredPermission).toBe("omes_control.architecture.read");
  });

  test("the page uses loadAdminScreen (server-side enforcement, not UI hiding)", async () => {
    const source = await readFile(PAGE, "utf8");
    expect(source).toContain("loadAdminScreen");
    expect(source).toContain('activityCode: "architecture"');
  });
});

describe("the screen never executes SQL directly and has no tenant/database read", () => {
  test("the page contains no raw INSERT/UPDATE/DELETE", async () => {
    const source = await readFile(PAGE, "utf8");
    expect(source).not.toMatch(
      /\b(INSERT\s+INTO|UPDATE\s+awcms_|DELETE\s+FROM)/i
    );
  });

  test("the application loader reads only the vendored fixture, never a database table", async () => {
    const source = await readFile(APPLICATION_FILE, "utf8");
    expect(source).not.toMatch(/\bgetDatabaseClient\b/);
    expect(source).not.toMatch(/\btenant_id\b/);
    expect(source).toContain("loadFixture");
    expect(source).toContain("assertOmesContract");
  });
});

describe("the screen explicitly states this is a pinned snapshot, not live host state", () => {
  test("the page cites the pinned-snapshot wording in both id and en catalogs", async () => {
    const source = await readFile(PAGE, "utf8");
    expect(source).toContain(
      "This is a pinned release snapshot from a specific OMES release — not live host state. It only changes when this screen's data is re-vendored from a newer OMES commit."
    );

    const enPo = await readFile("locales/en.po", "utf8");
    const idPo = await readFile("locales/id.po", "utf8");
    expect(enPo).toContain(
      'msgid "This is a pinned release snapshot from a specific OMES release — not live host state. It only changes when this screen\'s data is re-vendored from a newer OMES commit."'
    );
    expect(idPo).toContain(
      'msgid "This is a pinned release snapshot from a specific OMES release — not live host state. It only changes when this screen\'s data is re-vendored from a newer OMES commit."'
    );
    // id.po must actually carry a non-empty translation, not just declare the key.
    expect(idPo).toContain("Ini adalah cuplikan rilis yang dipatok");
  });

  test("the page renders omesVersion and PIN.json-derived provenance, never the fixture's own commit/generated_at", async () => {
    const source = await readFile(PAGE, "utf8");
    expect(source).toContain("snapshot.omesVersion");
    expect(source).toContain("snapshot.provenance.sourceCommit");
    expect(source).toContain("snapshot.provenance.sourceCommitShort");
    expect(source).toContain("snapshot.provenance.vendoredAt");

    // The fixture's own `omes_commit`/`generated_at` are deliberate
    // deterministic placeholders (OMES's
    // scripts/generate-architecture-capabilities-view.py), not real
    // provenance — the page's TEMPLATE must never reference them (the
    // module doc above is allowed to explain, in prose, why not — so this
    // checks the rendering body specifically, not the whole file text).
    const templateBody = source.slice(source.indexOf("---", 1) + 3);
    expect(templateBody).not.toContain("snapshot.omesCommit");
    expect(templateBody).not.toContain("snapshot.generatedAt");
    expect(templateBody).not.toContain("snapshot.fixtureOmesCommit");
    expect(templateBody).not.toContain("snapshot.fixtureGeneratedAt");
  });

  test("the rendered provenance is sourced from contracts/v1/PIN.json, and the all-zero fixture placeholder is never shown", async () => {
    const snapshot = await fetchArchitectureSnapshot();
    const pin = await OMES_CONTRACT_PIN;

    expect(snapshot.provenance.sourceCommit).toBe(pin.sourceCommit);
    expect(snapshot.provenance.vendoredAt).toBe(pin.syncedAt);
    expect(snapshot.provenance.sourceCommitShort).toBe(
      pin.sourceCommit.slice(0, snapshot.provenance.sourceCommitShort.length)
    );
    expect(pin.sourceCommit).toMatch(/^[0-9a-f]{7,40}$/);

    // The fixture's own placeholder commit must never leak into what is
    // displayed as provenance.
    expect(snapshot.provenance.sourceCommit).not.toBe(
      "0000000000000000000000000000000000000000"
    );
    expect(snapshot.provenance.sourceCommit).not.toBe(
      snapshot.fixtureOmesCommit
    );
  });
});

describe("fetchArchitectureSnapshot() reads the vendored fixture and validates against the vendored schema", () => {
  test("the projected snapshot's raw fixture source validates cleanly against architecture-capabilities-view", async () => {
    const snapshot = await fetchArchitectureSnapshot();
    expect(snapshot.lanes.length).toBeGreaterThan(0);
    const totalCapabilities = snapshot.lanes.reduce(
      (sum, lane) => sum + lane.capabilities.length,
      0
    );
    expect(totalCapabilities).toBeGreaterThan(0);

    // Round-trip: re-serialize the projected shape back to the wire shape
    // and confirm it still validates against the vendored schema — proving
    // the domain projection did not drop/rename a field the contract
    // requires.
    const capabilities = snapshot.lanes.flatMap((lane) =>
      lane.capabilities.map((capability) => ({
        id: capability.id,
        name: capability.name,
        plane: capability.plane,
        authority: capability.authority,
        execution_semantics: capability.executionSemantics,
        implementation_status: capability.implementationStatus,
        upstream_project: capability.upstreamProject,
        omes_module: capability.omesModule
      }))
    );
    const planes = snapshot.lanes.map((lane) => ({
      id: lane.plane.id,
      name: lane.plane.name,
      execution_semantics: lane.plane.executionSemantics
    }));

    const errors = await validateOmesContract(
      "architecture-capabilities-view",
      {
        schema_version: snapshot.schemaVersion,
        omes_version: snapshot.omesVersion,
        // These two round-trip the fixture's OWN placeholder fields (see
        // domain/architecture.ts's module doc) purely to reconstruct a
        // schema-valid payload — they are never what the page renders as
        // provenance; `snapshot.provenance` (from PIN.json) is.
        omes_commit: snapshot.fixtureOmesCommit,
        generated_at: snapshot.fixtureGeneratedAt,
        planes,
        capabilities
      } as never
    );
    expect(errors).toEqual([]);
  });

  test("every capability is assigned to exactly one lane matching its declared plane", async () => {
    const snapshot = await fetchArchitectureSnapshot();
    for (const lane of snapshot.lanes) {
      for (const capability of lane.capabilities) {
        expect(capability.plane).toBe(lane.plane.id);
      }
    }
  });
});

describe("domain/architecture.ts is a pure projection, no I/O", () => {
  test("the domain module performs no file/network/database access", async () => {
    const source = await readFile(DOMAIN_FILE, "utf8");
    expect(source).not.toMatch(/\breadFile\b|\bfetch\(|\bgetDatabaseClient\b/);
  });
});
