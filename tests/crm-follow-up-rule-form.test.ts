/**
 * Pure rules of the follow-up RULE EDITOR form (Issue #1165, ADR-0159): the
 * strings a person typed become the closed `definition` the API's OWN validators
 * accept, a stored definition round-trips into the form, and a retry of the same
 * form builds the same bytes (so one `Idempotency-Key` is enough). No database;
 * the behavioural side against the real handlers is
 * `tests/integration/crm-follow-up-api.integration.test.ts`.
 */
import { describe, expect, test } from "bun:test";

import { createIdempotencyKeySource } from "../src/lib/ui/admin-idempotency-key";
import {
  archiveBody,
  buildDefinition,
  clockToMinutes,
  createBody,
  emptyValues,
  offsetMinutes,
  parseHolidays,
  publishBody,
  rejectedFieldNames,
  simulateBody,
  valuesFromDefinition,
  type RuleFormValues
} from "../src/lib/ui/crm-follow-up-rule-form";
import {
  validateCreateRule,
  validatePublishRevision,
  validateSimulate
} from "../src/modules/crm-follow-up/domain/crm-follow-up-validation";

const filled = (over: Partial<RuleFormValues> = {}): RuleFormValues => ({
  ...emptyValues(),
  taskTitle: "Call the lead",
  ...over
});

const SAMPLE = {
  occurredAt: "2026-11-16T03:00:00.000Z",
  pipelineId: "",
  stageCategory: "",
  stageKey: "",
  ownerTenantUserId: "",
  leadId: ""
};

describe("typed controls become the request the API validates", () => {
  test("the default form is a valid create body", () => {
    const result = validateCreateRule(
      createBody("call-back", "Call back", filled())
    );

    expect(result.valid).toBe(true);
  });

  test("a filled form with every optional part passes the real validators", () => {
    const values = filled({
      triggerKind: "stage_entered",
      stageCategory: "qualified",
      stageKey: "qualified",
      pipelineId: "11111111-1111-4111-8111-111111111111",
      dueHours: "1",
      dueMinutes: "30",
      escalateHours: "2",
      escalateMinutes: "0",
      escalationRecipient: "22222222-2222-4222-8222-222222222222",
      assigneeMode: "fixed_user",
      assigneeUser: "33333333-3333-4333-8333-333333333333",
      maxOpenPerLead: "3",
      holidays: "2026-12-25, 2026-12-31"
    });

    expect(validateCreateRule(createBody("rule-x", "X", values)).valid).toBe(
      true
    );
    expect(validatePublishRevision(publishBody(4, values)).valid).toBe(true);
    expect(validateSimulate(simulateBody(values, SAMPLE)).valid).toBe(true);
  });

  test("blank filters and blank escalation are null, never an empty string", () => {
    const definition = buildDefinition(filled()) as {
      trigger: Record<string, unknown>;
      escalation: unknown;
      assignee: { tenantUserId: unknown };
    };

    expect(definition.trigger).toEqual({
      kind: "lead_created",
      pipelineId: null,
      stageCategory: null,
      stageKey: null
    });
    expect(definition.escalation).toBeNull();
    expect(definition.assignee.tenantUserId).toBeNull();
  });

  test("a lead_assigned trigger carries no filter even if a hidden box still holds one", () => {
    const definition = buildDefinition(
      filled({ triggerKind: "lead_assigned", stageKey: "left-over" })
    ) as { trigger: { stageKey: unknown } };

    expect(definition.trigger.stageKey).toBeNull();
    expect(
      validateCreateRule(
        createBody(
          "rule-x",
          "X",
          filled({ triggerKind: "lead_assigned", stageKey: "left-over" })
        )
      ).valid
    ).toBe(true);
  });

  test("a lead_owner assignee drops a person left in the hidden box", () => {
    const definition = buildDefinition(
      filled({
        assigneeMode: "lead_owner",
        assigneeUser: "33333333-3333-4333-8333-333333333333"
      })
    ) as { assignee: { tenantUserId: unknown } };

    expect(definition.assignee.tenantUserId).toBeNull();
  });

  test("a mistake is passed through for the server to name, never silently fixed", () => {
    const result = validateCreateRule(
      createBody(
        "rule-x",
        "X",
        filled({ timeZone: "Not/AZone", workStart: "9am", dueHours: "-1" })
      )
    );

    expect(result.valid).toBe(false);

    if (!result.valid) {
      const names = rejectedFieldNames(result.errors, {
        timeZone: "Time zone",
        workStartMinute: "Work starts",
        dueAfterMinutes: "Due after"
      });

      expect(names.sort()).toEqual(["Due after", "Time zone", "Work starts"]);
    }
  });
});

describe("a stored definition comes back into the form unchanged", () => {
  test("form -> definition -> form -> definition is a fixed point", () => {
    const values = filled({
      triggerKind: "stage_entered",
      stageCategory: "working",
      escalateHours: "1",
      escalateMinutes: "15",
      holidays: "2026-12-25\n2026-12-31",
      workEnd: "24:00"
    });
    const first = buildDefinition(values);
    const stored = validateCreateRule(createBody("rule-x", "X", values));

    expect(stored.valid).toBe(true);

    if (stored.valid) {
      const back = valuesFromDefinition(stored.value.definition);

      expect(JSON.stringify(buildDefinition(back))).toBe(JSON.stringify(first));
      expect(back.workEnd).toBe("24:00");
      expect(back.escalateHours).toBe("1");
      expect(back.escalateMinutes).toBe("15");
    }
  });

  test("a rule that never escalates shows blank escalation boxes", () => {
    const stored = validateCreateRule(createBody("rule-x", "X", filled()));

    expect(stored.valid).toBe(true);

    if (stored.valid) {
      const back = valuesFromDefinition(stored.value.definition);

      expect(back.escalateHours).toBe("");
      expect(back.escalateMinutes).toBe("");
    }
  });
});

describe("a retry of the same form is the same request", () => {
  test("the same values build byte-identical bodies and draw one key", () => {
    const keyFor = createIdempotencyKeySource();
    const url = "/api/v1/crm-follow-up/rules";
    const a = createBody("rule-x", "X", filled());
    const b = createBody("rule-x", "X", filled());

    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(keyFor({ url, body: a })).toBe(keyFor({ url, body: b }));
  });

  test("a changed form draws a new key", () => {
    const keyFor = createIdempotencyKeySource();
    const url = "/api/v1/crm-follow-up/rules";
    const first = keyFor({ url, body: createBody("rule-x", "X", filled()) });
    const second = keyFor({
      url,
      body: createBody("rule-x", "X", filled({ dueHours: "5" }))
    });

    expect(second).not.toBe(first);
  });

  test("no write body carries a clock reading", () => {
    const texts = [
      JSON.stringify(createBody("rule-x", "X", filled())),
      JSON.stringify(publishBody(1, filled())),
      JSON.stringify(archiveBody(1))
    ];

    for (const text of texts) expect(text).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
  });

  test("the publish body carries the version the person saw", () => {
    expect(publishBody(7, filled()).expectedVersion).toBe(7);
    expect(archiveBody(7)).toEqual({ expectedVersion: 7 });
  });
});

describe("small readers", () => {
  test("clock text is minutes, midnight is 24:00, junk is null", () => {
    expect(clockToMinutes("09:00")).toBe(540);
    expect(clockToMinutes("9:05")).toBe(545);
    expect(clockToMinutes("24:00")).toBe(1440);
    expect(clockToMinutes("09:60")).toBeNull();
    expect(clockToMinutes("9am")).toBeNull();
    expect(clockToMinutes("")).toBeNull();
  });

  test("an offset is hours and minutes; blank is zero, junk is null", () => {
    expect(offsetMinutes("1", "30")).toBe(90);
    expect(offsetMinutes("", "")).toBe(0);
    expect(offsetMinutes("1.5", "0")).toBeNull();
    expect(offsetMinutes("-1", "0")).toBeNull();
  });

  test("holidays split on lines, commas and spaces", () => {
    expect(parseHolidays("2026-12-25\n2026-12-31, 2027-01-01 ")).toEqual([
      "2026-12-25",
      "2026-12-31",
      "2027-01-01"
    ]);
    expect(parseHolidays("  \n ")).toEqual([]);
  });

  test("a refused dotted field is named by its last segment, once", () => {
    expect(
      rejectedFieldNames(
        [
          { field: "definition.calendar.timeZone", message: "x" },
          { field: "timeZone", message: "y" },
          { field: "definition.unknownThing", message: "z" }
        ],
        { timeZone: "Time zone" }
      )
    ).toEqual(["Time zone", "unknownThing"]);
  });

  test("the simulation needs a time: blank is refused by name, not defaulted", () => {
    const result = validateSimulate(
      simulateBody(filled(), { ...SAMPLE, occurredAt: null })
    );

    expect(result.valid).toBe(false);

    if (!result.valid) {
      expect(result.errors.some((e) => e.field === "trigger.occurredAt")).toBe(
        true
      );
    }
  });
});
