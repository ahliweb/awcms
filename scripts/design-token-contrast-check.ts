#!/usr/bin/env bun
/**
 * `bun run design:token-contrast:check` — ADR-0120.
 *
 * Reads the colour tokens out of `src/styles/tokens.css` and asserts that every
 * foreground/background pair the design system actually PUTS ON SCREEN clears
 * WCAG 2.1 AA, in BOTH themes.
 *
 * ## Why this gate exists
 *
 * `docs/awcms/14_ui_ux_design_system.md` §Aksesibilitas promises AA. Until now
 * nothing checked it, and the promise was kept by whoever remembered to measure.
 * Twice it was not:
 *
 *   1. Issue #434 found `--color-primary` + white text at 3.68:1 in the dark
 *      theme. The fix was the `-strong` token family, and the docblock in
 *      `tokens.css` explaining it is excellent — and it is prose. It could not
 *      stop the next one.
 *   2. PR #720 found the SAME defect again in `StatusBadge`'s `info` variant,
 *      3.68:1 light / 2.43:1 dark, sitting in a file whose own comment already
 *      described the rule it was breaking.
 *
 * The redesign then found it a third and fourth time, in the opposite direction
 * — dark text on a pale tint. Three of the five obvious `--color-X` on
 * `--color-X-soft` pairs measured 4.07–4.48:1, and `--color-text-faint` passed
 * on `--color-surface` while failing at 4.39:1 on `--color-surface-3`, which is
 * the `<thead>` background where that token is used most.
 *
 * Four occurrences of one defect class is the point at which a comment is the
 * wrong instrument. This is the right one.
 *
 * ## What it checks, and what it deliberately does not
 *
 * It checks PAIRS THAT ARE DECLARED BELOW — a registry, not a sweep. A sweep
 * over every token combination would report hundreds of pairs nobody renders
 * and train its readers to ignore it (the same reasoning
 * `i18n:screens:check` gives for not scanning attributes).
 *
 * The cost of a registry is stated rather than hidden: a NEW pairing introduced
 * in CSS without a line here is not measured. Two things push against that —
 * every entry names the rule that renders it, so an unregistered pairing is
 * visible in review as a rule with no entry; and the registry fails when a
 * token it names disappears, so it cannot quietly stop measuring after a rename.
 *
 * It does NOT check contrast against `--color-bg`, only against the surfaces
 * text actually sits on. Nothing in this admin puts text directly on the page
 * background — every screen's text is inside a card, a table or the shell.
 *
 * Pure arithmetic on one file. No database, no network, no build output.
 */
import { readFile } from "node:fs/promises";

const TOKENS_FILE = "src/styles/tokens.css";

/** WCAG 2.1 AA for normal-size text (1.4.3). */
const AA_NORMAL = 4.5;

/**
 * WCAG 2.1 AA for large text (>=18.66px bold or >=24px) and for UI component
 * boundaries (1.4.11 Non-text Contrast). Used only where the entry says so.
 */
const AA_LARGE = 3;

type Pair = {
  /** Custom property holding the text/foreground colour, without `--`. */
  readonly fg: string;
  /** Custom property holding the background it sits on, without `--`. */
  readonly bg: string;
  /** Minimum acceptable ratio. */
  readonly min: number;
  /** The rule that renders this pairing — so an unregistered one shows up. */
  readonly renderedBy: string;
};

/**
 * The registry.
 *
 * `renderedBy` is not documentation: it is the thing a reviewer compares the
 * stylesheet against. If a rule sets `color:` and `background:` from two tokens
 * and does not appear here, that is the finding.
 */
const PAIRS: readonly Pair[] = [
  // ---- Body text on the three surfaces -----------------------------------
  {
    fg: "color-text",
    bg: "color-surface",
    min: AA_NORMAL,
    renderedBy: "admin.css .admin-card, .data-table td"
  },
  {
    fg: "color-text",
    bg: "color-surface-2",
    min: AA_NORMAL,
    renderedBy: "admin.css .badge, .admin-note"
  },
  {
    fg: "color-text",
    bg: "color-surface-3",
    min: AA_NORMAL,
    renderedBy: "admin.css .admin-form input, .data-table tbody tr:hover"
  },
  {
    fg: "color-text-muted",
    bg: "color-surface",
    min: AA_NORMAL,
    renderedBy: "admin.css .admin-page-description, .admin-sidebar a"
  },
  {
    fg: "color-text-muted",
    bg: "color-surface-2",
    min: AA_NORMAL,
    renderedBy: "admin.css .badge, .status-badge[data-variant='neutral']"
  },
  {
    fg: "color-text-muted",
    bg: "color-surface-3",
    min: AA_NORMAL,
    renderedBy: "admin.css .admin-table-foot"
  },
  // `--color-text-faint` on `--color-surface-3` is the pair that caught the
  // fourth occurrence: it passed on `--color-surface` and failed here, and
  // here is where table column headings live.
  {
    fg: "color-text-faint",
    bg: "color-surface",
    min: AA_NORMAL,
    renderedBy: "admin.css .admin-breadcrumb, .admin-sidebar-module-label"
  },
  {
    fg: "color-text-faint",
    bg: "color-surface-2",
    min: AA_NORMAL,
    renderedBy: "admin.css .admin-kbd inside a tinted control"
  },
  {
    fg: "color-text-faint",
    bg: "color-surface-3",
    min: AA_NORMAL,
    renderedBy: "admin.css .data-table th, .admin-table th, .admin-palette-open"
  },

  // ---- Solid fills carrying `--color-primary-contrast` --------------------
  // The `-strong` family exists for exactly these. See tokens.css.
  {
    fg: "color-primary-contrast",
    bg: "color-primary-strong",
    min: AA_NORMAL,
    renderedBy: "admin.css .btn-primary, .admin-brand-mark, .admin-avatar"
  },
  {
    fg: "color-primary-contrast",
    bg: "color-danger-strong",
    min: AA_NORMAL,
    renderedBy: "admin.css .btn-danger--solid, .admin-create-error"
  },
  {
    fg: "color-primary-contrast",
    bg: "color-success-strong",
    min: AA_NORMAL,
    renderedBy: "admin-screens.css solid success affordances"
  },
  {
    fg: "color-primary-contrast",
    bg: "color-info-strong",
    min: AA_NORMAL,
    renderedBy: "StatusBadge info variant (the PR #720 finding)"
  },

  // ---- Tinted status pairs: the `-on-soft` family -------------------------
  // Three of these five failed with the obvious `--color-X` foreground.
  {
    fg: "color-primary-on-soft",
    bg: "color-primary-soft",
    min: AA_NORMAL,
    renderedBy: "admin.css .admin-sidebar a[aria-current], .admin-chip--active"
  },
  {
    fg: "color-success-on-soft",
    bg: "color-success-soft",
    min: AA_NORMAL,
    renderedBy: "admin.css .status-badge[data-variant='success']"
  },
  {
    fg: "color-warning-on-soft",
    bg: "color-warning-soft",
    min: AA_NORMAL,
    renderedBy:
      "admin.css .status-badge[data-variant='warning'], .admin-sync-pill"
  },
  {
    fg: "color-danger-on-soft",
    bg: "color-danger-soft",
    min: AA_NORMAL,
    renderedBy:
      "admin.css .status-badge[data-variant='danger'], .admin-sidebar-count"
  },
  {
    fg: "color-info-on-soft",
    bg: "color-info-soft",
    min: AA_NORMAL,
    renderedBy: "admin-screens.css .status-badge[data-variant='info']"
  },

  // ---- Status colours used as TEXT/BORDER on a plain surface --------------
  // This is the job the plain (non-`-strong`, non-`-on-soft`) tokens are tuned
  // for, and the `.btn-danger` outline is the case that proved the three roles
  // genuinely need three values.
  {
    fg: "color-primary",
    bg: "color-surface",
    min: AA_NORMAL,
    renderedBy: "tokens.css `a`, admin.css .link-button"
  },
  {
    fg: "color-danger",
    bg: "color-surface",
    min: AA_NORMAL,
    renderedBy: "admin.css .btn-danger (outlined), .admin-error"
  },

  // ---- Non-text contrast (1.4.11): control boundaries --------------------
  // A border that cannot be seen is a control that cannot be found. `3:1` is
  // the standard's own threshold for this, not a relaxation of the one above.
  //
  // Only `--color-border-strong` is asserted, and `--color-border` deliberately
  // is NOT: 1.4.11 governs boundaries that identify an operable component, not
  // decorative separators. See that token's docblock in tokens.css for why the
  // role was split rather than the value darkened. All three surfaces are
  // checked because a control border has a fill on one side and a card on the
  // other, and either can be the lighter one.
  {
    fg: "color-border-strong",
    bg: "color-surface",
    min: AA_LARGE,
    renderedBy: "admin.css input/select/textarea borders, .btn-secondary"
  },
  {
    fg: "color-border-strong",
    bg: "color-surface-2",
    min: AA_LARGE,
    renderedBy: "admin.css controls sitting on a tinted panel"
  },
  {
    fg: "color-border-strong",
    bg: "color-surface-3",
    min: AA_LARGE,
    renderedBy: "admin.css the recessed input fill inside its own border"
  },
  {
    fg: "color-focus",
    bg: "color-surface",
    min: AA_LARGE,
    renderedBy: "tokens.css :focus-visible outline"
  },
  {
    fg: "color-focus",
    bg: "color-bg",
    min: AA_LARGE,
    renderedBy: "tokens.css :focus-visible outline over the page ground"
  }
];

/** sRGB channel -> linear, per WCAG 2.x relative luminance. */
function channelToLinear(value8Bit: number): number {
  const channel = value8Bit / 255;

  return channel <= 0.04045
    ? channel / 12.92
    : ((channel + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance(hex: string): number {
  const body = hex.replace("#", "");
  const red = Number.parseInt(body.slice(0, 2), 16);
  const green = Number.parseInt(body.slice(2, 4), 16);
  const blue = Number.parseInt(body.slice(4, 6), 16);

  return (
    0.2126 * channelToLinear(red) +
    0.7152 * channelToLinear(green) +
    0.0722 * channelToLinear(blue)
  );
}

function contrastRatio(foreground: string, background: string): number {
  const a = relativeLuminance(foreground);
  const b = relativeLuminance(background);
  const lighter = Math.max(a, b);
  const darker = Math.min(a, b);

  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Six-digit hex only.
 *
 * Three-digit shorthand, `rgb()` and `color-mix()` are REJECTED rather than
 * parsed. A gate that silently skips a value it cannot read is the "green while
 * wrong" mode this repo keeps finding; refusing loudly means the next person to
 * introduce one has to teach this script about it, which is the correct order.
 */
const HEX = /^#[0-9a-fA-F]{6}$/;

/**
 * Extracts `--name: value;` declarations from ONE block, located by its opening
 * selector. Deliberately not a CSS parser: the file is ours, its shape is
 * stable, and a dependency-free reader is the whole point of a Bun-only repo
 * that ships two runtime packages.
 */
function readBlock(source: string, selector: string): Map<string, string> {
  /*
   * Anchored to the START OF A LINE, which is not a detail.
   *
   * A plain `indexOf(':root[data-theme="dark"]')` matched the mention of that
   * selector inside this file's own header COMMENT, 200 lines above the rule.
   * The block it then read was the comment's tail, which declares no tokens —
   * so the dark theme silently inherited every light value and the gate
   * reported light-theme numbers under a "dark" label. It was green for the
   * wrong reason in one direction and red for the wrong reason in the other.
   */
  const anchored = new RegExp(
    `^${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`,
    "m"
  );
  const found = anchored.exec(source);

  if (found === null) {
    throw new Error(
      `${TOKENS_FILE}: block \`${selector}\` not found at the start of a line. This gate reads that block by name; if it was renamed, update this script rather than deleting the assertion.`
    );
  }

  const start = found.index;
  const open = source.indexOf("{", start);
  const close = source.indexOf("\n}", open);

  if (open === -1 || close === -1) {
    throw new Error(`${TOKENS_FILE}: could not delimit block \`${selector}\`.`);
  }

  const body = source.slice(open + 1, close);
  const declarations = new Map<string, string>();

  for (const match of body.matchAll(/--([a-z0-9-]+)\s*:\s*([^;]+);/gi)) {
    const [, name, value] = match;

    // Both groups are non-optional in the pattern, so this never trips at
    // runtime; it is here because `noUncheckedIndexedAccess` types them as
    // possibly-undefined and a `!` would assert rather than handle.
    if (name === undefined || value === undefined) {
      continue;
    }

    declarations.set(name, value.trim());
  }

  return declarations;
}

type Theme = { readonly name: string; readonly tokens: Map<string, string> };

function resolve(
  theme: Theme,
  token: string,
  failures: string[]
): string | null {
  const value = theme.tokens.get(token);

  if (value === undefined) {
    failures.push(
      `[${theme.name}] token \`--${token}\` is referenced by this gate but not declared in ${TOKENS_FILE}.`
    );

    return null;
  }

  if (!HEX.test(value)) {
    failures.push(
      `[${theme.name}] token \`--${token}\` is \`${value}\`, which this gate cannot measure. Use a 6-digit hex, or teach this script the new notation — do not drop the assertion.`
    );

    return null;
  }

  return value;
}

async function main(): Promise<void> {
  const source = await readFile(TOKENS_FILE, "utf8");

  const light = readBlock(source, ":root {");
  const darkOverrides = readBlock(source, ':root[data-theme="dark"]');

  // The dark block is an OVERRIDE layer, exactly as the cascade applies it: a
  // token the dark block does not restate keeps its light value. Measuring the
  // dark block alone would silently skip every inherited token.
  const dark = new Map(light);

  for (const [name, value] of darkOverrides) {
    dark.set(name, value);
  }

  const themes: readonly Theme[] = [
    { name: "light", tokens: light },
    { name: "dark", tokens: dark }
  ];

  const failures: string[] = [];
  let measured = 0;

  for (const theme of themes) {
    for (const pair of PAIRS) {
      const foreground = resolve(theme, pair.fg, failures);
      const background = resolve(theme, pair.bg, failures);

      if (foreground === null || background === null) {
        continue;
      }

      const ratio = contrastRatio(foreground, background);
      measured += 1;

      if (ratio < pair.min) {
        failures.push(
          `[${theme.name}] --${pair.fg} (${foreground}) on --${pair.bg} (${background}) = ${ratio.toFixed(2)}:1, below the required ${pair.min}:1.\n` +
            `    rendered by: ${pair.renderedBy}\n` +
            `    fix the TOKEN, not this threshold — see the \`-strong\` and \`-on-soft\` docblocks in ${TOKENS_FILE} for why one hue needs more than one value.`
        );
      }
    }
  }

  if (failures.length > 0) {
    console.error(
      `design:token-contrast:check FAILED — ${failures.length} problem(s):\n`
    );

    for (const failure of failures) {
      console.error(`  - ${failure}`);
    }

    process.exit(1);
  }

  console.log(
    `design:token-contrast:check OK — ${measured} token pairs measured across ${themes.length} themes, all at or above WCAG 2.1 AA.`
  );
}

await main();
