/**
 * `.admin-bulk-bar`'s pure client-side logic (Issue #862, wave 3 of #858) —
 * everything about the bar that does not need a real DOM: which decision a
 * clicked button's `data-bulk-action` names, how to fill the `{count}`
 * placeholder a server-translated template carries (client scripts cannot
 * translate — see `../i18n`'s catalog, a server-only module — so every string
 * the bar shows reaches it pre-translated via a `data-*` attribute), and what
 * the bar's own visibility/count/select-all state should be for a given
 * selection.
 *
 * The DOM wiring (querying checkboxes, listening for `change`, calling
 * `fetch`) stays inline in each consumer's own `<script>` — it is a few lines
 * per screen and gains nothing from being abstracted here, per this
 * codebase's existing `reason-panel-client.ts` split between pure logic
 * (tested directly) and DOM glue (covered by the e2e/typecheck layers
 * instead).
 */

/** The three decisions the EXISTING `bulk-moderate` endpoint accepts. */
export type BulkDecision = "approve" | "reject" | "spam";

/** Narrows a `button.dataset.bulkAction` read to a known {@link BulkDecision}. */
export function isBulkDecision(
  value: string | undefined
): value is BulkDecision {
  return value === "approve" || value === "reject" || value === "spam";
}

/**
 * Substitutes the one `{count}` placeholder a server-rendered template
 * carries. Unlike the server-side `t()`/`tn()` helpers, this is intentionally
 * not general-purpose interpolation — the bar has exactly one number to show,
 * and a second placeholder style here would just be an unused feature to
 * maintain.
 */
export function fillCount(template: string, count: number): string {
  return template.replace("{count}", String(count));
}

/** What the bar's DOM should reflect for a given selection. */
export type BulkBarState = {
  /** Whether the bar itself should be hidden (nothing selected). */
  hidden: boolean;
  /** The `{count}` template filled in with the current selection size. */
  countText: string;
  /** Whether the header's select-all checkbox should read as checked. */
  selectAllChecked: boolean;
  /**
   * Whether the header's select-all checkbox should read as indeterminate —
   * some, but not all, rows selected. `<input>.indeterminate` is a DOM
   * property with no HTML attribute equivalent, so the caller must still set
   * it directly; this only says what value it should be set to.
   */
  selectAllIndeterminate: boolean;
};

/**
 * Pure projection from "how many rows exist" / "how many are checked" to the
 * bar's full visible state — the one calculation `updateBulkBar()` in each
 * consumer's `<script>` needs, factored out so it is covered by a test that
 * needs no `document`.
 */
export function computeBulkBarState(
  totalRows: number,
  selectedRows: number,
  countTemplate: string
): BulkBarState {
  return {
    hidden: selectedRows === 0,
    countText: fillCount(countTemplate, selectedRows),
    selectAllChecked: totalRows > 0 && selectedRows === totalRows,
    selectAllIndeterminate: selectedRows > 0 && selectedRows < totalRows
  };
}
