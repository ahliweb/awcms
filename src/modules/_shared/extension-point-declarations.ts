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
