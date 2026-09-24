/**
 * Loads the pinned, vendored OMES v1 contract snapshot
 * (`src/modules/omes-control/contracts/v1/**`) from disk (Issue
 * ahliweb/omes#197, parent #195, ADR-0122).
 *
 * Follows the same `path.resolve(process.cwd(), ...)` convention as
 * `src/modules/module-management/application/health-registry.ts` for
 * reading repo-relative static files — the process always runs with its
 * working directory at the repository root.
 *
 * This is the ONLY module allowed to know the on-disk layout of the
 * vendored contracts directory; every other consumer goes through
 * `../contracts/index.ts`'s public API.
 */
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import { parseJsonTrackingFloats, type ParsedJson } from "./json-parse";
import type { JsonSchema, JsonValue } from "./schema";
import type { StateTable } from "./state-machine";

export const OMES_CONTRACT_VERSION = "v1" as const;

/** The only contract version this module knows how to load and validate. */
export const SUPPORTED_OMES_CONTRACT_VERSIONS: readonly string[] = [
  OMES_CONTRACT_VERSION
];

export const VENDORED_CONTRACTS_DIR = path.join(
  "src",
  "modules",
  "omes-control",
  "contracts",
  OMES_CONTRACT_VERSION
);

export type OmesContractPin = {
  sourceRepo: string;
  area: string;
  version: string;
  sourceCommit: string;
  syncedAt: string;
  files: Record<string, string>;
};

/** Raised when a caller asks for a contract version this module does not vendor/support. */
export class UnsupportedContractVersionError extends Error {
  constructor(version: string) {
    super(
      `unsupported OMES contract version '${version}' — this module only vendors and validates against: ${SUPPORTED_OMES_CONTRACT_VERSIONS.join(", ")}`
    );
    this.name = "UnsupportedContractVersionError";
  }
}

/** Raised when a caller asks for a schema/state-machine name that is not vendored. */
export class UnknownOmesContractError extends Error {
  constructor(kind: "schema" | "state machine", name: string) {
    super(
      `unknown OMES contract ${kind}: '${name}' is not part of the vendored ${OMES_CONTRACT_VERSION} snapshot`
    );
    this.name = "UnknownOmesContractError";
  }
}

function contractsRoot(version: string): string {
  if (!SUPPORTED_OMES_CONTRACT_VERSIONS.includes(version)) {
    throw new UnsupportedContractVersionError(version);
  }
  return path.resolve(process.cwd(), VENDORED_CONTRACTS_DIR);
}

let pinCache: OmesContractPin | undefined;

/** Reads and caches `PIN.json` — the vendoring manifest (source commit, version, per-file hashes). */
export async function loadPin(): Promise<OmesContractPin> {
  if (pinCache) return pinCache;
  const pinPath = path.join(contractsRoot(OMES_CONTRACT_VERSION), "PIN.json");
  const raw = await readFile(pinPath, "utf8");
  pinCache = JSON.parse(raw) as OmesContractPin;
  return pinCache;
}

const schemaCache = new Map<string, JsonSchema>();

/**
 * Loads `<name>.schema.json` from the vendored snapshot. `name` may be a
 * top-level schema (e.g. `"invoice"`, `"operation-request"`) or an event
 * schema under `events/` (e.g. `"events/backup.completed"`).
 */
export async function loadSchema(
  name: string,
  version: string = OMES_CONTRACT_VERSION
): Promise<JsonSchema> {
  const cacheKey = `${version}:${name}`;
  const cached = schemaCache.get(cacheKey);
  if (cached) return cached;

  const root = contractsRoot(version);
  const schemaPath = path.join(root, `${name}.schema.json`);
  let raw: string;
  try {
    raw = await readFile(schemaPath, "utf8");
  } catch {
    throw new UnknownOmesContractError("schema", name);
  }
  const schema = JSON.parse(raw) as JsonSchema;
  schemaCache.set(cacheKey, schema);
  return schema;
}

const stateTableCache = new Map<string, StateTable>();

/** Loads `<name>.states.json` from the vendored snapshot (e.g. `"subscription"`, `"invoice"`). */
export async function loadStateTable(
  name: string,
  version: string = OMES_CONTRACT_VERSION
): Promise<StateTable> {
  const cacheKey = `${version}:${name}`;
  const cached = stateTableCache.get(cacheKey);
  if (cached) return cached;

  const root = contractsRoot(version);
  const tablePath = path.join(root, `${name}.states.json`);
  let raw: string;
  try {
    raw = await readFile(tablePath, "utf8");
  } catch {
    throw new UnknownOmesContractError("state machine", name);
  }
  const table = JSON.parse(raw) as StateTable;
  stateTableCache.set(cacheKey, table);
  return table;
}

/**
 * Resolves a schema name (e.g. `"invoice"` or `"events/backup.completed"`)
 * to its fixtures directory. Top-level schemas keep fixtures under
 * `fixtures/<name>/`; event schemas keep fixtures under
 * `events/fixtures/<event-name>/` (matching the OMES source layout exactly
 * — this loader intentionally does not normalize that asymmetry away, so a
 * drift/re-sync never has to rewrite this mapping).
 */
function fixturesDirFor(root: string, schemaName: string): string {
  if (schemaName.startsWith("events/")) {
    return path.join(
      root,
      "events",
      "fixtures",
      schemaName.slice("events/".length)
    );
  }
  return path.join(root, "fixtures", schemaName);
}

/**
 * Loads a fixture file (used by tests, never by production request
 * handling), preserving which number literals were written with a decimal
 * point/exponent (`ParsedJson.floatLiteralPaths`) so `type: "integer"`
 * enforcement matches OMES's Python validator exactly — see `./json-parse.ts`.
 */
export async function loadFixture(
  schemaName: string,
  fixtureFileName: string,
  version: string = OMES_CONTRACT_VERSION
): Promise<ParsedJson<JsonValue>> {
  const root = contractsRoot(version);
  const fixturePath = path.join(
    fixturesDirFor(root, schemaName),
    fixtureFileName
  );
  const raw = await readFile(fixturePath, "utf8");
  return parseJsonTrackingFloats<JsonValue>(raw);
}

/** Loads an `invalid-*.reason.txt` sibling of a fixture, if any (used by tests). */
export async function loadFixtureReason(
  schemaName: string,
  fixtureFileName: string,
  version: string = OMES_CONTRACT_VERSION
): Promise<string | undefined> {
  const root = contractsRoot(version);
  const reasonFileName = fixtureFileName.replace(/\.json$/, ".reason.txt");
  const reasonPath = path.join(
    fixturesDirFor(root, schemaName),
    reasonFileName
  );
  try {
    return (await readFile(reasonPath, "utf8")).trim();
  } catch {
    return undefined;
  }
}

/** Lists every `valid-*.json` / `invalid-*.json` fixture file name for a schema (used by tests). */
export async function listFixtureFiles(
  schemaName: string,
  version: string = OMES_CONTRACT_VERSION
): Promise<string[]> {
  const root = contractsRoot(version);
  const dir = fixturesDirFor(root, schemaName);
  try {
    return (await readdir(dir)).filter((f) => f.endsWith(".json")).sort();
  } catch {
    return [];
  }
}

/** Lists every vendored top-level schema name (no `events/` prefix, no extension). */
export async function listTopLevelSchemaNames(
  version: string = OMES_CONTRACT_VERSION
): Promise<string[]> {
  const root = contractsRoot(version);
  const entries = await readdir(root);
  return entries
    .filter((f) => f.endsWith(".schema.json"))
    .map((f) => f.slice(0, -".schema.json".length))
    .sort();
}

/** Lists every vendored event schema name, each prefixed `events/` (no extension). */
export async function listEventSchemaNames(
  version: string = OMES_CONTRACT_VERSION
): Promise<string[]> {
  const root = contractsRoot(version);
  const eventsDir = path.join(root, "events");
  let entries: string[];
  try {
    entries = await readdir(eventsDir);
  } catch {
    return [];
  }
  return entries
    .filter((f) => f.endsWith(".schema.json"))
    .map((f) => `events/${f.slice(0, -".schema.json".length)}`)
    .sort();
}
