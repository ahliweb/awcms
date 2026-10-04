/**
 * The structured tax-definition editor's model (Issue #901) — PURE: no DOM, so
 * it is unit-testable and costs the client bundle only what it uses.
 *
 * ## The server stays authoritative
 *
 * This file does not validate a definition. It maps between the JSON document
 * the endpoint accepts (`validateTaxDefinition` in the tax module) and the rows
 * an operator edits, nothing more. Rates are kept as exact decimal STRINGS the
 * whole way through — never parsed to a number — and an empty optional field is
 * simply omitted, the way the server's closed-key validator expects.
 * Everything else (code pattern, uniqueness, undeclared categories, limits,
 * "a taxable rule needs a component") is the server's to refuse, and the page
 * shows its generic message.
 *
 * The limits below are UX hints (stop offering "add" past them), not rules.
 */

export const EDITOR_MAX_COMPONENTS_PER_RULE = 8;

export type EditorCategory = {
  code: string;
  name: string;
  description: string;
};
export type EditorComponent = {
  code: string;
  name: string;
  rate: string;
  basis: string;
};
export type EditorRule = {
  /** `""` is the fallback rule (serialised as `null`). */
  categoryCode: string;
  treatment: string;
  components: EditorComponent[];
};
export type EditorModel = { categories: EditorCategory[]; rules: EditorRule[] };

export function emptyComponent(): EditorComponent {
  return { code: "", name: "", rate: "", basis: "net" };
}

export function emptyRule(): EditorRule {
  return {
    categoryCode: "",
    treatment: "taxable",
    components: [emptyComponent()]
  };
}

/** What the editor starts from when there is no JSON to load. */
export function initialModel(): EditorModel {
  return { categories: [], rules: [emptyRule()] };
}

/** The JSON document the endpoint takes. Non-taxable rules carry no components. */
export function serializeModel(model: EditorModel): string {
  return JSON.stringify(
    {
      categories: model.categories.map((category) => ({
        code: category.code.trim(),
        name: category.name.trim(),
        ...(category.description.trim()
          ? { description: category.description.trim() }
          : {})
      })),
      rules: model.rules.map((rule) => ({
        categoryCode: rule.categoryCode === "" ? null : rule.categoryCode,
        treatment: rule.treatment,
        components:
          rule.treatment === "taxable"
            ? rule.components.map((component) => ({
                code: component.code.trim(),
                name: component.name.trim(),
                rate: component.rate.trim(),
                basis: component.basis
              }))
            : []
      }))
    },
    null,
    2
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function str(value: unknown, fallback = ""): string | null {
  if (value === undefined) return fallback;
  return typeof value === "string" ? value : null;
}

/**
 * Loads JSON text into rows, or `null` when it is not something the editor can
 * show faithfully (unparseable, unknown keys, a non-string where a string
 * belongs). `null` means "leave the JSON alone": the editor must never round-trip
 * a document into a different one, so it declines rather than guesses.
 */
export function parseModel(text: string): EditorModel | null {
  let raw: unknown;

  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }

  if (
    !isRecord(raw) ||
    !Array.isArray(raw.categories) ||
    !Array.isArray(raw.rules) ||
    Object.keys(raw).some((key) => key !== "categories" && key !== "rules")
  ) {
    return null;
  }

  const categories: EditorCategory[] = [];

  for (const entry of raw.categories) {
    if (
      !isRecord(entry) ||
      Object.keys(entry).some(
        (key) => key !== "code" && key !== "name" && key !== "description"
      )
    ) {
      return null;
    }
    const code = str(entry.code);
    const name = str(entry.name);
    const description = str(entry.description);
    if (code === null || name === null || description === null) return null;
    categories.push({ code, name, description });
  }

  const rules: EditorRule[] = [];

  for (const entry of raw.rules) {
    if (
      !isRecord(entry) ||
      Object.keys(entry).some(
        (key) =>
          key !== "categoryCode" && key !== "treatment" && key !== "components"
      )
    ) {
      return null;
    }
    const categoryCode =
      entry.categoryCode === null || entry.categoryCode === undefined
        ? ""
        : str(entry.categoryCode);
    const treatment = str(entry.treatment);
    const rawComponents = entry.components ?? [];
    if (
      categoryCode === null ||
      treatment === null ||
      !Array.isArray(rawComponents)
    ) {
      return null;
    }

    const components: EditorComponent[] = [];
    for (const component of rawComponents) {
      if (
        !isRecord(component) ||
        Object.keys(component).some(
          (key) =>
            key !== "code" &&
            key !== "name" &&
            key !== "rate" &&
            key !== "basis"
        )
      ) {
        return null;
      }
      const code = str(component.code);
      const name = str(component.name);
      const rate = str(component.rate);
      const basis = str(component.basis, "net");
      if (code === null || name === null || rate === null || basis === null) {
        return null;
      }
      components.push({ code, name, rate, basis });
    }

    rules.push({ categoryCode, treatment, components });
  }

  return { categories, rules };
}

/**
 * What the row editor may do with the textarea's current text. A blank textarea
 * starts a fresh model; text the rows can show loads; anything else is `null` —
 * the editor must then stay out of the way (hidden, never writing back), because
 * a stray edit on blank rows would overwrite the operator's JSON.
 */
export function loadEditableModel(text: string): EditorModel | null {
  return text.trim() === "" ? initialModel() : parseModel(text);
}
