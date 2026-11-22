/**
 * api-contract-examples.ts -- the example half of `bun run api:contract:lint`
 * (Issue #1391, ADR-0167).
 *
 * An example that nobody validates is documentation that drifts: the schema
 * gains a required field, the example does not, and the reference document goes
 * on showing a body the API no longer returns. A client author copies it, and
 * nothing fails. So every example in the bundled contract is validated against
 * the schema it sits next to, with the same `ajv` the lint uses, and a mismatch
 * fails the gate.
 *
 * ## What is validated
 *
 * - media-type `example` and every `examples.<name>.value` (request bodies and
 *   responses, inline or through `components`), against that media type's
 *   `schema`;
 * - parameter `example` / `examples.<name>.value`, against the parameter's
 *   `schema`;
 * - schema-level `example` and each entry of `examples`, against the schema
 *   node that carries it.
 *
 * `$ref` examples are resolved inside the bundle; `externalValue` is skipped
 * (it is a URL, not a value).
 *
 * ## Synthetic data only
 *
 * ADR-0167 §Consequences: fixtures are synthetic. Every string in an example
 * that looks like an e-mail address must use a reserved domain (RFC 2606 /
 * RFC 6761: `example.test`, `example.com|org|net`, or a `.test`, `.example`,
 * `.invalid`, `.localhost` host). A real address is a personal-data leak
 * committed into a document that is published.
 *
 * ## `format`
 *
 * `uuid`, `date-time`, `date`, `email` and `uri` are enforced here (small
 * in-house checks, no `ajv-formats`); the lint keeps every format accept-all
 * because it checks the contract, not instances.
 *
 * `nullable: true` is honoured the way ajv does (a `type` plus `nullable`
 * admits `null`), which is what the contract's 3.0-style fields mean.
 */
import Ajv2020 from "ajv/dist/2020.js";
import type { AnySchema } from "ajv";

import { ROOT_ID, createAjv, isRecord, seg } from "./api-contract-lint";

type AnyRecord = Record<string, unknown>;

export interface ExampleFailure {
  /** JSON pointer, relative to the bundle root, of the offending example. */
  pointer: string;
  message: string;
}

export interface ExampleResult {
  checked: number;
  failures: ExampleFailure[];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DATE_TIME =
  /^\d{4}-\d{2}-\d{2}[Tt]\d{2}:\d{2}:\d{2}(\.\d+)?([Zz]|[+-]\d{2}:\d{2})$/;
const EMAIL = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;
const URI = /^[a-zA-Z][a-zA-Z0-9+.-]*:\S*$/;

function isValidDate(value: string): boolean {
  if (!DATE.test(value)) {
    return false;
  }
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
}

function isValidDateTime(value: string): boolean {
  return DATE_TIME.test(value) && !Number.isNaN(Date.parse(value));
}

const EXAMPLE_FORMATS: Record<string, (value: string) => boolean> = {
  uuid: (value) => UUID.test(value),
  date: isValidDate,
  "date-time": isValidDateTime,
  email: (value) => EMAIL.test(value),
  uri: (value) => URI.test(value)
};

const RESERVED_HOSTS = new Set([
  "example.test",
  "example.com",
  "example.org",
  "example.net"
]);
const RESERVED_SUFFIXES = [".test", ".example", ".invalid", ".localhost"];

function isReservedHost(host: string): boolean {
  const lower = host.toLowerCase();
  return (
    RESERVED_HOSTS.has(lower) ||
    [...RESERVED_HOSTS].some((reserved) => lower.endsWith(`.${reserved}`)) ||
    RESERVED_SUFFIXES.some((suffix) => lower.endsWith(suffix))
  );
}

const EMAIL_IN_TEXT = /[^\s@"'<>(),;:]+@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/g;

/** Every e-mail-looking string inside an example value must use a reserved domain. */
export function findNonSyntheticEmails(value: unknown): string[] {
  const found: string[] = [];
  const visit = (node: unknown): void => {
    if (typeof node === "string") {
      for (const match of node.matchAll(EMAIL_IN_TEXT)) {
        if (!isReservedHost(match[1]!)) {
          found.push(match[0]);
        }
      }
    } else if (Array.isArray(node)) {
      node.forEach(visit);
    } else if (isRecord(node)) {
      Object.values(node).forEach(visit);
    }
  };
  visit(value);
  return found;
}

interface Candidate {
  /** Pointer of the example value, for the failure message. */
  pointer: string;
  value: unknown;
  /** Pointer of the schema to validate it against. */
  schemaPointer: string;
}

/** Resolve a bundle-local `$ref` (`#/components/examples/Name`). */
function resolveRef(doc: AnyRecord, ref: unknown): unknown {
  if (typeof ref !== "string" || !ref.startsWith("#/")) {
    return undefined;
  }
  let node: unknown = doc;
  for (const raw of ref.slice(2).split("/")) {
    const key = raw.replaceAll("~1", "/").replaceAll("~0", "~");
    if (!isRecord(node) || !(key in node)) {
      return undefined;
    }
    node = node[key];
  }
  return node;
}

function exampleEntries(
  doc: AnyRecord,
  holder: AnyRecord,
  pointer: string,
  schemaPointer: string,
  into: Candidate[]
): void {
  if ("example" in holder) {
    into.push({
      pointer: `${pointer}/example`,
      value: holder.example,
      schemaPointer
    });
  }
  if (isRecord(holder.examples)) {
    for (const [name, raw] of Object.entries(holder.examples)) {
      const entry =
        isRecord(raw) && "$ref" in raw ? resolveRef(doc, raw.$ref) : raw;
      if (isRecord(entry) && "value" in entry) {
        into.push({
          pointer: `${pointer}/examples/${seg(name)}/value`,
          value: entry.value,
          schemaPointer
        });
      }
    }
  }
}

const SCHEMA_MAP_KEYS = [
  "properties",
  "patternProperties",
  "$defs",
  "definitions",
  "dependentSchemas"
];
const SCHEMA_ARRAY_KEYS = ["allOf", "anyOf", "oneOf", "prefixItems"];
const SCHEMA_SINGLE_KEYS = [
  "items",
  "additionalProperties",
  "not",
  "if",
  "then",
  "else",
  "contains",
  "propertyNames",
  "unevaluatedProperties",
  "unevaluatedItems"
];

/** Walk a schema node, collecting its own `example(s)` and those of its sub-schemas. */
function walkSchema(
  doc: AnyRecord,
  node: unknown,
  pointer: string,
  into: Candidate[]
): void {
  if (!isRecord(node)) {
    return;
  }
  if ("example" in node || (Array.isArray(node.examples) && node.examples)) {
    if ("example" in node) {
      into.push({
        pointer: `${pointer}/example`,
        value: node.example,
        schemaPointer: pointer
      });
    }
    if (Array.isArray(node.examples)) {
      node.examples.forEach((value, index) => {
        into.push({
          pointer: `${pointer}/examples/${index}`,
          value,
          schemaPointer: pointer
        });
      });
    }
  }
  for (const key of SCHEMA_MAP_KEYS) {
    const map = node[key];
    if (isRecord(map)) {
      for (const [name, child] of Object.entries(map)) {
        walkSchema(doc, child, `${pointer}/${key}/${seg(name)}`, into);
      }
    }
  }
  for (const key of SCHEMA_ARRAY_KEYS) {
    const list = node[key];
    if (Array.isArray(list)) {
      list.forEach((child, index) =>
        walkSchema(doc, child, `${pointer}/${key}/${index}`, into)
      );
    }
  }
  for (const key of SCHEMA_SINGLE_KEYS) {
    walkSchema(doc, node[key], `${pointer}/${key}`, into);
  }
}

/** Walk everything that is NOT a schema (paths, operations, responses, media types). */
function walkDocument(
  doc: AnyRecord,
  node: unknown,
  pointer: string,
  into: Candidate[]
): void {
  if (Array.isArray(node)) {
    node.forEach((child, index) =>
      walkDocument(doc, child, `${pointer}/${index}`, into)
    );
    return;
  }
  if (!isRecord(node)) {
    return;
  }
  const isMediaType = /\/content\/[^/]+$/.test(pointer);
  const isParameter = /\/parameters\/(\d+|[^/]+)$/.test(pointer);
  if ((isMediaType || isParameter) && node.schema !== undefined) {
    exampleEntries(doc, node, pointer, `${pointer}/schema`, into);
  }
  for (const [key, child] of Object.entries(node)) {
    const childPointer = `${pointer}/${seg(key)}`;
    if (key === "schema") {
      walkSchema(doc, child, childPointer, into);
    } else if (
      key === "schemas" &&
      pointer === "/components" &&
      isRecord(child)
    ) {
      for (const [name, schema] of Object.entries(child)) {
        walkSchema(doc, schema, `${childPointer}/${seg(name)}`, into);
      }
    } else if (key === "example" || key === "examples") {
      // already handled by the holder (media type / parameter); not a node to descend.
      continue;
    } else {
      walkDocument(doc, child, childPointer, into);
    }
  }
}

export function collectExamples(doc: AnyRecord): Candidate[] {
  const candidates: Candidate[] = [];
  walkDocument(doc, doc, "", candidates);
  return candidates;
}

export function validateContractExamples(doc: AnyRecord): ExampleResult {
  const ajv: Ajv2020 = createAjv(doc, EXAMPLE_FORMATS);
  ajv.addSchema(doc as AnySchema, ROOT_ID);

  const failures: ExampleFailure[] = [];
  const seen = new Set<string>();
  let checked = 0;

  for (const candidate of collectExamples(doc)) {
    const key = `${candidate.pointer}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);

    const emails = findNonSyntheticEmails(candidate.value);
    if (emails.length > 0) {
      failures.push({
        pointer: candidate.pointer,
        message: `non-synthetic e-mail address(es) ${emails.join(", ")}; use a reserved domain (example.test)`
      });
    }

    let validate;
    try {
      validate = ajv.compile({
        $ref: `${ROOT_ID}#${candidate.schemaPointer}`
      });
    } catch (error) {
      failures.push({
        pointer: candidate.pointer,
        message: `its schema does not compile: ${error instanceof Error ? error.message : String(error)}`
      });
      continue;
    }
    checked += 1;
    if (!validate(candidate.value)) {
      const detail = (validate.errors ?? [])
        .slice(0, 5)
        .map(
          (e) => `${e.instancePath || "(root)"} ${e.message ?? "is invalid"}`
        )
        .join("; ");
      failures.push({
        pointer: candidate.pointer,
        message: `does not validate against ${candidate.schemaPointer}: ${detail}`
      });
    }
  }
  return { checked, failures };
}
