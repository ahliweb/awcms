/**
 * The settings form sends only what the viewer changed (Issue #1166, audit
 * M-1): a stale tab that edits the undo window must not re-assert `enabled`.
 */
import { describe, expect, test } from "bun:test";

import { settingsPatchFromForm } from "../../src/lib/ui/crm-leads-settings-patch";

describe("settingsPatchFromForm", () => {
  const initial = { enabled: true, mergeUndoHours: 168 };

  test("a changed undo window never carries the switch", () => {
    expect(
      settingsPatchFromForm(initial, { enabled: true, mergeUndoHours: 48 })
    ).toEqual({ mergeUndoHours: 48 });
  });

  test("a changed switch never carries the window", () => {
    expect(
      settingsPatchFromForm(initial, { enabled: false, mergeUndoHours: 168 })
    ).toEqual({ enabled: false });
  });

  test("both changed: both sent; neither changed: nothing is sent", () => {
    expect(
      settingsPatchFromForm(initial, { enabled: false, mergeUndoHours: 1 })
    ).toEqual({ enabled: false, mergeUndoHours: 1 });
    expect(settingsPatchFromForm(initial, { ...initial })).toBeNull();
  });
});
