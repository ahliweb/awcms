import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import prettier from "prettier";
import { parseDocument, stringify } from "yaml";

/**
 * Issue #182 (epic #177): the public OpenAPI contract is split into source
 * fragments -- one file per base module under `openapi/modules/*.openapi.yaml`
 * (plus a `foundation` fragment for the truly module-less platform ops), plus
 * a root fragment (`openapi/awcms-public-api.src.yaml`) holding the shared
 * `info`/`servers`/`tags`/`security`/`components.securitySchemes`/
 * `components.parameters`/`components.responses`, and any schema shared by 2+
 * modules (or referenced by none). This script merges every fragment into the
 * single published artifact at the SAME path every consumer already uses,
 * `openapi/awcms-public-api.openapi.yaml` -- that file is now GENERATED, never
 * edited by hand (see `openapi/README.md`).
 *
 * Determinism: every fragment is loaded in a fixed, explicitly sorted order
 * (module files sorted by filename, not raw `readdir` order which the
 * filesystem does not guarantee is stable), and every merged object
 * (`paths`, `components.schemas`) has its keys re-sorted alphabetically before
 * serialization. Running this script twice against unchanged sources produces
 * byte-identical output (see `tests/openapi-bundle.test.ts`).
 *
 * Local/offline only: no network access, no external CLI -- just `yaml`
 * parse/stringify over files already in the repo, then Prettier (no
 * randomness) so the generated artifact already satisfies `bun run lint`.
 */

export const ROOT_SRC_PATH = "openapi/awcms-public-api.src.yaml";
export const MODULES_DIR = "openapi/modules";
export const BUNDLED_PATH = "openapi/awcms-public-api.openapi.yaml";

const BUNDLE_HEADER = `# GENERATED FILE -- do not edit by hand.
#
# This is the bundled, published OpenAPI contract, produced by
# \`bun run openapi:bundle\` (scripts/openapi-bundle.ts, Issue #182) from the
# source fragments in ${ROOT_SRC_PATH} and ${MODULES_DIR}/*.openapi.yaml. Edit
# those files, then regenerate this one -- direct edits here are silently
# overwritten and never reviewed as the source of truth.
`;

type AnyRecord = Record<string, unknown>;

/** Thrown when two fragments (or a fragment and the root) collide on a merged key. */
export class BundleConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BundleConflictError";
  }
}

function sortObject<T>(obj: Record<string, T>): Record<string, T> {
  const out: Record<string, T> = {};
  for (const key of Object.keys(obj).sort((a, b) => a.localeCompare(b))) {
    out[key] = obj[key]!;
  }
  return out;
}

function asRecord(value: unknown): AnyRecord {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as AnyRecord;
  }
  return {};
}

async function readYaml(absolutePath: string): Promise<unknown> {
  const source = await readFile(absolutePath, "utf8");
  const document = parseDocument(source);

  if (document.errors.length > 0) {
    const messages = document.errors.map((error) => error.message).join("; ");
    throw new Error(`${absolutePath}: invalid YAML -- ${messages}`);
  }

  return document.toJSON();
}

/**
 * Lists the module fragment file names under `openapi/modules/`, sorted by
 * filename (deterministic — `readdir` order is not guaranteed stable).
 */
export async function listModuleFragmentFiles(
  rootDir = process.cwd()
): Promise<string[]> {
  const entries = await readdir(path.join(rootDir, MODULES_DIR), {
    withFileTypes: true
  });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".openapi.yaml"))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));
}

export type BundleOptions = {
  /**
   * Absolute (or `rootDir`-relative) paths to ADDITIONAL fragment files merged
   * after the base `openapi/modules/*.openapi.yaml` set — a general seam for
   * contributing an extra module fragment (a module's
   * `ModuleDescriptor.api.openApiPath`) WITHOUT editing the base bundle or any
   * base fragment (Issue #182). An extra fragment that redefines a base path
   * or schema throws `BundleConflictError` — it can never silently override the
   * base contract.
   */
  extraFragmentFiles?: string[];
};

/**
 * Reads every `openapi/modules/*.openapi.yaml` fragment (sorted by filename)
 * and the root fragment, and merges them into a single bundled OpenAPI
 * document (as a plain JS object -- not yet serialized). Exported for tests
 * that assert on structure without round-tripping through YAML text. Throws
 * `BundleConflictError` when two fragments collide on the same path or schema.
 */
export async function buildBundledDocument(
  rootDir = process.cwd(),
  options: BundleOptions = {}
): Promise<AnyRecord> {
  const root = asRecord(await readYaml(path.join(rootDir, ROOT_SRC_PATH)));

  const moduleFiles = await listModuleFragmentFiles(rootDir);
  if (moduleFiles.length === 0) {
    throw new Error(`No module fragments found in ${MODULES_DIR}/`);
  }

  const mergedPaths: AnyRecord = {};
  const rootComponents = asRecord(root.components);
  const mergedSchemas: AnyRecord = { ...asRecord(rootComponents.schemas) };
  const rootSchemaNames = new Set(Object.keys(mergedSchemas));
  const pathOwner = new Map<string, string>();
  const schemaOwner = new Map<string, string>();
  for (const name of rootSchemaNames) schemaOwner.set(name, ROOT_SRC_PATH);

  const fragmentSources: Array<{ label: string; absolutePath: string }> = [
    ...moduleFiles.map((fileName) => ({
      label: fileName,
      absolutePath: path.join(rootDir, MODULES_DIR, fileName)
    })),
    ...(options.extraFragmentFiles ?? []).map((filePath) => ({
      label: filePath,
      absolutePath: path.isAbsolute(filePath)
        ? filePath
        : path.join(rootDir, filePath)
    }))
  ];

  for (const { label: fileName, absolutePath } of fragmentSources) {
    const moduleDoc = asRecord(await readYaml(absolutePath));
    const modulePaths = asRecord(moduleDoc.paths);
    const moduleComponents = asRecord(moduleDoc.components);
    const moduleSchemas = asRecord(moduleComponents.schemas);

    // Fail closed: the bundler only carries a fragment's `paths` and
    // `components.schemas` into the bundle. Any OTHER `components` section
    // (responses, parameters, securitySchemes, requestBodies, headers, ...)
    // declared by a fragment would be SILENTLY dropped — a `$ref` to it from a
    // 2xx response then dangles in the bundle and slips past
    // `collectStandardErrorSchemaProblems` (which only guards 4xx/5xx). Reject
    // it explicitly so a contributor gets an actionable error instead
    // of a broken bundle: those sections are root-owned (`awcms-public-api.src.yaml`),
    // or inline the shape into the fragment's own `components.schemas`.
    const unsupportedComponentSections = Object.keys(moduleComponents).filter(
      (section) => section !== "schemas"
    );
    if (unsupportedComponentSections.length > 0) {
      throw new BundleConflictError(
        `Fragment ${fileName} declares unsupported components section(s) [${unsupportedComponentSections.join(
          ", "
        )}]. A fragment may only contribute "paths" and "components.schemas"; reusable responses/parameters/securitySchemes are root-owned (openapi/awcms-public-api.src.yaml) or must be inlined into the fragment's own schemas.`
      );
    }

    for (const [pathKey, pathItem] of Object.entries(modulePaths)) {
      const existing = pathOwner.get(pathKey);
      if (existing !== undefined) {
        throw new BundleConflictError(
          `Duplicate path "${pathKey}" -- defined in ${fileName} and ${existing}. An extra fragment may not override a base path.`
        );
      }
      pathOwner.set(pathKey, fileName);
      mergedPaths[pathKey] = pathItem;
    }

    for (const [schemaName, schemaDef] of Object.entries(moduleSchemas)) {
      const existing = schemaOwner.get(schemaName);
      if (existing !== undefined) {
        throw new BundleConflictError(
          `Duplicate schema "${schemaName}" -- defined in ${fileName} and ${existing}. An extra fragment may not override a base or shared schema.`
        );
      }
      schemaOwner.set(schemaName, fileName);
      mergedSchemas[schemaName] = schemaDef;
    }
  }

  return {
    openapi: root.openapi,
    info: root.info,
    ...(root.servers !== undefined ? { servers: root.servers } : {}),
    tags: root.tags,
    paths: sortObject(mergedPaths),
    components: {
      securitySchemes: rootComponents.securitySchemes,
      parameters: rootComponents.parameters,
      responses: rootComponents.responses,
      schemas: sortObject(mergedSchemas)
    },
    security: root.security
  };
}

export async function bundleOpenApi(rootDir = process.cwd()): Promise<string> {
  const bundled = await buildBundledDocument(rootDir);
  const rawYaml = BUNDLE_HEADER + stringify(bundled, { lineWidth: 0 });

  // Format with the project's own Prettier config so the generated artifact
  // already satisfies `bun run lint` (Prettier checks every `.yaml` file);
  // deterministic given the same input (Prettier has no randomness), so this
  // keeps bundle-twice-is-byte-identical.
  const filepath = path.join(rootDir, BUNDLED_PATH);
  const config = (await prettier.resolveConfig(filepath)) ?? {};

  return prettier.format(rawYaml, { ...config, filepath, parser: "yaml" });
}

export async function writeBundledOpenApi(
  rootDir = process.cwd()
): Promise<string> {
  const yamlText = await bundleOpenApi(rootDir);
  await writeFile(path.join(rootDir, BUNDLED_PATH), yamlText, "utf8");
  return yamlText;
}

if (import.meta.main) {
  await writeBundledOpenApi();
  console.log(`openapi:bundle OK — wrote ${BUNDLED_PATH}`);
}
