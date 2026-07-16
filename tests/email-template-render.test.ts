import { describe, expect, test } from "bun:test";

import {
  renderEmailTemplate,
  resolveLocaleVariant
} from "../src/modules/email/domain/email-template-render";
import {
  registerDerivedEmailTemplateCategory,
  resetDerivedEmailTemplateCategoriesForTests
} from "../src/modules/email/domain/email-template-categories";

const PASSWORD_RESET_TEMPLATE = {
  subjectTemplate: {
    en: "Reset your password, {{userName}}",
    id: "Atur ulang kata sandi Anda, {{userName}}"
  },
  textBodyTemplate: {
    en: "Click {{resetUrl}} to reset. Expires in {{expiresInMinutes}} minutes.",
    id: "Klik {{resetUrl}} untuk atur ulang."
  },
  htmlBodyTemplate: null
};

describe("resolveLocaleVariant", () => {
  test("returns the requested locale when present", () => {
    expect(resolveLocaleVariant({ en: "Hello", id: "Halo" }, "id")).toBe(
      "Halo"
    );
  });

  test("falls back to en when the requested locale is missing", () => {
    expect(resolveLocaleVariant({ en: "Hello" }, "fr")).toBe("Hello");
  });

  test("returns null when neither the requested locale nor en exist", () => {
    expect(resolveLocaleVariant({ id: "Halo" }, "fr")).toBeNull();
  });

  test("returns null for a null variants map", () => {
    expect(resolveLocaleVariant(null, "en")).toBeNull();
  });
});

describe("renderEmailTemplate", () => {
  test("substitutes allowlisted variables into subject and text body without escaping, locale=en", () => {
    const result = renderEmailTemplate(
      PASSWORD_RESET_TEMPLATE,
      {
        userName: "Alice & Bob",
        resetUrl: "https://example.com/reset?token=abc",
        expiresInMinutes: "30"
      },
      "auth.password_reset",
      "en"
    );

    expect(result.subject).toBe("Reset your password, Alice & Bob");
    expect(result.textBody).toBe(
      "Click https://example.com/reset?token=abc to reset. Expires in 30 minutes."
    );
    expect(result.htmlBody).toBeUndefined();
  });

  test("selects the requested locale variant", () => {
    const result = renderEmailTemplate(
      PASSWORD_RESET_TEMPLATE,
      { userName: "Alice" },
      "auth.password_reset",
      "id"
    );

    expect(result.subject).toBe("Atur ulang kata sandi Anda, Alice");
  });

  test("falls back to en when the requested locale variant is missing (text body has no id variant for the html-body slot in this fixture, but subject does — verifying fallback on a body missing a locale)", () => {
    const templateMissingIdBody = {
      subjectTemplate: { en: "Subject", id: "Subjek" },
      textBodyTemplate: { en: "Body only in English" },
      htmlBodyTemplate: null
    };

    const result = renderEmailTemplate(
      templateMissingIdBody,
      {},
      "auth.password_reset",
      "id"
    );

    expect(result.subject).toBe("Subjek");
    expect(result.textBody).toBe("Body only in English");
  });

  test("HTML-escapes values substituted into the HTML body only", () => {
    const result = renderEmailTemplate(
      {
        subjectTemplate: { en: "Hi {{userName}}" },
        textBodyTemplate: null,
        htmlBodyTemplate: { en: "<p>Hi {{userName}}</p>" }
      },
      { userName: "<script>alert(1)</script>" },
      "auth.password_reset",
      "en"
    );

    expect(result.subject).toBe("Hi <script>alert(1)</script>");
    expect(result.htmlBody).toBe(
      "<p>Hi &lt;script&gt;alert(1)&lt;/script&gt;</p>"
    );
  });

  test("missing variables render as an empty string, never a literal token", () => {
    const result = renderEmailTemplate(
      {
        subjectTemplate: { en: "Hi {{userName}}" },
        textBodyTemplate: { en: "Body {{resetUrl}}" },
        htmlBodyTemplate: null
      },
      {},
      "auth.password_reset",
      "en"
    );

    expect(result.subject).toBe("Hi ");
    expect(result.textBody).toBe("Body ");
  });

  test("a variable not on the category's allowlist is never substituted, even if provided", () => {
    const result = renderEmailTemplate(
      {
        subjectTemplate: { en: "Hi {{userName}}, token={{secretToken}}" },
        textBodyTemplate: null,
        htmlBodyTemplate: null
      },
      { userName: "Alice", secretToken: "raw-secret-value" },
      "auth.password_reset",
      "en"
    );

    expect(result.subject).toBe("Hi Alice, token=");
    expect(result.subject).not.toContain("raw-secret-value");
  });

  test("an unrecognized category allows no variables at all", () => {
    const result = renderEmailTemplate(
      {
        subjectTemplate: { en: "Hi {{userName}}" },
        textBodyTemplate: null,
        htmlBodyTemplate: null
      },
      { userName: "Alice" },
      "unknown.category",
      "en"
    );

    expect(result.subject).toBe("Hi ");
  });

  test("a registered derived category's allowlist is honored", () => {
    resetDerivedEmailTemplateCategoriesForTests();
    registerDerivedEmailTemplateCategory("derived.order_confirmation", [
      "orderNumber"
    ]);

    const result = renderEmailTemplate(
      {
        subjectTemplate: { en: "Order {{orderNumber}} ({{internalNote}})" },
        textBodyTemplate: null,
        htmlBodyTemplate: null
      },
      { orderNumber: "A123", internalNote: "should not appear" },
      "derived.order_confirmation",
      "en"
    );

    expect(result.subject).toBe("Order A123 ()");
    resetDerivedEmailTemplateCategoriesForTests();
  });
});
