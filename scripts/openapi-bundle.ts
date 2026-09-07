import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import prettier from "prettier";
import { isPair, isScalar, parseDocument, stringify, visit } from "yaml";
import type { Document, Scalar } from "yaml";

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

/**
 * Thrown when a fragment contains an unquoted (plain) YAML scalar that the
 * parser silently truncated at a whitespace-preceded `#` (Issue #786). YAML's
 * plain-scalar grammar treats ` #' as a comment start wherever it appears —
 * including in the middle of prose like "Issue #591 — when the...". This has
 * already bitten three PRs (#784, #789, #787) whose authors happened to
 * mention their own issue number in an unquoted `description`/`summary` and
 * had to hand-quote it reactively; other pre-existing instances went
 * unnoticed for releases because the bundler emitted the truncated text
 * without complaint.
 *
 * Detection uses the YAML library's OWN attribution rather than a text
 * heuristic: for a PLAIN-style `Scalar` node, `yaml` parses everything after
 * a whitespace-preceded `#` as that node's trailing `.comment` (verified
 * against `yaml@2.9.0`) — so a plain scalar with a non-empty same-line
 * `.comment` is *exactly* the shape of this bug, and nothing else. A survey
 * of every fragment in this repo at the time this check was added found
 * zero legitimate same-line trailing comments (every genuine comment in
 * these files starts its own line, which `yaml` attributes as
 * `commentBefore` on the NEXT node, never as `.comment` on the scalar
 * itself) — so this check has no known false-positive shape to guard
 * against; if a future fragment legitimately needs a same-line comment next
 * to a plain scalar, quoting the scalar (as this error demands) is also the
 * correct fix, since it disambiguates "comment" from "value" for any reader.
 */
export class TruncatedScalarError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TruncatedScalarError";
  }
}

/**
 * Walks a parsed fragment's AST for plain scalars silently truncated by a
 * `#` comment, and throws `TruncatedScalarError` naming the file and the
 * dotted key path so a contributor can find and quote the offending line.
 */
function assertNoTruncatedScalars(
  document: Document,
  absolutePath: string
): void {
  visit(document, {
    Scalar(_key, node, ancestors) {
      const scalar = node as Scalar;
      if (
        scalar.type !== "PLAIN" ||
        typeof scalar.comment !== "string" ||
        scalar.comment.trim().length === 0
      ) {
        return;
      }
      const keyPath: string[] = [];
      for (const ancestor of ancestors) {
        if (isPair(ancestor) && isScalar(ancestor.key)) {
          keyPath.push(String((ancestor.key as Scalar).value));
        }
      }
      const location = keyPath.length > 0 ? keyPath.join(".") : "(top level)";
      throw new TruncatedScalarError(
        `${absolutePath}: the scalar at "${location}" looks truncated at " #" -- ` +
          `YAML parsed its value as ${JSON.stringify(scalar.value)} and silently ` +
          `dropped ${JSON.stringify(
            scalar.comment.trim()
          )} as a comment. If that text was meant to be part of the value ` +
          `(e.g. prose mentioning an issue number like "Issue #591"), quote the ` +
          `whole scalar with double quotes so "#" is no longer a comment marker.`
      );
    }
  });
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

  assertNoTruncatedScalars(document, absolutePath);

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
