/**
 * Request validation for `/api/v1/crm-follow-up/*` (Issue #1165, ADR-0159).
 * Pure module: no database, no I/O. Error text never echoes a submitted value.
 *
 * Every body is a closed shape: an unknown key is a validation error, never a
 * silently ignored or silently stored field.
 */
import {
  ASSIGNEE_MODES,
  MAX_DUE_AFTER_MINUTES,
  MAX_ESCALATE_AFTER_MINUTES,
  MAX_HOLIDAYS,
  MAX_NAME_LENGTH,
  MAX_OPEN_PER_LEAD,
  MAX_TITLE_LENGTH,
  STAFF_STOP_KINDS,
  STAGE_CATEGORIES,
  TASK_OUTCOMES,
  TASK_STATUSES,
  TRIGGER_KINDS,
  type StaffStopKind,
  type TaskOutcome,
  type TaskStatus
} from "./crm-follow-up-constants";
import type { RuleDefinition, TriggerFacts } from "./rule-definition";
import { canonicalZone } from "./working-calendar";

export type FieldError = { field: string; message: string };
export type Validated<T> =
  { valid: true; value: T } | { valid: false; errors: FieldError[] };

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CODE_PATTERN = /^[a-z][a-z0-9_-]{1,39}$/;
const STAGE_KEY_PATTERN = /^[a-z][a-z0-9_]{0,39}$/;
const DATE_PATTERN = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;
const MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;
const MIN_INSTANT_MS = Date.UTC(2000, 0, 1);
const MAX_INSTANT_MS = Date.UTC(2100, 0, 1);

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Collects every error at once, with dotted field names. */
class Reader {
  constructor(
    readonly raw: Record<string, unknown>,
    readonly errors: FieldError[],
    private readonly prefix = ""
  ) {}

  field(name: string): string {
    return this.prefix ? `${this.prefix}.${name}` : name;
  }

  error(name: string, message: string): void {
    this.errors.push({ field: this.field(name), message });
  }

  closed(allowed: readonly string[]): void {
    for (const key of Object.keys(this.raw)) {
      if (!allowed.includes(key)) this.error(key, "Unknown field.");
    }
  }

  child(name: string, required: boolean): Reader | null {
    const value = this.raw[name];

    if (value === undefined || value === null) {
      if (required) this.error(name, `${name} is required.`);
      return null;
    }

    if (!isRecord(value)) {
      this.error(name, `${name} must be an object.`);
      return null;
    }

    return new Reader(value, this.errors, this.field(name));
  }

  text(
    name: string,
    options: { required?: boolean; max: number; pattern?: RegExp }
  ): string | null {
    const value = this.raw[name];

    if (value === undefined || value === null) {
      if (options.required) this.error(name, `${name} is required.`);
      return null;
    }

    if (typeof value !== "string") {
      this.error(name, `${name} must be a string.`);
      return null;
    }

    const trimmed = value.trim();

    if (trimmed.length === 0 || trimmed.length > options.max) {
      this.error(name, `${name} must be 1-${options.max} characters.`);
      return null;
    }

    if (options.pattern && !options.pattern.test(trimmed)) {
      this.error(name, `${name} has an invalid format.`);
      return null;
    }

    return trimmed;
  }

  integer(
    name: string,
    options: { required?: boolean; min: number; max: number }
  ): number | null {
    const value = this.raw[name];

    if (value === undefined || value === null) {
      if (options.required) this.error(name, `${name} is required.`);
      return null;
    }

    if (
      typeof value !== "number" ||
      !Number.isInteger(value) ||
      value < options.min ||
      value > options.max
    ) {
      this.error(
        name,
        `${name} must be an integer between ${options.min} and ${options.max}.`
      );
      return null;
    }

    return value;
  }

  boolean(name: string, required = false): boolean | null {
    const value = this.raw[name];

    if (value === undefined || value === null) {
      if (required) this.error(name, `${name} is required.`);
      return null;
    }

    if (typeof value !== "boolean") {
      this.error(name, `${name} must be a boolean.`);
      return null;
    }

    return value;
  }

  uuid(name: string, required = false): string | null {
    const value = this.raw[name];

    if (value === undefined || value === null) {
      if (required) this.error(name, `${name} is required.`);
      return null;
    }

    if (!isUuid(value)) {
      this.error(name, `${name} must be a UUID.`);
      return null;
    }

    return value.toLowerCase();
  }

  oneOf<T extends string>(
    name: string,
    allowed: readonly T[],
    required = false
  ): T | null {
    const value = this.raw[name];

    if (value === undefined || value === null) {
      if (required) this.error(name, `${name} is required.`);
      return null;
    }

    if (typeof value !== "string" || !allowed.includes(value as T)) {
      this.error(name, `${name} must be one of: ${allowed.join(", ")}.`);
      return null;
    }

    return value as T;
  }

  instant(name: string, required = false): Date | null {
    const value = this.raw[name];

    if (value === undefined || value === null) {
      if (required) this.error(name, `${name} is required.`);
      return null;
    }

    const parsed =
      typeof value === "string" && value.length <= 40
        ? new Date(value)
        : new Date(Number.NaN);

    if (Number.isNaN(parsed.getTime())) {
      this.error(name, `${name} must be an ISO 8601 instant.`);
      return null;
    }

    // A bounded range (audit of PR #1266, LOW-3): an instant far outside it is
    // a mistake, and it would make the calendar walk meaningless.
    if (
      parsed.getTime() < MIN_INSTANT_MS ||
      parsed.getTime() >= MAX_INSTANT_MS
    ) {
      this.error(name, `${name} must be between 2000 and 2100.`);
      return null;
    }

    return parsed;
  }
}

function start(raw: unknown): { reader: Reader; errors: FieldError[] } | null {
  if (!isRecord(raw)) return null;

  const errors: FieldError[] = [];

  return { reader: new Reader(raw, errors), errors };
}

const BODY_NOT_OBJECT: Validated<never> = {
  valid: false,
  errors: [{ field: "body", message: "Body must be a JSON object." }]
};

function done<T>(errors: FieldError[], value: () => T): Validated<T> {
  return errors.length > 0
    ? { valid: false, errors }
    : { valid: true, value: value() };
}

/**
 * Whether ANY start instant can be scheduled (audit of PR #1266, MEDIUM-1).
 * The calendar walk looks `MAX_DAYS_SCANNED` (800) days ahead and at most 366
 * of those can be holidays, so at least 61 whole weeks of the weekly pattern
 * remain; a revision whose offsets need more working time than that could
 * throw at run time, so it is refused at publish and simulate time instead.
 * Run-time paths still survive a `RangeError` (dispatch suppresses the notice,
 * the consumer isolates the rule), so this is the first line, not the only one.
 */
function calendarCanAlwaysSchedule(
  workingDays: number[],
  workStartMinute: number,
  workEndMinute: number,
  totalMinutes: number
): boolean {
  const weekly = workingDays.length * (workEndMinute - workStartMinute);

  // Margin: at most four daylight-saving shifts in 800 days, each costing at
  // most an hour of the daily window.
  const margin = 4 * Math.min(60, workEndMinute - workStartMinute);

  return weekly * 61 >= totalMinutes + margin;
}

/** Reads `definition` (a revision) from a reader that holds it. */
function readDefinition(reader: Reader): RuleDefinition | null {
  const before = reader.errors.length;

  reader.closed([
    "trigger",
    "taskTitle",
    "dueAfterMinutes",
    "escalation",
    "assignee",
    "notify",
    "maxOpenPerLead",
    "calendar"
  ]);

  const trigger = reader.child("trigger", true);
  let kind = null;
  let pipelineId = null;
  let stageCategory = null;
  let stageKey = null;

  if (trigger) {
    trigger.closed(["kind", "pipelineId", "stageCategory", "stageKey"]);
    kind = trigger.oneOf("kind", TRIGGER_KINDS, true);
    pipelineId = trigger.uuid("pipelineId");
    stageCategory = trigger.oneOf("stageCategory", STAGE_CATEGORIES);
    stageKey = trigger.text("stageKey", {
      max: 40,
      pattern: STAGE_KEY_PATTERN
    });

    if (
      kind === "lead_assigned" &&
      (pipelineId !== null || stageCategory !== null || stageKey !== null)
    ) {
      trigger.error(
        "kind",
        "A lead_assigned trigger takes no pipeline or stage filter (the event carries neither)."
      );
    }
  }

  const taskTitle = reader.text("taskTitle", {
    required: true,
    max: MAX_TITLE_LENGTH
  });
  const dueAfterMinutes = reader.integer("dueAfterMinutes", {
    required: true,
    min: 0,
    max: MAX_DUE_AFTER_MINUTES
  });

  let escalation: RuleDefinition["escalation"] = null;
  const escalationReader = reader.child("escalation", false);

  if (escalationReader) {
    escalationReader.closed(["afterMinutes", "recipientTenantUserId"]);
    const afterMinutes = escalationReader.integer("afterMinutes", {
      required: true,
      min: 1,
      max: MAX_ESCALATE_AFTER_MINUTES
    });
    const recipient = escalationReader.uuid("recipientTenantUserId");

    if (afterMinutes !== null) {
      escalation = { afterMinutes, recipientTenantUserId: recipient };
    }
  }

  const assignee = reader.child("assignee", true);
  let mode = null;
  let assigneeUser = null;

  if (assignee) {
    assignee.closed(["mode", "tenantUserId"]);
    mode = assignee.oneOf("mode", ASSIGNEE_MODES, true);
    assigneeUser = assignee.uuid("tenantUserId");

    if (mode === "fixed_user" && assigneeUser === null) {
      assignee.error(
        "tenantUserId",
        "A fixed_user assignee needs tenantUserId."
      );
    }
    if (mode === "lead_owner" && assigneeUser !== null) {
      assignee.error(
        "tenantUserId",
        "A lead_owner assignee takes no tenantUserId."
      );
    }
  }

  const notify = reader.child("notify", false);
  let onAssign = false;
  let onDue = false;

  if (notify) {
    notify.closed(["onAssign", "onDue"]);
    onAssign = notify.boolean("onAssign") ?? false;
    onDue = notify.boolean("onDue") ?? false;
  }

  const maxOpenPerLead =
    reader.integer("maxOpenPerLead", { min: 1, max: MAX_OPEN_PER_LEAD }) ?? 1;

  const calendar = reader.child("calendar", true);
  let timeZone: string | null = null;
  let workingDays: number[] = [];
  let workStartMinute: number | null = null;
  let workEndMinute: number | null = null;
  let holidays: string[] = [];

  if (calendar) {
    calendar.closed([
      "timeZone",
      "workingDays",
      "workStartMinute",
      "workEndMinute",
      "holidays"
    ]);
    timeZone = calendar.text("timeZone", { required: true, max: 64 });

    if (timeZone !== null) {
      // Stored CANONICAL (audit of PR #1266, HIGH-1): `asia/jakarta` is kept as
      // `Asia/Jakarta`, and validation fills no formatter cache.
      const canonical = canonicalZone(timeZone);

      if (canonical === null) {
        calendar.error("timeZone", "timeZone must be an IANA time zone.");
        timeZone = null;
      } else {
        timeZone = canonical;
      }
    }

    const days = calendar.raw.workingDays;

    if (
      !Array.isArray(days) ||
      days.length === 0 ||
      days.length > 7 ||
      !days.every((d) => Number.isInteger(d) && d >= 1 && d <= 7) ||
      new Set(days).size !== days.length
    ) {
      calendar.error(
        "workingDays",
        "workingDays must be 1-7 distinct ISO weekdays (1 = Monday .. 7 = Sunday)."
      );
    } else {
      workingDays = [...(days as number[])].sort((a, b) => a - b);
    }

    workStartMinute = calendar.integer("workStartMinute", {
      required: true,
      min: 0,
      max: 1439
    });
    workEndMinute = calendar.integer("workEndMinute", {
      required: true,
      min: 1,
      max: 1440
    });

    if (
      workStartMinute !== null &&
      workEndMinute !== null &&
      workStartMinute >= workEndMinute
    ) {
      calendar.error(
        "workEndMinute",
        "workEndMinute must be after workStartMinute."
      );
    }

    const rawHolidays = calendar.raw.holidays;

    if (rawHolidays !== undefined && rawHolidays !== null) {
      if (
        !Array.isArray(rawHolidays) ||
        rawHolidays.length > MAX_HOLIDAYS ||
        !rawHolidays.every(
          (d) =>
            typeof d === "string" &&
            DATE_PATTERN.test(d) &&
            !Number.isNaN(new Date(`${d}T00:00:00Z`).getTime()) &&
            new Date(`${d}T00:00:00Z`).toISOString().slice(0, 10) === d
        ) ||
        new Set(rawHolidays).size !== rawHolidays.length
      ) {
        calendar.error(
          "holidays",
          `holidays must be at most ${MAX_HOLIDAYS} distinct YYYY-MM-DD dates.`
        );
      } else {
        holidays = [...(rawHolidays as string[])].sort();
      }
    }
  }

  if (
    reader.errors.length === before &&
    !calendarCanAlwaysSchedule(
      workingDays,
      workStartMinute!,
      workEndMinute!,
      dueAfterMinutes! + (escalation?.afterMinutes ?? 0)
    )
  ) {
    reader.error(
      "calendar",
      "The calendar does not hold enough working time for the due and escalation offsets."
    );
  }

  if (reader.errors.length > before) return null;

  return {
    trigger: { kind: kind!, pipelineId, stageCategory, stageKey },
    taskTitle: taskTitle!,
    dueAfterMinutes: dueAfterMinutes!,
    escalation,
    assignee: { mode: mode!, tenantUserId: assigneeUser },
    notify: { onAssign, onDue },
    maxOpenPerLead,
    calendar: {
      timeZone: timeZone!,
      workingDays,
      workStartMinute: workStartMinute!,
      workEndMinute: workEndMinute!,
      holidays
    }
  };
}

export type CreateRuleInput = {
  code: string;
  name: string;
  definition: RuleDefinition;
};

export function validateCreateRule(raw: unknown): Validated<CreateRuleInput> {
  const s = start(raw);

  if (!s) return BODY_NOT_OBJECT;

  const { reader, errors } = s;

  reader.closed(["code", "name", "definition"]);
  const code = reader.text("code", {
    required: true,
    max: 40,
    pattern: CODE_PATTERN
  });
  const name = reader.text("name", { required: true, max: MAX_NAME_LENGTH });
  const definitionReader = reader.child("definition", true);
  const definition = definitionReader ? readDefinition(definitionReader) : null;

  return done(errors, () => ({
    code: code!,
    name: name!,
    definition: definition!
  }));
}

export type PublishRevisionInput = {
  expectedVersion: number;
  definition: RuleDefinition;
};

export function validatePublishRevision(
  raw: unknown
): Validated<PublishRevisionInput> {
  const s = start(raw);

  if (!s) return BODY_NOT_OBJECT;

  const { reader, errors } = s;

  reader.closed(["expectedVersion", "definition"]);
  const expectedVersion = reader.integer("expectedVersion", {
    required: true,
    min: 1,
    max: 2_000_000_000
  });
  const definitionReader = reader.child("definition", true);
  const definition = definitionReader ? readDefinition(definitionReader) : null;

  return done(errors, () => ({
    expectedVersion: expectedVersion!,
    definition: definition!
  }));
}

export type VersionedInput = { expectedVersion: number };

export function validateVersioned(raw: unknown): Validated<VersionedInput> {
  const s = start(raw);

  if (!s) return BODY_NOT_OBJECT;

  const { reader, errors } = s;

  reader.closed(["expectedVersion"]);
  const expectedVersion = reader.integer("expectedVersion", {
    required: true,
    min: 1,
    max: 2_000_000_000
  });

  return done(errors, () => ({ expectedVersion: expectedVersion! }));
}

export type CompleteTaskInput = {
  expectedVersion: number;
  outcome: TaskOutcome;
};

export function validateCompleteTask(
  raw: unknown
): Validated<CompleteTaskInput> {
  const s = start(raw);

  if (!s) return BODY_NOT_OBJECT;

  const { reader, errors } = s;

  reader.closed(["expectedVersion", "outcome"]);
  const expectedVersion = reader.integer("expectedVersion", {
    required: true,
    min: 1,
    max: 2_000_000_000
  });
  const outcome = reader.oneOf("outcome", TASK_OUTCOMES, true);

  return done(errors, () => ({
    expectedVersion: expectedVersion!,
    outcome: outcome!
  }));
}

export type SettingsPatch = {
  enabled?: boolean;
  maxNoticesPerRecipientHour?: number;
};

export function validateSettingsPatch(raw: unknown): Validated<SettingsPatch> {
  const s = start(raw);

  if (!s) return BODY_NOT_OBJECT;

  const { reader, errors } = s;

  reader.closed(["enabled", "maxNoticesPerRecipientHour"]);
  const enabled = reader.boolean("enabled");
  const cap = reader.integer("maxNoticesPerRecipientHour", {
    min: 1,
    max: 200
  });

  if (enabled === null && cap === null && errors.length === 0) {
    reader.error("body", "Nothing to change.");
  }

  return done(errors, () => ({
    ...(enabled !== null ? { enabled } : {}),
    ...(cap !== null ? { maxNoticesPerRecipientHour: cap } : {})
  }));
}

export type StopSignalInput = { kind: StaffStopKind; occurredAt: Date | null };

export function validateStopSignal(raw: unknown): Validated<StopSignalInput> {
  const s = start(raw);

  if (!s) return BODY_NOT_OBJECT;

  const { reader, errors } = s;

  reader.closed(["kind", "occurredAt"]);
  const kind = reader.oneOf("kind", STAFF_STOP_KINDS, true);
  const occurredAt = reader.instant("occurredAt");

  if (
    occurredAt !== null &&
    occurredAt.getTime() > Date.now() + MAX_FUTURE_SKEW_MS
  ) {
    reader.error("occurredAt", "occurredAt must not be in the future.");
  }

  return done(errors, () => ({ kind: kind!, occurredAt }));
}

export type SimulateInput = {
  definition: RuleDefinition;
  trigger: Omit<TriggerFacts, "leadId">;
  leadId: string | null;
};

export function validateSimulate(raw: unknown): Validated<SimulateInput> {
  const s = start(raw);

  if (!s) return BODY_NOT_OBJECT;

  const { reader, errors } = s;

  reader.closed(["definition", "trigger", "leadId"]);
  const definitionReader = reader.child("definition", true);
  const definition = definitionReader ? readDefinition(definitionReader) : null;
  const trigger = reader.child("trigger", true);
  let facts: Omit<TriggerFacts, "leadId"> | null = null;

  if (trigger) {
    trigger.closed([
      "kind",
      "pipelineId",
      "stageCategory",
      "stageKey",
      "ownerTenantUserId",
      "occurredAt"
    ]);
    const kind = trigger.oneOf("kind", TRIGGER_KINDS, true);
    const pipelineId = trigger.uuid("pipelineId");
    const stageCategory = trigger.oneOf("stageCategory", STAGE_CATEGORIES);
    const stageKey = trigger.text("stageKey", {
      max: 40,
      pattern: STAGE_KEY_PATTERN
    });
    const owner = trigger.uuid("ownerTenantUserId");
    const occurredAt = trigger.instant("occurredAt", true);

    if (kind && occurredAt) {
      facts = {
        kind,
        pipelineId,
        stageCategory,
        stageKey,
        ownerTenantUserId: owner,
        occurredAt
      };
    }
  }

  const leadId = reader.uuid("leadId");

  return done(errors, () => ({
    definition: definition!,
    trigger: facts!,
    leadId
  }));
}

export type TaskListFilter = {
  status: TaskStatus | null;
  assignee: "me" | string | null;
  leadId: string | null;
  overdue: boolean;
  limit: number;
  cursor: { dueAt: string; id: string } | null;
};

/** Query string of `GET /tasks`. The cursor is `<dueAt ISO>|<id>`, opaque to the caller. */
export function validateTaskListQuery(
  params: URLSearchParams
): Validated<TaskListFilter> {
  const errors: FieldError[] = [];
  const allowed = [
    "status",
    "assignee",
    "leadId",
    "overdue",
    "limit",
    "cursor"
  ];

  for (const key of params.keys()) {
    if (!allowed.includes(key)) {
      errors.push({ field: key, message: "Unknown query parameter." });
    }
  }

  const status = params.get("status");

  if (status !== null && !TASK_STATUSES.includes(status as TaskStatus)) {
    errors.push({ field: "status", message: "Unknown status." });
  }

  const assignee = params.get("assignee");

  if (assignee !== null && assignee !== "me" && !isUuid(assignee)) {
    errors.push({ field: "assignee", message: "assignee is 'me' or a UUID." });
  }

  const leadId = params.get("leadId");

  if (leadId !== null && !isUuid(leadId)) {
    errors.push({ field: "leadId", message: "leadId must be a UUID." });
  }

  const overdue = params.get("overdue");

  if (overdue !== null && overdue !== "true" && overdue !== "false") {
    errors.push({ field: "overdue", message: "overdue is true or false." });
  }

  const limitRaw = params.get("limit");
  const limit = limitRaw === null ? 50 : Number(limitRaw);

  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    errors.push({ field: "limit", message: "limit must be 1-100." });
  }

  const cursorRaw = params.get("cursor");
  let cursor: TaskListFilter["cursor"] = null;

  if (cursorRaw !== null) {
    const [dueAt, id] = cursorRaw.split("|");

    if (
      !dueAt ||
      !id ||
      !isUuid(id) ||
      Number.isNaN(new Date(dueAt).getTime())
    ) {
      errors.push({ field: "cursor", message: "cursor is invalid." });
    } else {
      cursor = { dueAt: new Date(dueAt).toISOString(), id: id.toLowerCase() };
    }
  }

  return errors.length > 0
    ? { valid: false, errors }
    : {
        valid: true,
        value: {
          status: (status as TaskStatus | null) ?? null,
          assignee: assignee === null ? null : assignee.toLowerCase(),
          leadId: leadId === null ? null : leadId.toLowerCase(),
          overdue: overdue === "true",
          limit,
          cursor
        }
      };
}
