import { describe, expect, test } from "bun:test";

import { redactEmailAddressesInText } from "../src/modules/email/domain/email-log-redaction";

describe("redactEmailAddressesInText", () => {
  test("replaces an email-address-shaped substring", () => {
    expect(
      redactEmailAddressesInText("Invalid recipient: user@example.com")
    ).toBe("Invalid recipient: [REDACTED_EMAIL]");
  });

  test("replaces multiple occurrences", () => {
    expect(redactEmailAddressesInText("from a@b.com to c@d.co.id failed")).toBe(
      "from [REDACTED_EMAIL] to [REDACTED_EMAIL] failed"
    );
  });

  test("leaves text with no email addresses untouched", () => {
    expect(redactEmailAddressesInText("Wrong API Token")).toBe(
      "Wrong API Token"
    );
  });
});
