/**
 * Public API for AWCMS's consumption of the pinned OMES v1 Control Center
 * contracts (Issue ahliweb/omes#197, parent #195, ADR-0122).
 *
 * This is the ONLY module `src/modules/omes-control/**` code outside this
 * directory (including #198's `application/**` and `src/pages/api/v1/omes/**`
 * handlers, once landed) should import from to validate a payload against an
 * OMES contract, scan for raw secrets, or read a job/subscription state
 * machine. Everything here is fail-closed:
 *
 *  - An unsupported/unknown contract version is rejected immediately.
 *  - An unknown schema or state-machine name is rejected immediately.
 *  - Any JSON Schema keyword outside the small supported subset makes the
 *    underlying schema itself fail to load (`SchemaError` from
 *    `./schema.ts`), never silently ignored.
 *  - The raw-secret scan (`scanForRawSecrets`) always runs, independently of
 *    whatever the schema for a given contract declares — a schema bug must
 *    never be the only thing standing between a payload and a leaked secret.
 *
 * No network access and no PyPI/npm-equivalent JSON Schema dependency is
 * used anywhere in this module — see `./schema.ts`'s module doc for why.
 */
import {
  loadPin,
  loadSchema,
  loadStateTable,
  OMES_CONTRACT_VERSION,
  SUPPORTED_OMES_CONTRACT_VERSIONS,
  UnsupportedContractVersionError,
  type OmesContractPin
} from "./loader";
import { StateMachine } from "./state-machine";
import { parseJsonTrackingFloats } from "./json-parse";
import {
  assertValid,
  scanForRawSecrets as scanForRawSecretsImpl,
  validate as validateImpl,
  type JsonSchema,
  type JsonValue
} from "./schema";

export { ContractValidationError, SchemaError } from "./schema";
export {
  StateMachine,
  StateMachineError,
  TransitionError
} from "./state-machine";
export {
  UnknownOmesContractError,
  UnsupportedContractVersionError
} from "./loader";
export type { JsonSchema, JsonValue } from "./schema";
export type { StateTable } from "./state-machine";
export type { OmesContractPin } from "./loader";

/**
 * The pinned OMES contract source, resolved once at import time from the
 * committed `contracts/v1/PIN.json` manifest. Exposed so callers (and
 * `#198`'s API layer) can surface the exact pinned commit/version in
 * diagnostics, health checks, or an admin screen without re-parsing the
 * manifest themselves.
 *
 * A promise rather than a synchronously-resolved value because the manifest
 * is read from disk; callers that need it synchronously should read it once
 * during module/route initialization.
 */
export const OMES_CONTRACT_PIN: Promise<OmesContractPin> = loadPin();

/** The only OMES contract version this module vendors and validates against. */
export { OMES_CONTRACT_VERSION, SUPPORTED_OMES_CONTRACT_VERSIONS };

export type ValidateOmesContractOptions = {
  /** Defaults to `OMES_CONTRACT_VERSION` ("v1"). Any other value is rejected. */
  version?: string;
  /**
   * Paths (in `$.foo.bar[0]` form) of number literals that were written
   * with a decimal point/exponent in the ORIGINAL JSON text — produced by
   * `parseOmesContractJson`/`./json-parse.ts`. Supplying this lets
   * `type: "integer"` reject `19.0` exactly like OMES's Python validator
   * does. Callers who only have an already-`JSON.parse`d JS object cannot
   * supply this (the distinction is lost by then); omitting it falls back
   * to `Number.isInteger()` alone, which is the best available without the
   * raw text — see `./json-parse.ts`'s module doc for why this gap exists.
   */
  floatLiteralPaths?: ReadonlySet<string>;
};

/**
 * Validates `payload` against the vendored OMES contract schema named
 * `schemaName` (e.g. `"invoice"`, `"operation-request"`,
 * `"events/backup.completed"`).
 *
 * Returns the list of validation error strings (empty = valid). This
 * combines JSON Schema validation (fail-closed on unsupported keywords) with
 * the independent raw-secret scan — both always run.
 *
 * Throws `UnsupportedContractVersionError` if `options.version` is not a
 * version this module vendors, and `UnknownOmesContractError` (from
 * `./loader`) if `schemaName` is not a vendored schema.
 */
export async function validateOmesContract(
  schemaName: string,
  payload: JsonValue,
  options: ValidateOmesContractOptions = {}
): Promise<string[]> {
  const version = options.version ?? OMES_CONTRACT_VERSION;
  if (!SUPPORTED_OMES_CONTRACT_VERSIONS.includes(version)) {
    throw new UnsupportedContractVersionError(version);
  }
  const schema: JsonSchema = await loadSchema(schemaName, version);
  return validateImpl(payload, schema, "$", options.floatLiteralPaths);
}

/**
 * Same as `validateOmesContract()`, but parses `rawJsonText` itself (via
 * `./json-parse.ts`) instead of taking an already-`JSON.parse`d value, so
 * `type: "integer"` enforcement is fully OMES-equivalent — this is the
 * PREFERRED entry point for any caller that still has the original request
 * body text (e.g. an API route reading `await request.text()` instead of
 * `await request.json()`).
 */
export async function validateOmesContractText(
  schemaName: string,
  rawJsonText: string,
  options: Omit<ValidateOmesContractOptions, "floatLiteralPaths"> = {}
): Promise<string[]> {
  const { value, floatLiteralPaths } =
    parseJsonTrackingFloats<JsonValue>(rawJsonText);
  return validateOmesContract(schemaName, value, {
    ...options,
    floatLiteralPaths
  });
}

/**
 * Same as `validateOmesContract()`, but throws `ContractValidationError`
 * instead of returning the error list — the fail-closed entry point request
 * handlers should prefer (a caught/ignored return value is how a validation
 * bypass usually happens).
 */
export async function assertOmesContract(
  schemaName: string,
  payload: JsonValue,
  options: ValidateOmesContractOptions = {}
): Promise<void> {
  const version = options.version ?? OMES_CONTRACT_VERSION;
  if (!SUPPORTED_OMES_CONTRACT_VERSIONS.includes(version)) {
    throw new UnsupportedContractVersionError(version);
  }
  const schema: JsonSchema = await loadSchema(schemaName, version);
  assertValid(payload, schema, "$", options.floatLiteralPaths);
}

/**
 * Independent raw-secret scanner (re-exported for callers that want to run
 * it on a payload without also loading/validating a schema — e.g. a log
 * redaction path). Always safe to call in addition to
 * `validateOmesContract`, which already runs it internally.
 */
export function scanForRawSecrets(payload: JsonValue): string[] {
  return scanForRawSecretsImpl(payload);
}

const stateMachineCache = new Map<string, StateMachine>();

/**
 * Loads (and caches) the `StateMachine` encoded by the vendored
 * `<name>.states.json` contract (e.g. `"subscription"`, `"invoice"`).
 * Throws `UnknownOmesContractError` if no such state table is vendored, and
 * `UnsupportedContractVersionError` for an unsupported version.
 */
export async function getOmesStateMachine(
  name: string,
  options: ValidateOmesContractOptions = {}
): Promise<StateMachine> {
  const version = options.version ?? OMES_CONTRACT_VERSION;
  if (!SUPPORTED_OMES_CONTRACT_VERSIONS.includes(version)) {
    throw new UnsupportedContractVersionError(version);
  }
  const cacheKey = `${version}:${name}`;
  const cached = stateMachineCache.get(cacheKey);
  if (cached) return cached;

  const table = await loadStateTable(name, version);
  const machine = new StateMachine(table);
  stateMachineCache.set(cacheKey, machine);
  return machine;
}
