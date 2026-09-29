/**
 * Unit tests for the PURE function in `settings-save-bar-client.ts`
 * (Issue #854 part 2) — no `document`, so this runs under plain `bun:test`.
 * The DOM-wiring half (`initSettingsSaveBars`) is exercised implicitly by
 * every admin screen that adopts `SettingsSaveBar` and is loaded under
 * `check:astro-scripts:check`; a full interaction test belongs in Playwright,
 * not here.
 */
import { describe, expect, test } from "bun:test";

import { resolveStatusText } from "../src/lib/ui/settings-save-bar-client";

describe("resolveStatusText", () => {
  test("returns the dirty label when dirty and one was given", () => {
    expect(resolveStatusText(true, "Unsaved changes", "Saved")).toBe(
      "Unsaved changes"
    );
  });

  test("returns the clean label when not dirty and one was given", () => {
    expect(resolveStatusText(false, "Unsaved changes", "Saved")).toBe("Saved");
  });

  test("returns null when the relevant label was not supplied", () => {
    expect(resolveStatusText(true, undefined, "Saved")).toBeNull();
    expect(resolveStatusText(false, "Unsaved changes", undefined)).toBeNull();
  });

  test("returns null when neither label was supplied", () => {
    expect(resolveStatusText(true, undefined, undefined)).toBeNull();
    expect(resolveStatusText(false, undefined, undefined)).toBeNull();
  });
});
