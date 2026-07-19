import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { parse as parseYaml } from "yaml";

import { bundleOpenApi, BUNDLED_PATH } from "./openapi-bundle";

const OPENAPI_PATH = path.resolve(process.cwd(), BUNDLED_PATH);
export const ASYNCAPI_PATH = "asyncapi/awcms-domain-events.asyncapi.yaml";
const ASYNCAPI_ABS_PATH = path.resolve(process.cwd(), ASYNCAPI_PATH);
const API_ROUTES_DIR = path.resolve(process.cwd(), "src/pages/api/v1");
const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;

/** Endpoints allowed to declare `security: []` — every other `security: []` operation fails the check. */
const ALLOWED_PUBLIC_OPERATIONS = new Set([
  "getHealth",
  "getDatabasePoolHealth",
  "getSetupStatus",
  "postSetupInitialize",
  "postAuthLogin",
  "postAuthMfaVerify",
  // Issue #185 — the OIDC SSO entry points are unauthenticated by design: a
  // fresh browser navigation carries no session yet, and the callback is the
  // IdP's own redirect target. Both are still tenant-bound (via `state`) and
  // rate-limited; the callback trusts nothing until state/nonce/PKCE/ID-token
  // all validate.
  "getAuthSsoStart",
  "getAuthSsoCallback"
]);

/**
 * Bundle paths deliberately NOT backed by a route file under
 * `src/pages/api/v1` (internal/feature-flag-gated, reviewed) — empty today.
 * Every entry is an explicit, reviewed exception to route↔contract parity.
 */
const ROUTE_PARITY_EXEMPTIONS = new Set<string>([]);

type OpenApiDocument = {
  security?: unknown[];
  paths?: Record<string, Record<string, OpenApiOperation>>;
  components?: {
    responses?: Record<string, unknown>;
    schemas?: Record<string, unknown>;
  };
};

type OpenApiOperation = {
  operationId?: string;
  security?: unknown[];
  parameters?: Array<{ name: string; in: string; required?: boolean }>;
  responses?: Record<string, unknown>;
};

const errors: string[] = [];

function fail(message: string): void {
  errors.push(message);
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function refName(node: unknown): string | undefined {
  const ref = asRecord(node).$ref;
  return typeof ref === "string" ? ref.split("/").pop() : undefined;
}

/**
 * Pure gate: unique operationId, explicit security, and `security: []` only via
 * the reviewed allow-list. Exported so mutation tests can drive the REAL gate
 * logic with a synthetic (e.g. duplicate-operationId) document.
 */
export function collectOperationIdProblems(doc: OpenApiDocument): string[] {
  const problems: string[] = [];
  const seen = new Map<string, string>();
  const hasDocumentDefaultSecurity =
    Array.isArray(doc.security) && doc.security.length > 0;

  for (const [routePath, operations] of Object.entries(doc.paths ?? {})) {
    for (const [method, operation] of Object.entries(operations)) {
      if (
        !HTTP_METHODS.includes(
          method.toUpperCase() as (typeof HTTP_METHODS)[number]
        )
      )
        continue;

      const label = `${method.toUpperCase()} ${routePath}`;

      if (!operation.operationId) {
        problems.push(`${label}: missing operationId.`);
        continue;
      }

      const existing = seen.get(operation.operationId);

      if (existing) {
        problems.push(
          `Duplicate operationId "${operation.operationId}" (${existing} and ${label}).`
        );
      } else {
        seen.set(operation.operationId, label);
      }

      if (
        operation.security &&
        operation.security.length === 0 &&
        !ALLOWED_PUBLIC_OPERATIONS.has(operation.operationId)
      ) {
        problems.push(
          `${label}: declares security: [] but "${operation.operationId}" is not in ALLOWED_PUBLIC_OPERATIONS.`
        );
      }

      // No per-operation `security` means it inherits the document-level
      // default (valid OpenAPI) — only fail when neither is present.
      if (!operation.security && !hasDocumentDefaultSecurity) {
        problems.push(
          `${label}: must declare a security requirement, or security: [] plus an allow-list entry.`
        );
      }
    }
  }

  return problems;
}

/** Every `security: []` allow-list entry must correspond to a real public operation. */
function checkPublicAllowListUsed(doc: OpenApiDocument): void {
  const publicOperationIds = new Set<string>();
  for (const operations of Object.values(doc.paths ?? {})) {
    for (const [method, operation] of Object.entries(operations)) {
      if (
        !HTTP_METHODS.includes(
          method.toUpperCase() as (typeof HTTP_METHODS)[number]
        )
      )
        continue;
      if (
        operation.operationId &&
        Array.isArray(operation.security) &&
        operation.security.length === 0
      ) {
        publicOperationIds.add(operation.operationId);
      }
    }
  }

  for (const allowed of ALLOWED_PUBLIC_OPERATIONS) {
    if (!publicOperationIds.has(allowed)) {
      fail(
        `ALLOWED_PUBLIC_OPERATIONS lists "${allowed}" but no operation declares security: [] with that operationId (stale allow-list entry).`
      );
    }
  }
}

export function collectPathParameterProblems(doc: OpenApiDocument): string[] {
  const problems: string[] = [];
  for (const [routePath, pathItem] of Object.entries(doc.paths ?? {})) {
    const templateParams = [...routePath.matchAll(/\{([^}]+)\}/g)]
      .map((m) => m[1])
      .filter((param): param is string => param !== undefined);

    // Path-item-level `parameters` (valid OpenAPI, shared by every method under
    // this path) count as declared for ALL operations — otherwise a contributor
    // who factors a common `{id}` param up to the path item gets a false
    // "no matching in: path parameter". `parameters` is not in the method map,
    // so read it off the raw path-item record.
    const pathLevelParams = (
      (pathItem as { parameters?: OpenApiOperation["parameters"] })
        .parameters ?? []
    )
      .filter((p) => p.in === "path")
      .map((p) => p.name);

    for (const [method, operation] of Object.entries(pathItem)) {
      if (
        !HTTP_METHODS.includes(
          method.toUpperCase() as (typeof HTTP_METHODS)[number]
        )
      )
        continue;

      const declaredParams = [
        ...pathLevelParams,
        ...(operation.parameters ?? [])
          .filter((p) => p.in === "path")
          .map((p) => p.name)
      ];

      for (const templateParam of templateParams) {
        if (!declaredParams.includes(templateParam)) {
          problems.push(
            `${method.toUpperCase()} ${routePath}: path parameter "{${templateParam}}" has no matching "in: path" parameter.`
          );
        }
      }

      for (const declaredParam of declaredParams) {
        if (!templateParams.includes(declaredParam)) {
          problems.push(
            `${method.toUpperCase()} ${routePath}: declares path parameter "${declaredParam}" not present in the path template.`
          );
        }
      }
    }
  }
  return problems;
}

/**
 * Every non-2xx/3xx response must resolve — directly, via
 * `components.responses`, or through `allOf`/`oneOf`/`anyOf` — to the shared
 * `ApiError` schema (`src/modules/_shared/api-response.ts`'s `fail()`
 * envelope), never an ad-hoc inline error shape. This is what makes the split
 * safe: a fragment cannot introduce a bespoke error body that drifts from the
 * standard envelope without this gate catching it.
 */
export function collectStandardErrorSchemaProblems(
  doc: OpenApiDocument
): string[] {
  const problems: string[] = [];
  const componentResponses = asRecord(doc.components?.responses);
  const schemas = asRecord(doc.components?.schemas);

  function schemaReachesApiError(node: unknown, seen: Set<string>): boolean {
    const name = refName(node);
    if (name) {
      if (name === "ApiError") return true;
      if (seen.has(name)) return false;
      seen.add(name);
      return schemaReachesApiError(schemas[name], seen);
    }
    const rec = asRecord(node);
    for (const key of ["allOf", "oneOf", "anyOf"] as const) {
      const members = rec[key];
      if (Array.isArray(members)) {
        if (members.some((m) => schemaReachesApiError(m, seen))) return true;
      }
    }
    return false;
  }

  function responseResolvesToApiError(responseNode: unknown): boolean {
    let node = responseNode;
    const name = refName(responseNode);
    if (name && componentResponses[name] !== undefined) {
      node = componentResponses[name];
    }
    const content = asRecord(asRecord(node).content);
    const media =
      asRecord(content["application/json"]) ?? Object.values(content)[0];
    const schema = asRecord(media).schema;
    if (schema === undefined) return false;
    return schemaReachesApiError(schema, new Set());
  }

  for (const [routePath, operations] of Object.entries(doc.paths ?? {})) {
    for (const [method, operation] of Object.entries(operations)) {
      if (
        !HTTP_METHODS.includes(
          method.toUpperCase() as (typeof HTTP_METHODS)[number]
        )
      )
        continue;

      for (const [status, responseNode] of Object.entries(
        operation.responses ?? {}
      )) {
        const isError = status === "default" || /^[45]/.test(status);
        if (!isError) continue;
        if (!responseResolvesToApiError(responseNode)) {
          problems.push(
            `${method.toUpperCase()} ${routePath}: response "${status}" does not resolve to the shared ApiError envelope.`
          );
        }
      }
    }
  }

  return problems;
}

async function discoverRouteFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const entryPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      files.push(...(await discoverRouteFiles(entryPath)));
    } else if (entry.isFile() && entry.name.endsWith(".ts")) {
      files.push(entryPath);
    }
  }

  return files;
}

export function routeFileToTemplate(filePath: string): string {
  const relative = path
    .relative(API_ROUTES_DIR, filePath)
    .replace(/\.ts$/, "")
    .replace(/\/index$/, "")
    .replace(/\[([^\]]+)\]/g, "{$1}");

  return `/api/v1/${relative}`.replace(/\/$/, "") || "/api/v1";
}

/**
 * Pure bidirectional route↔contract parity: every route file resolves to a
 * declared bundle path, and every declared bundle path has a route file (or an
 * explicit `ROUTE_PARITY_EXEMPTIONS` entry). Exported so mutation tests can
 * remove a route template (route deleted) or a declared path (fragment
 * removed) and assert the gate goes red.
 */
export function collectRouteParityProblems(
  declaredPaths: Set<string>,
  routeTemplates: Set<string>
): string[] {
  const problems: string[] = [];

  for (const template of routeTemplates) {
    if (!declaredPaths.has(template)) {
      problems.push(
        `Route file resolves to "${template}" but no matching OpenAPI path is declared (add an operation to the owning module fragment, then re-run \`bun run openapi:bundle\`).`
      );
    }
  }

  for (const declaredPath of declaredPaths) {
    if (
      !routeTemplates.has(declaredPath) &&
      !ROUTE_PARITY_EXEMPTIONS.has(declaredPath)
    ) {
      problems.push(
        `OpenAPI declares path "${declaredPath}" but no matching route file exists under src/pages/api/v1 (and it is not in ROUTE_PARITY_EXEMPTIONS).`
      );
    }
  }

  return problems;
}

async function checkRouteParity(doc: OpenApiDocument): Promise<void> {
  const routeFiles = await discoverRouteFiles(API_ROUTES_DIR);
  const declaredPaths = new Set(Object.keys(doc.paths ?? {}));
  const routeTemplates = new Set(routeFiles.map(routeFileToTemplate));
  for (const problem of collectRouteParityProblems(
    declaredPaths,
    routeTemplates
  )) {
    fail(problem);
  }
}

/**
 * The committed bundle must byte-match what `bun run openapi:bundle` produces
 * right now from the source fragments — so a fragment edit without a
 * regenerated bundle (or a hand-edited bundle) fails the build. `bundleOpenApi`
 * also throws `BundleConflictError` on a duplicate path/schema across fragments
 * (including a derived fragment trying to override a base path/operation/schema),
 * surfaced here as a spec-check failure.
 */
async function checkBundleFreshness(): Promise<void> {
  let fresh: string;
  try {
    fresh = await bundleOpenApi();
  } catch (error) {
    fail(
      `openapi:bundle failed to build from fragments — ${
        error instanceof Error ? error.message : String(error)
      }`
    );
    return;
  }

  let committed: string;
  try {
    committed = await readFile(OPENAPI_PATH, "utf8");
  } catch {
    fail(
      `${BUNDLED_PATH} is missing — run \`bun run openapi:bundle\` and commit the result.`
    );
    return;
  }

  if (fresh !== committed) {
    fail(
      `${BUNDLED_PATH} is stale relative to the source fragments — run \`bun run openapi:bundle\` and commit the result.`
    );
  }
}

async function main() {
  await checkBundleFreshness();

  const [openApiRaw, asyncApiRaw] = await Promise.all([
    readFile(OPENAPI_PATH, "utf8"),
    readFile(ASYNCAPI_ABS_PATH, "utf8")
  ]);

  const openApiDoc = parseYaml(openApiRaw) as OpenApiDocument;
  parseYaml(asyncApiRaw);

  for (const problem of collectOperationIdProblems(openApiDoc)) fail(problem);
  checkPublicAllowListUsed(openApiDoc);
  for (const problem of collectPathParameterProblems(openApiDoc)) fail(problem);
  for (const problem of collectStandardErrorSchemaProblems(openApiDoc)) {
    fail(problem);
  }
  await checkRouteParity(openApiDoc);

  if (errors.length > 0) {
    console.error(`api:spec:check failed — ${errors.length} issue(s):`);
    for (const error of errors) console.error(`  - ${error}`);
    process.exitCode = 1;
    return;
  }

  console.log("api:spec:check passed.");
}

if (import.meta.main) {
  await main();
}
