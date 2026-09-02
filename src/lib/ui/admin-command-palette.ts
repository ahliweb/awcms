/**
 * Command palette (Cmd/Ctrl+K) for the admin shell — ADR-0120.
 *
 * ## What it is, and what it deliberately is not
 *
 * It filters the links ALREADY IN THE PAGE. `AdminLayout` renders every nav
 * entry this caller can see into the dialog's `<ul>` at SSR time, and this
 * script only shows and hides them.
 *
 * That is the whole design, and it is worth saying why, because the obvious
 * version of this feature is a search endpoint:
 *
 *   - **No fetch, so no permission surface.** A `/api/v1/admin/search` would be
 *     a new endpoint that must decide what this caller may see, and getting it
 *     wrong leaks the existence of screens. The sidebar has already made that
 *     decision, correctly, on the server (`composeSidebarSections` filters by
 *     `grantedPermissionKeys` and tenant-disabled modules). Reusing its output
 *     means the palette cannot be more permissive than the menu — not by policy,
 *     but structurally, because it has nothing else to show.
 *   - **No fetch, so it works offline.** This repo ships a LAN/offline profile.
 *   - **No fetch, so no `connect-src` change.**
 *
 * The cost, stated: it searches SCREEN NAMES, not content. Typing an article
 * title finds nothing. That is a real limit and the placeholder says so rather
 * than implying otherwise.
 *
 * ## Why `<dialog>`
 *
 * `showModal()` brings the focus trap, Escape-to-close, inertness of the page
 * behind, the `::backdrop` element, and focus restoration to the opener. Every
 * one of those is something hand-rolled modal code gets wrong, and none of them
 * is behaviour we then have to own or test.
 *
 * ## CSP
 *
 * Loaded by `AdminLayout`'s bundled `<script>`, which keeps a cross-chunk
 * import so Astro emits it as an EXTERNAL module. See that file's comment for
 * why "has an import" is the wrong way to state that rule.
 */

/** Ids owned by `AdminLayout.astro`. Changing one means changing both. */
const DIALOG_ID = "admin-palette";
const OPEN_BUTTON_ID = "admin-palette-open";
const INPUT_ID = "admin-palette-input";
const EMPTY_ID = "admin-palette-empty";

/**
 * Attribute carrying the pre-lowercased text to match against.
 *
 * Written by the server rather than derived here so the comparison does not
 * depend on the browser's locale casing rules — `toLowerCase()` on a Turkish
 * locale famously maps `I` to `ı`, which would make a screen called "Identity"
 * unfindable by typing "id" on exactly the machines least likely to report it.
 */
const HAYSTACK_ATTRIBUTE = "data-search";

export function initAdminCommandPalette(): void {
  const dialogElement = document.getElementById(DIALOG_ID);
  const inputElement = document.getElementById(INPUT_ID);

  // Not an error: a page may render the shell without the palette (the whole
  // element is absent when the caller can see no nav entries at all).
  if (
    !(dialogElement instanceof HTMLDialogElement) ||
    !(inputElement instanceof HTMLInputElement)
  ) {
    return;
  }

  /*
   * Re-bound to fresh consts, which is not ceremony.
   *
   * TypeScript's `instanceof` narrowing does not survive into the function
   * DECLARATIONS below — those could in principle be called after a later
   * reassignment, so the compiler widens the captured binding back to
   * `HTMLElement | null`. Binding the narrowed values here is what lets the
   * handlers use `.showModal()` and `.value` without a cast per call site.
   */
  const dialog: HTMLDialogElement = dialogElement;
  const input: HTMLInputElement = inputElement;
  const empty = document.getElementById(EMPTY_ID);

  const items = Array.from(
    dialog.querySelectorAll<HTMLLIElement>("li[data-search]")
  );

  function applyFilter(): void {
    const query = input.value.trim().toLowerCase();
    let visible = 0;

    for (const item of items) {
      const haystack = item.getAttribute(HAYSTACK_ATTRIBUTE) ?? "";
      const matches = query === "" || haystack.includes(query);

      // `hidden` rather than `style.display`, because `tokens.css` carries the
      // global `[hidden] { display: none !important }` that makes the attribute
      // authoritative — see that rule's comment for the four auth pages a
      // competing `display` rule silently broke.
      item.hidden = !matches;

      if (matches) {
        visible += 1;
      }
    }

    if (empty !== null) {
      empty.hidden = visible > 0;
    }
  }

  function open(): void {
    if (dialog.open) {
      return;
    }

    input.value = "";
    applyFilter();
    dialog.showModal();
    // After `showModal()`, so focus lands in the field rather than on the
    // dialog itself.
    input.focus();
  }

  const openButton = document.getElementById(OPEN_BUTTON_ID);

  openButton?.addEventListener("click", open);
  input.addEventListener("input", applyFilter);

  /*
   * Cmd+K on macOS, Ctrl+K elsewhere.
   *
   * `event.key` is compared case-insensitively because holding Shift (or having
   * Caps Lock on) reports `"K"`, and a shortcut that stops working with Caps
   * Lock is the kind of defect nobody reports and everybody notices.
   *
   * Guarded against firing while the operator is typing in a real field, so
   * Ctrl+K inside a text input keeps whatever meaning the platform gives it.
   */
  document.addEventListener("keydown", (event) => {
    if (event.key.toLowerCase() !== "k" || !(event.metaKey || event.ctrlKey)) {
      return;
    }

    const active = document.activeElement;
    const typing =
      active instanceof HTMLInputElement ||
      active instanceof HTMLTextAreaElement ||
      (active instanceof HTMLElement && active.isContentEditable);

    if (typing && active !== input) {
      return;
    }

    event.preventDefault();
    open();
  });

  /*
   * Click on the backdrop closes.
   *
   * A click on `::backdrop` is reported with the DIALOG as its target, because
   * the backdrop is not an element in the tree. So: a click whose target IS the
   * dialog came from outside the panel, and one from inside is targeted at a
   * descendant. `Escape` is already handled by the element itself.
   */
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) {
      dialog.close();
    }
  });

  /*
   * Down/Up move from the field into the results and along them.
   *
   * Tab already works — the links are in the tab order and the dialog traps
   * focus. This adds the arrow keys people expect from a palette without
   * replacing the behaviour the platform provides.
   */
  dialog.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") {
      return;
    }

    const links = items
      .filter((item) => !item.hidden)
      .map((item) => item.querySelector("a"))
      .filter((link): link is HTMLAnchorElement => link !== null);

    if (links.length === 0) {
      return;
    }

    event.preventDefault();

    const index = links.indexOf(document.activeElement as HTMLAnchorElement);

    if (event.key === "ArrowDown") {
      // From the input (`index === -1`) the first press lands on the first
      // result; from the last result it wraps to the first.
      links[(index + 1) % links.length]?.focus();

      return;
    }

    if (index <= 0) {
      // Up from the first result (or from the input) returns to the field, so
      // the operator can keep typing without reaching for the mouse.
      input.focus();

      return;
    }

    links[index - 1]?.focus();
  });
}
