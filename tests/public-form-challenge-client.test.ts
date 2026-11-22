/**
 * Client helper of the public-form challenge seam (Issue #1353). Pure: a
 * FormData and a minimal fake DOM root, no browser.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import {
  CHALLENGE_WIDGET_SELECTOR,
  focusChallengeOnRefusal,
  isChallengeRefusalCode,
  readChallengeFields
} from "../src/lib/ui/public-form-challenge-client";

function form(fields: Record<string, string>): FormData {
  const data = new FormData();

  for (const [name, value] of Object.entries(fields)) {
    data.set(name, value);
  }

  return data;
}

function fakeRoot(withWidget: boolean) {
  const attributes = new Map<string, string>();
  let focused = 0;
  const widget = {
    hasAttribute: (name: string) => attributes.has(name),
    setAttribute: (name: string, value: string) => attributes.set(name, value),
    focus: () => {
      focused += 1;
    }
  };

  return {
    root: {
      querySelector: (selector: string) =>
        withWidget && selector === CHALLENGE_WIDGET_SELECTOR ? widget : null
    } as unknown as ParentNode,
    attributes,
    focused: () => focused
  };
}

describe("readChallengeFields", () => {
  test("no widget on the page: an empty object, so the body is unchanged", () => {
    expect(readChallengeFields(form({ loginIdentifier: "a" }))).toEqual({});
  });

  test("reads the three contract fields", () => {
    expect(
      readChallengeFields(
        form({ challengeId: "i", challengeAnswer: "4", challengeToken: "t" })
      )
    ).toEqual({ challengeId: "i", challengeAnswer: "4", challengeToken: "t" });
  });

  test("Turnstile's cf-turnstile-response is read as challengeToken; the contract field wins", () => {
    expect(
      readChallengeFields(form({ "cf-turnstile-response": "cf" }))
    ).toEqual({ challengeToken: "cf" });
    expect(
      readChallengeFields(
        form({ challengeToken: "own", "cf-turnstile-response": "cf" })
      )
    ).toEqual({ challengeToken: "own" });
  });

  test("empty and oversize values are not sent", () => {
    expect(
      readChallengeFields(
        form({ challengeToken: "", challengeAnswer: "x".repeat(5000) })
      )
    ).toEqual({});
  });

  test("a File value is not a field value", () => {
    const data = new FormData();
    data.set("challengeToken", new File(["x"], "x.txt"));

    expect(readChallengeFields(data)).toEqual({});
  });
});

describe("focus on refusal", () => {
  test("recognises the neutral and the Turnstile refusal codes only", () => {
    for (const code of [
      "CHALLENGE_REQUIRED",
      "CHALLENGE_INVALID",
      "TURNSTILE_REQUIRED",
      "TURNSTILE_INVALID"
    ]) {
      expect(isChallengeRefusalCode(code)).toBe(true);
    }

    for (const code of ["RATE_LIMITED", "VALIDATION_ERROR", undefined, 400]) {
      expect(isChallengeRefusalCode(code)).toBe(false);
    }
  });

  test("a refusal hands focus to the widget and makes it focusable", () => {
    const fake = fakeRoot(true);

    expect(
      focusChallengeOnRefusal(fake.root, {
        error: { code: "CHALLENGE_INVALID" }
      })
    ).toBe(true);
    expect(fake.focused()).toBe(1);
    expect(fake.attributes.get("tabindex")).toBe("-1");
  });

  test("a body that is null, a string or has no error is not a refusal", () => {
    for (const body of [null, undefined, "x", {}, { error: null }, 7]) {
      expect(focusChallengeOnRefusal(fakeRoot(true).root, body)).toBe(false);
    }
  });

  test("another error code leaves focus alone; no widget is not an error", () => {
    const fake = fakeRoot(true);

    expect(
      focusChallengeOnRefusal(fake.root, {
        error: { code: "RATE_LIMITED" }
      })
    ).toBe(false);
    expect(fake.focused()).toBe(0);
    expect(
      focusChallengeOnRefusal(fakeRoot(false).root, {
        error: { code: "CHALLENGE_INVALID" }
      })
    ).toBe(false);
  });
});

describe("page wiring", () => {
  for (const page of ["forgot-password", "reset-password"]) {
    test(`${page}.astro imports the helper (so its script is bundled, not inlined) and uses it`, () => {
      const text = readFileSync(
        new URL(`../src/pages/${page}.astro`, import.meta.url),
        "utf8"
      );

      expect(text).toContain("lib/ui/public-form-challenge-client");
      expect(text).toContain("readChallengeFields(formData)");
      expect(text).toContain("focusChallengeOnRefusal(form, payload)");
    });
  }
});
