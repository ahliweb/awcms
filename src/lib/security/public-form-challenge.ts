/**
 * The public-form challenge (captcha) SEAM (Issue #1353).
 *
 * A pre-session form (login, forgot/reset password, register, invitation
 * accept, platform setup, and any module's own public form) opts into a
 * human-presence challenge with ONE call:
 *
 *   const refused = await enforcePublicFormCaptcha(request, "my_form", body);
 *   if (refused) return refused;
 *
 * and no edit to a shared file. Providers are declared by modules in their
 * descriptor (`ModuleDescriptor.publicFormChallengeProviders`, ADR-0164's
 * model) and resolved here on demand from the extension-point source the web
 * composition root (`src/middleware.ts`) installed. The platform ships exactly
 * one provider: Cloudflare Turnstile (`identity-access`), whose former
 * per-route call sites now go through this seam, so there is ONE path.
 *
 * Contract, in the order it is enforced:
 *  - OFF by default. No declared provider switched on by its own
 *    `isEnabled(env)` means "return null", behaviour exactly as before.
 *  - More than one enabled provider is a configuration error: REFUSE.
 *  - FAIL-CLOSED. A missing token, a refusing verifier, a verifier that THROWS,
 *    one that does not answer within the deadline, and one that returns
 *    anything but `{ ok: true }` all refuse the request.
 *  - SINGLE-USE. A presented token is burned (hashed, bounded, per process)
 *    BEFORE the verifier is asked, so a replay is refused even when two
 *    requests race, and a refused or failed attempt cannot be retried with the
 *    same token (no answer brute-forcing against one challenge). The burn
 *    cannot span processes: the provider's own `verify` is the source of truth
 *    for single-use, this is defence in depth.
 *  - BOUND to form + tenant: both are passed to `verify`, which must refuse a
 *    token issued for another form or tenant.
 *  - NO ORACLE. Every refusal other than "nothing presented" is ONE response
 *    (same code, same message): wrong form, wrong tenant, replay, expired,
 *    verifier error and timeout are indistinguishable to the caller.
 *
 * The rate limit of each route is the PRIMARY control and runs before this; the
 * seam never replaces or relaxes it. The token is never logged.
 */
// Binds the web-only verifiers of providers whose secrets must not reach a job.
import "./public-form-challenge-bindings";
import { log } from "../logging/logger";
import { fail } from "../../modules/_shared/api-response";
import { challengeRoutePatternToRegExp } from "../../modules/_shared/extension-point-declarations";
import { requireExtensionPointModules } from "../../modules/_shared/extension-point-source";
import type {
  ModulePublicFormChallengeProvider,
  PublicFormChallenge,
  PublicFormChallengeFields
} from "../../modules/_shared/public-form-challenge-contract";
import { resolveClientIp } from "./rate-limit";

// The names live in a dependency-free module so a descriptor and a gate can use
// them without reaching this file (and `turnstile.ts`'s web-only secret).
import { PUBLIC_FORM_NAMES } from "../../modules/_shared/public-form-names";

export { PUBLIC_FORM_NAMES };

const DEFAULT_REQUIRED_CODE = "CHALLENGE_REQUIRED";
const DEFAULT_INVALID_CODE = "CHALLENGE_INVALID";
const DEFAULT_REQUIRED_MESSAGE =
  "A verification challenge response is required.";
const DEFAULT_INVALID_MESSAGE = "Verification challenge failed.";

/** A verifier that does not answer by this deadline refuses the request. */
export const PUBLIC_FORM_CHALLENGE_TIMEOUT_MS = 10_000;
/** Longest field value the seam will hash or forward; longer is refused outright (bounds memory and CPU on an unauthenticated path). */
const MAX_FIELD_LENGTH = 4_096;
/** Bounded per-process burned-token memory. */
export const PUBLIC_FORM_CHALLENGE_BURN_CAPACITY = 10_000;
const BURN_TTL_MS = 15 * 60_000;

export type PublicFormCaptchaOptions = {
  /** The tenant the form belongs to. Default: the `x-awcms-tenant-id` header, or `null` when absent. Pass `null` explicitly for a tenant-less form. */
  tenantId?: string | null;
  /** Default: `resolveClientIp(request)`. */
  clientIp?: string;
  env?: NodeJS.ProcessEnv;
  now?: () => number;
  /** Test seam: the verifier deadline. Production uses `PUBLIC_FORM_CHALLENGE_TIMEOUT_MS`. */
  timeoutMs?: number;
};

type ActiveProvider =
  | { kind: "none" }
  | { kind: "ambiguous"; provider: ModulePublicFormChallengeProvider }
  | { kind: "one"; provider: ModulePublicFormChallengeProvider };

function declaredProviders(): readonly ModulePublicFormChallengeProvider[] {
  return requireExtensionPointModules("The public-form challenge seam").flatMap(
    (module) => module.publicFormChallengeProviders ?? []
  );
}

/**
 * Which provider is switched on in `env`. THROWS
 * (`ExtensionPointSourceNotInstalledError`, ADR-0164) in a process that
 * installed no extension-point source: such a process cannot know whether a
 * challenge is required, and "no providers" would be fail-OPEN (a Turnstile
 * deployment whose composition root forgot the install would stop challenging).
 * `enforcePublicFormCaptcha` turns that into a refusal. The web entry installs
 * the source and `extension-points:check` keeps that true; a test that calls a
 * route handler directly gets it from the `bunfig.toml` test preload.
 */
export function resolveActivePublicFormChallengeProvider(
  env: NodeJS.ProcessEnv = process.env
): ActiveProvider {
  const enabled: ModulePublicFormChallengeProvider[] = [];

  for (const provider of declaredProviders()) {
    let on: boolean;

    try {
      on = provider.isEnabled(env);
    } catch {
      // A provider that cannot even say whether it is on is not trusted to be
      // off: fail closed rather than skip the challenge.
      log("warning", "public_form_challenge.is_enabled_threw", {
        provider: provider.key
      });
      return { kind: "ambiguous", provider };
    }

    if (on) {
      enabled.push(provider);
    }
  }

  if (enabled.length === 0) {
    return { kind: "none" };
  }

  if (enabled.length > 1) {
    log("warning", "public_form_challenge.multiple_providers_enabled", {
      providers: enabled.map((provider) => provider.key)
    });
    return {
      kind: "ambiguous",
      provider: enabled[0] as ModulePublicFormChallengeProvider
    };
  }

  return {
    kind: "one",
    provider: enabled[0] as ModulePublicFormChallengeProvider
  };
}

// --- burned tokens ----------------------------------------------------------

const burned = new Map<string, number>();

function burnKey(parts: readonly string[]): string {
  const hasher = new Bun.CryptoHasher("sha256");

  // Length-prefixed: a separator byte alone would let a value that CONTAINS the
  // separator collide with a different split of the same bytes, and the fields
  // are attacker-supplied JSON strings.
  for (const part of parts) {
    hasher.update(`${part.length}:`);
    hasher.update(part);
  }

  return hasher.digest("hex");
}

/** Synchronous, so two racing requests cannot both claim the same token. Returns false when it was already burned. */
function claim(key: string, nowMs: number): boolean {
  const existing = burned.get(key);

  if (existing !== undefined && existing > nowMs) {
    return false;
  }

  burned.delete(key);

  // Evict expired entries from the front (insertion order = expiry order, the
  // TTL is constant), then the oldest if still full.
  for (const [oldKey, expiry] of burned) {
    if (expiry > nowMs && burned.size < PUBLIC_FORM_CHALLENGE_BURN_CAPACITY) {
      break;
    }

    burned.delete(oldKey);
  }

  burned.set(key, nowMs + BURN_TTL_MS);
  return true;
}

/** Test seam only. */
export function resetPublicFormChallengeForTests(): void {
  burned.clear();
}

// --- request reading --------------------------------------------------------

function readString(source: unknown, name: string): string | undefined {
  if (typeof source !== "object" || source === null) {
    return undefined;
  }

  const value = (source as Record<string, unknown>)[name];

  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function normaliseTenant(raw: string | null | undefined): string | null {
  const trimmed = raw?.trim();

  return trimmed ? trimmed : null;
}

function refusal(
  provider: ModulePublicFormChallengeProvider | null,
  kind: "required" | "invalid"
): Response {
  const text = provider?.refusal ?? {};

  return kind === "required"
    ? fail(
        400,
        text.requiredCode ?? DEFAULT_REQUIRED_CODE,
        text.requiredMessage ?? DEFAULT_REQUIRED_MESSAGE
      )
    : fail(
        400,
        text.invalidCode ?? DEFAULT_INVALID_CODE,
        text.invalidMessage ?? DEFAULT_INVALID_MESSAGE
      );
}

function safeReasonCode(reason: unknown): string {
  return typeof reason === "string" && /^[a-z][a-z0-9_]{0,39}$/.test(reason)
    ? reason
    : "unspecified";
}

async function withDeadline<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("deadline")), ms);
      })
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The one call a public form makes. Returns `null` to proceed, or the refusal
 * `Response` to return as-is. See the file header for the contract.
 *
 * `body` is the already-parsed JSON body, typed `unknown`: it is untrusted.
 */
export async function enforcePublicFormCaptcha(
  request: Request,
  formName: string,
  body: unknown,
  options: PublicFormCaptchaOptions = {}
): Promise<Response | null> {
  const env = options.env ?? process.env;
  let active: ActiveProvider;

  try {
    active = resolveActivePublicFormChallengeProvider(env);
  } catch {
    // No extension-point source (a composition root that forgot to install it):
    // fail closed. Which provider would have applied is unknowable here.
    log("error", "public_form_challenge.source_not_installed", { formName });
    return refusal(null, "invalid");
  }

  if (active.kind === "none") {
    return null;
  }

  if (active.kind === "ambiguous") {
    // The refusal text of the provider that triggered it, so a caller cannot
    // tell a configuration fault from an ordinary refusal by its wording.
    return refusal(active.provider, "invalid");
  }

  const { provider } = active;
  const tenantId =
    options.tenantId !== undefined
      ? normaliseTenant(options.tenantId)
      : normaliseTenant(request.headers.get("x-awcms-tenant-id"));

  const challengeId = readString(body, "challengeId");
  const challengeAnswer = readString(body, "challengeAnswer");
  const challengeToken =
    readString(body, "challengeToken") ??
    (provider.legacyTokenField
      ? readString(body, provider.legacyTokenField)
      : undefined);

  if (
    challengeToken === undefined &&
    (challengeId === undefined || challengeAnswer === undefined)
  ) {
    return refusal(provider, "required");
  }

  if (
    [challengeId, challengeAnswer, challengeToken].some(
      (value) => value !== undefined && value.length > MAX_FIELD_LENGTH
    )
  ) {
    return refusal(provider, "invalid");
  }

  const nowMs = (options.now ?? Date.now)();

  // Burn BEFORE verifying; see the header. The key is independent of the form
  // and tenant on purpose: a token spent on one form is spent on every form.
  const burnedNow = claim(
    burnKey([provider.key, challengeId ?? "", challengeToken ?? ""]),
    nowMs
  );

  if (!burnedNow) {
    log("warning", "public_form_challenge.refused", {
      provider: provider.key,
      formName,
      reason: "replay"
    });
    return refusal(provider, "invalid");
  }

  try {
    const result = await withDeadline(
      provider.verify({
        token: challengeToken ?? "",
        challengeId,
        challengeAnswer,
        challengeToken,
        formName,
        tenantId,
        remoteIp: options.clientIp ?? resolveClientIp(request, undefined),
        env
      }),
      options.timeoutMs ?? PUBLIC_FORM_CHALLENGE_TIMEOUT_MS
    );

    if (result?.ok === true) {
      return null;
    }

    log("warning", "public_form_challenge.refused", {
      provider: provider.key,
      formName,
      reason: safeReasonCode(
        (result as { reason?: unknown } | undefined)?.reason
      )
    });
  } catch {
    // The error text is never logged: a verifier may echo the token or secret.
    log("warning", "public_form_challenge.verifier_failed", {
      provider: provider.key,
      formName
    });
  }

  return refusal(provider, "invalid");
}

/** `issue(formName, tenant) -> challenge` through the active provider, for the (provider-specific) endpoint that hands a client its challenge. `null` when no provider is on. */
export async function issuePublicFormChallenge(
  formName: string,
  tenantId: string | null,
  env: NodeJS.ProcessEnv = process.env
): Promise<{ providerKey: string; challenge: PublicFormChallenge } | null> {
  const active = resolveActivePublicFormChallengeProvider(env);

  if (active.kind === "none") {
    return null;
  }

  if (active.kind === "ambiguous") {
    throw new Error(
      "Public-form challenge provider configuration is ambiguous."
    );
  }

  return {
    providerKey: active.provider.key,
    challenge: await withDeadline(
      active.provider.issue(formName, normaliseTenant(tenantId)),
      PUBLIC_FORM_CHALLENGE_TIMEOUT_MS
    )
  };
}

type TestSolver = (
  formName: string,
  tenantId: string | null
) => Promise<PublicFormChallengeFields>;

const testSolvers = new Map<string, TestSolver>();

/**
 * TEST-ONLY: registers the solver the integration harness uses to supply a
 * solved challenge for `providerKey`. It lives here, not on the provider, so it
 * can never ride along in a production descriptor; it refuses to register
 * outside `NODE_ENV=test`, and `extension-points:check` rejects any call from
 * `src/` or `scripts/`.
 */
export function registerPublicFormChallengeTestSolver(
  providerKey: string,
  solver: TestSolver
): void {
  if (process.env.NODE_ENV !== "test") {
    throw new Error("A challenge test solver can only be registered in tests.");
  }

  testSolvers.set(providerKey, solver);
}

/** Test seam only. */
export function clearPublicFormChallengeTestSolversForTests(): void {
  testSolvers.clear();
}

/**
 * TEST-ONLY (the integration harness): the fields a solved challenge for
 * `formName` carries, or `null` when no provider is on or none has a solver.
 */
export async function solvePublicFormChallengeForTests(
  formName: string,
  tenantId: string | null,
  env: NodeJS.ProcessEnv = process.env
): Promise<PublicFormChallengeFields | null> {
  const active = resolveActivePublicFormChallengeProvider(env);

  const solver =
    active.kind === "one" ? testSolvers.get(active.provider.key) : undefined;

  return solver ? solver(formName, normaliseTenant(tenantId)) : null;
}

/**
 * The form a concrete API path belongs to, from the `publicFormChallengeForms`
 * the modules declared (Issue #1353), or `undefined`. The integration harness
 * uses it to pick the form for a request, so a module's new protected route needs
 * a declaration in its own descriptor and no harness edit.
 */
export function resolvePublicFormForRoute(
  pathname: string
): string | undefined {
  for (const module of requireExtensionPointModules(
    "The public-form challenge route map"
  )) {
    for (const form of module.publicFormChallengeForms ?? []) {
      if (
        form.routes.some((route) =>
          challengeRoutePatternToRegExp(route).test(pathname)
        )
      ) {
        return form.formName;
      }
    }
  }

  return undefined;
}

export type PublicFormChallengeWidgetSpec = {
  providerKey: string;
  /** External loader URL (never inline), or `undefined`. */
  scriptSrc: string | undefined;
  containerClass: string;
  /** `data-*` attributes only; anything else the provider returned is dropped. */
  attributes: Record<string, string>;
};

const WIDGET_ATTRIBUTE_NAME = /^data-[a-z0-9]+(?:-[a-z0-9]+)*$/;
const WIDGET_ATTRIBUTE_MAX = 2_048;

/**
 * What a page renders for `formName`: the widget the ENABLED provider declared
 * (Turnstile today), or `null` when no provider is on, the provider declares no
 * widget, or it cannot be rendered. NEVER throws and never decides access: a
 * page without a widget just cannot present a token, and the server still
 * refuses it (`enforcePublicFormCaptcha` is the only gate). That is why every
 * failure here is "render nothing" rather than an error page.
 *
 * Provider output is untrusted at this boundary: only `data-*` attribute names
 * with string values of bounded length are kept, so a provider cannot inject an
 * event handler (`onload`) or another element's attributes through the widget.
 */
export async function resolvePublicFormChallengeWidget(
  formName: string,
  tenantId: string | null = null,
  env: NodeJS.ProcessEnv = process.env
): Promise<PublicFormChallengeWidgetSpec | null> {
  try {
    const active = resolveActivePublicFormChallengeProvider(env);

    if (active.kind !== "one" || !active.provider.widget) {
      return null;
    }

    const { provider } = active;
    const widget = provider.widget as NonNullable<
      ModulePublicFormChallengeProvider["widget"]
    >;
    const challenge = await withDeadline(
      provider.issue(formName, normaliseTenant(tenantId)),
      PUBLIC_FORM_CHALLENGE_TIMEOUT_MS
    );
    const raw = widget.attributes({ formName, challenge });

    if (raw === null || typeof raw !== "object") {
      return null;
    }

    const attributes: Record<string, string> = {};

    for (const [name, value] of Object.entries(raw)) {
      if (
        WIDGET_ATTRIBUTE_NAME.test(name) &&
        name !== "data-challenge-widget" &&
        typeof value === "string" &&
        value.length > 0 &&
        value.length <= WIDGET_ATTRIBUTE_MAX
      ) {
        attributes[name] = value;
      }
    }

    return {
      providerKey: provider.key,
      scriptSrc: widget.scriptSrc,
      containerClass: widget.containerClass,
      attributes
    };
  } catch {
    log("warning", "public_form_challenge.widget_unavailable", { formName });
    return null;
  }
}

/**
 * The CSP origins the enabled provider's widget needs (`script-src` and
 * `frame-src`), or `[]`. Same fail-safe direction as the widget: any problem
 * opens NOTHING (the policy only ever narrows on error), because an unopened
 * origin merely stops a widget rendering, whereas a wrongly opened one widens
 * the policy.
 */
export function resolvePublicFormChallengeCspOrigins(
  env: NodeJS.ProcessEnv = process.env
): readonly string[] {
  try {
    const active = resolveActivePublicFormChallengeProvider(env);

    return active.kind === "one"
      ? [...(active.provider.widget?.cspOrigins ?? [])]
      : [];
  } catch {
    return [];
  }
}
