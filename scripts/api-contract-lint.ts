/**
 * api-contract-lint.ts -- `bun run api:contract:lint` (Issue #1390, ADR-0167).
 *
 * Compiles every schema of the bundled OpenAPI contract with `ajv` (draft
 * 2020-12 dialect, the dialect OpenAPI 3.1 declares) and fails when one does not
 * compile. `api:spec:check` only compares path templates and operation shape; a
 * schema that no validator can use (an empty `properties:` left by an
 * indentation slip, a dangling `$ref`, a `type` that is not a type) passed it
 * silently. A typed client, a fixture generator or a response validator all
 * trip over those defects first, so the contract is checked the day it changes.
 *
 * ## What is compiled
 *
 * Every schema reachable from `components.schemas`, every `requestBody`, and
 * every response of every operation (success AND error, inline or through
 * `components.responses`, any media type that carries a `schema`). Each is
 * compiled as a `$ref` to its JSON pointer inside the bundle, so a failure
 * names the operation and the exact pointer, not an opaque schema id.
 *
 * ## Strictness (nothing is switched off wholesale)
 *
 * `ajv` runs with `strict: true`. OpenAPI 3.1 is a JSON Schema vocabulary PLUS a
 * few annotation keywords, and those are registered explicitly, one by one:
 *
 * - `discriminator`, `xml`, `externalDocs`, `example` -- OpenAPI annotation
 *   keywords. `discriminator` is shape-checked (an object with a string
 *   `propertyName`); the others are accepted as annotations.
 * - `nullable` -- an OpenAPI 3.0 keyword. In 3.1 it is NOT a keyword and has
 *   no effect; the contract still carries it (ADR-0167 §6 retrofits it
 *   gradually, no mass rewrite). It is accepted only as a boolean; the
 *   `nullable` WITHOUT a `type` defect is guarded by
 *   `tests/openapi-contract-hygiene.test.ts`.
 * - `x-*` vendor extensions, which the OpenAPI specification allows anywhere.
 *   They are registered as annotations only for the names that actually occur.
 * - `format` -- only the formats OpenAPI and JSON Schema define are known
 *   (`KNOWN_FORMATS`); an unknown or misspelled format fails the lint. They are
 *   not enforced here (this gate checks the contract, not instances), which
 *   avoids a second dependency (`ajv-formats`).
 *
 * Everything else -- an unknown keyword, `properties: null`, a `$ref` that does
 * not resolve, `required` naming a non-array, `exclusiveMinimum: true`
 * (3.0-style) -- is an error.
 */
import Ajv2020 from "ajv/dist/2020.js";
import type { AnySchema } from "ajv";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { parse as parseYaml } from "yaml";

import { BUNDLED_PATH } from "./openapi-bundle";

type AnyRecord = Record<string, unknown>;

export interface ContractLintFailure {
  /** `METHOD /path` for an operation, or `components.schemas.Name`. */
  where: string;
  /** JSON pointer, relative to the bundle root, of the schema that failed. */
  pointer: string;
  message: string;
}

export interface ContractLintResult {
  compiled: number;
  failures: ContractLintFailure[];
}

const HTTP_METHODS = [
  "get",
  "put",
  "post",
  "delete",
  "options",
  "head",
  "patch",
  "trace"
];

/** Formats defined by JSON Schema 2020-12 and OpenAPI 3.1. Registered as accept-all. */
export const KNOWN_FORMATS = [
  "date-time",
  "date",
  "time",
  "duration",
  "email",
  "idn-email",
  "hostname",
  "idn-hostname",
  "ipv4",
  "ipv6",
  "uri",
  "uri-reference",
  "iri",
  "iri-reference",
  "uri-template",
  "uuid",
  "json-pointer",
  "relative-json-pointer",
  "regex",
  "int32",
  "int64",
  "float",
  "double",
  "byte",
  "binary",
  "password"
];

const OPENAPI_ROOT_KEYS = [
  "openapi",
  "info",
  "servers",
  "paths",
  "webhooks",
  "components",
  "security",
  "tags"
];

const ROOT_ID = "urn:awcms:contract-bundle";

function isRecord(value: unknown): value is AnyRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** RFC 6901 escaping of one pointer segment. */
function seg(key: string): string {
  return key.replaceAll("~", "~0").replaceAll("/", "~1");
}

function collectVendorExtensions(node: unknown, into: Set<string>): void {
  if (Array.isArray(node)) {
    for (const child of node) {
      collectVendorExtensions(child, into);
    }
    return;
  }
  if (!isRecord(node)) {
    return;
  }
  for (const [key, value] of Object.entries(node)) {
    if (key.startsWith("x-")) {
      into.add(key);
    }
    collectVendorExtensions(value, into);
  }
}

function createAjv(doc: AnyRecord): Ajv2020 {
  const formats: Record<string, true> = {};
  for (const name of KNOWN_FORMATS) {
    formats[name] = true;
  }
  const ajv = new Ajv2020({
    strict: true,
    allErrors: false,
    validateFormats: true,
    formats,
    // the bundle root is not itself a JSON Schema (it has `openapi`, `paths`);
    // it is registered only as a pointer target, so no `$schema`/meta check.
    validateSchema: false
  });

  ajv.addKeyword({ keyword: "example" });
  ajv.addKeyword({ keyword: "xml", schemaType: "object" });
  ajv.addKeyword({ keyword: "externalDocs", schemaType: "object" });
  ajv.addKeyword({
    keyword: "discriminator",
    schemaType: "object",
    metaSchema: {
      type: "object",
      required: ["propertyName"],
      properties: {
        propertyName: { type: "string" },
        mapping: { type: "object", additionalProperties: { type: "string" } }
      },
      additionalProperties: true
    }
  });

  // The bundle root is a pointer target, not a schema, but ajv compiles the
  // resource a `$ref` points into, so the OpenAPI document's own top-level keys
  // must be known. A schema inside the contract using one of them is NOT
  // validated by them -- they are plain annotations.
  for (const keyword of OPENAPI_ROOT_KEYS) {
    ajv.addKeyword({ keyword });
  }

  const vendor = new Set<string>();
  collectVendorExtensions(doc, vendor);
  for (const keyword of vendor) {
    ajv.addKeyword({ keyword });
  }
  return ajv;
}

/** Resolve a `$ref` into `components.responses|requestBodies`; returns the pointer and node. */
function resolveComponentRef(
  doc: AnyRecord,
  ref: string
): { pointer: string; node: unknown } | undefined {
  if (!ref.startsWith("#/")) {
    return undefined;
  }
  const pointer = ref.slice(1);
  let node: unknown = doc;
  for (const raw of pointer.slice(1).split("/")) {
    const key = raw.replaceAll("~1", "/").replaceAll("~0", "~");
    if (!isRecord(node) || !(key in node)) {
      return undefined;
    }
    node = node[key];
  }
  return { pointer, node };
}

interface Target {
  where: string;
  pointer: string;
}

/** Every schema location to compile, as JSON pointers into the bundle. */
export function collectTargets(doc: AnyRecord): {
  targets: Target[];
  failures: ContractLintFailure[];
} {
  const targets: Target[] = [];
  const failures: ContractLintFailure[] = [];

  const components = isRecord(doc.components) ? doc.components : {};
  if (isRecord(components.schemas)) {
    for (const name of Object.keys(components.schemas)) {
      targets.push({
        where: `components.schemas.${name}`,
        pointer: `/components/schemas/${seg(name)}`
      });
    }
  }

  const fromContent = (
    where: string,
    basePointer: string,
    holder: unknown
  ): void => {
    if (!isRecord(holder) || !isRecord(holder.content)) {
      return;
    }
    for (const [mediaType, media] of Object.entries(holder.content)) {
      if (isRecord(media) && media.schema !== undefined) {
        targets.push({
          where,
          pointer: `${basePointer}/content/${seg(mediaType)}/schema`
        });
      }
    }
  };

  const fromReference = (
    where: string,
    basePointer: string,
    holder: unknown
  ): void => {
    if (isRecord(holder) && typeof holder.$ref === "string") {
      const resolved = resolveComponentRef(doc, holder.$ref);
      if (!resolved) {
        failures.push({
          where,
          pointer: `${basePointer}/$ref`,
          message: `$ref ${holder.$ref} does not resolve`
        });
        return;
      }
      fromContent(where, resolved.pointer, resolved.node);
      return;
    }
    fromContent(where, basePointer, holder);
  };

  const paths = isRecord(doc.paths) ? doc.paths : {};
  for (const [route, item] of Object.entries(paths)) {
    if (!isRecord(item)) {
      continue;
    }
    for (const method of HTTP_METHODS) {
      const operation = item[method];
      if (!isRecord(operation)) {
        continue;
      }
      const opBase = `/paths/${seg(route)}/${method}`;
      const where = `${method.toUpperCase()} ${route}`;
      fromReference(where, `${opBase}/requestBody`, operation.requestBody);
      if (isRecord(operation.responses)) {
        for (const [status, response] of Object.entries(operation.responses)) {
          fromReference(
            `${where} -> ${status}`,
            `${opBase}/responses/${seg(status)}`,
            response
          );
        }
      }
    }
  }
  return { targets, failures };
}

export function lintOpenApiContract(doc: AnyRecord): ContractLintResult {
  const ajv = createAjv(doc);
  ajv.addSchema(doc as AnySchema, ROOT_ID);

  const { targets, failures } = collectTargets(doc);
  const seen = new Set<string>();
  let compiled = 0;

  for (const target of targets) {
    if (seen.has(target.pointer)) {
      continue;
    }
    seen.add(target.pointer);
    try {
      ajv.compile({ $ref: `${ROOT_ID}#${target.pointer}` });
      compiled += 1;
    } catch (error) {
      failures.push({
        where: target.where,
        pointer: target.pointer,
        message: error instanceof Error ? error.message : String(error)
      });
    }
  }
  return { compiled, failures };
}

export async function runContractLint(
  bundlePath = path.resolve(process.cwd(), BUNDLED_PATH)
): Promise<ContractLintResult> {
  const doc = parseYaml(await readFile(bundlePath, "utf8")) as AnyRecord;
  return lintOpenApiContract(doc);
}

if (import.meta.main) {
  const started = performance.now();
  const result = await runContractLint();
  const ms = Math.round(performance.now() - started);
  if (result.failures.length > 0) {
    console.error(
      `api:contract:lint FAILED -- ${result.failures.length} schema location(s) do not compile (${result.compiled} compiled, ${ms} ms):`
    );
    for (const failure of result.failures) {
      console.error(
        `  - ${failure.where}\n      at ${failure.pointer}\n      ${failure.message}`
      );
    }
    process.exitCode = 1;
  } else {
    console.log(
      `api:contract:lint OK -- ${result.compiled} schema locations compiled in ${ms} ms.`
    );
  }
}
