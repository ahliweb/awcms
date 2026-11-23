/**
 * The social dispatcher's closed vocabulary (the #1145 credential-path review,
 * L1) and the migration that enforces it (sql/427) must name the same values:
 * a phrase the code writes but the policy refuses would abort the dispatcher's
 * finalise transaction in production, and a value the policy admits but no code
 * writes is a channel a compromised role could still use.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import {
  SOCIAL_DISPATCH_ALLOWED_PHRASES,
  SOCIAL_DISPATCH_AUDIT_ACTIONS,
  SOCIAL_DISPATCH_AUDIT_ATTRIBUTE_KEYS,
  SOCIAL_DISPATCH_AUDIT_MESSAGES,
  SOCIAL_DISPATCH_PHRASES,
  phraseFor
} from "../src/modules/social-publishing/domain/social-dispatch-vocabulary";

const MIGRATION = readFileSync(
  "sql/427_awcms_social_dispatch_secret_view_and_value_bounds.sql",
  "utf8"
);
const DISPATCHER = readFileSync(
  "src/modules/social-publishing/application/social-publish-dispatch.ts",
  "utf8"
);
const literal = (value: string) => `'${value.replace(/'/g, "''")}'`;

/** The quoted literals of the `IN ( ... )` list that follows `marker` in the migration. */
function inList(marker: string): string[] {
  const from = MIGRATION.indexOf(marker);
  const open = MIGRATION.indexOf("(", from + marker.length - 1);
  const close = MIGRATION.indexOf("\n    )", open);
  const body = MIGRATION.slice(open + 1, close);

  return [...body.matchAll(/'((?:[^']|'')*)'/g)].map((match) =>
    match[1]!.replace(/''/g, "'")
  );
}

describe("social dispatch vocabulary (L1)", () => {
  test("every phrase phraseFor can return is in the allowed list", () => {
    const codes = [
      ...Object.keys(SOCIAL_DISPATCH_PHRASES),
      "ACCOUNT_REVOKED",
      "HELD_ACCOUNT_DEGRADED",
      "SOMETHING_ELSE",
      "",
      "__proto__",
      "constructor"
    ];

    for (const code of codes) {
      expect(SOCIAL_DISPATCH_ALLOWED_PHRASES).toContain(phraseFor(code));
    }
  });

  test("phraseFor never echoes the code it is given", () => {
    for (const code of ["EAAG_TOKEN_123", "ACCOUNT_EAAG", "HELD_EAAG"]) {
      expect(phraseFor(code)).not.toContain(code);
    }
  });

  test("the last_error and error_message lists of sql/427 are exactly the allowed phrases", () => {
    expect(inList("OR last_error IN (")).toEqual([
      ...SOCIAL_DISPATCH_ALLOWED_PHRASES
    ]);
    expect(inList("OR error_message IN (")).toEqual([
      ...SOCIAL_DISPATCH_ALLOWED_PHRASES
    ]);
  });

  test("the audit message, action and key lists of sql/427 are exactly the vocabulary", () => {
    expect(inList("AND message IN (")).toEqual(
      Object.values(SOCIAL_DISPATCH_AUDIT_MESSAGES)
    );
    expect(inList("AND action IN (")).toEqual([
      ...SOCIAL_DISPATCH_AUDIT_ACTIONS
    ]);

    for (const key of SOCIAL_DISPATCH_AUDIT_ATTRIBUTE_KEYS) {
      expect(MIGRATION).toContain(literal(key));
    }
  });

  test("the dispatcher writes its audit messages and phrases only through the vocabulary", () => {
    // No inline message or phrase literal left in the dispatcher: each one goes
    // through SOCIAL_DISPATCH_AUDIT_MESSAGES / phraseFor / PHRASES.
    expect(DISPATCHER).not.toMatch(/message:\s*\n?\s*"/);
    expect(DISPATCHER).not.toMatch(/last_error = '[^']/);

    for (const message of Object.values(SOCIAL_DISPATCH_AUDIT_MESSAGES)) {
      expect(DISPATCHER).not.toContain(message);
    }
  });
});
