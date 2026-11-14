/**
 * The pure rules of the omnichannel inbox screens (Issue #1164): clock/minute
 * conversion, the working-week summary, the policy form's request body, and
 * the label vocabularies' coverage of the module's closed enums.
 */
import { describe, expect, test } from "bun:test";

import { getTranslatorFor } from "../src/lib/i18n";
import {
  activityDetailLabel,
  activityKindLabel,
  conversationStatusLabel,
  customerStateLabel,
  slaStateLabel,
  sourceKindLabel
} from "../src/lib/i18n/labels/omnichannel-inbox";
import {
  buildPolicyBody,
  clockToMinutes,
  minutesToClock,
  openDays,
  rebuildResumePoint
} from "../src/lib/ui/omnichannel-inbox-screen";
import {
  ACTIVITY_KINDS,
  CONVERSATION_STATUSES,
  CUSTOMER_STATES,
  SLA_STATES,
  SOURCE_KINDS
} from "../src/modules/omnichannel-inbox/domain/inbox-constants";
import { validateSlaPolicyCreateBody } from "../src/modules/omnichannel-inbox/domain/inbox-validation";

describe("clock conversion", () => {
  test("round-trips and refuses nonsense", () => {
    expect(minutesToClock(540)).toBe("09:00");
    expect(minutesToClock(1440)).toBe("24:00");
    expect(clockToMinutes("09:30")).toBe(570);
    expect(clockToMinutes("24:00")).toBe(1440);
    expect(clockToMinutes("24:01")).toBeNull();
    expect(clockToMinutes("25:00")).toBeNull();
    expect(clockToMinutes("09:60")).toBeNull();
    expect(clockToMinutes("9:00")).toBeNull();
    expect(clockToMinutes("")).toBeNull();
  });
});

describe("working-week summary", () => {
  test("lists only open days, Monday first", () => {
    const hours = [
      { start: 540, end: 1020 },
      null,
      { start: 540, end: 1020 },
      null,
      null,
      null,
      { start: 600, end: 720 }
    ];

    expect(openDays(hours)).toEqual([
      { isoWeekday: 1, window: "09:00-17:00" },
      { isoWeekday: 3, window: "09:00-17:00" },
      { isoWeekday: 7, window: "10:00-12:00" }
    ]);
  });
});

describe("the policy form body", () => {
  const fields = {
    name: " Office hours ",
    timezone: " Asia/Jakarta ",
    firstResponseMinutes: 60,
    nextResponseMinutes: 240,
    openWeekdays: [1, 2, 3, 4, 5],
    opensAt: "09:00",
    closesAt: "17:00",
    holidays: "2026-12-25\n\n 2026-12-25 \n2027-01-01\r\n"
  };

  test("is accepted by the API's own validator", () => {
    const body = buildPolicyBody(fields)!;

    expect(body).not.toBeNull();
    expect(body.holidays).toEqual(["2026-12-25", "2027-01-01"]);
    expect(body.workingHours).toHaveLength(7);
    expect(body.workingHours[5]).toBeNull();
    expect(body.name).toBe("Office hours");

    const validated = validateSlaPolicyCreateBody(body);

    expect(validated.valid).toBe(true);
  });

  test("refuses no open day and a window that closes before it opens", () => {
    expect(buildPolicyBody({ ...fields, openWeekdays: [] })).toBeNull();
    expect(
      buildPolicyBody({ ...fields, opensAt: "17:00", closesAt: "09:00" })
    ).toBeNull();
    expect(buildPolicyBody({ ...fields, opensAt: "nine" })).toBeNull();
  });
});

describe("labels cover every closed vocabulary of the module", () => {
  const { t } = getTranslatorFor("en");

  test("no known value falls back to its raw token", () => {
    for (const status of CONVERSATION_STATUSES) {
      expect(conversationStatusLabel(t, status)).not.toBe(status);
    }

    for (const state of CUSTOMER_STATES) {
      expect(customerStateLabel(t, state)).not.toBe(state);
    }

    for (const kind of SOURCE_KINDS) {
      expect(sourceKindLabel(t, kind)).not.toBe(kind);
    }

    for (const state of SLA_STATES) {
      expect(slaStateLabel(t, state)).not.toBe(state);
    }

    for (const kind of ACTIVITY_KINDS) {
      expect(activityKindLabel(t, kind)).not.toBe(kind);
    }
  });

  test("an unknown value is shown raw, never blank", () => {
    expect(conversationStatusLabel(t, "weird")).toBe("weird");
    expect(activityKindLabel(t, "weird")).toBe("weird");
  });

  test("detail codes are translated or omitted, never echoed raw", () => {
    expect(activityDetailLabel(t, "status_changed", "open")).toBe("Open");
    expect(activityDetailLabel(t, "sla_breached", "first")).toBe(
      "First response"
    );
    expect(activityDetailLabel(t, "assigned", "reassigned")).not.toContain(
      "reassigned"
    );
    expect(
      activityDetailLabel(t, "assignee_revoked", "user_inactive")
    ).not.toBe("user_inactive");
    expect(activityDetailLabel(t, "assigned", "something_new")).toBe("");
    expect(activityDetailLabel(t, "tag_added", null)).toBe("");
  });
});

describe("rebuild resume point", () => {
  test("a paused rebuild continues; a finished or malformed one starts over", () => {
    expect(rebuildResumePoint(false, "1500")).toBe("1500");
    expect(rebuildResumePoint(true, "1500")).toBe("0");
    expect(rebuildResumePoint(false, "abc")).toBe("0");
    expect(rebuildResumePoint(false, undefined)).toBe("0");
    expect(rebuildResumePoint(false, "-1")).toBe("0");
  });
});
