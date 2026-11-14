/**
 * Pure rules of the Meta enablement preflight (Issue #1298 L5). The database
 * half (read as the real `awcms_worker`) is in
 * `tests/integration/whatsapp-meta-audit-lows.integration.test.ts`.
 */
import { describe, expect, test } from "bun:test";

import {
  evaluateMetaEnablement,
  type MetaPreflightGroup
} from "../src/modules/whatsapp-delivery/domain/meta-enablement-preflight";
import type { WhatsappTemplateDefinition } from "../src/modules/whatsapp-delivery/domain/whatsapp-templates";

const TEMPLATES: Record<string, WhatsappTemplateDefinition> = {
  "t.otp": {
    key: "t.otp",
    version: 1,
    purpose: "security",
    body: "{{code}}",
    variables: ["code"],
    providerTemplate: { name: "otp", language: "id" }
  },
  "t.remind": {
    key: "t.remind",
    version: 1,
    purpose: "transactional",
    body: "hi",
    variables: [],
    providerTemplate: { name: "remind", language: "id" }
  },
  "t.free": {
    key: "t.free",
    version: 1,
    purpose: "transactional",
    body: "hi",
    variables: []
  }
};
const lookupTemplate = (key: string) => TEMPLATES[key];
const group = (over: Partial<MetaPreflightGroup>): MetaPreflightGroup => ({
  senderAccountId: "n1",
  templateKey: "t.remind",
  purpose: "transactional",
  windowOpen: false,
  rows: 3,
  ...over
});
const approval = (
  over: Partial<{
    wabaId: string;
    name: string;
    status: "APPROVED" | "PAUSED" | "REINSTATED";
    category: "UTILITY" | "MARKETING" | "AUTHENTICATION";
  }> = {}
) => ({
  wabaId: "w1",
  name: "remind",
  language: "id",
  status: "APPROVED" as const,
  category: "UTILITY" as const,
  ...over
});

describe("evaluateMetaEnablement", () => {
  const bound = [{ accountId: "n1", wabaId: "w1" }];

  test("a number whose template is approved on its own WABA in the right category is ready", () => {
    const report = evaluateMetaEnablement({
      numbers: bound,
      groups: [group({})],
      approvals: [approval()],
      lookupTemplate
    });

    expect(report.findings).toEqual([]);
    expect(report.blockedRows).toBe(0);
    expect(report.pendingRows).toBe(3);
  });

  test("an approval on ANOTHER WABA, a paused one, a wrong category and a missing one each block", () => {
    for (const approvals of [
      [approval({ wabaId: "w2" })],
      [approval({ status: "PAUSED" })],
      [approval({ category: "MARKETING" })],
      []
    ]) {
      const report = evaluateMetaEnablement({
        numbers: bound,
        groups: [group({})],
        approvals,
        lookupTemplate
      });

      expect(report.blockedRows).toBe(3);
      expect(report.findings).toEqual([
        expect.objectContaining({
          kind: "pending_blocked",
          reason: "TEMPLATE_NOT_APPROVED",
          wabaId: "w1",
          providerTemplate: { name: "remind", language: "id" }
        })
      ]);
    }
  });

  test("the OTP that will not arrive is counted on its own", () => {
    const report = evaluateMetaEnablement({
      numbers: bound,
      groups: [
        group({ templateKey: "t.otp", purpose: "security", rows: 2 }),
        group({ rows: 5 })
      ],
      approvals: [approval()],
      lookupTemplate
    });

    expect(report.blockedRows).toBe(2);
    expect(report.blockedSecurityRows).toBe(2);
  });

  test("a number with no live WABA parent blocks everything queued on it, even with an empty queue", () => {
    const unbound = [{ accountId: "n1", wabaId: null }];
    const withRows = evaluateMetaEnablement({
      numbers: unbound,
      groups: [
        group({ templateKey: "t.otp", purpose: "security", rows: 2 }),
        group({ rows: 4 })
      ],
      approvals: [approval()],
      lookupTemplate
    });

    expect(withRows.findings).toEqual([
      {
        kind: "number_without_waba",
        accountId: "n1",
        pendingRows: 6,
        pendingSecurityRows: 2
      }
    ]);
    expect(withRows.blockedRows).toBe(6);

    const empty = evaluateMetaEnablement({
      numbers: unbound,
      groups: [],
      approvals: [],
      lookupTemplate
    });

    expect(empty.findings).toHaveLength(1);
    expect(empty.blockedRows).toBe(0);
  });

  test("free text needs an open window; an unregistered template is reported, not guessed", () => {
    const closed = evaluateMetaEnablement({
      numbers: bound,
      groups: [group({ templateKey: "t.free", rows: 1 })],
      approvals: [],
      lookupTemplate
    });
    const open = evaluateMetaEnablement({
      numbers: bound,
      groups: [group({ templateKey: "t.free", windowOpen: true, rows: 1 })],
      approvals: [],
      lookupTemplate
    });
    const unknown = evaluateMetaEnablement({
      numbers: bound,
      groups: [group({ templateKey: "t.nope", rows: 1 })],
      approvals: [],
      lookupTemplate
    });

    expect(closed.findings).toEqual([
      expect.objectContaining({ reason: "OUTSIDE_SERVICE_WINDOW" })
    ]);
    expect(open.findings).toEqual([]);
    expect(unknown.findings).toEqual([
      expect.objectContaining({ reason: "TEMPLATE_UNREGISTERED" })
    ]);
  });

  test("rows of a sender that is not a connected Meta number of the tenant are outside the preflight", () => {
    const report = evaluateMetaEnablement({
      numbers: bound,
      groups: [group({ senderAccountId: "starsender-device", rows: 9 })],
      approvals: [],
      lookupTemplate
    });

    expect(report.pendingRows).toBe(0);
    expect(report.findings).toEqual([]);
  });
});
