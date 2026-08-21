import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { parse as parseYaml } from "yaml";

import { listModules } from "../src/modules";
import {
  bundleOpenApi,
  BUNDLED_PATH,
  listModuleFragmentFiles,
  MODULES_DIR,
  ROOT_SRC_PATH
} from "./openapi-bundle";

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
  // ADR-0088 — the second half of a tenantless login. It carries no session
  // BECAUSE no tenant has been chosen yet, which is the same reason
  // `postAuthMfaVerify` above is public: both are authenticated by possession
  // of a short-lived, single-use token minted by a login that already proved a
  // credential. The bearer it accepts is deliberately NOT a session token, and
  // the authorization chokepoint refuses that bearer kind outright — so listing
  // it here widens nothing a session could reach.
  //
  // `postAuthSessionSwitch` is NOT listed: it requires a live session and is
  // authenticated like any other authorized surface.
  "postAuthSessionTenant",
  // Issue #185 — the OIDC SSO entry points are unauthenticated by design: a
  // fresh browser navigation carries no session yet, and the callback is the
  // IdP's own redirect target. Both are still tenant-bound (via `state`) and
  // rate-limited; the callback trusts nothing until state/nonce/PKCE/ID-token
  // all validate.
  "getAuthSsoStart",
  "getAuthSsoCallback",
  // visitor_analytics (ported from awcms-micro epic #617-#624) — the public
  // visit-ingest beacon is anonymous by design: it carries no session, resolves
  // the tenant from a public tenant code, records only privacy-preserving,
  // anonymized, public-area page views, and is fire-and-forget (always 202).
  "analyticsCollect",
  // newsletter (Issue #598, ADR-0103) — all three subscription endpoints are
  // anonymous by design, and the anonymity is the requirement rather than a
  // shortcut: a reader has no account, and PRD §30 forbids making them get one
  // to stop receiving mail. Each resolves the tenant from the request HOST (so a
  // caller cannot choose whose list they write to), is per-IP rate-limited, and
  // answers the SAME neutral body for every outcome — which is what stops a
  // public endpoint being a way to ask whether a named person subscribes here.
  "newsletterSubscribe",
  "newsletterConfirm",
  "newsletterUnsubscribe",
  // site_search (ADR-0040, ported from awcms-micro Issue #270) — the public
  // search + typeahead endpoints are anonymous by design: a site visitor has no
  // session. Both resolve the tenant from the request HOST (never a
  // client-supplied tenant header), read a projection that contains PUBLISHED
  // PUBLIC content only, are per-IP rate-limited and query-length-bounded, and
  // return the same neutral empty payload for every non-serving outcome.
  "siteSearchQuery",
  "siteSearchSuggest",
  // comments (ADR-0041, ported from awcms-micro Issue #271) — the public
  // comment surface is anonymous by design: a site visitor commenting on an
  // article has no session, and requiring one would make the module useless for
  // the case it exists to serve.
  //
  // What keeps that safe is NOT authentication, so it is worth stating plainly:
  // every one of these resolves the tenant from the request HOST (never a
  // client-supplied tenant header); every one re-confirms the target resource
  // is PUBLISHED and PUBLIC through its owning module's declarative
  // publicationFilter before doing anything; the two write paths are per-IP
  // rate-limited, anti-abuse gated, and Idempotency-Key'd; the read path returns
  // approved rows only, with no moderation metadata; and every non-serving
  // outcome returns one uniform neutral response, so none of them can be used as
  // an existence oracle for unpublished content. The two author-bound
  // operations (edit, delete-request) match a registered author by session user
  // id and an anonymous one by stored IP hash, returning 404 — not 403 — when
  // the caller is not the author, so the endpoint does not confirm that some
  // other author's comment exists.
  "listPublicComments",
  "submitPublicComment",
  "editPublicComment",
  "submitPublicCommentReply",
  "reportPublicComment",
  "requestPublicCommentDeletion",
  // Password recovery (Wave 2 delta auth, adapted from awcms-micro Issue #496)
  // — unauthenticated by definition: the caller cannot sign in, which is the
  // entire premise of the flow. Requiring a session would make it unusable for
  // the only case it exists to serve.
  //
  // What keeps it safe is not authentication: both are tenant-bound, per-IP +
  // per-tenant rate limited, and Turnstile-gated on the full-online profile.
  // `postAuthPasswordForgot` returns ONE fixed 200 body for every outcome, so
  // it is not an account-existence oracle; `postAuthPasswordReset` returns ONE
  // generic rejection for every invalid-token reason, so it is not a
  // token-state oracle. Redemption requires a 256-bit CSPRNG token that is
  // stored only as a sha256 hash, is single-use (enforced with a row lock, not
  // a read-then-write), expires in minutes, and is superseded by the next
  // request. An identity whose tenant disabled password login is refused on
  // BOTH paths, so this is not a way around that policy.
  "postAuthPasswordForgot",
  "postAuthPasswordReset",
  // Self-registration (Wave 2 delta auth) — unauthenticated by definition: an
  // applicant has no account yet, which is the point of the endpoint.
  //
  // What keeps it safe is not authentication: it is OFF unless
  // `AUTH_SELF_REGISTRATION_ENABLED=true` (and answers 404 when off, so the
  // switch is not discoverable), tenant-bound, per-IP + per-tenant rate
  // limited, and Turnstile-gated on the full-online profile. It creates NO
  // account and accepts NO password and NO privilege field — approval is a
  // separate, permissioned admin action. An already-registered address, an
  // already-pending request and a fresh one all return the identical 200, so it
  // is not an account-existence oracle.
  "postAuthRegister",
  // Invitations (ADR-0082, Gelombang 4 PR 4.2) — unauthenticated for the same
  // structural reason self-registration is: the recipient has no account yet,
  // which is what the invitation exists to change. `getAuthInvitationPreview`
  // renders the page; `postAuthInvitationAccept` creates the membership.
  //
  // What keeps them safe is not authentication:
  //
  // Nobody reaches either without a 256-bit CSPRNG token that is stored only as
  // a sha256 hash, is single-use, expires, and is ROTATED by every resend — so
  // an invitation cannot be issued by anyone but a holder of
  // `identity_access.invitations.create`, and a superseded link is dead.
  //
  // Both are tenant-bound and rate-limited through `checkAuthRateLimit`, whose
  // SOURCE ceiling is keyed on something the caller cannot choose (#447), and
  // the accept path is additionally Turnstile-gated with its OWN action so a
  // token solved on the login form cannot be spent here.
  //
  // Neither is an oracle. Unknown, revoked, already-accepted, expired and
  // wrong-tenant all answer one identical 404 — 404 rather than 410, because
  // 410 would say the token was once valid. The preview returns the tenant name
  // and the inviter's name and NEVER the invited address.
  //
  // Acceptance accepts no privilege field: what the invitee may hold was
  // decided by the administrator who invited them and is read from
  // `awcms_invitation_policies`. It grants no `is_system` role — checked at
  // issue AND re-checked here — and it issues NO SESSION, so the tenant's MFA
  // policy, its SSO-only policy and the login rate limit all still stand
  // between the new account and a signed-in browser.
  "getAuthInvitationPreview",
  "postAuthInvitationAccept"
]);

/**
 * Bundle paths deliberately NOT backed by a route file under
 * `src/pages/api/v1` (internal/feature-flag-gated, reviewed) — empty today.
 * Every entry is an explicit, reviewed exception to route↔contract parity.
 */
const ROUTE_PARITY_EXEMPTIONS = new Set<string>([]);

type OpenApiDocument = {
  security?: unknown[];
  tags?: unknown[];
  paths?: Record<string, Record<string, OpenApiOperation>>;
  components?: {
    responses?: Record<string, unknown>;
    schemas?: Record<string, unknown>;
  };
};

type OpenApiOperation = {
  operationId?: string;
  tags?: unknown[];
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
    const media = asRecord(
      content["application/json"] ?? Object.values(content)[0]
    );
    const schema = media.schema;
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

/**
 * Tag catalog integrity, both directions.
 *
 * The generated reference document (`scripts/api-docs-generate.ts`) groups
 * operations by the tags DECLARED in the root catalog: an operation carrying a
 * tag nobody declared is silently absent from every section, and a declared tag
 * nobody carries silently documents a surface that no longer exists. Both
 * failure modes shipped at once — `blog_content`'s 30 REST paths were tagged
 * `Blog Content`, a tag the root catalog never declared, so the reference
 * document had no Blog Content section at all while still advertising two
 * `News Portal` tags for a module ADR-0044 retired. Nothing was red.
 *
 * Hence three rules, not one: every operation is tagged, every operation tag is
 * declared, and every declared tag is carried. Dropping the third would let the
 * catalog keep naming retired surfaces, which is exactly half of what happened.
 */
export function collectTagCatalogProblems(doc: OpenApiDocument): string[] {
  const problems: string[] = [];
  const declared = new Map<string, number>();

  for (const tag of doc.tags ?? []) {
    const name = asRecord(tag).name;
    if (typeof name !== "string" || name.length === 0) {
      problems.push("Root tag catalog contains an entry without a name.");
      continue;
    }
    if (declared.has(name)) {
      problems.push(`Root tag catalog declares "${name}" more than once.`);
      continue;
    }
    declared.set(name, 0);
  }

  for (const [routePath, operations] of Object.entries(doc.paths ?? {})) {
    for (const [method, operation] of Object.entries(operations)) {
      if (
        !HTTP_METHODS.includes(
          method.toUpperCase() as (typeof HTTP_METHODS)[number]
        )
      )
        continue;

      const label = `${method.toUpperCase()} ${routePath}`;
      const tags = Array.isArray(operation.tags) ? operation.tags : [];

      if (tags.length === 0) {
        problems.push(
          `${label}: declares no tag, so it is absent from every section of the generated API reference.`
        );
        continue;
      }

      for (const rawTag of tags) {
        const tag = String(rawTag);
        const uses = declared.get(tag);
        if (uses === undefined) {
          problems.push(
            `${label}: tag "${tag}" is not declared in the root tag catalog (${ROOT_SRC_PATH}) — the generated API reference drops this operation entirely.`
          );
          continue;
        }
        declared.set(tag, uses + 1);
      }
    }
  }

  for (const [tag, uses] of declared) {
    if (uses === 0) {
      problems.push(
        `Root tag catalog declares "${tag}" but no operation carries it — remove it, or the contract keeps advertising a surface that no longer exists.`
      );
    }
  }

  return problems;
}

/**
 * One fragment file per REGISTERED module (ADR-0026), enforced both ways.
 *
 * `ModuleDescriptor.api.openApiPath` was never checked against the filesystem,
 * so two modules could (and did) point at the generated BUNDLE instead of their
 * own fragment — which both overstates what they declare and leaves their real
 * fragment claimed by nobody. That is how `openapi/modules/news-portal.openapi.yaml`
 * outlived the module ADR-0044 retired: no rule connected fragments to the
 * registry in either direction.
 *
 * `MODULE_LESS_FRAGMENTS` is the reviewed exception list — platform surfaces
 * that genuinely belong to no module.
 */
const MODULE_LESS_FRAGMENTS = new Set(["foundation.openapi.yaml"]);

export function collectFragmentOwnershipProblems(
  modules: readonly { key: string; api?: { openApiPath?: string } }[],
  fragmentFiles: readonly string[]
): string[] {
  const problems: string[] = [];
  const available = new Set(fragmentFiles);
  const claimedBy = new Map<string, string[]>();

  for (const module of modules) {
    const declaredPath = module.api?.openApiPath;
    if (declaredPath === undefined) continue;

    if (declaredPath === BUNDLED_PATH) {
      problems.push(
        `Module "${module.key}" points api.openApiPath at the generated bundle (${BUNDLED_PATH}) instead of its own fragment under ${MODULES_DIR}/.`
      );
      continue;
    }

    const prefix = `${MODULES_DIR}/`;
    if (!declaredPath.startsWith(prefix)) {
      problems.push(
        `Module "${module.key}" declares api.openApiPath "${declaredPath}", which is not under ${MODULES_DIR}/.`
      );
      continue;
    }

    const fileName = declaredPath.slice(prefix.length);
    if (!available.has(fileName)) {
      problems.push(
        `Module "${module.key}" declares api.openApiPath "${declaredPath}" but that fragment file does not exist.`
      );
      continue;
    }

    claimedBy.set(fileName, [...(claimedBy.get(fileName) ?? []), module.key]);
  }

  for (const [fileName, owners] of claimedBy) {
    if (owners.length > 1) {
      problems.push(
        `Fragment "${MODULES_DIR}/${fileName}" is claimed by more than one module (${owners.sort().join(", ")}).`
      );
    }
  }

  for (const fileName of fragmentFiles) {
    if (MODULE_LESS_FRAGMENTS.has(fileName)) continue;
    if (!claimedBy.has(fileName)) {
      problems.push(
        `Fragment "${MODULES_DIR}/${fileName}" is claimed by no registered module — either a module must declare it via api.openApiPath, or the fragment belongs to a module that no longer exists and must be merged into its successor's fragment.`
      );
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
  for (const problem of collectTagCatalogProblems(openApiDoc)) fail(problem);
  for (const problem of collectFragmentOwnershipProblems(
    listModules(),
    await listModuleFragmentFiles()
  )) {
    fail(problem);
  }
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
