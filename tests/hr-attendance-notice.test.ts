/**
 * The requester notice of a settled attendance correction (#1044) -- the parts
 * that need no database: the outcome mapping, and that the e-mail templates are
 * translated, registered as categories, and have no slot for the reason.
 */
import { describe, expect, test } from "bun:test";

import { DEFAULT_EMAIL_TEMPLATES } from "../src/modules/email/domain/email-default-templates";
import { getAllowedVariablesForCategory } from "../src/modules/email/domain/email-template-categories";
import {
  CORRECTION_NOTICE_TEMPLATE_KEYS,
  correctionNoticeCorrelationId,
  formatCorrectionDate,
  noticeOutcomeForStatus
} from "../src/modules/hr-workforce/application/hr-attendance-notice";

describe("noticeOutcomeForStatus", () => {
  test("maps the three settled statuses and nothing else", () => {
    expect(noticeOutcomeForStatus("approved")).toBe("applied");
    expect(noticeOutcomeForStatus("rejected")).toBe("rejected");
    expect(noticeOutcomeForStatus("withdrawn")).toBe("cancelled");
    expect(noticeOutcomeForStatus("pending")).toBeNull();
    expect(noticeOutcomeForStatus("")).toBeNull();
  });

  test("the correlation id is one per (correction, outcome)", () => {
    expect(correctionNoticeCorrelationId("c1", "applied")).toBe(
      "hr_workforce.attendance_correction:c1:applied"
    );
    expect(correctionNoticeCorrelationId("c1", "rejected")).not.toBe(
      correctionNoticeCorrelationId("c1", "applied")
    );
  });

  test("the date is the UTC calendar date", () => {
    expect(formatCorrectionDate("2026-10-16T23:30:00.000Z")).toBe("2026-10-16");
    expect(formatCorrectionDate(new Date("2026-10-17T00:00:00.000Z"))).toBe(
      "2026-10-17"
    );
  });
});

describe("the notice e-mail templates", () => {
  const keys = Object.values(CORRECTION_NOTICE_TEMPLATE_KEYS);

  test("each outcome has a default template, translated EN and ID", () => {
    for (const key of keys) {
      const template = DEFAULT_EMAIL_TEMPLATES.find(
        (entry) => entry.templateKey === key
      );

      expect(template, key).toBeDefined();
      for (const locale of ["en", "id"] as const) {
        expect(template!.subjectTemplate[locale]?.length, key).toBeGreaterThan(
          0
        );
        expect(template!.textBodyTemplate[locale]?.length, key).toBeGreaterThan(
          0
        );
      }
      expect(template!.textBodyTemplate.id).not.toBe(
        template!.textBodyTemplate.en
      );
    }
  });

  test("the variable allow-list has employee and date, and no slot for the reason", () => {
    for (const key of keys) {
      const allowed = getAllowedVariablesForCategory(key);

      expect(allowed, key).not.toBeNull();
      expect([...allowed!].sort()).toEqual([
        "correctionDate",
        "employeeName",
        "userName"
      ]);
    }
  });

  test("every placeholder a template uses is on its allow-list", () => {
    for (const key of keys) {
      const template = DEFAULT_EMAIL_TEMPLATES.find(
        (entry) => entry.templateKey === key
      )!;
      const allowed = new Set(getAllowedVariablesForCategory(key));
      const texts = [
        ...Object.values(template.subjectTemplate),
        ...Object.values(template.textBodyTemplate)
      ];

      for (const text of texts) {
        for (const match of String(text).matchAll(/{{(\w+)}}/g)) {
          expect(allowed.has(match[1]!), `${key}: ${match[1]}`).toBe(true);
        }
      }
    }
  });
});

describe("subject rendering (audit L2 of #1044)", () => {
  test("a CR/LF/TAB inside a substituted value collapses to one space", async () => {
    const { renderEmailTemplate } =
      await import("../src/modules/email/domain/email-template-render");
    const rendered = renderEmailTemplate(
      {
        subjectTemplate: { en: "Hello {{userName}}" },
        textBodyTemplate: { en: "x" },
        htmlBodyTemplate: null
      },
      { userName: "Eve\r\nBcc: a@b.test\tz" },
      "system.announcement"
    );

    expect(rendered.subject).toBe("Hello Eve Bcc: a@b.test z");
  });
});
