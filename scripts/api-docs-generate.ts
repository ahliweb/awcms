/**
 * Issue #182 (epic #177 ERP-readiness): generates a single, readable Markdown
 * API & event reference document from the CANONICAL bundled contracts —
 * `openapi/awcms-public-api.openapi.yaml` (produced by `bun run openapi:bundle`)
 * and `asyncapi/awcms-domain-events.asyncapi.yaml`. This script never reads the
 * `openapi/modules/*.openapi.yaml` fragments directly; it calls
 * `buildBundledDocument()` from `scripts/openapi-bundle.ts` so the reference
 * document always describes the same merged contract every other consumer
 * (route-parity check, published bundle file) sees.
 *
 * Determinism: paths/schemas in the bundled document are already alphabetically
 * sorted by the bundler; operations within a tag are emitted by iterating the
 * sorted path list and a FIXED HTTP method order; the reachable-schema appendix
 * is built from that same fixed traversal. Two runs against unchanged sources
 * produce byte-identical Markdown (see `tests/api-docs-generate.test.ts`).
 *
 * Safety of examples: every example value is SYNTHESIZED from the JSON Schema
 * shape (type/format/enum/const) — never copied from a config file, log,
 * fixture, or real database row. UUIDs are the nil UUID, dates a fixed
 * placeholder, hostnames/emails the RFC 2606 documentation domain.
 *
 * Local/offline only: YAML parsing plus string templating over files already
 * in the repo, then Prettier (no randomness). Regenerate with
 * `bun run api:docs:generate`; `bun run api:docs:check` (part of
 * `bun run check`) fails the build if this file is stale.
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import prettier from "prettier";
import { parseDocument } from "yaml";

import { buildBundledDocument, BUNDLED_PATH } from "./openapi-bundle";
import { ASYNCAPI_PATH } from "./api-spec-check";

export const API_REFERENCE_PATH = "docs/awcms/api-reference.md";

type AnyRecord = Record<string, unknown>;

const HTTP_METHOD_ORDER = ["get", "post", "put", "patch", "delete"] as const;

// The standard-envelope schemas get dedicated treatment in the "Standard
// envelope" section — excluded from the per-operation reachable-schema
// appendix so they aren't documented twice. awcms's envelope names only
// `ApiError` and `ApiMeta` (success responses use inline `allOf` wrappers, not
// a named `ApiSuccess`); the extra names are listed defensively so a future
// contract that DOES name them is handled without an edit here.
const ENVELOPE_SCHEMA_NAMES = new Set([
  "ApiSuccess",
  "ApiError",
  "ApiMeta",
  "ErrorDetail",
  "ErrorCode"
]);

const SYNTHETIC = {
  uuid: "00000000-0000-0000-0000-000000000000",
  dateTime: "2026-01-01T00:00:00.000Z",
  date: "2026-01-01",
  email: "user@example.com",
  url: "https://example.com/resource",
  hostname: "tenant.example.com"
};

function asRecord(value: unknown): AnyRecord {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as AnyRecord;
  }
  return {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/** GitHub-style heading slug — mirrors `scripts/lib/docs-checks.mjs`'s slugify. */
function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s/g, "-");
}

function schemaAnchor(name: string): string {
  return `#schema-${slugify(name)}`;
}

function refName(node: unknown): string | undefined {
  const ref = asRecord(node).$ref;
  return typeof ref === "string" ? ref.split("/").pop() : undefined;
}

/** Picks the `application/json` media type schema off a `content` map. */
function jsonSchemaOf(content: unknown): unknown {
  const record = asRecord(content);
  if (record["application/json"] !== undefined) {
    return asRecord(record["application/json"]).schema;
  }
  const first = Object.values(record)[0];
  return first !== undefined ? asRecord(first).schema : undefined;
}

/**
 * Human-readable, linked type label for a schema node — resolves `$ref`,
 * `allOf` (including the `ApiSuccess<Data>` wrapper pattern every 2xx response
 * in this contract uses), arrays, and enums. Every named schema encountered is
 * added to `reachable` so the appendix only documents schemas actually used.
 */
function schemaSummary(
  node: unknown,
  reachable: Set<string>,
  depth = 0
): string {
  if (depth > 6) return "…";
  const rec = asRecord(node);

  const name = refName(node);
  if (name) {
    if (ENVELOPE_SCHEMA_NAMES.has(name)) {
      const anchor =
        name === "ApiSuccess"
          ? "#standard-success-envelope"
          : "#standard-error-envelope";
      return `[\`${name}\`](${anchor})`;
    }
    reachable.add(name);
    return `[\`${name}\`](${schemaAnchor(name)})`;
  }

  if (Array.isArray(rec.allOf)) {
    const baseRef = rec.allOf.find((m) => typeof asRecord(m).$ref === "string");
    const dataMember = rec.allOf.find(
      (m) => asRecord(asRecord(m).properties).data !== undefined
    );
    if (baseRef && dataMember) {
      const baseLabel = schemaSummary(baseRef, reachable, depth + 1);
      const dataLabel = schemaSummary(
        asRecord(asRecord(dataMember).properties).data,
        reachable,
        depth + 1
      );
      // HTML entities, not backslash-escapes: this string is later run through
      // mdEscape() as a table cell, which escapes backslashes before pipes — a
      // literal `\<` here would become `\\<`, a visible rendering regression.
      return `${baseLabel}&lt;${dataLabel}&gt;`;
    }
    return rec.allOf
      .map((m) => schemaSummary(m, reachable, depth + 1))
      .join(" & ");
  }

  if (Array.isArray(rec.oneOf) && rec.oneOf.length > 0) {
    return rec.oneOf
      .map((m) => schemaSummary(m, reachable, depth + 1))
      .join(" \\| ");
  }

  if (rec.type === "array") {
    return `array of ${schemaSummary(rec.items, reachable, depth + 1)}`;
  }

  if (Array.isArray(rec.enum)) {
    return `enum(${rec.enum.map((v) => `\`${String(v)}\``).join(", ")})`;
  }

  if (typeof rec.type === "string") {
    return rec.format ? `${rec.type} (${rec.format})` : rec.type;
  }

  if (rec.properties) return "object";

  return "unknown";
}

/**
 * Synthesizes a safe, deterministic JSON example from a schema node — never
 * reads any real data. `seen` guards `$ref` cycles; `depth` bounds plain
 * nesting.
 */
function exampleValue(
  node: unknown,
  schemas: AnyRecord,
  keyHint: string | undefined,
  depth: number,
  seen: ReadonlySet<string>
): unknown {
  if (depth > 6) return null;
  const rec = asRecord(node);

  const name = refName(node);
  if (name) {
    if (seen.has(name)) return `(circular: ${name})`;
    return exampleValue(
      schemas[name],
      schemas,
      keyHint,
      depth + 1,
      new Set([...seen, name])
    );
  }

  if (Array.isArray(rec.allOf)) {
    let merged: AnyRecord = {};
    let mergedProperties: AnyRecord = {};
    for (const member of rec.allOf) {
      const resolvedName = refName(member);
      const resolved = resolvedName
        ? asRecord(schemas[resolvedName])
        : asRecord(member);
      merged = { ...merged, ...resolved };
      mergedProperties = {
        ...mergedProperties,
        ...asRecord(resolved.properties)
      };
    }
    merged.properties = mergedProperties;
    return exampleValue(merged, schemas, keyHint, depth, seen);
  }

  if (Array.isArray(rec.oneOf) && rec.oneOf.length > 0) {
    return exampleValue(rec.oneOf[0], schemas, keyHint, depth + 1, seen);
  }
  if (Array.isArray(rec.anyOf) && rec.anyOf.length > 0) {
    return exampleValue(rec.anyOf[0], schemas, keyHint, depth + 1, seen);
  }

  if (rec.const !== undefined) return rec.const;
  if (Array.isArray(rec.enum) && rec.enum.length > 0) return rec.enum[0];
  if (rec.example !== undefined) return rec.example;

  const rawType = rec.type;
  const type = Array.isArray(rawType)
    ? (rawType.find((t) => t !== "null") ?? rawType[0])
    : rawType;

  if (type === "array") {
    if (depth >= 4) return [];
    return [exampleValue(rec.items, schemas, keyHint, depth + 1, seen)];
  }

  if (type === "object" || rec.properties) {
    const props = asRecord(rec.properties);
    const keys = Object.keys(props);
    if (keys.length === 0)
      return depth === 0 ? {} : "(operation-specific payload)";
    const out: AnyRecord = {};
    for (const key of keys) {
      out[key] = exampleValue(props[key], schemas, key, depth + 1, seen);
    }
    return out;
  }

  if (type === "string") {
    if (rec.format === "uuid") return SYNTHETIC.uuid;
    if (rec.format === "date-time") return SYNTHETIC.dateTime;
    if (rec.format === "date") return SYNTHETIC.date;
    const hint = (keyHint ?? "").toLowerCase();
    if (hint.includes("email")) return SYNTHETIC.email;
    if (hint.includes("url") || hint.includes("canonicalurl"))
      return SYNTHETIC.url;
    if (hint.includes("hostname") || hint.includes("domain"))
      return SYNTHETIC.hostname;
    if (hint === "slug") return "example-slug";
    return "string";
  }

  if (type === "integer" || type === "number") {
    return typeof rec.minimum === "number" ? rec.minimum : 0;
  }

  if (type === "boolean") return false;

  return null;
}

function jsonBlock(value: unknown): string {
  return "```json\n" + JSON.stringify(value, null, 2) + "\n```";
}

function mdEscape(text: string): string {
  // Escape backslashes FIRST, then pipes, so a schema-authored value ending in
  // `\` can't absorb the escaping backslash meant for a `|` cell delimiter.
  return text.replace(/\\/g, "\\\\").replace(/\|/g, "\\|");
}

function table(headers: string[], rows: string[][]): string {
  const lines = [
    `| ${headers.join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`
  ];
  for (const row of rows) {
    lines.push(`| ${row.map(mdEscape).join(" | ")} |`);
  }
  return lines.join("\n");
}

/** Resolves an operation `parameters` entry (own definition or `$ref`). */
function resolveParameter(
  node: unknown,
  componentsParameters: AnyRecord
): AnyRecord {
  const name = refName(node);
  if (name) return asRecord(componentsParameters[name]);
  return asRecord(node);
}

function securityLabel(security: unknown): string {
  if (!Array.isArray(security))
    return "inherits global (`bearerAuth` + `tenantHeader`)";
  if (security.length === 0) return "none (public endpoint)";
  return security
    .map((requirement) => Object.keys(asRecord(requirement)).join(" + "))
    .join(" OR ");
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function renderHeader(openApi: AnyRecord, asyncApi: AnyRecord): string {
  const openApiInfo = asRecord(openApi.info);
  const asyncApiInfo = asRecord(asyncApi.info);

  return `# AWCMS API & Event Reference (generated)

> **GENERATED FILE — do not edit by hand.** Produced by
> \`bun run api:docs:generate\` (\`scripts/api-docs-generate.ts\`, Issue #182,
> epic #177) from the bundled contracts below. Edit the OpenAPI fragments
> (\`openapi/awcms-public-api.src.yaml\` + \`openapi/modules/*.openapi.yaml\`) or
> the AsyncAPI file, regenerate the OpenAPI bundle (\`bun run openapi:bundle\`),
> then regenerate this document — never edit it directly. \`bun run api:docs:check\`
> (part of \`bun run check\`) fails the build if this file is stale relative to
> the bundled contracts.

- **REST contract**: [\`${BUNDLED_PATH}\`](../../${BUNDLED_PATH}) — \`info.version\` \`${String(openApiInfo.version)}\`.
- **Event contract**: [\`${ASYNCAPI_PATH}\`](../../${ASYNCAPI_PATH}) — \`info.version\` \`${String(asyncApiInfo.version)}\`.

Contract version is independent SemVer, bumped only when the contract SHAPE
itself changes (ADR-0008 — see
[\`docs/adr/0008-independent-contract-and-module-versioning.md\`](../adr/0008-independent-contract-and-module-versioning.md)),
not on every package release.

**Version selection.** This document is generated 1:1 from the contract files
committed at the same git commit/tag you're viewing it at — there is no
interactive version switcher (no SaaS, no build-time JS required to read it
offline). To read the reference for a prior release, check out that release's
git tag, or regenerate locally with \`bun run api:docs:generate\` after checking
it out.

**Offline/LAN use.** This is a plain, self-contained Markdown file with no
external image/script/font references — open it with any text editor, \`less\`,
or a local Markdown previewer. No server or internet connection is required.
`;
}

function renderConventions(openApi: AnyRecord): string {
  const components = asRecord(openApi.components);
  const securitySchemes = asRecord(components.securitySchemes);
  const parameters = asRecord(components.parameters);
  const responses = asRecord(components.responses);
  const schemas = asRecord(components.schemas);
  const info = asRecord(openApi.info);

  const securityRows = Object.entries(securitySchemes).map(([name, node]) => {
    const rec = asRecord(node);
    const kind =
      rec.type === "http"
        ? `http (${String(rec.scheme)}${rec.bearerFormat ? `, ${String(rec.bearerFormat)}` : ""})`
        : rec.type === "apiKey"
          ? `apiKey (${String(rec.in)}: \`${String(rec.name)}\`)`
          : String(rec.type);
    return [`\`${name}\``, kind, String(rec.description ?? "")];
  });

  const parameterRows = Object.entries(parameters).map(([name, node]) => {
    const rec = asRecord(node);
    const schema = asRecord(rec.schema);
    return [
      `\`${name}\``,
      `\`${String(rec.name)}\` (${String(rec.in)})`,
      rec.required ? "yes" : "no",
      schemaSummary(schema, new Set()),
      String(rec.description ?? "")
    ];
  });

  const responseRows = Object.entries(responses).map(([name, node]) => {
    const rec = asRecord(node);
    return [
      `\`${name}\``,
      "[`ApiError`](#standard-error-envelope)",
      String(rec.description ?? "")
    ];
  });

  // awcms's `ApiError.error.code` is a free-form string, not a named
  // `ErrorCode` enum — surface the enum only if the contract ever adds one.
  const errorCodeEnum = asRecord(
    asRecord(asRecord(asRecord(schemas.ApiError).properties).error).properties
  ).code;
  const errorCodes = asArray(asRecord(errorCodeEnum).enum).map(String);

  const successExample = {
    success: true,
    data: "(operation-specific payload — see each operation's response)",
    meta: { correlationId: SYNTHETIC.uuid, requestId: SYNTHETIC.uuid }
  };
  const errorExample = {
    success: false,
    error: {
      code: errorCodes[0] ?? "VALIDATION_ERROR",
      message: "string",
      details: [{ field: "string", message: "string", code: "string" }]
    },
    meta: { correlationId: SYNTHETIC.uuid, requestId: SYNTHETIC.uuid }
  };

  return `## Contract overview

**${String(info.title)}** — version \`${String(info.version)}\`.

${String(info.description ?? "")}

## Cross-cutting conventions

### Authentication model

${table(["Scheme", "Kind", "Description"], securityRows)}

Every operation below states its own security requirement explicitly — either a
real requirement (usually \`bearerAuth\` + \`tenantHeader\` together) or
\`none (public endpoint)\`. There is no implicit "some endpoints just don't need
auth" — \`bun run api:spec:check\`'s public operation allow-list
(\`ALLOWED_PUBLIC_OPERATIONS\` in \`scripts/api-spec-check.ts\`) enforces this
stays reviewed.

### Tenant context

\`tenantHeader\` (\`X-AWCMS-Tenant-ID\`) carries the active tenant for every
tenant-scoped request; the server also sets PostgreSQL Row-Level Security
context from the authenticated session, never trusting the header alone as the
sole isolation boundary (defense in depth).

### Pagination

List endpoints use opaque **keyset** pagination via the \`cursor\` query
parameter — never large offsets. Pass the previous page's \`nextCursor\` value
back as \`cursor\`; omit it for the first page.

### Idempotency

High-risk mutations require the \`Idempotency-Key\` header — a replayed key
returns the original result rather than performing the mutation twice.

### Correlation & request IDs

\`X-Correlation-ID\` and \`X-Request-ID\` are optional caller-supplied trace IDs,
echoed back in every response's \`meta\` object
(\`ApiMeta.correlationId\`/\`requestId\`).

### Standard parameters

${table(["Name", "Header/query", "Required", "Type", "Description"], parameterRows)}

### Standard success envelope

Every \`2xx\` response body is a success-shaped object (\`success: true\` plus a
\`data\` payload typed to that operation's specific response schema):

${jsonBlock(successExample)}

### Standard error envelope

Every non-\`2xx\`/\`3xx\` response resolves to the same \`ApiError\` shape — never
an ad-hoc inline error shape (\`bun run api:spec:check\`'s standard error schema
check enforces this):

${jsonBlock(errorExample)}
${errorCodes.length > 0 ? `\n**Error codes** (\`ErrorCode\` enum): ${errorCodes.map((c) => `\`${c}\``).join(", ")}.\n` : ""}
**Standard error responses**:

${table(["Response", "Schema", "Description"], responseRows)}

### Request body size limits

Every endpoint that accepts a body enforces an application-level size cap
(default 128 KiB) independent of any reverse-proxy limit; a body over the limit
is rejected with \`413 Payload Too Large\` / \`PAYLOAD_TOO_LARGE\`, using the same
envelope as every other error response.
`;
}

/**
 * Expands `reachable` to a full transitive closure over `components.schemas` so
 * every schema actually exercised by the public contract gets an appendix
 * entry — never a dangling `(#schema-x)` link with no matching heading.
 */
function expandReachableClosure(
  schemas: AnyRecord,
  reachable: Set<string>
): void {
  function visit(node: unknown): void {
    const rec = asRecord(node);
    const name = refName(node);
    if (name) {
      if (!ENVELOPE_SCHEMA_NAMES.has(name) && !reachable.has(name)) {
        reachable.add(name);
        visit(schemas[name]);
      }
      return;
    }
    for (const member of [
      ...asArray(rec.allOf),
      ...asArray(rec.oneOf),
      ...asArray(rec.anyOf)
    ]) {
      visit(member);
    }
    if (rec.items !== undefined) visit(rec.items);
    for (const propSchema of Object.values(asRecord(rec.properties))) {
      visit(propSchema);
    }
  }

  for (const name of [...reachable]) {
    visit(schemas[name]);
  }
}

function renderOperations(openApi: AnyRecord, reachable: Set<string>): string {
  const tags = asArray(openApi.tags).map((t) => asRecord(t));
  const paths = asRecord(openApi.paths);
  const components = asRecord(openApi.components);
  const componentsParameters = asRecord(components.parameters);
  const globalSecurity = openApi.security;

  const sortedPathKeys = Object.keys(paths).sort((a, b) => a.localeCompare(b));

  const sections: string[] = ["## REST operations by module"];

  for (const tag of tags) {
    const tagName = String(tag.name);
    const operationBlocks: string[] = [];

    for (const pathKey of sortedPathKeys) {
      for (const method of HTTP_METHOD_ORDER) {
        const op = asRecord(asRecord(paths[pathKey])[method]);
        if (Object.keys(op).length === 0) continue;
        const opTags = asArray(op.tags).map(String);
        if (!opTags.includes(tagName)) continue;

        const operationId = String(op.operationId ?? "(missing operationId)");
        const summary = String(op.summary ?? "");
        const description = String(op.description ?? "");
        const security = securityLabel(op.security ?? globalSecurity);

        const parameterRows = asArray(op.parameters).map((paramNode) => {
          const resolved = resolveParameter(paramNode, componentsParameters);
          return [
            `\`${String(resolved.name)}\``,
            String(resolved.in ?? ""),
            resolved.required ? "yes" : "no",
            schemaSummary(resolved.schema, reachable),
            String(resolved.description ?? "")
          ];
        });

        const requestBody = asRecord(op.requestBody);
        const requestBodySchema = jsonSchemaOf(requestBody.content);
        const requestBodyLine =
          requestBodySchema !== undefined
            ? `**Request body** (${requestBody.required ? "required" : "optional"}): ${schemaSummary(requestBodySchema, reachable)}`
            : "";

        const responseRows = Object.entries(asRecord(op.responses)).map(
          ([status, responseNode]) => {
            const responseName = refName(responseNode);
            const resolvedResponse = responseName
              ? asRecord(asRecord(components.responses)[responseName])
              : asRecord(responseNode);
            const schema = jsonSchemaOf(resolvedResponse.content);
            const label =
              schema !== undefined
                ? schemaSummary(schema, reachable)
                : responseName
                  ? `[\`${responseName}\`](#standard-error-envelope)`
                  : "";
            return [status, String(resolvedResponse.description ?? ""), label];
          }
        );

        operationBlocks.push(
          `### \`${method.toUpperCase()} ${pathKey}\` — ${summary || operationId}

- **operationId**: \`${operationId}\`
- **Security**: ${security}
${description ? `\n${description}\n` : ""}
${parameterRows.length > 0 ? `**Parameters**\n\n${table(["Name", "In", "Required", "Type", "Description"], parameterRows)}\n` : ""}
${requestBodyLine}

**Responses**

${table(["Status", "Description", "Schema"], responseRows)}
`
        );
      }
    }

    if (operationBlocks.length === 0) continue;

    sections.push(
      `## ${tagName}\n\n${String(tag.description ?? "")}\n\n${operationBlocks.join("\n")}`
    );
  }

  return sections.join("\n\n");
}

function renderSchemaAppendix(
  openApi: AnyRecord,
  reachable: Set<string>
): string {
  const schemas = asRecord(asRecord(openApi.components).schemas);
  const names = [...reachable].sort((a, b) => a.localeCompare(b));

  const blocks = names.map((name) => {
    const node = asRecord(schemas[name]);
    if (Object.keys(node).length === 0) {
      return `### Schema: ${name}\n\n_Referenced but not found in \`components.schemas\` — check the contract._\n`;
    }

    const props = asRecord(node.properties);
    const required = new Set(asArray(node.required).map(String));

    let body: string;
    if (Array.isArray(node.enum)) {
      body = `Enum values: ${node.enum.map((v: unknown) => `\`${String(v)}\``).join(", ")}.`;
    } else if (Object.keys(props).length > 0) {
      const rows = Object.entries(props).map(([propName, propNode]) => {
        const rec = asRecord(propNode);
        return [
          `\`${propName}\``,
          schemaSummary(propNode, new Set()),
          required.has(propName) ? "yes" : "no",
          rec.nullable ? "yes" : "no",
          String(rec.description ?? "")
        ];
      });
      body = table(
        ["Field", "Type", "Required", "Nullable", "Description"],
        rows
      );
    } else {
      body = String(node.description ?? "_No properties declared._");
    }

    const example = exampleValue(node, schemas, undefined, 0, new Set([name]));

    return `### Schema: ${name}

${node.description ? `${String(node.description)}\n\n` : ""}${body}

**Example**

${jsonBlock(example)}
`;
  });

  return `## Schema appendix\n\nEvery schema referenced by at least one operation above (excluding the standard envelope schemas, covered in §Standard success/error envelope).\n\n${blocks.join("\n")}`;
}

function renderEvents(asyncApi: AnyRecord): string {
  const channels = asRecord(asyncApi.channels);
  const components = asRecord(asyncApi.components);
  const schemas = asRecord(components.schemas);
  const envelope = asRecord(
    schemas.DomainEventEnvelope ?? schemas.DomainEvent ?? {}
  );
  const securitySchemes = asRecord(components.securitySchemes);

  const envelopeRows = Object.entries(asRecord(envelope.properties)).map(
    ([name, node]) => {
      const rec = asRecord(node);
      const required = asArray(envelope.required).map(String).includes(name);
      const type = Array.isArray(rec.type)
        ? rec.type.join(" | ")
        : String(rec.type ?? "object");
      return [
        `\`${name}\``,
        type,
        required ? "yes" : "no",
        String(rec.description ?? "")
      ];
    }
  );

  const envelopeExample = exampleValue(
    envelope,
    schemas,
    undefined,
    0,
    new Set(["DomainEventEnvelope"])
  );

  const channelNames = Object.keys(channels).sort((a, b) => a.localeCompare(b));
  const channelRows = channelNames.map((address) => {
    const rec = asRecord(channels[address]);
    return `- \`${address}\` — ${String(rec.description ?? "")
      .replace(/\s+/g, " ")
      .trim()}`;
  });

  const hmac = asRecord(securitySchemes.syncHmac);

  return `## Domain events

Every channel below carries the SAME message envelope (\`DomainEvent\` /
\`DomainEventEnvelope\`) — documented once here instead of once per channel.
Producer direction is always \`send\` (this repo publishes events; there is no
consumer/subscriber contract in this file).

### Event envelope

${
  envelopeRows.length > 0
    ? table(["Field", "Type", "Required", "Description"], envelopeRows)
    : "_No named envelope schema found in the AsyncAPI contract._"
}

**Message headers** (HMAC-signed, same scheme as Sync Storage requests${
    hmac.description ? ` — ${String(hmac.description)}` : ""
  }):
\`X-AWCMS-Node-ID\`, \`X-AWCMS-Timestamp\`, \`X-AWCMS-Signature\`.

**Example**

${jsonBlock(envelopeExample)}

### Channels (${channelNames.length})

${channelRows.join("\n")}
`;
}

function findDeprecated(openApi: AnyRecord, asyncApi: AnyRecord): string[] {
  const found: string[] = [];
  const paths = asRecord(openApi.paths);
  for (const [pathKey, pathItem] of Object.entries(paths)) {
    for (const method of HTTP_METHOD_ORDER) {
      const op = asRecord(asRecord(pathItem)[method]);
      if (op.deprecated === true) {
        found.push(
          `- REST: \`${method.toUpperCase()} ${pathKey}\` (\`${String(op.operationId)}\`)`
        );
      }
    }
  }
  const schemas = asRecord(asRecord(openApi.components).schemas);
  for (const [name, node] of Object.entries(schemas)) {
    if (asRecord(node).deprecated === true) {
      found.push(`- Schema: \`${name}\``);
    }
  }
  const channels = asRecord(asyncApi.channels);
  for (const [address, node] of Object.entries(channels)) {
    if (asRecord(node).deprecated === true) {
      found.push(`- Event channel: \`${address}\``);
    }
  }
  return found;
}

function renderDeprecationPolicy(
  openApi: AnyRecord,
  asyncApi: AnyRecord
): string {
  const deprecated = findDeprecated(openApi, asyncApi);
  return `## Compatibility & deprecation policy

Contract changes follow ADR-0008's SemVer rules (independent of the package
release version):

- **PATCH** — description/documentation-only fixes, no schema change.
- **MINOR** — additive, backward-compatible changes (new endpoint/event, new
  optional field/parameter).
- **MAJOR** — breaking changes (removed/renamed field or endpoint, changed
  response shape).

See [\`docs/adr/0008-independent-contract-and-module-versioning.md\`](../adr/0008-independent-contract-and-module-versioning.md)
for the full policy.

**Currently deprecated** (derived from \`deprecated: true\` on any operation,
schema, or event channel in the bundled contracts):

${deprecated.length > 0 ? deprecated.join("\n") : "_None — nothing in the bundled contracts is currently marked deprecated._"}
`;
}

async function loadAsyncApi(rootDir: string): Promise<AnyRecord> {
  const absolutePath = path.join(rootDir, ASYNCAPI_PATH);
  const source = await readFile(absolutePath, "utf8");
  const document = parseDocument(source);
  if (document.errors.length > 0) {
    const messages = document.errors.map((e) => e.message).join("; ");
    throw new Error(`${ASYNCAPI_PATH}: invalid YAML -- ${messages}`);
  }
  return asRecord(document.toJSON());
}

async function buildRawApiReferenceMarkdown(rootDir: string): Promise<string> {
  const openApi = await buildBundledDocument(rootDir);
  const asyncApi = await loadAsyncApi(rootDir);

  const reachable = new Set<string>();

  const header = renderHeader(openApi, asyncApi);
  const conventions = renderConventions(openApi);
  // Operations must render first: schemaSummary() calls inside it populate
  // `reachable`, which the appendix below depends on. The closure then pulls in
  // schemas nested inside those that never appear directly in an operation's
  // own signature.
  const operations = renderOperations(openApi, reachable);
  expandReachableClosure(
    asRecord(asRecord(openApi.components).schemas),
    reachable
  );
  const appendix = renderSchemaAppendix(openApi, reachable);
  const events = renderEvents(asyncApi);
  const deprecation = renderDeprecationPolicy(openApi, asyncApi);

  return (
    [header, conventions, operations, appendix, events, deprecation]
      .join("\n\n")
      .replace(/\n{3,}/g, "\n\n") + "\n"
  );
}

/**
 * Builds the final Markdown, formatted with the project's own Prettier config
 * so the generated artifact already satisfies `bun run lint`. Prettier has no
 * randomness, so this keeps generate-twice-is-byte-identical.
 */
export async function buildApiReferenceMarkdown(
  rootDir = process.cwd()
): Promise<string> {
  const raw = await buildRawApiReferenceMarkdown(rootDir);
  const filepath = path.join(rootDir, API_REFERENCE_PATH);
  const config = (await prettier.resolveConfig(filepath)) ?? {};

  return prettier.format(raw, { ...config, filepath, parser: "markdown" });
}

export async function writeApiReferenceDocs(
  rootDir = process.cwd()
): Promise<string> {
  const content = await buildApiReferenceMarkdown(rootDir);
  await writeFile(path.join(rootDir, API_REFERENCE_PATH), content, "utf8");
  return content;
}

if (import.meta.main) {
  await writeApiReferenceDocs();
  console.log(`api:docs:generate OK — wrote ${API_REFERENCE_PATH}`);
}
