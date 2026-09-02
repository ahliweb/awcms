/**
 * Theme toggle behaviour — cycles system → light → dark → system, persists the
 * choice in `localStorage[THEME_STORAGE_KEY]`, and updates `data-theme` on
 * `<html>` live (no reload).
 *
 * WHY THIS LIVES HERE AND NOT IN `ThemeToggle.astro`
 *
 * It used to be a `<script>` inside the component, and the component's own doc
 * comment asserted that Astro would bundle it to an external module because it
 * was not marked `is:inline`. That assertion was WRONG, and it was wrong in the
 * build output while reading correctly in the source — the third instance of a
 * class this repo has now hit three times:
 *
 *   1. `LanguageSwitcher` (v9.1.2) — same cause, found in production.
 *   2. The bare side-effect import that was the first attempted fix for it.
 *   3. This.
 *
 * The mechanism: Astro only emits a component `<script>` as an external file if
 * something survives bundling that requires a CROSS-CHUNK import. This script's
 * one import was `THEME_STORAGE_KEY`, a string constant — the minifier folds it
 * to a literal (`var e = "awcms_theme"`), the import disappears, nothing is left
 * that needs a chunk, and Astro writes the whole body into the SSR manifest's
 * `inlinedScripts` map. `renderScript` then emits it as
 * `<script type="module">…</script>`, and the CSP — `script-src 'self'` plus
 * exactly one hash, the theme-init body — refuses it. The button renders and
 * does nothing.
 *
 * Nothing about that is visible in dev, in `bun run build`, or in Playwright:
 * all three speak plain HTTP with no browser CSP enforcement. It is visible in
 * `dist/`, which is why `bun run build:inline-scripts:check` now reads the built
 * manifest and fails on ANY inlined script. That gate covers the class; this
 * file is one instance of the cure.
 *
 * The cure is to make the behaviour a real module that `AdminLayout.astro`'s
 * script imports alongside its other imports, so it lands in a shared chunk that
 * `script-src 'self'` admits with no hash bookkeeping. It also means this code
 * is type-checked, which a `.astro` `<script>` never is (ADR-0068 §B).
 */
import { THEME_STORAGE_KEY } from "../security/theme-init-script";

const ORDER = ["system", "light", "dark"] as const;
type ThemeMode = (typeof ORDER)[number];

/*
 * ADR-0120 — the three glyphs are now SVGs RENDERED BY THE COMPONENT, and this
 * module only chooses which one is visible.
 *
 * They used to be emoji assigned with `icon.textContent = ICONS[mode]`. Two
 * reasons that had to change, and the second is the one that matters:
 *
 *   1. Emoji render from the platform's own font — 🖥️ is a beige CRT on one
 *      machine and a flat glyph on another — so the one control that never
 *      matched the rest of the topbar was the one telling you about appearance.
 *   2. Swapping to SVG by assigning markup would mean `innerHTML` in client
 *      code. The values would be our own constants and therefore safe, but it
 *      establishes an `innerHTML` seam in the admin shell for decoration, which
 *      is a bad seam to have available. Rendering all three server-side and
 *      toggling `hidden` needs no markup assignment at all.
 */
const MODE_ICON_SELECTOR = ".theme-toggle-icon";

function isThemeMode(value: string | null): value is ThemeMode {
  return value === "system" || value === "light" || value === "dark";
}

function labelFor(button: HTMLElement, mode: ThemeMode): string {
  const key = `label${mode.charAt(0).toUpperCase()}${mode.slice(1)}` as
    "labelSystem" | "labelLight" | "labelDark";

  return button.dataset[key] ?? mode;
}

function resolveTheme(mode: ThemeMode): "light" | "dark" {
  if (mode === "light" || mode === "dark") {
    return mode;
  }

  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function applyButtonState(button: HTMLElement, mode: ThemeMode): void {
  button.dataset.mode = mode;

  // Every mode's glyph is in the DOM; exactly one is shown. `hidden` (not
  // `style.display`) because `tokens.css` makes that attribute authoritative.
  for (const icon of button.querySelectorAll<HTMLElement>(MODE_ICON_SELECTOR)) {
    icon.hidden = icon.dataset.mode !== mode;
  }

  const label = button.querySelector(".theme-toggle-label");

  if (label) {
    label.textContent = labelFor(button, mode);
  }

  /*
   * The accessible name has to follow the state too.
   *
   * The button's `aria-label` is a fixed "Change colour theme", which describes
   * the ACTION but never says which mode is active — and the visible label is
   * hidden at phone widths, so on a phone a screen-reader user had no way to
   * know whether they were in system, light or dark. `aria-description` carries
   * the current mode without replacing the action name.
   */
  button.setAttribute("aria-description", labelFor(button, mode));
}

function init(): void {
  const button = document.getElementById("theme-toggle");

  if (!button) {
    return;
  }

  // A hand-edited/corrupted localStorage value must not wedge the control:
  // anything unrecognised falls back to "system" rather than being trusted.
  const raw = localStorage.getItem(THEME_STORAGE_KEY);
  const stored: ThemeMode = isThemeMode(raw) ? raw : "system";
  applyButtonState(button, stored);

  // Follow the OS while in "system" mode, so the admin doesn't sit on a stale
  // theme when the machine flips at sunset with the tab open.
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  media.addEventListener("change", () => {
    if (button.dataset.mode === "system") {
      document.documentElement.setAttribute(
        "data-theme",
        resolveTheme("system")
      );
    }
  });

  button.addEventListener("click", () => {
    const current = button.dataset.mode;
    const currentMode: ThemeMode = isThemeMode(current ?? null)
      ? (current as ThemeMode)
      : "system";
    const nextIndex = (ORDER.indexOf(currentMode) + 1) % ORDER.length;
    const next = ORDER[nextIndex] ?? "system";

    localStorage.setItem(THEME_STORAGE_KEY, next);
    document.documentElement.setAttribute("data-theme", resolveTheme(next));
    applyButtonState(button, next);
  });
}

init();
