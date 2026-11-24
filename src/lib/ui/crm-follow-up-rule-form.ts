/**
 * Pure rules of the follow-up RULE EDITOR form (Issue #1165, ADR-0159): how the
 * plain strings a person typed become the closed `definition` the API validates,
 * and how a definition is shown back in the form's controls. No DOM, no network:
 * unit-tested without rendering.
 *
 * ## What this does NOT do
 *
 * It does not validate. The server (`validateCreateRule`, `validatePublishRevision`,
 * `validateSimulate`) is the only authority and answers a field-named 422; this
 * module only shapes the request so an honest form never trips on a type
 * (a number sent as text, a blank sent as an empty string where the API reads
 * `null`). A value it cannot read is passed through as `null`/NaN-free input and
 * left for the server to refuse, never silently "fixed".
 *
 * ## Retry-stable by construction
 *
 * Nothing here reads the clock. The one time-shaped input (the simulation's
 * "when it happened") is read by the page and sent as typed; the three writes
 * (create, publish, archive) carry no instant at all, so one `Idempotency-Key`
 * per distinct body is enough and a retry of the same form replays instead of
 * raising `IDEMPOTENCY_CONFLICT`.
 */
import type {
  RuleDefinition,
  TriggerFacts
} from "../../modules/crm-follow-up/domain/rule-definition";

/** The raw strings and flags the form's controls hold. */
export type RuleFormValues = {
  triggerKind: string;
  pipelineId: string;
  stageCategory: string;
  stageKey: string;
  taskTitle: string;
  dueHours: string;
  dueMinutes: string;
  /** Both blank: the rule never escalates. */
  escalateHours: string;
  escalateMinutes: string;
  escalationRecipient: string;
  assigneeMode: string;
  assigneeUser: string;
  notifyOnAssign: boolean;
  notifyOnDue: boolean;
  maxOpenPerLead: string;
  timeZone: string;
  workingDays: number[];
  workStart: string;
  workEnd: string;
  /** One `YYYY-MM-DD` per line or separated by commas/spaces. */
  holidays: string;
};

/** Blank (after trimming) is `null`, which the API reads as "no filter". */
function textOrNull(value: string): string | null {
  const trimmed = value.trim();

  return trimmed === "" ? null : trimmed;
}

/**
 * `09:00` -> `540`; `24:00` -> `1440` (a window may end at midnight).
 * Anything that is not `H:MM`/`HH:MM` is `null`, so the server's own range check
 * (`workStartMinute` 0..1439, `workEndMinute` 1..1440) names the field.
 */
export function clockToMinutes(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());

  if (!match) return null;

  const hours = Number(match[1]);
  const minutes = Number(match[2]);

  if (minutes > 59) return null;

  return hours * 60 + minutes;
}

/** A whole number of minutes from an hours box and a minutes box; blank is 0. */
export function offsetMinutes(hours: string, minutes: string): number | null {
  const h = hours.trim() === "" ? 0 : Number(hours);
  const m = minutes.trim() === "" ? 0 : Number(minutes);

  if (!Number.isInteger(h) || !Number.isInteger(m) || h < 0 || m < 0) {
    return null;
  }

  return h * 60 + m;
}

/** The dates of a holidays box: split on lines, commas and spaces; blanks dropped. */
export function parseHolidays(value: string): string[] {
  return value
    .split(/[\s,;]+/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

/**
 * The form's values as the request's `definition`. Mirrors the closed shape of
 * `RuleDefinition`; a `lead_assigned` trigger carries no filter (the event has
 * no pipeline or stage), whatever a hidden filter box still holds.
 */
export function buildDefinition(values: RuleFormValues): unknown {
  const filtered = values.triggerKind !== "lead_assigned";
  const escalateBlank =
    values.escalateHours.trim() === "" && values.escalateMinutes.trim() === "";
  const dueAfterMinutes = offsetMinutes(values.dueHours, values.dueMinutes);
  const escalateAfter = escalateBlank
    ? null
    : offsetMinutes(values.escalateHours, values.escalateMinutes);
  const maxOpen = Number(values.maxOpenPerLead);

  return {
    trigger: {
      kind: values.triggerKind,
      pipelineId: filtered ? textOrNull(values.pipelineId) : null,
      stageCategory: filtered ? textOrNull(values.stageCategory) : null,
      stageKey: filtered ? textOrNull(values.stageKey) : null
    },
    taskTitle: values.taskTitle.trim(),
    // `null` is not a number: the server answers "must be an integer".
    dueAfterMinutes,
    escalation: escalateBlank
      ? null
      : {
          afterMinutes: escalateAfter,
          recipientTenantUserId: textOrNull(values.escalationRecipient)
        },
    assignee: {
      mode: values.assigneeMode,
      tenantUserId:
        values.assigneeMode === "fixed_user"
          ? textOrNull(values.assigneeUser)
          : null
    },
    notify: { onAssign: values.notifyOnAssign, onDue: values.notifyOnDue },
    maxOpenPerLead: Number.isInteger(maxOpen) ? maxOpen : null,
    calendar: {
      timeZone: values.timeZone.trim(),
      workingDays: [...values.workingDays].sort((a, b) => a - b),
      workStartMinute: clockToMinutes(values.workStart),
      workEndMinute: clockToMinutes(values.workEnd),
      holidays: parseHolidays(values.holidays)
    }
  };
}

/** The body of `POST /rules`. */
export function createBody(
  code: string,
  name: string,
  values: RuleFormValues
): { code: string; name: string; definition: unknown } {
  return {
    code: code.trim(),
    name: name.trim(),
    definition: buildDefinition(values)
  };
}

/** The body of `POST /rules/{id}/revisions`: the version the person SAW. */
export function publishBody(
  expectedVersion: number,
  values: RuleFormValues
): { expectedVersion: number; definition: unknown } {
  return { expectedVersion, definition: buildDefinition(values) };
}

/** The body of `POST /rules/{id}/archive`. */
export function archiveBody(expectedVersion: number): {
  expectedVersion: number;
} {
  return { expectedVersion };
}

/** What the simulation's sample-event controls hold. */
export type SampleValues = {
  /** A `datetime-local` already converted to an instant, or `null`. */
  occurredAt: string | null;
  pipelineId: string;
  stageCategory: string;
  stageKey: string;
  ownerTenantUserId: string;
  leadId: string;
};

/**
 * The body of `POST /rules/simulate`. The sample event's kind is the draft's own
 * trigger kind (a draft is simulated against the event it claims to answer);
 * the sample's filters are what the event "carries", so they are sent as typed.
 * `occurredAt` is required by the API, so a blank is sent as `null` and refused
 * by name instead of being defaulted to a moving "now".
 */
export function simulateBody(
  values: RuleFormValues,
  sample: SampleValues
): {
  definition: unknown;
  trigger: Omit<TriggerFacts, "leadId" | "occurredAt"> & {
    occurredAt: string | null;
  };
  leadId: string | null;
} {
  return {
    definition: buildDefinition(values),
    trigger: {
      kind: values.triggerKind as TriggerFacts["kind"],
      pipelineId: textOrNull(sample.pipelineId),
      stageCategory: textOrNull(
        sample.stageCategory
      ) as TriggerFacts["stageCategory"],
      stageKey: textOrNull(sample.stageKey),
      ownerTenantUserId: textOrNull(sample.ownerTenantUserId),
      occurredAt: sample.occurredAt
    },
    leadId: textOrNull(sample.leadId)
  };
}

/** A stored definition as the form's initial values (the revise form). */
export function valuesFromDefinition(
  definition: RuleDefinition
): RuleFormValues {
  const due = splitMinutes(definition.dueAfterMinutes);
  const escalate =
    definition.escalation === null
      ? { hours: "", minutes: "" }
      : splitMinutes(definition.escalation.afterMinutes);

  return {
    triggerKind: definition.trigger.kind,
    pipelineId: definition.trigger.pipelineId ?? "",
    stageCategory: definition.trigger.stageCategory ?? "",
    stageKey: definition.trigger.stageKey ?? "",
    taskTitle: definition.taskTitle,
    dueHours: due.hours,
    dueMinutes: due.minutes,
    escalateHours: escalate.hours,
    escalateMinutes: escalate.minutes,
    escalationRecipient: definition.escalation?.recipientTenantUserId ?? "",
    assigneeMode: definition.assignee.mode,
    assigneeUser: definition.assignee.tenantUserId ?? "",
    notifyOnAssign: definition.notify.onAssign,
    notifyOnDue: definition.notify.onDue,
    maxOpenPerLead: String(definition.maxOpenPerLead),
    timeZone: definition.calendar.timeZone,
    workingDays: [...definition.calendar.workingDays],
    workStart: minutesToClockText(definition.calendar.workStartMinute),
    workEnd: minutesToClockText(definition.calendar.workEndMinute),
    holidays: definition.calendar.holidays.join("\n")
  };
}

/** The values of a brand-new rule: a weekday office day, nothing filtered. */
export function emptyValues(): RuleFormValues {
  return {
    triggerKind: "lead_created",
    pipelineId: "",
    stageCategory: "",
    stageKey: "",
    taskTitle: "",
    dueHours: "4",
    dueMinutes: "0",
    escalateHours: "",
    escalateMinutes: "",
    escalationRecipient: "",
    assigneeMode: "lead_owner",
    assigneeUser: "",
    notifyOnAssign: true,
    notifyOnDue: true,
    maxOpenPerLead: "1",
    timeZone: "Asia/Jakarta",
    workingDays: [1, 2, 3, 4, 5],
    workStart: "09:00",
    workEnd: "17:00",
    holidays: ""
  };
}

function splitMinutes(total: number): { hours: string; minutes: string } {
  return {
    hours: String(Math.floor(total / 60)),
    minutes: String(total % 60)
  };
}

function minutesToClockText(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(
    minutes % 60
  ).padStart(2, "0")}`;
}

/** One entry of the API's `error.details`. */
export type RejectedField = { field: string; message: string };

/**
 * The distinct control names the API refused, in the order it listed them. The
 * server's dotted path (`definition.calendar.timeZone`) is reduced to its last
 * segment and looked up in the page's own translated label map; an unknown
 * segment falls back to itself, a name the form chose, never a server sentence.
 */
export function rejectedFieldNames(
  fields: readonly RejectedField[],
  labels: Readonly<Record<string, string>>
): string[] {
  const names: string[] = [];

  for (const entry of fields) {
    const last = entry.field.split(".").pop() ?? entry.field;
    const label = labels[last] ?? last;

    if (!names.includes(label)) names.push(label);
  }

  return names;
}
