import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { parse as parseYaml } from "yaml";

const OPENAPI_PATH = path.resolve(
  process.cwd(),
  "openapi/awcms-public-api.openapi.yaml"
);
const ASYNCAPI_PATH = path.resolve(
  process.cwd(),
  "asyncapi/awcms-domain-events.asyncapi.yaml"
);
const API_ROUTES_DIR = path.resolve(process.cwd(), "src/pages/api/v1");
const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;

/** Endpoints allowed to declare `security: []` — every other `security: []` operation fails the check. */
const ALLOWED_PUBLIC_OPERATIONS = new Set([
  "getHealth",
  "getSetupStatus",
  "postSetupInitialize",
  "postAuthLogin"
]);

type OpenApiDocument = {
  security?: unknown[];
  paths?: Record<string, Record<string, OpenApiOperation>>;
};

type OpenApiOperation = {
  operationId?: string;
  security?: unknown[];
  parameters?: Array<{ name: string; in: string; required?: boolean }>;
};

const errors: string[] = [];

function fail(message: string): void {
  errors.push(message);
}

function checkOperationIds(doc: OpenApiDocument): void {
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
        fail(`${label}: missing operationId.`);
        continue;
      }

      const existing = seen.get(operation.operationId);

      if (existing) {
        fail(
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
        fail(
          `${label}: declares security: [] but "${operation.operationId}" is not in ALLOWED_PUBLIC_OPERATIONS.`
        );
      }

      // No per-operation `security` means it inherits the document-level
      // default (valid OpenAPI) — only fail when neither is present.
      if (!operation.security && !hasDocumentDefaultSecurity) {
        fail(
          `${label}: must declare a security requirement, or security: [] plus an allow-list entry.`
        );
      }
    }
  }
}

function checkPathParameters(doc: OpenApiDocument): void {
  for (const [routePath, operations] of Object.entries(doc.paths ?? {})) {
    const templateParams = [...routePath.matchAll(/\{([^}]+)\}/g)]
      .map((m) => m[1])
      .filter((param): param is string => param !== undefined);

    for (const [method, operation] of Object.entries(operations)) {
      if (
        !HTTP_METHODS.includes(
          method.toUpperCase() as (typeof HTTP_METHODS)[number]
        )
      )
        continue;

      const declaredParams = (operation.parameters ?? [])
        .filter((p) => p.in === "path")
        .map((p) => p.name);

      for (const templateParam of templateParams) {
        if (!declaredParams.includes(templateParam)) {
          fail(
            `${method.toUpperCase()} ${routePath}: path parameter "{${templateParam}}" has no matching "in: path" parameter.`
          );
        }
      }

      for (const declaredParam of declaredParams) {
        if (!templateParams.includes(declaredParam)) {
          fail(
            `${method.toUpperCase()} ${routePath}: declares path parameter "${declaredParam}" not present in the path template.`
          );
        }
      }
    }
  }
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

function routeFileToTemplate(filePath: string): string {
  const relative = path
    .relative(API_ROUTES_DIR, filePath)
    .replace(/\.ts$/, "")
    .replace(/\/index$/, "")
    .replace(/\[([^\]]+)\]/g, "{$1}");

  return `/api/v1/${relative}`.replace(/\/$/, "") || "/api/v1";
}

async function checkRouteParity(doc: OpenApiDocument): Promise<void> {
  const routeFiles = await discoverRouteFiles(API_ROUTES_DIR);
  const declaredPaths = new Set(Object.keys(doc.paths ?? {}));
  const routeTemplates = new Set(routeFiles.map(routeFileToTemplate));

  for (const template of routeTemplates) {
    if (!declaredPaths.has(template)) {
      fail(
        `Route file resolves to "${template}" but no matching OpenAPI path is declared.`
      );
    }
  }

  for (const declaredPath of declaredPaths) {
    if (!routeTemplates.has(declaredPath)) {
      fail(
        `OpenAPI declares path "${declaredPath}" but no matching route file exists under src/pages/api/v1.`
      );
    }
  }
}

async function main() {
  const [openApiRaw, asyncApiRaw] = await Promise.all([
    readFile(OPENAPI_PATH, "utf8"),
    readFile(ASYNCAPI_PATH, "utf8")
  ]);

  const openApiDoc = parseYaml(openApiRaw) as OpenApiDocument;
  parseYaml(asyncApiRaw);

  checkOperationIds(openApiDoc);
  checkPathParameters(openApiDoc);
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
