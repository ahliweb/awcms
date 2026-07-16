/**
 * Safe template rendering (Issue #495's minimal seam, superseded here by
 * Issue #498's full scope): resolves a per-locale template variant
 * (`sql/021`'s `jsonb` body columns, doc 04 §Konten multi-bahasa "JSONB
 * per-locale"), filters the caller's variables through the template's
 * category allowlist (`email-template-categories.ts` — an unrecognized
 * category or a variable not on the allowlist is silently dropped, never
 * substituted), then substitutes `{{key}}` tokens. Values substituted into
 * `htmlBody` are HTML-escaped (XSS prevention); `textBody`/`subject` are
 * not (plain text has no markup to escape).
 */
import { getAllowedVariablesForCategory } from "./email-template-categories";

export type LocalizedTemplateText = Record<string, string>;

export type EmailTemplateSource = {
  subjectTemplate: LocalizedTemplateText;
  textBodyTemplate: LocalizedTemplateText | null;
  htmlBodyTemplate: LocalizedTemplateText | null;
};

export type RenderedEmail = {
  subject: string;
  textBody?: string;
  htmlBody?: string;
};

const VARIABLE_PATTERN = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g;
const FALLBACK_LOCALE = "en";

function escapeHtmlValue(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Unknown/missing/non-allowlisted variables render as an empty string — never leaves a literal `{{token}}` in sent content. */
function substitute(
  template: string,
  variables: Record<string, string>,
  escapeHtml: boolean
): string {
  return template.replace(VARIABLE_PATTERN, (_match, key: string) => {
    const raw = variables[key] ?? "";
    return escapeHtml ? escapeHtmlValue(raw) : raw;
  });
}

/** Requested locale → `FALLBACK_LOCALE` → `null` if neither variant exists (e.g. an optional body that simply wasn't authored for any locale). */
export function resolveLocaleVariant(
  variants: LocalizedTemplateText | null,
  locale: string
): string | null {
  if (!variants) {
    return null;
  }

  return variants[locale] ?? variants[FALLBACK_LOCALE] ?? null;
}

/**
 * Only variables named in `getAllowedVariablesForCategory(category)` are
 * ever substituted — an unrecognized category resolves to "no variables
 * allowed" (every `{{token}}` renders empty), not "everything allowed".
 */
function filterToAllowlist(
  variables: Record<string, string>,
  category: string
): Record<string, string> {
  const allowlist = getAllowedVariablesForCategory(category);

  if (!allowlist) {
    return {};
  }

  const filtered: Record<string, string> = {};

  for (const key of allowlist) {
    if (key in variables) {
      filtered[key] = variables[key]!;
    }
  }

  return filtered;
}

export function renderEmailTemplate(
  template: EmailTemplateSource,
  variables: Record<string, string>,
  category: string,
  locale = FALLBACK_LOCALE
): RenderedEmail {
  const safeVariables = filterToAllowlist(variables, category);
  const subjectTemplate =
    resolveLocaleVariant(template.subjectTemplate, locale) ?? "";
  const textBodyVariant = resolveLocaleVariant(
    template.textBodyTemplate,
    locale
  );
  const htmlBodyVariant = resolveLocaleVariant(
    template.htmlBodyTemplate,
    locale
  );

  return {
    subject: substitute(subjectTemplate, safeVariables, false),
    textBody: textBodyVariant
      ? substitute(textBodyVariant, safeVariables, false)
      : undefined,
    htmlBody: htmlBodyVariant
      ? substitute(htmlBodyVariant, safeVariables, true)
      : undefined
  };
}
