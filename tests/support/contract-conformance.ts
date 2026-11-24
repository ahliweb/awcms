/**
 * Provider-side response conformance (Issue #1393, ADR-0167).
 *
 * `assertResponseConforms` takes what a REAL handler answered (status + decoded
 * JSON body) and checks it against the generated OpenAPI bundle:
 *
 * 1. the operation DECLARES that status (exact code, `NXX` range or `default`,
 *    in that order of precedence) -- a status the contract never mentions is a
 *    failure, which is what `api:spec:check` cannot see;
 * 2. the body validates against the schema of that response, compiled by `ajv`
 *    through the same `createAjv` the contract lint (#1390) and the example
 *    validator (#1391) use. There is no hand-written validator here, so
 *    `required` and `additionalProperties: false` are enforced.
 *
 * It claims nothing about authorization or tenant isolation: those stay tested
 * where they are. It checks the SHAPE of an answer, nothing else.
 */
import Ajv2020 from "ajv/dist/2020.js";
import type { AnySchema, ValidateFunction } from "ajv";
import { readFileSync } from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";

import { EXAMPLE_FORMATS } from "../../scripts/api-contract-examples";
import {
  ROOT_ID,
  createAjv,
  isRecord,
  resolveComponentRef,
  seg
} from "../../scripts/api-contract-lint";
import { BUNDLED_PATH } from "../../scripts/openapi-bundle";

type AnyRecord = Record<string, unknown>;

export interface ObservedResponse {
  status: number;
  /** The decoded JSON body, or `undefined` for an empty body. */
  body: unknown;
}

let cached: { doc: AnyRecord; ajv: Ajv2020 } | undefined;
const compiled = new Map<string, ValidateFunction>();

function load(): { doc: AnyRecord; ajv: Ajv2020 } {
  if (!cached) {
    const doc = parseYaml(
      readFileSync(path.resolve(process.cwd(), BUNDLED_PATH), "utf8")
    ) as AnyRecord;
    const ajv = createAjv(doc, EXAMPLE_FORMATS);
    ajv.addSchema(doc as AnySchema, ROOT_ID);
    cached = { doc, ajv };
  }
  return cached;
}

/** The key of `responses` that covers `status`, or undefined when none does. */
export function declaredStatusKey(
  responses: AnyRecord,
  status: number
): string | undefined {
  const exact = String(status);
  if (exact in responses) {
    return exact;
  }
  const range = `${Math.floor(status / 100)}XX`;
  if (range in responses) {
    return range;
  }
  return "default" in responses ? "default" : undefined;
}

export function assertResponseConforms(
  method: string,
  route: string,
  observed: ObservedResponse
): void {
  const { doc, ajv } = load();
  const where = `${method.toUpperCase()} ${route}`;
  const paths = isRecord(doc.paths) ? doc.paths : {};
  const item = paths[route];
  const operation = isRecord(item) ? item[method.toLowerCase()] : undefined;
  if (!isRecord(operation) || !isRecord(operation.responses)) {
    throw new Error(`${where}: not an operation of the bundled contract`);
  }

  const key = declaredStatusKey(operation.responses, observed.status);
  if (key === undefined) {
    throw new Error(
      `${where}: answered ${observed.status}, which the contract does not declare (declared: ${Object.keys(operation.responses).join(", ")})`
    );
  }

  let basePointer = `/paths/${seg(route)}/${method.toLowerCase()}/responses/${seg(key)}`;
  let response: unknown = operation.responses[key];
  if (isRecord(response) && typeof response.$ref === "string") {
    const resolved = resolveComponentRef(doc, response.$ref);
    if (!resolved) {
      throw new Error(`${where}: response $ref ${response.$ref} unresolved`);
    }
    basePointer = resolved.pointer;
    response = resolved.node;
  }

  const media =
    isRecord(response) && isRecord(response.content)
      ? response.content["application/json"]
      : undefined;
  if (!isRecord(media) || media.schema === undefined) {
    if (observed.body !== undefined) {
      throw new Error(
        `${where}: answered ${observed.status} with a body, but the contract declares none for it`
      );
    }
    return;
  }

  const pointer = `${basePointer}/content/application~1json/schema`;
  let validate = compiled.get(pointer);
  if (!validate) {
    validate = ajv.compile({ $ref: `${ROOT_ID}#${pointer}` });
    compiled.set(pointer, validate);
  }
  if (!validate(observed.body)) {
    const detail = (validate.errors ?? [])
      .slice(0, 5)
      .map((e) => `${e.instancePath || "(root)"} ${e.message ?? "is invalid"}`)
      .join("; ");
    throw new Error(
      `${where} -> ${observed.status}: body does not conform to ${pointer}: ${detail}`
    );
  }
}
