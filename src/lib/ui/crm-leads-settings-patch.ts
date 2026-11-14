/**
 * The body of `PATCH /api/v1/crm-leads/settings` the settings form sends
 * (Issue #1166, audit M-1).
 *
 * The API has no version precondition, so a form that always sent BOTH fields
 * would let a stale tab silently undo another admin's change: switch the
 * module off in one tab, press Save for the undo window in another that still
 * shows "on", and the switch is back on, with lead capture running again. The
 * form therefore sends only the fields the viewer actually changed from the
 * values the page was rendered with. A pure function so a test runs the real
 * decision, not a source-text match.
 */
export type CrmSettingsFormValues = {
  enabled: boolean;
  mergeUndoHours: number;
};

export type CrmSettingsFormPatch = {
  enabled?: boolean;
  mergeUndoHours?: number;
};

/** `null` when nothing changed: no request is sent. */
export function settingsPatchFromForm(
  initial: CrmSettingsFormValues,
  current: CrmSettingsFormValues
): CrmSettingsFormPatch | null {
  const patch: Record<string, boolean | number> = {};

  for (const key of Object.keys(current) as (keyof CrmSettingsFormValues)[]) {
    if (current[key] !== initial[key]) patch[key] = current[key];
  }

  return Object.keys(patch).length === 0 ? null : patch;
}
