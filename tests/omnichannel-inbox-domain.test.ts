/**
 * Pure rules of `omnichannel_inbox` (Issue #1164, ADR-0160): business-time SLA
 * arithmetic across zones, nights, weekends, holidays and a DST change; the
 * bounded formatter cache; the envelope reader that keeps ids and times only;
 * and request validation.
 */
import { describe, expect, test } from "bun:test";

import { readEnvelope } from "../src/modules/omnichannel-inbox/domain/envelope-reader";
import {
  DEFAULT_REBUILD_WINDOW_DAYS,
  MAX_REBUILD_WINDOW_DAYS
} from "../src/modules/omnichannel-inbox/domain/inbox-constants";
import { omnichannelInboxModule } from "../src/modules/omnichannel-inbox/module";
import {
  MAX_CACHED_ZONES,
  cachedZoneCountForTests,
  canonicalTimeZone,
  computeDueAt,
  localDateOf,
  validateCalendar,
  type SlaCalendar
} from "../src/modules/omnichannel-inbox/domain/sla-calendar";
import {
  validateAssignmentBody,
  validateListConversationsQuery,
  validateRebuildBody,
  validateSlaPolicyCreateBody
} from "../src/modules/omnichannel-inbox/domain/inbox-validation";

const day = (start: number, end: number) => ({
  start: start * 60,
  end: end * 60
});
const officeHours = (zone: string, holidays: string[] = []): SlaCalendar => ({
  timezone: zone,
  workingHours: [
    day(9, 17),
    day(9, 17),
    day(9, 17),
    day(9, 17),
    day(9, 17),
    null,
    null
  ],
  holidays
});
const due = (start: string, minutes: number, calendar: SlaCalendar) =>
  new Date(computeDueAt(Date.parse(start), minutes, calendar)!).toISOString();

describe("SLA business-time arithmetic", () => {
  test("inside a working window the budget is plain minutes", () => {
    // Tuesday 10:00 WIB (03:00Z) + 60 min = 11:00 WIB (04:00Z).
    expect(due("2026-11-10T03:00:00Z", 60, officeHours("Asia/Jakarta"))).toBe(
      "2026-11-10T04:00:00.000Z"
    );
  });

  test("a message at night waits for the next morning", () => {
    // Tuesday 22:00 WIB (15:00Z) -> Wednesday 09:00 WIB + 30 min.
    expect(due("2026-11-10T15:00:00Z", 30, officeHours("Asia/Jakarta"))).toBe(
      "2026-11-11T02:30:00.000Z"
    );
  });

  test("the rest of the budget crosses the weekend and a holiday", () => {
    // Friday 16:30 WIB: 30 min Friday, Sat/Sun closed, Monday a holiday,
    // 30 min Tuesday -> Tuesday 09:30 WIB = 02:30Z.
    expect(
      due(
        "2026-11-13T09:30:00Z",
        60,
        officeHours("Asia/Jakarta", ["2026-11-16"])
      )
    ).toBe("2026-11-17T02:30:00.000Z");
  });

  test("the same instant gives different due times in different zones", () => {
    const start = "2026-11-10T15:00:00Z";
    // 15:00Z is 22:00 in Jakarta (closed) but 16:00 in Berlin (open, 1h left).
    expect(due(start, 30, officeHours("Asia/Jakarta"))).toBe(
      "2026-11-11T02:30:00.000Z"
    );
    expect(due(start, 30, officeHours("Europe/Berlin"))).toBe(
      "2026-11-10T15:30:00.000Z"
    );
  });

  test("a window keeps its local meaning across a DST change", () => {
    // New York: Friday 6 March 2026, 16:30 EST (21:30Z); DST starts Sunday 8
    // March; 60 minutes = 30 Friday + 30 Monday from 09:00 EDT (13:00Z).
    expect(
      due("2026-03-06T21:30:00Z", 60, officeHours("America/New_York"))
    ).toBe("2026-03-09T13:30:00.000Z");
  });

  test("local dates are read in the policy's zone", () => {
    expect(
      localDateOf(Date.parse("2026-11-10T20:00:00Z"), "Asia/Jakarta")
    ).toBe("2026-11-11");
    expect(localDateOf(Date.parse("2026-11-10T20:00:00Z"), "UTC")).toBe(
      "2026-11-10"
    );
  });

  test("no working window within the bound answers null, never a wrong time", () => {
    const closed: SlaCalendar = {
      timezone: "UTC",
      workingHours: [null, null, null, null, null, null, null],
      holidays: []
    };
    expect(computeDueAt(Date.parse("2026-11-10T00:00:00Z"), 10, closed)).toBe(
      null
    );
  });

  test("the formatter cache is bounded and keyed by the canonical zone", () => {
    const zones = Intl.supportedValuesOf("timeZone").slice(0, 120);

    for (const zone of zones) {
      computeDueAt(Date.parse("2026-11-10T00:00:00Z"), 1, officeHours(zone));
    }

    expect(cachedZoneCountForTests()).toBeLessThanOrEqual(MAX_CACHED_ZONES);
    // A non-canonical spelling resolves to the canonical name.
    expect(canonicalTimeZone("asia/jakarta")).toBe("Asia/Jakarta");
    expect(canonicalTimeZone("Mars/Olympus")).toBe(null);
    expect(canonicalTimeZone("../etc/passwd")).toBe(null);
  });
});

describe("calendar validation", () => {
  test("refuses a policy with no open day, a bad window, a fake date or an unknown zone", () => {
    const valid = validateCalendar({
      timezone: "Asia/Jakarta",
      workingHours: officeHours("UTC").workingHours,
      holidays: ["2026-12-25"]
    });
    expect(valid.valid).toBe(true);

    const fields = (input: Parameters<typeof validateCalendar>[0]) => {
      const result = validateCalendar(input);
      return result.valid ? [] : result.errors.map((error) => error.field);
    };

    expect(
      fields({
        timezone: "UTC",
        workingHours: [null, null, null, null, null, null, null],
        holidays: []
      })
    ).toEqual(["workingHours"]);
    expect(
      fields({
        timezone: "UTC",
        workingHours: [day(17, 9), null, null, null, null, null, null],
        holidays: []
      })
    ).toEqual(["workingHours"]);
    expect(
      fields({
        timezone: "UTC",
        workingHours: officeHours("UTC").workingHours,
        holidays: ["2026-02-30"]
      })
    ).toEqual(["holidays"]);
    expect(
      fields({
        timezone: "Nowhere/Land",
        workingHours: officeHours("UTC").workingHours,
        holidays: []
      })
    ).toEqual(["timezone"]);
  });

  test("an SLA policy body is a closed field set", () => {
    const body = {
      name: "Default",
      timezone: "UTC",
      firstResponseMinutes: 60,
      nextResponseMinutes: 30,
      workingHours: officeHours("UTC").workingHours
    };

    expect(validateSlaPolicyCreateBody(body).valid).toBe(true);
    expect(validateSlaPolicyCreateBody({ ...body, extra: 1 }).valid).toBe(
      false
    );
    expect(
      validateSlaPolicyCreateBody({ ...body, firstResponseMinutes: 0 }).valid
    ).toBe(false);
  });
});

describe("envelope reader", () => {
  const account = "11111111-1111-4111-8111-111111111111";
  const contact = "22222222-2222-4222-8222-222222222222";

  test("keeps ids and the SERVER receipt time, never anything else", () => {
    const fact = readEnvelope(
      "awcms.telegram_engagement.interaction.received",
      {
        eventKind: "message",
        channelAccountId: account,
        conversationRef: contact,
        occurredAt: "2020-01-01T00:00:00Z",
        receivedAt: "2026-11-10T03:00:00Z",
        text: "a body that must never be read"
      }
    );

    expect(fact).toEqual({
      kind: "inbound",
      sourceKind: "telegram",
      sourceRef: contact,
      channelAccountId: account,
      receivedAt: new Date("2026-11-10T03:00:00Z")
    });
    expect(JSON.stringify(fact)).not.toContain("body");
  });

  test("ignores membership updates, interactions, other purposes and malformed payloads", () => {
    expect(
      readEnvelope("awcms.telegram_engagement.interaction.received", {
        eventKind: "membership",
        channelAccountId: account,
        conversationRef: contact,
        receivedAt: "2026-11-10T03:00:00Z"
      })
    ).toBe(null);
    expect(
      readEnvelope("awcms.website_engagement.submission.received", {
        kind: "interaction",
        submissionId: contact,
        receivedAt: "2026-11-10T03:00:00Z"
      })
    ).toBe(null);
    expect(
      readEnvelope("awcms.telegram_engagement.consent.changed", {
        purpose: "marketing",
        action: "opt_out",
        contactRef: contact
      })
    ).toBe(null);
    expect(
      readEnvelope("awcms.telegram_engagement.interaction.received", {
        eventKind: "message",
        channelAccountId: "not-a-uuid",
        conversationRef: contact,
        receivedAt: "2026-11-10T03:00:00Z"
      })
    ).toBe(null);
    expect(readEnvelope("awcms.something.else", {})).toBe(null);
  });

  test("support opt-out and a website withdrawal are customer-state facts", () => {
    expect(
      readEnvelope("awcms.telegram_engagement.consent.changed", {
        purpose: "support",
        action: "opt_out",
        contactRef: contact
      })
    ).toMatchObject({ kind: "customer_state", state: "opted_out" });
    expect(
      readEnvelope("awcms.website_engagement.submission.withdrawn", {
        submissionId: contact
      })
    ).toMatchObject({ kind: "customer_state", state: "withdrawn" });
  });
});

describe("request validation", () => {
  test("list query: closed parameters, bounded limit, opaque cursor", () => {
    expect(
      validateListConversationsQuery(
        new URLSearchParams("assignee=me&limit=10")
      ).valid
    ).toBe(true);
    expect(
      validateListConversationsQuery(new URLSearchParams("limit=1000")).valid
    ).toBe(false);
    expect(
      validateListConversationsQuery(new URLSearchParams("tenantId=x")).valid
    ).toBe(false);
    expect(
      validateListConversationsQuery(new URLSearchParams("cursor=garbage"))
        .valid
    ).toBe(false);
  });

  test("assignment needs a UUID or null and the current version", () => {
    expect(
      validateAssignmentBody({ assigneeTenantUserId: null, expectedVersion: 1 })
        .valid
    ).toBe(true);
    expect(
      validateAssignmentBody({ assigneeTenantUserId: "me", expectedVersion: 1 })
        .valid
    ).toBe(false);
    expect(validateAssignmentBody({ assigneeTenantUserId: null }).valid).toBe(
      false
    );
  });

  test("rebuild cannot reach past the default retention window", () => {
    expect(validateRebuildBody({}).valid).toBe(true);
    expect(validateRebuildBody({ windowDays: 366 }).valid).toBe(false);
    expect(validateRebuildBody({ afterSequence: "-1" }).valid).toBe(false);
  });

  test("afterSequence is at most the bigint maximum (#1275 L-2)", () => {
    expect(
      validateRebuildBody({ afterSequence: "9223372036854775807" }).valid
    ).toBe(true);
    expect(
      validateRebuildBody({ afterSequence: "9223372036854775808" }).valid
    ).toBe(false);
    expect(
      validateRebuildBody({ afterSequence: "9999999999999999999" }).valid
    ).toBe(false);
  });

  test("the rebuild window is bound to the purge's retention (#1275 L-7)", () => {
    // The purge reads only `defaultRetentionDays` (data_lifecycle has no
    // per-tenant override), so a window wider than it would let a rebuild
    // bring back a conversation the purge removed.
    const descriptor = omnichannelInboxModule.dataLifecycle?.find(
      (entry) => entry.tableName === "awcms_inbox_conversations"
    );

    expect(descriptor).toBeDefined();
    expect(MAX_REBUILD_WINDOW_DAYS).toBeLessThanOrEqual(
      descriptor!.defaultRetentionDays
    );
    expect(DEFAULT_REBUILD_WINDOW_DAYS).toBeLessThanOrEqual(
      MAX_REBUILD_WINDOW_DAYS
    );
  });
});
