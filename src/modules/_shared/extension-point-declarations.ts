/**
 * Validator for the descriptor-declared extension points of `email` and
 * `whatsapp_delivery` (ADR-0164, Issue #1277): `ModuleDescriptor.
 * emailTemplateCategories` and `ModuleDescriptor.whatsappTemplates`.
 *
 * Pure: no database, no registry. It is called by
 * `bun run extension-points:check` (a CI gate) and by the test suite; the
 * runtime resolvers (`email-template-categories.ts`,
 * `whatsapp-templates.ts`) enforce the same shapes again where they register,
 * so a composition CI never saw still fails loudly instead of silently
 * rendering an empty variable.
 */
import type { ModuleDescriptor } from "./module-contract";
import type { ModulePublicFormChallengeProvider } from "./public-form-challenge-contract";

const EMAIL_CATEGORY_PATTERN = /^derived\.[a-z][a-z0-9_]*$/;
const WHATSAPP_KEY_PATTERN = /^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/;
const VARIABLE_PATTERN = /^[a-z][a-zA-Z0-9_]*$/;

export type ExtensionPointIssue = {
  moduleKey: string;
  message: string;
};

function dependsOnOrConsumes(
  module: ModuleDescriptor,
  ownerKey: string,
  allowSoftEdge: boolean
): boolean {
  if (module.key === ownerKey) {
    return true;
  }

  if (module.dependencies.includes(ownerKey)) {
    return true;
  }

  return (
    allowSoftEdge &&
    (module.capabilities?.consumes ?? []).some(
      (edge) => edge.providedBy === ownerKey
    )
  );
}

/**
 * `baseCategories` is the fixed list `email` ships; a descriptor may not
 * redeclare one of them (it is not `derived.*` anyway, so the prefix rule
 * catches it first, but the explicit check keeps the message honest).
 */
export function validateEmailCategoryDeclarations(
  modules: readonly ModuleDescriptor[],
  baseCategories: readonly string[]
): ExtensionPointIssue[] {
  const issues: ExtensionPointIssue[] = [];
  const owners = new Map<string, string>();

  for (const module of modules) {
    const declared = module.emailTemplateCategories ?? [];

    if (declared.length > 0 && !dependsOnOrConsumes(module, "email", false)) {
      issues.push({
        moduleKey: module.key,
        message: `declares emailTemplateCategories but does not list "email" in dependencies.`
      });
    }

    for (const entry of declared) {
      const label = `e-mail category "${entry.category}"`;

      if (baseCategories.includes(entry.category)) {
        issues.push({
          moduleKey: module.key,
          message: `${label} is a base category; base categories are fixed in email.`
        });
        continue;
      }

      if (!EMAIL_CATEGORY_PATTERN.test(entry.category)) {
        issues.push({
          moduleKey: module.key,
          message: `${label} must be "derived.<name>" in lower-case snake case.`
        });
      }

      const owner = owners.get(entry.category);

      if (owner !== undefined) {
        issues.push({
          moduleKey: module.key,
          message: `${label} is also declared by module "${owner}".`
        });
      } else {
        owners.set(entry.category, module.key);
      }

      for (const name of entry.allowedVariables) {
        if (!VARIABLE_PATTERN.test(name)) {
          issues.push({
            moduleKey: module.key,
            message: `${label} has an invalid variable name "${name}".`
          });
        }
      }

      if (
        new Set(entry.allowedVariables).size !== entry.allowedVariables.length
      ) {
        issues.push({
          moduleKey: module.key,
          message: `${label} lists a variable twice.`
        });
      }
    }
  }

  return issues;
}

export function validateWhatsappTemplateDeclarations(
  modules: readonly ModuleDescriptor[]
): ExtensionPointIssue[] {
  const issues: ExtensionPointIssue[] = [];
  const owners = new Map<string, string>();

  for (const module of modules) {
    const declared = module.whatsappTemplates ?? [];

    if (
      declared.length > 0 &&
      !dependsOnOrConsumes(module, "whatsapp_delivery", true)
    ) {
      issues.push({
        moduleKey: module.key,
        message: `declares whatsappTemplates but neither lists "whatsapp_delivery" in dependencies nor consumes its capability.`
      });
    }

    for (const template of declared) {
      const label = `WhatsApp template "${template.key}"`;

      if (!WHATSAPP_KEY_PATTERN.test(template.key)) {
        issues.push({
          moduleKey: module.key,
          message: `${label} must be "<module>.<name>" in lower-case snake case.`
        });
      } else if (!template.key.startsWith(`${module.key}.`)) {
        issues.push({
          moduleKey: module.key,
          message: `${label} must be prefixed "${module.key}." (ADR-0133 section 4: module-prefixed keys).`
        });
      }

      const owner = owners.get(template.key);

      if (owner !== undefined) {
        issues.push({
          moduleKey: module.key,
          message: `${label} is also declared by module "${owner}".`
        });
      } else {
        owners.set(template.key, module.key);
      }

      if (!Number.isInteger(template.version) || template.version < 1) {
        issues.push({
          moduleKey: module.key,
          message: `${label} needs a positive integer version.`
        });
      }

      if (template.body.length === 0) {
        issues.push({
          moduleKey: module.key,
          message: `${label} has an empty body.`
        });
      }

      for (const name of template.variables) {
        if (!VARIABLE_PATTERN.test(name)) {
          issues.push({
            moduleKey: module.key,
            message: `${label} has an invalid variable name "${name}".`
          });
        }
      }

      for (const secret of template.secretVariables ?? []) {
        if (!template.variables.includes(secret)) {
          issues.push({
            moduleKey: module.key,
            message: `${label} marks "${secret}" secret but does not allow it.`
          });
        }
      }

      if (
        template.purpose === "security" &&
        (template.secretVariables ?? []).length === 0
      ) {
        issues.push({
          moduleKey: module.key,
          message: `${label} is a security template and must declare at least one secret variable.`
        });
      }
    }
  }

  return issues;
}

export function formatExtensionPointIssue(issue: ExtensionPointIssue): string {
  return `module "${issue.moduleKey}": ${issue.message}`;
}

const CHALLENGE_PROVIDER_KEY_PATTERN = /^[a-z][a-z0-9_]*$/;
const CHALLENGE_REFUSAL_CODE_PATTERN = /^[A-Z][A-Z0-9_]*$/;
const CHALLENGE_LEGACY_FIELD_PATTERN = /^[a-z][a-zA-Z0-9]*$/;
const CHALLENGE_RESERVED_FIELDS = [
  "challengeId",
  "challengeAnswer",
  "challengeToken"
];

/**
 * Public-form challenge providers (Issue #1353): unique snake_case keys across
 * the composed registry, the three contract functions present, and refusal
 * codes and the legacy field in a shape a client can rely on. Pure.
 */
export function validatePublicFormChallengeProviderDeclarations(
  modules: readonly ModuleDescriptor[]
): ExtensionPointIssue[] {
  const issues: ExtensionPointIssue[] = [];
  const owners = new Map<string, string>();

  for (const module of modules) {
    for (const provider of module.publicFormChallengeProviders ?? []) {
      const label = `challenge provider "${provider.key}"`;

      if (
        typeof provider.key !== "string" ||
        !CHALLENGE_PROVIDER_KEY_PATTERN.test(provider.key)
      ) {
        issues.push({
          moduleKey: module.key,
          message: `${label} must have a lower-case snake case key.`
        });
      }

      const owner = owners.get(provider.key);

      if (owner !== undefined) {
        issues.push({
          moduleKey: module.key,
          message: `${label} is also declared by module "${owner}".`
        });
      } else {
        owners.set(provider.key, module.key);
      }

      if (!provider.description?.trim()) {
        issues.push({
          moduleKey: module.key,
          message: `${label} needs a description.`
        });
      }

      for (const method of ["isEnabled", "issue", "verify"] as const) {
        if (typeof provider[method] !== "function") {
          issues.push({
            moduleKey: module.key,
            message: `${label} must implement ${method}().`
          });
        }
      }

      if ("solveForTests" in provider) {
        issues.push({
          moduleKey: module.key,
          message: `${label} carries a solveForTests: a test solver is registered from a test (see the seam), never declared in a production descriptor.`
        });
      }

      if (provider.legacyTokenField !== undefined) {
        if (
          !CHALLENGE_LEGACY_FIELD_PATTERN.test(provider.legacyTokenField) ||
          CHALLENGE_RESERVED_FIELDS.includes(provider.legacyTokenField)
        ) {
          issues.push({
            moduleKey: module.key,
            message: `${label} has an invalid legacyTokenField "${provider.legacyTokenField}".`
          });
        }
      }

      if (provider.widget !== undefined) {
        issues.push(
          ...validateChallengeWidget(module.key, label, provider.widget)
        );
      }

      for (const code of [
        provider.refusal?.requiredCode,
        provider.refusal?.invalidCode
      ]) {
        if (code !== undefined && !CHALLENGE_REFUSAL_CODE_PATTERN.test(code)) {
          issues.push({
            moduleKey: module.key,
            message: `${label} has an invalid refusal code "${code}" (UPPER_SNAKE_CASE).`
          });
        }
      }
    }
  }

  return issues;
}

const CHALLENGE_FORM_NAME_PATTERN = /^[a-z][a-z0-9_]{0,31}$/;
// An API path: literal segments, or one Astro dynamic segment `[name]`.
const CHALLENGE_ROUTE_PATTERN =
  /^\/api\/(?:[A-Za-z0-9_.-]+|\[[A-Za-z0-9_]+\])(?:\/(?:[A-Za-z0-9_.-]+|\[[A-Za-z0-9_]+\]))*$/;
const CHALLENGE_ORIGIN_PATTERN = /^https:\/\/[a-z0-9.-]+(?::\d{1,5})?$/;
const CHALLENGE_CLASS_PATTERN =
  /^[A-Za-z][A-Za-z0-9_-]*(?: [A-Za-z][A-Za-z0-9_-]*)*$/;

function validateChallengeWidget(
  moduleKey: string,
  label: string,
  widget: NonNullable<ModulePublicFormChallengeProvider["widget"]>
): ExtensionPointIssue[] {
  const issues: ExtensionPointIssue[] = [];
  const add = (message: string) => issues.push({ moduleKey, message });

  if (
    typeof widget.containerClass !== "string" ||
    !CHALLENGE_CLASS_PATTERN.test(widget.containerClass)
  ) {
    add(`${label} widget needs a plain containerClass (CSS class names only).`);
  }

  if (typeof widget.attributes !== "function") {
    add(`${label} widget must implement attributes().`);
  }

  const origins = widget.cspOrigins ?? [];

  for (const origin of origins) {
    if (typeof origin !== "string" || !CHALLENGE_ORIGIN_PATTERN.test(origin)) {
      add(
        `${label} widget has an invalid CSP origin "${String(origin)}" (https origin, no path, no wildcard).`
      );
    }
  }

  if (widget.scriptSrc !== undefined) {
    let parsed: URL | null = null;

    try {
      parsed = new URL(widget.scriptSrc);
    } catch {
      parsed = null;
    }

    if (
      parsed === null ||
      parsed.protocol !== "https:" ||
      parsed.username !== "" ||
      parsed.password !== "" ||
      parsed.hash !== ""
    ) {
      add(
        `${label} widget scriptSrc must be an https URL without credentials or fragment.`
      );
    } else if (!origins.includes(parsed.origin)) {
      add(
        `${label} widget scriptSrc origin ${parsed.origin} must be listed in cspOrigins, or the CSP blocks it.`
      );
    }
  }

  return issues;
}

/**
 * Public-form challenge FORM declarations (Issue #1353): `snake_case` names,
 * each route an API path that is declared once across the composed registry
 * (two modules claiming one route would make the harness and the gate
 * ambiguous). Whether a route is a REAL file is checked by the gate
 * (`extension-points:check`), which can see the file system. Pure.
 */
export function validatePublicFormChallengeFormDeclarations(
  modules: readonly ModuleDescriptor[]
): ExtensionPointIssue[] {
  const issues: ExtensionPointIssue[] = [];
  const routeOwners = new Map<string, string>();

  for (const module of modules) {
    for (const form of module.publicFormChallengeForms ?? []) {
      const label = `challenge form "${form.formName}"`;

      if (
        typeof form.formName !== "string" ||
        !CHALLENGE_FORM_NAME_PATTERN.test(form.formName)
      ) {
        issues.push({
          moduleKey: module.key,
          message: `${label} must have a lower-case snake case name of at most 32 characters.`
        });
      }

      if (!Array.isArray(form.routes) || form.routes.length === 0) {
        issues.push({
          moduleKey: module.key,
          message: `${label} must list at least one route.`
        });
        continue;
      }

      for (const route of form.routes) {
        if (typeof route !== "string" || !CHALLENGE_ROUTE_PATTERN.test(route)) {
          issues.push({
            moduleKey: module.key,
            message: `${label} has an invalid route "${String(route)}" (an /api/... path; [param] segments allowed).`
          });
          continue;
        }

        const owner = routeOwners.get(route);

        if (owner !== undefined) {
          issues.push({
            moduleKey: module.key,
            message: `${label} route ${route} is also declared by ${owner}.`
          });
        } else {
          routeOwners.set(route, `module "${module.key}" (${form.formName})`);
        }
      }
    }
  }

  return issues;
}

/** Route patterns (`/a/[x]/b`) to a regex over a concrete path, for the harness and the gate. */
export function challengeRoutePatternToRegExp(route: string): RegExp {
  const source = route
    .split("/")
    .map((segment) =>
      /^\[[A-Za-z0-9_]+\]$/.test(segment)
        ? "[^/]+"
        : segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    )
    .join("/");

  return new RegExp(`^${source}$`);
}
