/**
 * `crm_follow_up` without a database (Issue #1165, ADR-0159): the working
 * calendar (zones, weekends, holidays, daylight saving), the fail-closed
 * trigger match, the closed request shapes, the descriptor's seeded
 * permissions and consumed events, and the absence of product vocabulary.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { crmFollowUpModule } from "../src/modules/crm-follow-up/module";
import { crmLeadsModule } from "../src/modules/crm-leads/module";
import {
  CONSUMED_LEAD_EVENT_TYPES,
  NOTIFICATION_TEMPLATE_KEYS
} from "../src/modules/crm-follow-up/domain/crm-follow-up-constants";
import {
  definitionHash,
  definitionFromRow,
  matchesTrigger,
  planTask,
  weekdayMaskOf,
  type RuleDefinition,
  type TriggerFacts
} from "../src/modules/crm-follow-up/domain/rule-definition";
import {
  validateCreateRule,
  validateSimulate,
  validateStopSignal,
  validateTaskListQuery
} from "../src/modules/crm-follow-up/domain/crm-follow-up-validation";
import {
  addWorkingMinutes,
  isKnownTimeZone,
  isWithinWorkingTime,
  nextWorkingInstant,
  type WorkingCalendar
} from "../src/modules/crm-follow-up/domain/working-calendar";
import {
  resetZonedFormatterCacheForTests,
  ZONED_FORMATTER_CACHE_MAX,
  zonedFormatterCacheSizeForTests,
  zonedPartsFormatter
} from "../src/lib/time/zoned-formatter";
import { isValidTimezone } from "../src/modules/booking/domain/booking-time";
import { isValidTimeZone } from "../src/modules/hr-workforce/domain/hr-shift-time";
import { nextWorkingInstantOr } from "../src/modules/crm-follow-up/application/task-engine";
import { getAllowedVariablesForCategory } from "../src/modules/email/domain/email-template-categories";
import { DEFAULT_EMAIL_TEMPLATES } from "../src/modules/email/domain/email-default-templates";

const JAKARTA: WorkingCalendar = {
  timeZone: "Asia/Jakarta",
  workingDays: 0b0011111, // Monday..Friday
  workStartMinute: 9 * 60,
  workEndMinute: 17 * 60,
  holidays: ["2026-11-13"]
};

const at = (iso: string) => new Date(iso);

function definition(over: Partial<RuleDefinition> = {}): RuleDefinition {
  return {
    trigger: {
      kind: "stage_entered",
      pipelineId: null,
      stageCategory: "qualified",
      stageKey: null
    },
    taskTitle: "Call back",
    dueAfterMinutes: 120,
    escalation: null,
    assignee: { mode: "lead_owner", tenantUserId: null },
    notify: { onAssign: true, onDue: true },
    maxOpenPerLead: 1,
    calendar: {
      timeZone: "Asia/Jakarta",
      workingDays: [1, 2, 3, 4, 5],
      workStartMinute: 540,
      workEndMinute: 1020,
      holidays: []
    },
    ...over
  };
}

const facts = (over: Partial<TriggerFacts> = {}): TriggerFacts => ({
  kind: "stage_entered",
  leadId: "00000000-0000-4000-8000-0000000000a1",
  pipelineId: "00000000-0000-4000-8000-0000000000b1",
  stageCategory: "qualified",
  stageKey: "qualified",
  ownerTenantUserId: "00000000-0000-4000-8000-0000000000c1",
  occurredAt: at("2026-11-11T02:00:00Z"), // Wednesday 09:00 Jakarta
  ...over
});

describe("working calendar", () => {
  test("adds working minutes inside one day (Asia/Jakarta, UTC+7)", () => {
    // Wednesday 2026-11-11 10:00 local = 03:00Z; +60 working minutes.
    expect(
      addWorkingMinutes(JAKARTA, at("2026-11-11T03:00:00Z"), 60).toISOString()
    ).toBe("2026-11-11T04:00:00.000Z");
  });

  test("time outside the window does not count and rolls to the next working day", () => {
    // Wednesday 16:30 local (09:30Z) + 60 minutes: 30 today, 30 tomorrow 09:00.
    expect(
      addWorkingMinutes(JAKARTA, at("2026-11-11T09:30:00Z"), 60).toISOString()
    ).toBe("2026-11-12T02:30:00.000Z");
  });

  test("a holiday and the weekend are skipped", () => {
    // Thursday 16:00 local (09:00Z) + 120: 60 Thursday, Friday 13 Nov is a
    // holiday, Sat/Sun skipped, the remaining 60 on Monday 16 Nov 09:00-10:00.
    expect(
      addWorkingMinutes(JAKARTA, at("2026-11-12T09:00:00Z"), 120).toISOString()
    ).toBe("2026-11-16T03:00:00.000Z");
  });

  test("zero minutes is the next working instant; quiet hours detect outside time", () => {
    const saturday = at("2026-11-14T05:00:00Z");

    expect(isWithinWorkingTime(JAKARTA, saturday)).toBe(false);
    expect(nextWorkingInstant(JAKARTA, saturday).toISOString()).toBe(
      "2026-11-16T02:00:00.000Z"
    );
    expect(addWorkingMinutes(JAKARTA, saturday, 0).toISOString()).toBe(
      "2026-11-16T02:00:00.000Z"
    );
    expect(isWithinWorkingTime(JAKARTA, at("2026-11-16T02:00:00Z"))).toBe(true);
  });

  test("the window follows the zone across a daylight-saving change", () => {
    const newYork: WorkingCalendar = {
      timeZone: "America/New_York",
      workingDays: 0b1111111,
      workStartMinute: 9 * 60,
      workEndMinute: 17 * 60,
      holidays: []
    };

    // 9:00 local is 14:00Z in winter (EST) and 13:00Z after 8 March 2026 (EDT).
    expect(
      nextWorkingInstant(newYork, at("2026-03-07T00:00:00Z")).toISOString()
    ).toBe("2026-03-07T14:00:00.000Z");
    expect(
      nextWorkingInstant(newYork, at("2026-03-09T00:00:00Z")).toISOString()
    ).toBe("2026-03-09T13:00:00.000Z");
  });

  test("the same instant gives the same answer whatever the host zone", () => {
    const before = process.env.TZ;

    try {
      process.env.TZ = "Pacific/Auckland";
      const a = addWorkingMinutes(JAKARTA, at("2026-11-12T09:00:00Z"), 120);
      process.env.TZ = "America/Los_Angeles";
      const b = addWorkingMinutes(JAKARTA, at("2026-11-12T09:00:00Z"), 120);

      expect(a.toISOString()).toBe(b.toISOString());
    } finally {
      process.env.TZ = before;
    }
  });
});

describe("rule definition", () => {
  test("a matching event plans the due instant over the calendar and takes the owner", () => {
    const plan = planTask(
      definition({
        escalation: { afterMinutes: 60, recipientTenantUserId: null }
      }),
      facts()
    );

    expect(plan.dueAt.toISOString()).toBe("2026-11-11T04:00:00.000Z");
    expect(plan.escalateAt?.toISOString()).toBe("2026-11-11T05:00:00.000Z");
    expect(plan.assigneeTenantUserId).toBe(
      "00000000-0000-4000-8000-0000000000c1"
    );
  });

  test("a fixed assignee wins over the lead owner", () => {
    const fixed = "00000000-0000-4000-8000-0000000000d1";

    expect(
      planTask(
        definition({ assignee: { mode: "fixed_user", tenantUserId: fixed } }),
        facts()
      ).assigneeTenantUserId
    ).toBe(fixed);
  });

  test("filters match exactly, and a filter the event cannot answer does not match", () => {
    expect(matchesTrigger(definition(), facts())).toBe(true);
    expect(
      matchesTrigger(definition(), facts({ stageCategory: "working" }))
    ).toBe(false);
    expect(matchesTrigger(definition(), facts({ kind: "lead_created" }))).toBe(
      false
    );
    const withPipeline = definition({
      trigger: {
        kind: "stage_entered",
        pipelineId: "00000000-0000-4000-8000-0000000000b1",
        stageCategory: null,
        stageKey: null
      }
    });

    expect(matchesTrigger(withPipeline, facts({ pipelineId: null }))).toBe(
      false
    );
    expect(matchesTrigger(withPipeline, facts())).toBe(true);
  });

  test("the definition hash is stable and round-trips through the stored row", () => {
    const def = definition({
      calendar: { ...definition().calendar, holidays: ["2026-12-25"] }
    });
    const row = {
      trigger_kind: def.trigger.kind,
      pipeline_id: def.trigger.pipelineId,
      stage_category: def.trigger.stageCategory,
      stage_key: def.trigger.stageKey,
      task_title: def.taskTitle,
      due_after_minutes: def.dueAfterMinutes,
      escalate_after_minutes: null,
      escalation_tenant_user_id: null,
      assignee_mode: def.assignee.mode,
      fixed_assignee_tenant_user_id: null,
      notify_on_assign: true,
      notify_on_due: true,
      max_open_per_lead: 1,
      time_zone: def.calendar.timeZone,
      working_days: weekdayMaskOf(def),
      work_start_minute: 540,
      work_end_minute: 1020,
      holidays: "{2026-12-25}"
    };

    expect(definitionHash(definitionFromRow(row))).toBe(definitionHash(def));
    expect(definitionHash(def)).toMatch(/^[0-9a-f]{64}$/);
    expect(definitionHash({ ...def, taskTitle: "Other" })).not.toBe(
      definitionHash(def)
    );
  });
});

describe("validation", () => {
  const body = {
    code: "qualified-callback",
    name: "Call back qualified leads",
    definition: {
      trigger: { kind: "stage_entered", stageCategory: "qualified" },
      taskTitle: "Call back",
      dueAfterMinutes: 120,
      assignee: { mode: "lead_owner" },
      notify: { onAssign: true, onDue: true },
      calendar: {
        timeZone: "Asia/Jakarta",
        workingDays: [5, 1, 2, 3, 4],
        workStartMinute: 540,
        workEndMinute: 1020,
        holidays: ["2026-12-25"]
      }
    }
  };

  test("a valid rule is accepted and normalised", () => {
    const result = validateCreateRule(body);

    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.value.definition.calendar.workingDays).toEqual([
        1, 2, 3, 4, 5
      ]);
      expect(result.value.definition.maxOpenPerLead).toBe(1);
    }
  });

  test("closed shapes: an unknown field, an expression or an unknown zone is refused", () => {
    expect(validateCreateRule({ ...body, extra: 1 }).valid).toBe(false);
    expect(
      validateCreateRule({
        ...body,
        definition: { ...body.definition, condition: "lead.score > 5" }
      }).valid
    ).toBe(false);
    expect(
      validateCreateRule({
        ...body,
        definition: {
          ...body.definition,
          calendar: { ...body.definition.calendar, timeZone: "Mars/Olympus" }
        }
      }).valid
    ).toBe(false);
    expect(
      validateCreateRule({
        ...body,
        definition: {
          ...body.definition,
          calendar: { ...body.definition.calendar, holidays: ["2026-02-30"] }
        }
      }).valid
    ).toBe(false);
  });

  test("a lead_assigned trigger takes no stage filter; a fixed assignee needs an id", () => {
    expect(
      validateCreateRule({
        ...body,
        definition: {
          ...body.definition,
          trigger: { kind: "lead_assigned", stageCategory: "new" }
        }
      }).valid
    ).toBe(false);
    expect(
      validateCreateRule({
        ...body,
        definition: { ...body.definition, assignee: { mode: "fixed_user" } }
      }).valid
    ).toBe(false);
  });

  test("staff may record only the four staff stop kinds, never in the future", () => {
    expect(validateStopSignal({ kind: "consent_withdrawn" }).valid).toBe(true);
    expect(validateStopSignal({ kind: "converted" }).valid).toBe(false);
    expect(
      validateStopSignal({
        kind: "manual",
        occurredAt: new Date(Date.now() + 3_600_000).toISOString()
      }).valid
    ).toBe(false);
  });

  test("simulate needs a trigger instant; the task list query is closed", () => {
    expect(
      validateSimulate({
        definition: body.definition,
        trigger: { kind: "stage_entered" }
      }).valid
    ).toBe(false);
    expect(
      validateTaskListQuery(new URLSearchParams("assignee=me&overdue=true"))
        .valid
    ).toBe(true);
    expect(validateTaskListQuery(new URLSearchParams("sort=name")).valid).toBe(
      false
    );
  });
});

describe("descriptor and contracts", () => {
  test("every permission the descriptor declares is seeded by sql/370", () => {
    const seed = readFileSync(
      "sql/370_awcms_crm_follow_up_permissions.sql",
      "utf8"
    );

    for (const permission of crmFollowUpModule.permissions ?? []) {
      expect(seed).toContain(
        `('crm_follow_up', '${permission.activityCode}', '${permission.action}',`
      );
    }
    expect(crmFollowUpModule.permissions).toHaveLength(5);
  });

  test("the consumer subscribes only to events crm_leads publishes", () => {
    const published = new Set(crmLeadsModule.events?.publishes ?? []);
    const consumer = crmFollowUpModule.domainEventConsumers![0]!;

    for (const type of CONSUMED_LEAD_EVENT_TYPES) {
      expect(published.has(type)).toBe(true);
    }
    expect([...consumer.eventTypes]).toEqual([...CONSUMED_LEAD_EVENT_TYPES]);
    expect(crmFollowUpModule.status).toBe("experimental");
    expect(crmFollowUpModule.navigation ?? []).toHaveLength(0);
  });

  test("the notice categories carry no slot for anything about the lead", () => {
    for (const key of Object.values(NOTIFICATION_TEMPLATE_KEYS)) {
      expect(getAllowedVariablesForCategory(key)).toEqual([
        "userName",
        "taskTitle",
        "dueAt",
        "taskReference"
      ]);
      expect(
        DEFAULT_EMAIL_TEMPLATES.some((template) => template.templateKey === key)
      ).toBe(true);
    }
  });

  test("the worker category allow-list is widened by exactly the three categories", () => {
    const sql = readFileSync(
      "sql/371_awcms_crm_follow_up_email_categories.sql",
      "utf8"
    );
    const body = sql.slice(sql.indexOf("CREATE OR REPLACE FUNCTION"));
    const listed = [...body.matchAll(/'([a-z_.]+)'/g)]
      .map((match) => match[1]!)
      .filter((value) => value.includes("."));

    expect([...new Set(listed)].sort()).toEqual(
      [
        "crm.follow_up_assigned",
        "crm.follow_up_due",
        "crm.follow_up_escalated",
        "hr.attendance_correction_applied",
        "hr.attendance_correction_cancelled",
        "hr.attendance_correction_rejected"
      ].sort()
    );
  });

  test("no product vocabulary in the schema or the module (ADR-0153 L2)", () => {
    const sources = [
      readFileSync("sql/369_awcms_crm_follow_up_schema.sql", "utf8"),
      readFileSync("src/modules/crm-follow-up/module.ts", "utf8"),
      readFileSync(
        "src/modules/crm-follow-up/domain/crm-follow-up-constants.ts",
        "utf8"
      )
    ].join("\n");

    expect(sources).not.toMatch(/\b(cohort|angkatan|re_?registration|lpp)\b/i);
  });
});

describe("audit of PR #1266", () => {
  test("HIGH-1: validation fills no formatter cache, and N spellings stay within the bound", () => {
    resetZonedFormatterCacheForTests();

    // 500 case spellings of one zone through every validator that runs
    // before authorization: nothing is cached.
    for (let i = 0; i < 500; i += 1) {
      const spelling = [..."asia/jakarta"]
        .map((ch, index) => ((i >> index) & 1 ? ch.toUpperCase() : ch))
        .join("");

      expect(isValidTimezone(spelling)).toBe(true);
      expect(isValidTimeZone(spelling)).toBe(true);
      expect(isKnownTimeZone(spelling)).toBe(true);
    }

    expect(zonedFormatterCacheSizeForTests()).toBe(0);

    // Spellings of one zone share ONE entry once a formatter is needed.
    for (const spelling of ["asia/jakarta", "ASIA/JAKARTA", "Asia/Jakarta"]) {
      zonedPartsFormatter(spelling);
    }
    expect(zonedFormatterCacheSizeForTests()).toBe(1);

    // Many distinct zones never grow it past the bound.
    for (const zone of Intl.supportedValuesOf("timeZone").slice(0, 200)) {
      zonedPartsFormatter(zone);
    }
    expect(zonedFormatterCacheSizeForTests()).toBeLessThanOrEqual(
      ZONED_FORMATTER_CACHE_MAX
    );
    resetZonedFormatterCacheForTests();
  });

  test("HIGH-1: a rule stores the canonical zone name", () => {
    const result = validateCreateRule({
      code: "canonical-zone",
      name: "Rule",
      definition: {
        trigger: { kind: "lead_created" },
        taskTitle: "Call",
        dueAfterMinutes: 0,
        assignee: { mode: "lead_owner" },
        calendar: {
          timeZone: "asia/jakarta",
          workingDays: [1],
          workStartMinute: 540,
          workEndMinute: 600
        }
      }
    });

    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.value.definition.calendar.timeZone).toBe("Asia/Jakarta");
    }
  });

  test("MEDIUM-1: a calendar that cannot hold the offsets is refused at publish/simulate", () => {
    const tiny = {
      code: "tiny-window",
      name: "Rule",
      definition: {
        trigger: { kind: "lead_created" },
        taskTitle: "Call",
        dueAfterMinutes: 43200,
        assignee: { mode: "lead_owner" },
        calendar: {
          timeZone: "UTC",
          workingDays: [1],
          workStartMinute: 0,
          workEndMinute: 1
        }
      }
    };

    expect(validateCreateRule(tiny).valid).toBe(false);
    expect(
      validateCreateRule({
        ...tiny,
        definition: { ...tiny.definition, dueAfterMinutes: 0 }
      }).valid
    ).toBe(true);
  });

  test("MEDIUM-1: scheduling falls back instead of throwing", () => {
    const none: WorkingCalendar = {
      timeZone: "UTC",
      workingDays: 0b0000001,
      workStartMinute: 0,
      workEndMinute: 1,
      holidays: []
    };
    const from = at("2026-11-11T00:00:00Z");

    expect(() => addWorkingMinutes(none, from, 43200)).toThrow(RangeError);
    expect(
      nextWorkingInstantOr({ ...none, timeZone: "Mars/Base" }, from)
    ).toBe(from);
  });

  test("LOW-3: instants outside 2000-2100 are refused", () => {
    expect(
      validateStopSignal({ kind: "manual", occurredAt: "1900-01-01T00:00:00Z" })
        .valid
    ).toBe(false);
    expect(
      validateSimulate({
        definition: {
          trigger: { kind: "lead_created" },
          taskTitle: "x",
          dueAfterMinutes: 0,
          assignee: { mode: "lead_owner" },
          calendar: {
            timeZone: "UTC",
            workingDays: [1],
            workStartMinute: 0,
            workEndMinute: 60
          }
        },
        trigger: { kind: "lead_created", occurredAt: "2200-01-01T00:00:00Z" }
      }).valid
    ).toBe(false);
  });
});
