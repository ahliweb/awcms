import { describe, expect, test } from "bun:test";

import {
  validateCreateEmailTemplateInput,
  validateUpdateEmailTemplateInput
} from "../src/modules/email/domain/email-template-validation";

const VALID_CREATE_BODY = {
  templateKey: "auth.password_reset",
  name: "Password reset",
  subjectTemplate: { en: "Reset your password", id: "Atur ulang kata sandi" },
  textBodyTemplate: { en: "Click {{resetUrl}}", id: "Klik {{resetUrl}}" }
};

describe("validateCreateEmailTemplateInput", () => {
  test("accepts a valid body", () => {
    const result = validateCreateEmailTemplateInput(VALID_CREATE_BODY);
    expect(result.valid).toBe(true);
  });

  test("rejects a malformed templateKey", () => {
    const result = validateCreateEmailTemplateInput({
      ...VALID_CREATE_BODY,
      templateKey: "NotLowercase"
    });
    expect(result.valid).toBe(false);
  });

  test("rejects an unrecognized (but well-formed) category", () => {
    const result = validateCreateEmailTemplateInput({
      ...VALID_CREATE_BODY,
      templateKey: "unknown.category"
    });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((error) => error.field === "templateKey")).toBe(
        true
      );
    }
  });

  test("requires an en entry in subjectTemplate", () => {
    const result = validateCreateEmailTemplateInput({
      ...VALID_CREATE_BODY,
      subjectTemplate: { id: "Hanya Indonesia" }
    });
    expect(result.valid).toBe(false);
  });

  test("rejects a locale key that isn't a 2-letter code", () => {
    const result = validateCreateEmailTemplateInput({
      ...VALID_CREATE_BODY,
      subjectTemplate: { en: "Reset", indonesian: "Atur ulang" }
    });
    expect(result.valid).toBe(false);
  });

  test("requires at least one of textBodyTemplate/htmlBodyTemplate", () => {
    const { textBodyTemplate: _omit, ...withoutBody } = VALID_CREATE_BODY;
    const result = validateCreateEmailTemplateInput(withoutBody);
    expect(result.valid).toBe(false);
  });

  test("rejects unsafe HTML in htmlBodyTemplate", () => {
    const result = validateCreateEmailTemplateInput({
      ...VALID_CREATE_BODY,
      htmlBodyTemplate: { en: "<p>Hi</p><script>alert(1)</script>" }
    });
    expect(result.valid).toBe(false);
  });

  test("rejects an inline event handler attribute in htmlBodyTemplate", () => {
    const result = validateCreateEmailTemplateInput({
      ...VALID_CREATE_BODY,
      htmlBodyTemplate: { en: '<img src=x onerror="alert(1)">' }
    });
    expect(result.valid).toBe(false);
  });

  test("accepts safe HTML in htmlBodyTemplate", () => {
    const result = validateCreateEmailTemplateInput({
      ...VALID_CREATE_BODY,
      htmlBodyTemplate: { en: '<p>Click <a href="{{resetUrl}}">here</a></p>' }
    });
    expect(result.valid).toBe(true);
  });

  test("rejects a missing name", () => {
    const { name: _omit, ...withoutName } = VALID_CREATE_BODY;
    const result = validateCreateEmailTemplateInput(withoutName);
    expect(result.valid).toBe(false);
  });
});

describe("validateUpdateEmailTemplateInput", () => {
  test("accepts a partial update with just isActive", () => {
    const result = validateUpdateEmailTemplateInput({ isActive: false });
    expect(result.valid).toBe(true);
  });

  test("rejects an empty body", () => {
    const result = validateUpdateEmailTemplateInput({});
    expect(result.valid).toBe(false);
  });

  test("allows explicitly clearing htmlBodyTemplate with null", () => {
    const result = validateUpdateEmailTemplateInput({
      htmlBodyTemplate: null
    });
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.value.htmlBodyTemplate).toBeNull();
    }
  });

  test("rejects an unsafe htmlBodyTemplate update", () => {
    const result = validateUpdateEmailTemplateInput({
      htmlBodyTemplate: { en: '<iframe src="evil"></iframe>' }
    });
    expect(result.valid).toBe(false);
  });
});
