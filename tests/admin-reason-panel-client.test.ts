/**
 * Unit tests for the PURE functions in `reason-panel-client.ts` (Issue #854
 * part 3) — no `document`, so these run under plain `bun:test` (this repo has
 * no DOM shim registered for unit tests; the DOM-touching half of this module
 * is covered by `tests/e2e/admin-modules-toggle.e2e.ts`'s reason-panel
 * open/fill/submit flow instead).
 */
import { describe, expect, test } from "bun:test";

import {
  isReasonValid,
  resolveOpenerConfig,
  type ReasonOpenerDataset,
  type ReasonPanelDefaults
} from "../src/lib/ui/reason-panel-client";

const defaults: ReasonPanelDefaults = {
  defaultSubmitLabel: "Confirm",
  defaultBusyLabel: "Please wait…",
  defaultFailureMessage: "Could not save this action. Please try again."
};

describe("resolveOpenerConfig", () => {
  test("returns null when data-reason-title is missing or blank", () => {
    expect(
      resolveOpenerConfig(
        { reasonAction: "/api/v1/x" } as ReasonOpenerDataset,
        defaults
      )
    ).toBeNull();
    expect(
      resolveOpenerConfig(
        { reasonTitle: "   ", reasonAction: "/api/v1/x" },
        defaults
      )
    ).toBeNull();
  });

  test("returns null when neither data-reason-action nor data-reason-form is given", () => {
    expect(
      resolveOpenerConfig({ reasonTitle: "Delete?" }, defaults)
    ).toBeNull();
  });

  test("returns null when BOTH data-reason-action and data-reason-form are given (ambiguous)", () => {
    expect(
      resolveOpenerConfig(
        {
          reasonTitle: "Delete?",
          reasonAction: "/api/v1/x",
          reasonForm: "some-form"
        },
        defaults
      )
    ).toBeNull();
  });

  test("fetch mode: resolves defaults for every optional field", () => {
    const config = resolveOpenerConfig(
      { reasonTitle: "Delete this?", reasonAction: "/api/v1/media/1" },
      defaults
    );

    expect(config).toEqual({
      title: "Delete this?",
      description: null,
      submitLabel: "Confirm",
      busyLabel: "Please wait…",
      failureMessage: "Could not save this action. Please try again.",
      danger: false,
      minLength: 1,
      maxLength: null,
      field: "reason",
      mode: "fetch",
      action: "/api/v1/media/1",
      method: "POST",
      idempotent: false
    });
  });

  test("fetch mode: reads every override, including danger/idempotent presence flags", () => {
    const config = resolveOpenerConfig(
      {
        reasonTitle: "Delete this?",
        reasonDescription: "  Cannot be undone.  ",
        reasonAction: "/api/v1/media/1",
        reasonMethod: "delete",
        reasonField: "deleteReason",
        reasonMinLength: "8",
        reasonMaxLength: "500",
        reasonLabel: "Delete",
        reasonDanger: "",
        reasonBusyLabel: "Deleting…",
        reasonFailure: "Could not delete it.",
        reasonIdempotent: ""
      },
      defaults
    );

    expect(config).toEqual({
      title: "Delete this?",
      description: "Cannot be undone.",
      submitLabel: "Delete",
      busyLabel: "Deleting…",
      failureMessage: "Could not delete it.",
      danger: true,
      minLength: 8,
      maxLength: 500,
      field: "deleteReason",
      mode: "fetch",
      action: "/api/v1/media/1",
      method: "DELETE",
      idempotent: true
    });
  });

  test("form mode: writes into an existing form and carries no fetch-only fields", () => {
    const config = resolveOpenerConfig(
      { reasonTitle: "Reject?", reasonForm: "decision-form" },
      defaults
    );

    expect(config).toEqual({
      title: "Reject?",
      description: null,
      submitLabel: "Confirm",
      busyLabel: "Please wait…",
      failureMessage: "Could not save this action. Please try again.",
      danger: false,
      minLength: 1,
      maxLength: null,
      field: "reason",
      mode: "form",
      formId: "decision-form"
    });
  });

  test("an invalid min/max length falls back rather than producing NaN/0", () => {
    const config = resolveOpenerConfig(
      {
        reasonTitle: "Delete?",
        reasonAction: "/api/v1/x",
        reasonMinLength: "not-a-number",
        reasonMaxLength: "-5"
      },
      defaults
    );

    expect(config?.minLength).toBe(1);
    expect(config?.maxLength).toBeNull();
  });
});

describe("isReasonValid", () => {
  test("rejects a value shorter than minLength after trimming", () => {
    expect(isReasonValid("  ab  ", 3)).toBe(false);
  });

  test("accepts a value that meets minLength after trimming", () => {
    expect(isReasonValid("  abc  ", 3)).toBe(true);
  });

  test("whitespace-only never satisfies a minLength of 1", () => {
    expect(isReasonValid("   ", 1)).toBe(false);
  });
});
