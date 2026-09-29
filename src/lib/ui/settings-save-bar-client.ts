/**
 * `SettingsSaveBar`'s optional client half (Issue #854 part 2) — see
 * `../../components/SettingsSaveBar.astro` for the markup and why the bar is
 * ALWAYS rendered rather than hidden until a field changes.
 *
 * This module adds exactly the VISUAL distinction between "nothing changed
 * yet" and "there is something to save" — a class toggle on the bar and, if
 * the caller renders a `status` slot element with an id, a text swap — and
 * nothing else. It never hides or disables the bar's own Save/Reset buttons:
 * both already work with no JavaScript at all, and this module's absence (or
 * failure) must never take that away.
 *
 * Wiring is entirely through `data-*` attributes the component already
 * writes (`data-save-bar`, `data-save-bar-form`), so a page adopting
 * `SettingsSaveBar` needs only ONE call:
 *
 * ```ts
 * import { initSettingsSaveBars } from "../../lib/ui/settings-save-bar-client";
 * initSettingsSaveBars();
 * ```
 *
 * Optionally pass the ids of the status text elements and their two labels
 * via `data-dirty-label`/`data-clean-label` on the SAME element the `status`
 * slot renders (this module never invents copy — a screen that wants the
 * text to change supplies both strings, already translated).
 */

/** Selector for every bar this module wires. Matches the component's own attribute. */
export const SAVE_BAR_SELECTOR = "[data-save-bar]";

/** The class this module toggles once a tracked form changes. Purely presentational. */
export const DIRTY_CLASS = "is-dirty";

/**
 * Whichever of the two status labels applies right now. Pure — exported so a
 * test can drive it without a fake `document`.
 */
export function resolveStatusText(
  isDirty: boolean,
  dirtyLabel: string | undefined,
  cleanLabel: string | undefined
): string | null {
  return (isDirty ? dirtyLabel : cleanLabel) ?? null;
}

function wireOne(bar: HTMLElement): void {
  const formId = bar.dataset.saveBarForm;
  if (!formId) return;

  const form = document.getElementById(formId);
  if (!(form instanceof HTMLFormElement)) return;

  const status = bar.querySelector<HTMLElement>(".save-bar-status [id]");
  const dirtyLabel = status?.dataset.dirtyLabel;
  const cleanLabel = status?.dataset.cleanLabel;

  function setDirty(isDirty: boolean): void {
    bar.classList.toggle(DIRTY_CLASS, isDirty);

    if (!status) return;
    const text = resolveStatusText(isDirty, dirtyLabel, cleanLabel);
    if (text !== null) status.textContent = text;
  }

  form.addEventListener("input", () => setDirty(true));
  form.addEventListener("change", () => setDirty(true));
  form.addEventListener("reset", () => setDirty(false));
}

/** Wires every `SettingsSaveBar` on the page. Safe to call once per page load; does nothing when none is present. */
export function initSettingsSaveBars(): void {
  for (const bar of document.querySelectorAll<HTMLElement>(SAVE_BAR_SELECTOR)) {
    wireOne(bar);
  }
}
