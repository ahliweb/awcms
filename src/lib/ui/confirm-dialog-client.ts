/**
 * `ConfirmDialog`'s client half (Issue #854 part 1) — see
 * `../../components/ConfirmDialog.astro` for the markup, the docblock on why
 * this replaces `window.confirm()`, and an accessibility summary.
 *
 * This module is imported by `AdminLayout.astro`'s own script (the one
 * already proven external under this app's CSP — see that file's header
 * comment) so `initConfirmDialog()` runs once per page. Individual admin
 * screens import only {@link confirmAction} and never call
 * `initConfirmDialog` themselves.
 */

/** Matches `ConfirmDialog.astro`'s default `id` prop. */
export const CONFIRM_DIALOG_ID = "confirm-dialog";

type Confirmer = (message: string) => Promise<boolean>;

/**
 * Finds the one `<dialog id={dialogId}>` on the page and returns a function
 * that shows it with `message`, resolving `true`/`false` for confirm/cancel.
 *
 * Returns a function that always resolves `false` when the dialog or any of
 * its parts are missing from the DOM — the normal case on a page that never
 * imported `ConfirmDialog`, or (defensively) a markup regression. Silently
 * refusing every confirmation is the safe failure mode for a gate that exists
 * to stop a destructive action: it never lets one through unconfirmed.
 */
export function initConfirmDialog(
  dialogId: string = CONFIRM_DIALOG_ID
): Confirmer {
  const dialog = document.getElementById(dialogId);
  const message = document.getElementById(`${dialogId}-message`);
  const confirmButton = document.getElementById(`${dialogId}-confirm`);
  const cancelButton = document.getElementById(`${dialogId}-cancel`);

  if (
    !(dialog instanceof HTMLDialogElement) ||
    !message ||
    !confirmButton ||
    !cancelButton
  ) {
    return () => Promise.resolve(false);
  }

  // Control-flow narrowing from the checks above does not survive into the
  // nested function declarations below (a known TypeScript limitation for
  // closures) — these three are SEPARATE bindings that carry the narrowed
  // types explicitly, so every closure below reads real elements, never
  // `... | null`.
  const dialogElement: HTMLDialogElement = dialog;
  const confirm: HTMLElement = confirmButton;
  const cancel: HTMLElement = cancelButton;

  return (text: string) =>
    new Promise<boolean>((resolve) => {
      message.textContent = text;

      function onConfirm(): void {
        cleanup();
        resolve(true);
      }
      function onCancel(): void {
        cleanup();
        resolve(false);
      }
      function cleanup(): void {
        confirm.removeEventListener("click", onConfirm);
        cancel.removeEventListener("click", onCancel);
        dialogElement.removeEventListener("cancel", onCancel);
        if (dialogElement.open) dialogElement.close();
      }

      confirm.addEventListener("click", onConfirm);
      cancel.addEventListener("click", onCancel);
      // The native `cancel` event fires for Escape AND is the platform's own
      // "the operator backed out" signal — treating it as Cancel (not a
      // silent no-op) is what makes Escape reliably mean "no" here.
      dialogElement.addEventListener("cancel", onCancel);
      dialogElement.showModal();
    });
}

/**
 * The ONE shared confirm function every admin screen imports.
 *
 * Lazily wires the page's `<dialog id="confirm-dialog">` on first use and
 * caches the result — `AdminLayout` renders that dialog on every `/admin/*`
 * page, so any screen's own `<script>` can call this directly with no setup
 * call of its own:
 *
 * ```ts
 * import { confirmAction } from "../../lib/ui/confirm-dialog-client";
 *
 * if (!(await confirmAction(t("Delete this row?")))) return;
 * ```
 */
let cachedConfirmer: Confirmer | null = null;

export function confirmAction(message: string): Promise<boolean> {
  if (!cachedConfirmer) cachedConfirmer = initConfirmDialog();
  return cachedConfirmer(message);
}

/** Test-only: clears the cached confirmer so a fresh DOM is picked up. */
export function _resetConfirmDialogCacheForTests(): void {
  cachedConfirmer = null;
}
