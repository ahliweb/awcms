/**
 * Brand token override (ahliweb/awcms#1355).
 *
 * A deployment may ship ONE optional file, `brand/tokens.override.json`, that
 * overrides the VALUES of a small allow-list of colour tokens declared in
 * `src/styles/tokens.css`, without editing that upstream-owned file.
 *
 * Contract (kept deliberately narrow):
 *
 * - Only the families in {@link BRAND_OVERRIDE_FAMILIES} can be overridden.
 * - The token MUST already be declared in the `:root` block of `tokens.css`:
 *   an override can never invent a token.
 * - Values are 6-digit hex only — the same notation the contrast gate can
 *   measure. Anything else is rejected, never skipped.
 * - Parsing is by REJECTION: every problem is collected and thrown together.
 * - The stylesheet is produced at build time (a Vite transform appends it to
 *   `tokens.css` itself), so it ships inside the existing external CSS file:
 *   no inline `<style>`, no new request, CSP untouched. With no file, the
 *   transform returns the source byte-for-byte.
 *
 * Pure functions only: no I/O, so both the build and the contrast gate
 * (`design:token-contrast:check`) consume the SAME logic.
 */

/** Token-name families a deployment brand may override (no leading `--`). */
export const BRAND_OVERRIDE_FAMILIES: readonly string[] = [
  "color-primary",
  "color-info",
  "color-sidebar"
];

export const BRAND_OVERRIDE_FILE = "brand/tokens.override.json";

const HEX = /^#[0-9a-fA-F]{6}$/;

export type BrandOverride = {
  readonly light: ReadonlyMap<string, string>;
  readonly dark: ReadonlyMap<string, string>;
};

export class BrandOverrideError extends Error {
  readonly problems: readonly string[];

  constructor(problems: readonly string[]) {
    super(
      `${BRAND_OVERRIDE_FILE} is invalid — ${problems.length} problem(s):\n` +
        problems.map((problem) => `  - ${problem}`).join("\n")
    );
    this.name = "BrandOverrideError";
    this.problems = problems;
  }
}

export function isOverridableToken(name: string): boolean {
  return BRAND_OVERRIDE_FAMILIES.some(
    (family) => name === family || name.startsWith(`${family}-`)
  );
}

/**
 * Extracts `--name: value;` declarations from ONE block of `tokens.css`,
 * located by its opening selector at the START OF A LINE (a plain `indexOf`
 * once matched the selector quoted in a header comment — see the contrast
 * gate's history).
 */
export function readTokenBlock(
  source: string,
  selector: string
): Map<string, string> {
  const anchored = new RegExp(
    `^${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`,
    "m"
  );
  const found = anchored.exec(source);

  if (found === null) {
    throw new Error(
      `tokens.css: block \`${selector}\` not found at the start of a line.`
    );
  }

  const open = source.indexOf("{", found.index);
  const close = source.indexOf("\n}", open);

  if (open === -1 || close === -1) {
    throw new Error(`tokens.css: could not delimit block \`${selector}\`.`);
  }

  const declarations = new Map<string, string>();

  for (const match of source
    .slice(open + 1, close)
    .matchAll(/--([a-z0-9-]+)\s*:\s*([^;]+);/gi)) {
    const [, name, value] = match;

    if (name !== undefined && value !== undefined) {
      declarations.set(name, value.trim());
    }
  }

  return declarations;
}

export function parseBrandOverride(
  raw: unknown,
  tokensSource: string
): BrandOverride {
  const problems: string[] = [];
  const declared = readTokenBlock(tokensSource, ":root {");
  const out = {
    light: new Map<string, string>(),
    dark: new Map<string, string>()
  };

  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new BrandOverrideError([
      'the file must be a JSON object: { "light": { "<token>": "#rrggbb" }, "dark": { ... } }.'
    ]);
  }

  for (const [scheme, tokens] of Object.entries(raw)) {
    if (scheme !== "light" && scheme !== "dark") {
      problems.push(
        `unknown top-level key \`${scheme}\` — only \`light\` and \`dark\` are allowed.`
      );
      continue;
    }

    if (
      typeof tokens !== "object" ||
      tokens === null ||
      Array.isArray(tokens)
    ) {
      problems.push(`\`${scheme}\` must be an object of token -> value.`);
      continue;
    }

    for (const [rawName, value] of Object.entries(tokens)) {
      const name = rawName.replace(/^--/, "");

      if (!isOverridableToken(name)) {
        problems.push(
          `[${scheme}] \`${rawName}\` is not overridable. Allowed families: ${BRAND_OVERRIDE_FAMILIES.map((f) => `--${f}*`).join(", ")}.`
        );
        continue;
      }

      if (!declared.has(name)) {
        problems.push(
          `[${scheme}] unknown token \`--${name}\` — it is not declared in src/styles/tokens.css, and an override cannot invent a token.`
        );
        continue;
      }

      if (typeof value !== "string" || !HEX.test(value)) {
        problems.push(
          `[${scheme}] \`--${name}\` value ${JSON.stringify(value)} is not a 6-digit hex colour (#rrggbb).`
        );
        continue;
      }

      out[scheme].set(name, value.toLowerCase());
    }
  }

  if (problems.length > 0) {
    throw new BrandOverrideError(problems);
  }

  return out;
}

/** Empty string when there is nothing to override. Deterministic (sorted). */
export function renderBrandOverrideCss(override: BrandOverride): string {
  const block = (selector: string, tokens: ReadonlyMap<string, string>) =>
    tokens.size === 0
      ? ""
      : `${selector} {\n${[...tokens]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([name, value]) => `  --${name}: ${value};`)
          .join("\n")}\n}\n`;

  const css =
    block(":root", override.light) +
    block(':root[data-theme="dark"]', override.dark);

  return css === ""
    ? ""
    : `\n/* brand/tokens.override.json (ahliweb/awcms#1355) — generated, do not edit */\n${css}`;
}

/** Appends the override to the shipped stylesheet; identity when empty. */
export function applyBrandOverrideToTokensCss(
  tokensCss: string,
  override: BrandOverride | null
): string {
  if (override === null) {
    return tokensCss;
  }

  const css = renderBrandOverrideCss(override);

  return css === "" ? tokensCss : tokensCss + css;
}

/**
 * Effective per-theme token maps: shipped values with the override layered on
 * exactly as the cascade does it (dark = light + dark-block restatements).
 */
export function resolveEffectiveThemes(
  tokensSource: string,
  override: BrandOverride | null
): { light: Map<string, string>; dark: Map<string, string> } {
  const light = readTokenBlock(tokensSource, ":root {");
  const darkBlock = readTokenBlock(tokensSource, ':root[data-theme="dark"]');

  for (const [name, value] of override?.light ?? []) {
    light.set(name, value);
  }

  for (const [name, value] of override?.dark ?? []) {
    darkBlock.set(name, value);
  }

  const dark = new Map(light);

  for (const [name, value] of darkBlock) {
    dark.set(name, value);
  }

  return { light, dark };
}
