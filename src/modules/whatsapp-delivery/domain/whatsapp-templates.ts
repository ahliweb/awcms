/**
 * Template registry for `whatsapp_delivery` (Issue #963, ADR-0133 sections 2
 * and 4). A template key is registered with exactly ONE purpose and a versioned
 * variable allow-list; a caller cannot send a `marketing` template as
 * `transactional`, and a variable that is not on the list is DROPPED by the
 * renderer — payroll safety is enforced here, not by caller discipline.
 *
 * The registry is code, not rows: consuming modules call
 * `registerWhatsappTemplate` from their own module scope with a module-prefixed
 * key (`booking.reminder`, `commerce.order_paid`). Upstream ships no business
 * wording except the neutral `system.notice`.
 */
export type WhatsappPurpose = "transactional" | "security" | "marketing";

export const WHATSAPP_PURPOSES: readonly WhatsappPurpose[] = [
  "transactional",
  "security",
  "marketing"
];

export type WhatsappTemplateDefinition = {
  /** `<module>.<name>`, lower-case snake segments. */
  key: string;
  /** Bumped when wording or variables change; stored on the queue row. */
  version: number;
  purpose: WhatsappPurpose;
  /** Body with `{{variable}}` placeholders. Only allow-listed names are substituted. */
  body: string;
  /** The variable allow-list, in the order a provider template expects them. */
  variables: readonly string[];
  /** Variables that are secrets (an OTP code). The row is cleared at a terminal state. */
  secretVariables?: readonly string[];
  /**
   * Meta pre-approved template identity. Without it, a provider that requires
   * one fails the message terminally — it never falls back to free text for
   * `transactional`/`marketing` (ADR-0133 section 10, Q4).
   */
  providerTemplate?: { name: string; language: string };
};

const KEY_PATTERN = /^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/;
const VARIABLE_PATTERN = /^[a-z][a-zA-Z0-9_]*$/;
const MAX_VARIABLE_LENGTH = 1000;
const MAX_BODY_LENGTH = 4096;

const registry = new Map<string, WhatsappTemplateDefinition>();

export class WhatsappTemplateRegistrationError extends Error {}

function sameDefinition(
  a: WhatsappTemplateDefinition,
  b: WhatsappTemplateDefinition
): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function registerWhatsappTemplate(
  definition: WhatsappTemplateDefinition
): void {
  if (!KEY_PATTERN.test(definition.key)) {
    throw new WhatsappTemplateRegistrationError(
      `Template key "${definition.key}" must be <module>.<name> in lower-case snake case.`
    );
  }

  if (!WHATSAPP_PURPOSES.includes(definition.purpose)) {
    throw new WhatsappTemplateRegistrationError(
      `Template "${definition.key}" has an unknown purpose.`
    );
  }

  if (!Number.isInteger(definition.version) || definition.version < 1) {
    throw new WhatsappTemplateRegistrationError(
      `Template "${definition.key}" needs a positive integer version.`
    );
  }

  if (
    definition.body.length === 0 ||
    definition.body.length > MAX_BODY_LENGTH
  ) {
    throw new WhatsappTemplateRegistrationError(
      `Template "${definition.key}" body must be 1..${MAX_BODY_LENGTH} characters.`
    );
  }

  for (const name of definition.variables) {
    if (!VARIABLE_PATTERN.test(name)) {
      throw new WhatsappTemplateRegistrationError(
        `Template "${definition.key}" has an invalid variable name "${name}".`
      );
    }
  }

  for (const secret of definition.secretVariables ?? []) {
    if (!definition.variables.includes(secret)) {
      throw new WhatsappTemplateRegistrationError(
        `Template "${definition.key}" marks "${secret}" secret but does not allow it.`
      );
    }
  }

  // A security template carries a time-bound code: the code must be a secret
  // variable, or the "cleared at terminal" rule would silently not apply.
  if (
    definition.purpose === "security" &&
    (definition.secretVariables ?? []).length === 0
  ) {
    throw new WhatsappTemplateRegistrationError(
      `Security template "${definition.key}" must declare at least one secret variable.`
    );
  }

  const existing = registry.get(definition.key);

  if (existing) {
    // Re-registration of the identical definition is a no-op (a module imported
    // twice). A DIFFERENT definition under the same key is a conflict: the
    // second registrant would otherwise change the first one's wording.
    if (sameDefinition(existing, definition)) {
      return;
    }

    throw new WhatsappTemplateRegistrationError(
      `Template "${definition.key}" is already registered with a different definition.`
    );
  }

  registry.set(definition.key, Object.freeze({ ...definition }));
}

export function getWhatsappTemplate(
  key: string
): WhatsappTemplateDefinition | undefined {
  return registry.get(key);
}

export function listWhatsappTemplates(): WhatsappTemplateDefinition[] {
  return [...registry.values()].sort((a, b) => a.key.localeCompare(b.key));
}

/** Test seam only. */
export function resetWhatsappTemplatesForTests(): void {
  registry.clear();
  registerBuiltInTemplates();
}

function sanitizeValue(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }

  // Control characters can split a message or smuggle formatting into a
  // provider request; whitespace is collapsed to a single line.
  // eslint-disable-next-line no-control-regex
  return value
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .trim()
    .slice(0, MAX_VARIABLE_LENGTH);
}

export type RenderedWhatsappMessage = {
  body: string;
  /** The variables that survived the allow-list, as stored on the row. */
  variables: Record<string, string>;
  /** Names the caller supplied that the allow-list dropped. Reported, not stored. */
  droppedVariables: string[];
  /** Allow-listed values in the template's declared order, for template parameters. */
  parameters: string[];
  containsSecret: boolean;
};

export function renderWhatsappTemplate(
  template: WhatsappTemplateDefinition,
  supplied: Record<string, string>
): RenderedWhatsappMessage {
  const allowed = new Set(template.variables);
  const variables: Record<string, string> = {};
  const droppedVariables: string[] = [];

  for (const [name, value] of Object.entries(supplied ?? {})) {
    if (allowed.has(name)) {
      variables[name] = sanitizeValue(value);
    } else {
      droppedVariables.push(name);
    }
  }

  const body = template.body.replace(
    /\{\{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*\}\}/g,
    (_match, name: string) => (allowed.has(name) ? (variables[name] ?? "") : "")
  );

  return {
    body,
    variables,
    droppedVariables,
    parameters: template.variables.map((name) => variables[name] ?? ""),
    containsSecret:
      template.purpose === "security" ||
      (template.secretVariables ?? []).length > 0
  };
}

function registerBuiltInTemplates(): void {
  registerWhatsappTemplate({
    key: "system.notice",
    version: 1,
    purpose: "transactional",
    body: "{{message}}",
    variables: ["message"]
  });
}

registerBuiltInTemplates();
