/**
 * api-contract-fixtures.ts -- `bun run api:fixtures:generate|:check`
 * (Issue #1392, ADR-0167).
 *
 * Generates the contract-derived FIXTURES PACK from the bundled OpenAPI
 * contract and proves it is fresh. The pack is data, not a service: for every
 * operation it carries a request-body example and one example per declared JSON
 * response, each one valid against the schema it sits next to. A consumer
 * (a Storybook, an SSG build, a test) pins the pack and never imports this
 * repository's code. Nothing is mocked and nothing restates the contract by
 * hand: the contract is the single source.
 *
 * ## Where a fixture comes from
 *
 * 1. A DECLARED example (`example` / first `examples.<name>.value` on the media
 *    type), when the contract carries one -- `source: "declared"`. Issue #1391
 *    wrote those for three representative operations.
 * 2. Otherwise a value SYNTHESISED from the schema -- `source: "generated"` --
 *    by `generateFromSchema`: `$ref`, `allOf` (object merge), `oneOf`/`anyOf`
 *    (first branch that validates the whole node), `example`, `const`, `enum`,
 *    `format`, bounds, `minItems`; a cycle is cut at the first repeated `$ref`
 *    (an optional property is omitted, an array becomes empty); a cycle through
 *    a REQUIRED property cannot be cut and is reported.
 *
 * Every fixture is then validated with the same `ajv` as `api:contract:lint`
 * (formats enforced). A value that does not validate is NOT written; the
 * operation is listed under `skipped` with the reason. Nothing is dropped
 * silently: `summary.skipped` is the length of that list.
 *
 * ## Determinism and freshness
 *
 * Keys are emitted in a fixed order, values never depend on a clock, a random
 * source or the machine, so two runs are byte-identical. `:check` regenerates in
 * memory and fails when the committed pack differs -- a contract change without
 * regeneration is red.
 *
 * ## Known limit (TV-2, report #1379 section 7)
 *
 * An instance only proves a body fits the schema. A property renamed in a schema
 * that declares no `required` still validates, so instance validation cannot
 * catch it; that is what the contract policy (`required` on new operations,
 * ADR-0167 section 5) and the contract diff are for.
 *
 * ## Synthetic data only
 *
 * Generated strings are fixed placeholders; an e-mail is `user@example.test`.
 * Declared examples are checked by `api:contract:lint` for reserved domains, and
 * the pack re-checks them.
 */
import type { AnySchema, ValidateFunction } from "ajv";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parse as parseYaml } from "yaml";

import {
  EXAMPLE_FORMATS,
  findNonSyntheticEmails
} from "./api-contract-examples";
import { ROOT_ID, createAjv, isRecord, seg } from "./api-contract-lint";
import { BUNDLED_PATH } from "./openapi-bundle";

type AnyRecord = Record<string, unknown>;

export const PACK_PATH = "fixtures/api-contract/contract-fixtures.json";
export const PACK_VERSION = 1;

const HTTP_METHODS = ["get", "put", "post", "patch", "delete"] as const;
const MAX_DEPTH = 14;

export interface Fixture {
  contentType: string;
  source: "declared" | "generated";
  value: unknown;
}

export interface SkippedFixture {
  operation: string;
  /** `request`, a response status, or `shared`. */
  slot: string;
  reason: string;
}

export interface FixturePack {
  packVersion: number;
  contractSha256: string;
  summary: {
    operations: number;
    fixtures: number;
    declared: number;
    generated: number;
    skipped: number;
  };
  /** `components.responses` that several operations point at, emitted once. */
  sharedResponses: Record<string, Fixture>;
  operations: Record<
    string,
    {
      operationId?: string;
      request?: Fixture;
      responses: Record<string, Fixture | { $ref: string }>;
    }
  >;
  skipped: SkippedFixture[];
}

class Unsupported extends Error {}

export type Validate = (pointer: string, value: unknown) => string | undefined;

export interface GenContext {
  doc: AnyRecord;
  validate: Validate;
  /** `$ref` targets currently being expanded, for cycle detection. */
  stack: string[];
}

function resolvePointer(doc: AnyRecord, pointer: string): unknown {
  let node: unknown = doc;
  for (const raw of pointer.split("/").slice(1)) {
    const key = raw.replaceAll("~1", "/").replaceAll("~0", "~");
    if (!isRecord(node) || !(key in node)) {
      return undefined;
    }
    node = node[key];
  }
  return node;
}

function refPointer(ref: unknown): string | undefined {
  return typeof ref === "string" && ref.startsWith("#/")
    ? ref.slice(1)
    : undefined;
}

const FORMAT_VALUES: Record<string, string> = {
  uuid: "00000000-0000-4000-8000-000000000000",
  "date-time": "2026-01-01T00:00:00Z",
  date: "2026-01-01",
  time: "00:00:00Z",
  duration: "PT1H",
  email: "user@example.test",
  "idn-email": "user@example.test",
  hostname: "example.test",
  "idn-hostname": "example.test",
  ipv4: "192.0.2.1",
  ipv6: "2001:db8::1",
  uri: "https://example.test/resource",
  "uri-reference": "/resource",
  iri: "https://example.test/resource",
  "iri-reference": "/resource",
  "uri-template": "/resource/{id}",
  "json-pointer": "/a",
  "relative-json-pointer": "0",
  regex: "^.*$",
  byte: "ZXhhbXBsZQ==",
  binary: "example",
  password: "example-password"
};

const PATTERN_CANDIDATES = [
  "example",
  "Example1",
  "example-1",
  "1",
  "a",
  "0",
  "USD",
  "en",
  "en-US",
  "00:00",
  "000000",
  "abcdefghijklmnop",
  "0".repeat(64),
  "a".repeat(64)
];

function typeOf(node: AnyRecord): string | undefined {
  const raw = node.type;
  if (typeof raw === "string") {
    return raw;
  }
  if (Array.isArray(raw)) {
    return raw.find((t) => t !== "null" && typeof t === "string") as
      string | undefined;
  }
  if (isRecord(node.properties)) {
    return "object";
  }
  if (node.items !== undefined) {
    return "array";
  }
  return undefined;
}

function generateString(node: AnyRecord): string {
  let value =
    typeof node.format === "string" && node.format in FORMAT_VALUES
      ? FORMAT_VALUES[node.format]!
      : "example";
  if (typeof node.pattern === "string") {
    let re: RegExp | undefined;
    try {
      re = new RegExp(node.pattern, "u");
    } catch {
      re = undefined;
    }
    if (re && !re.test(value)) {
      const hit = PATTERN_CANDIDATES.find((candidate) => re.test(candidate));
      if (hit === undefined) {
        throw new Unsupported(
          `no placeholder satisfies pattern ${node.pattern}`
        );
      }
      value = hit;
    }
  }
  const min = typeof node.minLength === "number" ? node.minLength : 0;
  if (value.length < min) {
    value = value.padEnd(min, "x");
  }
  if (typeof node.maxLength === "number" && value.length > node.maxLength) {
    value = value.slice(0, node.maxLength);
  }
  return value;
}

function generateNumber(node: AnyRecord, integer: boolean): number {
  const num = (key: string): number | undefined =>
    typeof node[key] === "number" ? (node[key] as number) : undefined;
  const min = num("minimum");
  const exMin = num("exclusiveMinimum");
  const max = num("maximum");
  const exMax = num("exclusiveMaximum");
  const lower = Math.max(
    min ?? -Infinity,
    exMin === undefined ? -Infinity : exMin + (integer ? 1 : 0.5)
  );
  const upper = Math.min(
    max ?? Infinity,
    exMax === undefined ? Infinity : exMax - (integer ? 1 : 0.5)
  );
  let value = 1;
  if (value < lower) {
    value = lower;
  }
  if (value > upper) {
    value = upper;
  }
  if (integer) {
    value = Math.ceil(value);
  }
  const step = num("multipleOf");
  if (step !== undefined && step > 0 && value % step !== 0) {
    value = Math.ceil(value / step) * step;
  }
  return value;
}

/** Synthesise one value that validates against `node` (located at `pointer`). */
export function generateFromSchema(
  ctx: GenContext,
  node: unknown,
  pointer: string,
  depth = 0
): unknown {
  if (depth > MAX_DEPTH) {
    throw new Unsupported(`schema nests deeper than ${MAX_DEPTH} levels`);
  }
  if (node === true || node === undefined) {
    return {};
  }
  if (!isRecord(node)) {
    throw new Unsupported(`schema at ${pointer} is not an object`);
  }
  if ("$ref" in node) {
    const target = refPointer(node.$ref);
    const resolved = target ? resolvePointer(ctx.doc, target) : undefined;
    if (!target || resolved === undefined) {
      throw new Unsupported(`$ref ${String(node.$ref)} does not resolve`);
    }
    if (ctx.stack.includes(target)) {
      throw new Unsupported(`cyclic $ref ${String(node.$ref)}`);
    }
    ctx.stack.push(target);
    try {
      return generateFromSchema(ctx, resolved, target, depth + 1);
    } finally {
      ctx.stack.pop();
    }
  }
  if ("example" in node) {
    return node.example;
  }
  if (Array.isArray(node.examples) && node.examples.length > 0) {
    return node.examples[0];
  }
  if ("const" in node) {
    return node.const;
  }
  if (Array.isArray(node.enum) && node.enum.length > 0) {
    return node.enum[0];
  }

  if (Array.isArray(node.allOf)) {
    const { allOf, ...own } = node;
    const parts: unknown[] = (allOf as unknown[]).map((part, index) =>
      generateFromSchema(ctx, part, `${pointer}/allOf/${index}`, depth + 1)
    );
    if (Object.keys(own).length > 0) {
      parts.push(generateFromSchema(ctx, own, pointer, depth + 1));
    }
    if (parts.every(isRecord)) {
      return Object.assign({}, ...(parts as AnyRecord[]));
    }
    return parts[0];
  }

  for (const key of ["oneOf", "anyOf"] as const) {
    const branches = node[key];
    if (Array.isArray(branches) && branches.length > 0) {
      let firstError: string | undefined;
      for (const [index, branch] of branches.entries()) {
        try {
          const value = generateFromSchema(
            ctx,
            branch,
            `${pointer}/${key}/${index}`,
            depth + 1
          );
          const error = ctx.validate(pointer, value);
          if (error === undefined) {
            return value;
          }
          firstError ??= error;
        } catch (error) {
          if (!(error instanceof Unsupported)) {
            throw error;
          }
          firstError ??= error.message;
        }
      }
      throw new Unsupported(
        `no ${key} branch yields a valid value (${firstError ?? "none tried"})`
      );
    }
  }

  switch (typeOf(node)) {
    case "string":
      return generateString(node);
    case "integer":
      return generateNumber(node, true);
    case "number":
      return generateNumber(node, false);
    case "boolean":
      return true;
    case "array": {
      const min = typeof node.minItems === "number" ? node.minItems : 0;
      const max = typeof node.maxItems === "number" ? node.maxItems : Infinity;
      const wanted = Math.min(Math.max(min, 1), max);
      if (wanted === 0) {
        return [];
      }
      try {
        const item = generateFromSchema(
          ctx,
          node.items,
          `${pointer}/items`,
          depth + 1
        );
        return Array.from({ length: wanted }, () => structuredClone(item));
      } catch (error) {
        if (error instanceof Unsupported && min === 0) {
          return [];
        }
        throw error;
      }
    }
    case "object": {
      const out: AnyRecord = {};
      const required = new Set(
        Array.isArray(node.required) ? (node.required as string[]) : []
      );
      const properties = isRecord(node.properties) ? node.properties : {};
      for (const [name, child] of Object.entries(properties)) {
        if (
          !required.has(name) &&
          isRecord(child) &&
          Object.keys(child).length === 0
        ) {
          // An unconstrained optional property carries no information, and in an
          // `allOf` merge a later `{}` must not overwrite an earlier real value.
          continue;
        }
        try {
          out[name] = generateFromSchema(
            ctx,
            child,
            `${pointer}/properties/${seg(name)}`,
            depth + 1
          );
        } catch (error) {
          if (error instanceof Unsupported && !required.has(name)) {
            continue; // an optional property that cannot be built is omitted
          }
          throw error;
        }
      }
      const minProps =
        typeof node.minProperties === "number" ? node.minProperties : 0;
      if (
        Object.keys(out).length < minProps &&
        isRecord(node.additionalProperties)
      ) {
        const extra = generateFromSchema(
          ctx,
          node.additionalProperties,
          `${pointer}/additionalProperties`,
          depth + 1
        );
        for (let i = 1; Object.keys(out).length < minProps; i += 1) {
          out[`key${i}`] = structuredClone(extra);
        }
      }
      return out;
    }
    default:
      return {};
  }
}

interface MediaPick {
  contentType: string;
  media: AnyRecord;
  /** Pointer of the media type object (its `schema` is at `/schema`). */
  pointer: string;
}

function isJsonMedia(contentType: string): boolean {
  const base = contentType.split(";")[0]!.trim().toLowerCase();
  return base === "application/json" || base.endsWith("+json");
}

/** Resolve a response/requestBody (inline or `$ref`) to `{node, pointer}`. */
function resolveHolder(
  doc: AnyRecord,
  holder: unknown,
  pointer: string
): { node: AnyRecord; pointer: string } | undefined {
  if (isRecord(holder) && "$ref" in holder) {
    const target = refPointer(holder.$ref);
    const resolved = target ? resolvePointer(doc, target) : undefined;
    return isRecord(resolved) && target
      ? { node: resolved, pointer: target }
      : undefined;
  }
  return isRecord(holder) ? { node: holder, pointer } : undefined;
}

function pickMedia(
  holder: { node: AnyRecord; pointer: string },
  operation: string,
  slot: string,
  skipped: SkippedFixture[]
): MediaPick | undefined {
  const content = holder.node.content;
  if (!isRecord(content) || Object.keys(content).length === 0) {
    return undefined; // no body at all (a 204-style response): nothing to fixture
  }
  const names = Object.keys(content).sort();
  const json = names.find(isJsonMedia);
  if (json === undefined) {
    skipped.push({
      operation,
      slot,
      reason: `media type ${names.join(", ")} is not JSON`
    });
    return undefined;
  }
  const media = content[json];
  if (!isRecord(media) || media.schema === undefined) {
    skipped.push({ operation, slot, reason: `${json} declares no schema` });
    return undefined;
  }
  return {
    contentType: json,
    media,
    pointer: `${holder.pointer}/content/${seg(json)}`
  };
}

function declaredExample(
  doc: AnyRecord,
  media: AnyRecord
): { value: unknown } | undefined {
  if ("example" in media) {
    return { value: media.example };
  }
  if (isRecord(media.examples)) {
    for (const name of Object.keys(media.examples)) {
      const raw = media.examples[name];
      const entry =
        isRecord(raw) && "$ref" in raw
          ? resolvePointer(doc, refPointer(raw.$ref) ?? "/")
          : raw;
      if (isRecord(entry) && "value" in entry) {
        return { value: entry.value };
      }
    }
  }
  return undefined;
}

export function buildFixturePack(
  doc: AnyRecord,
  contractSha256: string
): FixturePack {
  const ajv = createAjv(doc, EXAMPLE_FORMATS);
  ajv.addSchema(doc as AnySchema, ROOT_ID);
  const compiled = new Map<string, ValidateFunction>();
  const validate: Validate = (pointer, value) => {
    let fn = compiled.get(pointer);
    if (!fn) {
      fn = ajv.compile({ $ref: `${ROOT_ID}#${pointer}` });
      compiled.set(pointer, fn);
    }
    if (fn(value)) {
      return undefined;
    }
    return (fn.errors ?? [])
      .slice(0, 3)
      .map((e) => `${e.instancePath || "(root)"} ${e.message ?? "is invalid"}`)
      .join("; ");
  };

  const skipped: SkippedFixture[] = [];
  const sharedResponses: Record<string, Fixture> = {};
  const operations: FixturePack["operations"] = {};
  let declared = 0;
  let generated = 0;

  const makeFixture = (
    pick: MediaPick,
    operation: string,
    slot: string
  ): Fixture | undefined => {
    const schemaPointer = `${pick.pointer}/schema`;
    const given = declaredExample(doc, pick.media);
    let value: unknown;
    let source: Fixture["source"];
    if (given !== undefined) {
      value = given.value;
      source = "declared";
    } else {
      try {
        value = generateFromSchema(
          { doc, validate, stack: [] },
          pick.media.schema,
          schemaPointer
        );
      } catch (error) {
        if (!(error instanceof Unsupported)) {
          throw error;
        }
        skipped.push({ operation, slot, reason: error.message });
        return undefined;
      }
      source = "generated";
    }
    const problem = validate(schemaPointer, value);
    if (problem !== undefined) {
      skipped.push({
        operation,
        slot,
        reason: `${source} value does not validate: ${problem}`
      });
      return undefined;
    }
    const emails = findNonSyntheticEmails(value);
    if (emails.length > 0) {
      skipped.push({
        operation,
        slot,
        reason: `non-synthetic e-mail ${emails.join(", ")}`
      });
      return undefined;
    }
    if (source === "declared") {
      declared += 1;
    } else {
      generated += 1;
    }
    return { contentType: pick.contentType, source, value };
  };

  const sharedDone = new Map<string, boolean>();
  const paths = isRecord(doc.paths) ? doc.paths : {};
  for (const route of Object.keys(paths).sort()) {
    const item = paths[route];
    if (!isRecord(item)) {
      continue;
    }
    for (const method of HTTP_METHODS) {
      const operation = item[method];
      if (!isRecord(operation)) {
        continue;
      }
      const label = `${method.toUpperCase()} ${route}`;
      const base = `/paths/${seg(route)}/${method}`;
      const entry: FixturePack["operations"][string] = { responses: {} };
      if (typeof operation.operationId === "string") {
        entry.operationId = operation.operationId;
      }

      const body = resolveHolder(
        doc,
        operation.requestBody,
        `${base}/requestBody`
      );
      if (body) {
        const pick = pickMedia(body, label, "request", skipped);
        const fixture = pick && makeFixture(pick, label, "request");
        if (fixture) {
          entry.request = fixture;
        }
      }

      const responses = isRecord(operation.responses)
        ? operation.responses
        : {};
      for (const status of Object.keys(responses).sort()) {
        const raw = responses[status];
        const shared =
          isRecord(raw) && typeof raw.$ref === "string"
            ? /^#\/components\/responses\/([^/]+)$/.exec(raw.$ref)?.[1]
            : undefined;
        if (shared !== undefined) {
          if (!sharedDone.has(shared)) {
            const holder = resolveHolder(doc, raw, "");
            const pick =
              holder && pickMedia(holder, `#${shared}`, "shared", skipped);
            const fixture = pick && makeFixture(pick, `#${shared}`, "shared");
            sharedDone.set(shared, fixture !== undefined);
            if (fixture) {
              sharedResponses[shared] = fixture;
            }
          }
          if (sharedDone.get(shared)) {
            entry.responses[status] = { $ref: `#/sharedResponses/${shared}` };
          }
          continue;
        }
        const holder = resolveHolder(
          doc,
          raw,
          `${base}/responses/${seg(status)}`
        );
        if (!holder) {
          continue;
        }
        const pick = pickMedia(holder, label, status, skipped);
        const fixture = pick && makeFixture(pick, label, status);
        if (fixture) {
          entry.responses[status] = fixture;
        }
      }
      operations[label] = entry;
    }
  }

  return {
    packVersion: PACK_VERSION,
    contractSha256,
    summary: {
      operations: Object.keys(operations).length,
      fixtures: declared + generated,
      declared,
      generated,
      skipped: skipped.length
    },
    sharedResponses: Object.fromEntries(
      Object.entries(sharedResponses).sort(([a], [b]) => a.localeCompare(b))
    ),
    operations,
    skipped: skipped.sort(
      (a, b) =>
        a.operation.localeCompare(b.operation) || a.slot.localeCompare(b.slot)
    )
  };
}

export function serializePack(pack: FixturePack): string {
  return `${JSON.stringify(pack, null, 2)}\n`;
}

export function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export async function generatePackFromBundle(
  bundlePath = path.resolve(process.cwd(), BUNDLED_PATH)
): Promise<string> {
  const text = await readFile(bundlePath, "utf8");
  const doc = parseYaml(text) as AnyRecord;
  return serializePack(buildFixturePack(doc, sha256(text)));
}

if (import.meta.main) {
  const generate = process.argv.includes("--generate");
  const packPath = path.resolve(process.cwd(), PACK_PATH);
  const fresh = await generatePackFromBundle();
  const summary = (JSON.parse(fresh) as FixturePack).summary;
  const line = `${summary.operations} operations, ${summary.fixtures} fixtures (${summary.declared} declared, ${summary.generated} generated), ${summary.skipped} skipped with a reason`;
  if (generate) {
    await writeFile(packPath, fresh, "utf8");
    console.log(`api:fixtures:generate OK -- ${line}.`);
  } else {
    let committed = "";
    try {
      committed = await readFile(packPath, "utf8");
    } catch {
      // a missing pack is stale
    }
    if (committed !== fresh) {
      console.error(
        `api:fixtures:check FAILED -- ${PACK_PATH} is stale: the contract changed and the fixtures pack was not regenerated. Run \`bun run api:fixtures:generate\` and commit the result.`
      );
      process.exitCode = 1;
    } else {
      console.log(`api:fixtures:check OK -- ${line}.`);
    }
  }
}
