/**
 * Request validation for `/api/v1/crm-leads/*` (Issue #1166, ADR-0153). Pure
 * module: no database, no I/O. Error text NEVER echoes a submitted value (a
 * contact value, a name or a note is personal data).
 *
 * Every body is a closed shape: an unknown key is a validation error, never a
 * silently ignored or silently stored field.
 */
import { normalizeIdentifierValue } from "../../profile-identity/domain/identifier";
import {
  CONTACT_POINT_KINDS,
  CONVERSION_MODES,
  HTTP_INTAKE_SOURCE_KINDS,
  LEGAL_BASES,
  MAX_CONTACT_POINTS_PER_REQUEST,
  MAX_DISPLAY_NAME_LENGTH,
  MAX_NOTE_LENGTH,
  MAX_REASON_LENGTH,
  MAX_STAGES_PER_REVISION,
  MAX_TRANSITIONS_PER_REVISION,
  STAGE_CATEGORIES,
  TRANSITION_GUARDS,
  type ContactPointKind,
  type ConversionMode,
  type HttpIntakeSourceKind,
  type LegalBasis,
  type StageCategory,
  type TransitionGuard
} from "./crm-leads-constants";

export type FieldError = { field: string; message: string };
export type Validated<T> =
  { valid: true; value: T } | { valid: false; errors: FieldError[] };

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CODE_PATTERN = /^[a-z][a-z0-9_-]{1,39}$/;
const STAGE_KEY_PATTERN = /^[a-z][a-z0-9_]{0,39}$/;
const REF_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
const CAMPAIGN_PATTERN = /^[A-Za-z0-9._:-]{1,64}$/;
const UTM_PATTERN = /^[A-Za-z0-9._~+-]{1,100}$/;
const PATH_PATTERN = /^\/[^?#%@\s]*$/;
const HOST_PATTERN = /^[a-z0-9.-]{1,253}$/;
const PLATFORM_PATTERN = /^[a-z][a-z0-9_]{1,31}$/;
const SCOPE_TYPE_PATTERN = /^[a-z][a-z0-9_]{0,39}$/;
const EMAIL_PATTERN = /^[^\s@]{1,64}@[^\s@]{1,253}\.[^\s@]{1,63}$/;
const PHONE_PATTERN = /^\+?[0-9]{6,20}$/;
const PLATFORM_ID_PATTERN = /^[A-Za-z0-9._:@-]{1,128}$/;
const MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A small collector so every validator reads the same way and reports every error at once. */
class Reader {
  readonly errors: FieldError[] = [];

  constructor(
    private readonly raw: Record<string, unknown>,
    private readonly prefix = ""
  ) {}

  private field(name: string): string {
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

  has(name: string): boolean {
    return this.raw[name] !== undefined;
  }

  text(
    name: string,
    options: {
      required?: boolean;
      max: number;
      pattern?: RegExp;
      nullable?: boolean;
    }
  ): string | null | undefined {
    const value = this.raw[name];

    if (value === undefined) {
      if (options.required) this.error(name, `${name} is required.`);
      return undefined;
    }

    if (value === null && options.nullable) return null;

    if (
      typeof value !== "string" ||
      value.trim().length === 0 ||
      value.length > options.max ||
      (options.pattern !== undefined && !options.pattern.test(value))
    ) {
      this.error(name, `${name} is malformed.`);
      return undefined;
    }

    return options.pattern ? value : value.trim();
  }

  uuid(
    name: string,
    options: { required?: boolean; nullable?: boolean } = {}
  ): string | null | undefined {
    const value = this.raw[name];

    if (value === undefined) {
      if (options.required) this.error(name, `${name} is required.`);
      return undefined;
    }

    if (value === null && options.nullable) return null;

    if (!isUuid(value)) {
      this.error(name, `${name} must be a UUID.`);
      return undefined;
    }

    return value.toLowerCase();
  }

  oneOf<T extends string>(
    name: string,
    allowed: readonly T[],
    required = false
  ): T | undefined {
    const value = this.raw[name];

    if (value === undefined) {
      if (required) this.error(name, `${name} is required.`);
      return undefined;
    }

    if (typeof value !== "string" || !allowed.includes(value as T)) {
      this.error(name, `${name} must be one of: ${allowed.join(", ")}.`);
      return undefined;
    }

    return value as T;
  }

  positiveInt(
    name: string,
    options: { required?: boolean; min?: number; max?: number } = {}
  ): number | undefined {
    const value = this.raw[name];

    if (value === undefined) {
      if (options.required) this.error(name, `${name} is required.`);
      return undefined;
    }

    const min = options.min ?? 1;
    const max = options.max ?? 2_147_483_647;

    if (
      typeof value !== "number" ||
      !Number.isInteger(value) ||
      value < min ||
      value > max
    ) {
      this.error(name, `${name} must be an integer between ${min} and ${max}.`);
      return undefined;
    }

    return value;
  }

  bool(name: string): boolean | undefined {
    const value = this.raw[name];

    if (value === undefined) return undefined;

    if (typeof value !== "boolean") {
      this.error(name, `${name} must be a boolean.`);
      return undefined;
    }

    return value;
  }

  instant(name: string, now: Date): Date | undefined {
    const value = this.raw[name];

    if (value === undefined) return undefined;

    if (typeof value !== "string" || value.length > 40) {
      this.error(name, `${name} must be an ISO-8601 instant.`);
      return undefined;
    }

    const parsed = new Date(value);

    if (
      Number.isNaN(parsed.getTime()) ||
      !/[zZ]|[+-]\d{2}:?\d{2}$/.test(value)
    ) {
      this.error(name, `${name} must be an ISO-8601 instant with a zone.`);
      return undefined;
    }

    if (parsed.getTime() > now.getTime() + MAX_FUTURE_SKEW_MS) {
      this.error(name, `${name} cannot be in the future.`);
      return undefined;
    }

    return parsed;
  }

  child(name: string, required = false): Reader | undefined {
    const value = this.raw[name];

    if (value === undefined) {
      if (required) this.error(name, `${name} is required.`);
      return undefined;
    }

    if (!isRecord(value)) {
      this.error(name, `${name} must be an object.`);
      return undefined;
    }

    return new Reader(value, this.field(name));
  }

  list(
    name: string,
    options: { required?: boolean; max: number; min?: number }
  ): unknown[] | undefined {
    const value = this.raw[name];

    if (value === undefined) {
      if (options.required) this.error(name, `${name} is required.`);
      return undefined;
    }

    if (
      !Array.isArray(value) ||
      value.length > options.max ||
      value.length < (options.min ?? 0)
    ) {
      this.error(
        name,
        `${name} must be a list of ${options.min ?? 0} to ${options.max} items.`
      );
      return undefined;
    }

    return value;
  }

  merge(other: Reader | undefined): void {
    if (other) this.errors.push(...other.errors);
  }
}

function result<T>(reader: Reader, build: () => T): Validated<T> {
  return reader.errors.length > 0
    ? { valid: false, errors: reader.errors }
    : { valid: true, value: build() };
}

function notAnObject<T>(): Validated<T> {
  return {
    valid: false,
    errors: [{ field: "body", message: "Body must be a JSON object." }]
  };
}

// ---------------------------------------------------------------------------
// Pipeline definitions.
// ---------------------------------------------------------------------------

export type StageDefinition = {
  key: string;
  name: string;
  category: StageCategory;
};

export type TransitionDefinition = {
  from: string;
  to: string;
  guards: TransitionGuard[];
};

export type PipelineDefinition = {
  initialStageKey: string;
  stages: StageDefinition[];
  transitions: TransitionDefinition[];
};

function readDefinition(
  parent: Reader,
  name: string
): PipelineDefinition | undefined {
  const reader = parent.child(name, true);

  if (!reader) return undefined;

  reader.closed(["initialStageKey", "stages", "transitions"]);

  const initialStageKey = reader.text("initialStageKey", {
    required: true,
    max: 40,
    pattern: STAGE_KEY_PATTERN
  });
  const rawStages = reader.list("stages", {
    required: true,
    min: 1,
    max: MAX_STAGES_PER_REVISION
  });
  const rawTransitions = reader.list("transitions", {
    required: true,
    max: MAX_TRANSITIONS_PER_REVISION
  });
  const stages: StageDefinition[] = [];
  const transitions: TransitionDefinition[] = [];

  rawStages?.forEach((raw, index) => {
    if (!isRecord(raw)) {
      reader.error(`stages[${index}]`, "A stage must be an object.");
      return;
    }

    const stage = new Reader(raw, `${name}.stages[${index}]`);
    stage.closed(["key", "name", "category"]);
    const key = stage.text("key", {
      required: true,
      max: 40,
      pattern: STAGE_KEY_PATTERN
    });
    const stageName = stage.text("name", { required: true, max: 80 });
    const category = stage.oneOf("category", STAGE_CATEGORIES, true);
    reader.merge(stage);

    if (key && stageName && category) {
      stages.push({ key, name: stageName, category });
    }
  });

  const keys = new Set(stages.map((stage) => stage.key));

  if (keys.size !== stages.length) {
    reader.error("stages", "Stage keys must be unique.");
  }

  if (initialStageKey && !keys.has(initialStageKey)) {
    reader.error("initialStageKey", "initialStageKey must name a stage.");
  }

  const initial = stages.find((stage) => stage.key === initialStageKey);

  if (initial && initial.category === "converted") {
    reader.error(
      "initialStageKey",
      "A lead cannot start in a converted stage: conversion is recorded, never assumed."
    );
  }

  const edges = new Set<string>();

  rawTransitions?.forEach((raw, index) => {
    if (!isRecord(raw)) {
      reader.error(`transitions[${index}]`, "A transition must be an object.");
      return;
    }

    const edge = new Reader(raw, `${name}.transitions[${index}]`);
    edge.closed(["from", "to", "guards"]);
    const from = edge.text("from", {
      required: true,
      max: 40,
      pattern: STAGE_KEY_PATTERN
    });
    const to = edge.text("to", {
      required: true,
      max: 40,
      pattern: STAGE_KEY_PATTERN
    });
    const rawGuards = edge.list("guards", { max: TRANSITION_GUARDS.length });
    const guards: TransitionGuard[] = [];

    rawGuards?.forEach((value) => {
      if (
        typeof value !== "string" ||
        !TRANSITION_GUARDS.includes(value as TransitionGuard)
      ) {
        edge.error(
          "guards",
          `guards may only contain: ${TRANSITION_GUARDS.join(", ")}.`
        );
      } else if (!guards.includes(value as TransitionGuard)) {
        guards.push(value as TransitionGuard);
      }
    });

    reader.merge(edge);

    if (from && to) {
      if (from === to) {
        reader.error(`transitions[${index}]`, "An edge must change the stage.");
      } else if (!keys.has(from) || !keys.has(to)) {
        reader.error(
          `transitions[${index}]`,
          "An edge must connect two stages of the definition."
        );
      } else if (edges.has(`${from}>${to}`)) {
        reader.error(`transitions[${index}]`, "Duplicate edge.");
      } else {
        edges.add(`${from}>${to}`);
        transitions.push({ from, to, guards: guards.sort() });
      }
    }
  });

  parent.merge(reader);

  return reader.errors.length > 0 || !initialStageKey
    ? undefined
    : { initialStageKey, stages, transitions };
}

export type CreatePipelineInput = {
  code: string;
  name: string;
  timeZone: string;
  scope: { type: string; id: string } | null;
  definition: PipelineDefinition;
};

/** Accepts only a zone the runtime's IANA database knows. */
export function isKnownTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return /^[A-Za-z][A-Za-z0-9_+/-]{0,63}$/.test(zone);
  } catch {
    return false;
  }
}

export function validateCreatePipeline(
  raw: unknown
): Validated<CreatePipelineInput> {
  if (!isRecord(raw)) return notAnObject();

  const reader = new Reader(raw);
  reader.closed(["code", "name", "timeZone", "scope", "definition"]);
  const code = reader.text("code", {
    required: true,
    max: 40,
    pattern: CODE_PATTERN
  });
  const name = reader.text("name", { required: true, max: 120 });
  const timeZone =
    reader.text("timeZone", { max: 64 }) ?? (undefined as string | undefined);

  if (timeZone && !isKnownTimeZone(timeZone)) {
    reader.error("timeZone", "timeZone must be an IANA time zone.");
  }

  let scope: CreatePipelineInput["scope"] = null;
  const scopeReader = reader.child("scope");

  if (scopeReader) {
    scopeReader.closed(["type", "id"]);
    const type = scopeReader.text("type", {
      required: true,
      max: 40,
      pattern: SCOPE_TYPE_PATTERN
    });
    const id = scopeReader.uuid("id", { required: true });
    reader.merge(scopeReader);

    if (type && id) scope = { type, id };
  }

  const definition = readDefinition(reader, "definition");

  return result(reader, () => ({
    code: code!,
    name: name!,
    timeZone: timeZone ?? "UTC",
    scope,
    definition: definition!
  }));
}

export type PublishRevisionInput = {
  expectedVersion: number;
  definition: PipelineDefinition;
  /** removed stage key -> stage key of the new revision. */
  stageMigrations: Record<string, string>;
  reason: string | null;
};

export function validatePublishRevision(
  raw: unknown
): Validated<PublishRevisionInput> {
  if (!isRecord(raw)) return notAnObject();

  const reader = new Reader(raw);
  reader.closed(["expectedVersion", "definition", "stageMigrations", "reason"]);
  const expectedVersion = reader.positiveInt("expectedVersion", {
    required: true
  });
  const definition = readDefinition(reader, "definition");
  const reason = reader.text("reason", { max: MAX_REASON_LENGTH });
  const stageMigrations: Record<string, string> = {};
  const migrationsReader = reader.child("stageMigrations");

  if (migrationsReader) {
    const entries = Object.entries(
      raw.stageMigrations as Record<string, unknown>
    );

    if (entries.length > MAX_STAGES_PER_REVISION) {
      reader.error("stageMigrations", "Too many stage migrations.");
    }

    for (const [from, to] of entries) {
      if (
        !STAGE_KEY_PATTERN.test(from) ||
        typeof to !== "string" ||
        !STAGE_KEY_PATTERN.test(to)
      ) {
        reader.error(
          "stageMigrations",
          "Each entry maps a stage key to a stage key."
        );
      } else {
        stageMigrations[from] = to;
      }
    }

    if (definition) {
      const keys = new Set(definition.stages.map((stage) => stage.key));

      for (const [from, to] of Object.entries(stageMigrations)) {
        if (!keys.has(to)) {
          reader.error(
            "stageMigrations",
            "A migration target must be a stage of the new definition."
          );
        }

        if (keys.has(from)) {
          reader.error(
            "stageMigrations",
            "Only a stage REMOVED by the new definition can be migrated."
          );
        }
        // Whether a migration crosses the `converted` boundary depends on the
        // category of the LEADS being moved, which only the database knows:
        // `publishRevision` refuses both directions (ADR-0153 L7).
      }
    }
  }

  return result(reader, () => ({
    expectedVersion: expectedVersion!,
    definition: definition!,
    stageMigrations,
    reason: reason ?? null
  }));
}

export type SettingsPatch = { enabled?: boolean; mergeUndoHours?: number };

export function validateSettingsPatch(raw: unknown): Validated<SettingsPatch> {
  if (!isRecord(raw)) return notAnObject();

  const reader = new Reader(raw);
  reader.closed(["enabled", "mergeUndoHours"]);
  const enabled = reader.bool("enabled");
  const mergeUndoHours = reader.positiveInt("mergeUndoHours", {
    min: 1,
    max: 720
  });

  if (enabled === undefined && mergeUndoHours === undefined) {
    reader.error("body", "Nothing to change.");
  }

  return result(reader, () => ({
    ...(enabled !== undefined ? { enabled } : {}),
    ...(mergeUndoHours !== undefined ? { mergeUndoHours } : {})
  }));
}

// ---------------------------------------------------------------------------
// Leads.
// ---------------------------------------------------------------------------

export type ContactPointInput = {
  kind: ContactPointKind;
  platform: string | null;
  /** NORMALISED value: lower-cased email, digits-only phone, trimmed platform id. */
  normalized: string;
};

function readContactPoint(
  raw: unknown,
  field: string,
  parent: Reader
): ContactPointInput | undefined {
  if (!isRecord(raw)) {
    parent.error(field, "A contact point must be an object.");
    return undefined;
  }

  const reader = new Reader(raw, field);
  reader.closed(["kind", "value", "platform"]);
  const kind = reader.oneOf("kind", CONTACT_POINT_KINDS, true);
  const value = raw.value;
  let platform: string | null = null;

  if (kind === "platform_id") {
    platform =
      reader.text("platform", {
        required: true,
        max: 32,
        pattern: PLATFORM_PATTERN
      }) ?? null;
  } else if (raw.platform !== undefined) {
    reader.error("platform", "platform is only for a platform_id.");
  }

  let normalized: string | undefined;

  if (typeof value !== "string" || value.length === 0 || value.length > 254) {
    reader.error("value", "value is required.");
  } else if (kind === "email") {
    normalized = normalizeIdentifierValue("email", value);
    if (!EMAIL_PATTERN.test(normalized)) {
      reader.error("value", "value is not an email address.");
    }
  } else if (kind === "phone") {
    normalized = normalizeIdentifierValue("phone", value);
    if (!PHONE_PATTERN.test(normalized)) {
      reader.error("value", "value is not a phone number.");
    }
  } else if (kind === "platform_id") {
    normalized = value.trim();
    if (!PLATFORM_ID_PATTERN.test(normalized)) {
      reader.error("value", "value is not a platform id.");
    }
  }

  parent.merge(reader);

  return reader.errors.length === 0 && kind && normalized
    ? { kind, platform, normalized }
    : undefined;
}

function readContactPoints(reader: Reader, name: string): ContactPointInput[] {
  const items = reader.list(name, { max: MAX_CONTACT_POINTS_PER_REQUEST });
  const out: ContactPointInput[] = [];
  const seen = new Set<string>();

  items?.forEach((item, index) => {
    const point = readContactPoint(item, `${name}[${index}]`, reader);

    if (!point) return;

    const identity = `${point.kind}|${point.platform ?? ""}|${point.normalized}`;

    if (!seen.has(identity)) {
      seen.add(identity);
      out.push(point);
    }
  });

  return out;
}

export type SourceInput = {
  kind: HttpIntakeSourceKind;
  externalEventId: string | null;
  channelAccountId: string | null;
  campaignRef: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  landingPath: string | null;
  referrerHost: string | null;
  legalBasis: LegalBasis;
  occurredAt: Date;
};

function readSource(
  parent: Reader,
  name: string,
  now: Date
): SourceInput | undefined {
  const reader = parent.child(name, true);

  if (!reader) return undefined;

  reader.closed([
    "kind",
    "externalEventId",
    "channelAccountId",
    "campaignRef",
    "utmSource",
    "utmMedium",
    "utmCampaign",
    "landingPath",
    "referrerHost",
    "legalBasis",
    "occurredAt"
  ]);
  const kind = reader.oneOf("kind", HTTP_INTAKE_SOURCE_KINDS, true);
  const externalEventId = reader.text("externalEventId", {
    max: 128,
    pattern: REF_PATTERN
  });
  const channelAccountId = reader.uuid("channelAccountId");
  const campaignRef = reader.text("campaignRef", {
    max: 64,
    pattern: CAMPAIGN_PATTERN
  });
  const utmSource = reader.text("utmSource", {
    max: 100,
    pattern: UTM_PATTERN
  });
  const utmMedium = reader.text("utmMedium", {
    max: 100,
    pattern: UTM_PATTERN
  });
  const utmCampaign = reader.text("utmCampaign", {
    max: 100,
    pattern: UTM_PATTERN
  });
  const landingPath = reader.text("landingPath", {
    max: 200,
    pattern: PATH_PATTERN
  });
  const referrerHost = reader.text("referrerHost", {
    max: 253,
    pattern: HOST_PATTERN
  });
  const legalBasis = reader.oneOf("legalBasis", LEGAL_BASES);
  const occurredAt = reader.instant("occurredAt", now);

  // An import or API intake is replayable only if it names its own event id
  // (ADR-0153 L4): without one, a re-uploaded row would be a second lead.
  if ((kind === "import" || kind === "api") && !externalEventId) {
    reader.error(
      "externalEventId",
      "externalEventId is required for an import or api source."
    );
  }

  parent.merge(reader);

  return reader.errors.length > 0 || !kind
    ? undefined
    : {
        kind,
        externalEventId: externalEventId ?? null,
        channelAccountId: channelAccountId ?? null,
        campaignRef: campaignRef ?? null,
        utmSource: utmSource ?? null,
        utmMedium: utmMedium ?? null,
        utmCampaign: utmCampaign ?? null,
        landingPath: landingPath ?? null,
        referrerHost: referrerHost ?? null,
        legalBasis: legalBasis ?? "not_stated",
        occurredAt: occurredAt ?? now
      };
}

export type CreateLeadInput = {
  pipelineId: string;
  displayName: string | null;
  ownerTenantUserId: string | null;
  contactPoints: ContactPointInput[];
  source: SourceInput;
};

export function validateCreateLead(
  raw: unknown,
  now: Date = new Date()
): Validated<CreateLeadInput> {
  if (!isRecord(raw)) return notAnObject();

  const reader = new Reader(raw);
  reader.closed([
    "pipelineId",
    "displayName",
    "ownerTenantUserId",
    "contactPoints",
    "source"
  ]);
  const pipelineId = reader.uuid("pipelineId", { required: true });
  const displayName = reader.text("displayName", {
    max: MAX_DISPLAY_NAME_LENGTH
  });
  const ownerTenantUserId = reader.uuid("ownerTenantUserId");
  const contactPoints = readContactPoints(reader, "contactPoints");
  const source = readSource(reader, "source", now);

  return result(reader, () => ({
    pipelineId: pipelineId!,
    displayName: displayName ?? null,
    ownerTenantUserId: ownerTenantUserId ?? null,
    contactPoints,
    source: source!
  }));
}

export type UpdateLeadInput = {
  expectedVersion: number;
  displayName?: string | null;
  addContactPoints: ContactPointInput[];
  revokeContactPointIds: string[];
};

export function validateUpdateLead(raw: unknown): Validated<UpdateLeadInput> {
  if (!isRecord(raw)) return notAnObject();

  const reader = new Reader(raw);
  reader.closed([
    "expectedVersion",
    "displayName",
    "addContactPoints",
    "revokeContactPointIds"
  ]);
  const expectedVersion = reader.positiveInt("expectedVersion", {
    required: true
  });
  const hasName = reader.has("displayName");
  const displayName = reader.text("displayName", {
    max: MAX_DISPLAY_NAME_LENGTH,
    nullable: true
  });
  const addContactPoints = readContactPoints(reader, "addContactPoints");
  const rawRevoke = reader.list("revokeContactPointIds", {
    max: MAX_CONTACT_POINTS_PER_REQUEST
  });
  const revokeContactPointIds: string[] = [];

  rawRevoke?.forEach((value) => {
    if (isUuid(value)) revokeContactPointIds.push(value.toLowerCase());
    else reader.error("revokeContactPointIds", "Each id must be a UUID.");
  });

  if (
    !hasName &&
    addContactPoints.length === 0 &&
    revokeContactPointIds.length === 0 &&
    reader.errors.length === 0
  ) {
    reader.error("body", "Nothing to change.");
  }

  return result(reader, () => ({
    expectedVersion: expectedVersion!,
    ...(hasName ? { displayName: displayName ?? null } : {}),
    addContactPoints,
    revokeContactPointIds
  }));
}

export type AddTouchInput = { source: SourceInput };

export function validateAddTouch(
  raw: unknown,
  now: Date = new Date()
): Validated<AddTouchInput> {
  if (!isRecord(raw)) return notAnObject();

  const reader = new Reader(raw);
  reader.closed(["source"]);
  const source = readSource(reader, "source", now);

  return result(reader, () => ({ source: source! }));
}

export type MoveLeadInput = {
  expectedVersion: number;
  toStageKey: string;
  reason: string | null;
  occurredAt: Date;
};

export function validateMoveLead(
  raw: unknown,
  now: Date = new Date()
): Validated<MoveLeadInput> {
  if (!isRecord(raw)) return notAnObject();

  const reader = new Reader(raw);
  reader.closed(["expectedVersion", "toStageKey", "reason", "occurredAt"]);
  const expectedVersion = reader.positiveInt("expectedVersion", {
    required: true
  });
  const toStageKey = reader.text("toStageKey", {
    required: true,
    max: 40,
    pattern: STAGE_KEY_PATTERN
  });
  const reason = reader.text("reason", { max: MAX_REASON_LENGTH });
  const occurredAt = reader.instant("occurredAt", now);

  return result(reader, () => ({
    expectedVersion: expectedVersion!,
    toStageKey: toStageKey!,
    reason: reason ?? null,
    occurredAt: occurredAt ?? now
  }));
}

export type AssignLeadInput = {
  expectedVersion: number;
  ownerTenantUserId: string | null;
};

export function validateAssignLead(raw: unknown): Validated<AssignLeadInput> {
  if (!isRecord(raw)) return notAnObject();

  const reader = new Reader(raw);
  reader.closed(["expectedVersion", "ownerTenantUserId"]);
  const expectedVersion = reader.positiveInt("expectedVersion", {
    required: true
  });

  if (!reader.has("ownerTenantUserId")) {
    reader.error(
      "ownerTenantUserId",
      "ownerTenantUserId is required (null unassigns)."
    );
  }

  const owner = reader.uuid("ownerTenantUserId", { nullable: true });

  return result(reader, () => ({
    expectedVersion: expectedVersion!,
    ownerTenantUserId: owner ?? null
  }));
}

export type LookupInput = {
  kind: ContactPointKind;
  platform: string | null;
  normalized: string;
};

export function validateLookup(raw: unknown): Validated<LookupInput> {
  if (!isRecord(raw)) return notAnObject();

  const reader = new Reader(raw);
  const point = readContactPoint(raw, "body", reader);

  return result(reader, () => point!);
}

export type MergeInput = {
  survivorLeadId: string;
  absorbedLeadId: string;
  survivorVersion: number;
  absorbedVersion: number;
  note: string;
};

export function validateMerge(raw: unknown): Validated<MergeInput> {
  if (!isRecord(raw)) return notAnObject();

  const reader = new Reader(raw);
  reader.closed([
    "survivorLeadId",
    "absorbedLeadId",
    "survivorVersion",
    "absorbedVersion",
    "note"
  ]);
  const survivorLeadId = reader.uuid("survivorLeadId", { required: true });
  const absorbedLeadId = reader.uuid("absorbedLeadId", { required: true });
  const survivorVersion = reader.positiveInt("survivorVersion", {
    required: true
  });
  const absorbedVersion = reader.positiveInt("absorbedVersion", {
    required: true
  });
  const note = reader.text("note", { required: true, max: MAX_NOTE_LENGTH });

  if (survivorLeadId && survivorLeadId === absorbedLeadId) {
    reader.error("absorbedLeadId", "A lead cannot be merged into itself.");
  }

  return result(reader, () => ({
    survivorLeadId: survivorLeadId!,
    absorbedLeadId: absorbedLeadId!,
    survivorVersion: survivorVersion!,
    absorbedVersion: absorbedVersion!,
    note: note!
  }));
}

export type ConversionInput = {
  mode: ConversionMode;
  expectedVersion: number;
  externalCustomerRef: string | null;
  evidenceRef: string;
  note: string | null;
  toStageKey: string | null;
  occurredAt: Date;
};

export function validateConversion(
  raw: unknown,
  now: Date = new Date()
): Validated<ConversionInput> {
  if (!isRecord(raw)) return notAnObject();

  const reader = new Reader(raw);
  reader.closed([
    "mode",
    "expectedVersion",
    "externalCustomerRef",
    "evidenceRef",
    "note",
    "toStageKey",
    "occurredAt"
  ]);
  const mode = reader.oneOf("mode", CONVERSION_MODES, true);
  const expectedVersion = reader.positiveInt("expectedVersion", {
    required: true
  });
  const externalCustomerRef = reader.text("externalCustomerRef", {
    max: 128,
    pattern: REF_PATTERN
  });
  const evidenceRef = reader.text("evidenceRef", {
    required: true,
    max: 128,
    pattern: REF_PATTERN
  });
  const note = reader.text("note", { max: MAX_NOTE_LENGTH });
  const toStageKey = reader.text("toStageKey", {
    max: 40,
    pattern: STAGE_KEY_PATTERN
  });
  const occurredAt = reader.instant("occurredAt", now);

  if (mode === "authority_confirmed" && !externalCustomerRef) {
    reader.error(
      "externalCustomerRef",
      "An authority-confirmed conversion names the authority's customer reference."
    );
  }

  if (mode === "authority_unconfirmed" && !note) {
    reader.error("note", "A manual conversion requires a note.");
  }

  return result(reader, () => ({
    mode: mode!,
    expectedVersion: expectedVersion!,
    externalCustomerRef: externalCustomerRef ?? null,
    evidenceRef: evidenceRef!,
    note: note ?? null,
    toStageKey: toStageKey ?? null,
    occurredAt: occurredAt ?? now
  }));
}

export type ReverseConversionInput = {
  evidenceRef: string;
  reason: string | null;
  occurredAt: Date;
};

export function validateReverseConversion(
  raw: unknown,
  now: Date = new Date()
): Validated<ReverseConversionInput> {
  if (!isRecord(raw)) return notAnObject();

  const reader = new Reader(raw);
  reader.closed(["evidenceRef", "reason", "occurredAt"]);
  const evidenceRef = reader.text("evidenceRef", {
    required: true,
    max: 128,
    pattern: REF_PATTERN
  });
  const reason = reader.text("reason", { max: MAX_REASON_LENGTH });
  const occurredAt = reader.instant("occurredAt", now);

  return result(reader, () => ({
    evidenceRef: evidenceRef!,
    reason: reason ?? null,
    occurredAt: occurredAt ?? now
  }));
}

export type ExpectedVersionInput = { expectedVersion: number };

export function validateExpectedVersion(
  raw: unknown
): Validated<ExpectedVersionInput> {
  if (!isRecord(raw)) return notAnObject();

  const reader = new Reader(raw);
  reader.closed(["expectedVersion"]);
  const expectedVersion = reader.positiveInt("expectedVersion", {
    required: true
  });

  return result(reader, () => ({ expectedVersion: expectedVersion! }));
}

/** `If-Match: "3"` or `If-Match: 3` -> 3. Anything else -> null. */
export function parseIfMatchVersion(header: string | null): number | null {
  if (!header) return null;

  const match = /^\s*(?:W\/)?"?([1-9][0-9]{0,9})"?\s*$/.exec(header);

  if (!match) return null;

  const value = Number(match[1]);

  return Number.isSafeInteger(value) && value <= 2_147_483_647 ? value : null;
}

export type LeadCursor = { createdAt: string; id: string };

export function encodeLeadCursor(cursor: LeadCursor): string {
  return Buffer.from(`${cursor.createdAt}|${cursor.id}`, "utf8").toString(
    "base64url"
  );
}

export function decodeLeadCursor(raw: string): LeadCursor | null {
  if (raw.length > 200) return null;

  const decoded = Buffer.from(raw, "base64url").toString("utf8");
  const [createdAt, id, extra] = decoded.split("|");

  if (extra !== undefined || !createdAt || !isUuid(id)) return null;
  if (Number.isNaN(new Date(createdAt).getTime())) return null;

  return { createdAt, id: id.toLowerCase() };
}

export type ListLeadsQuery = {
  pipelineId: string | null;
  stageCategory: StageCategory | null;
  ownerTenantUserId: string | null;
  includeDeleted: boolean;
  cursor: LeadCursor | null;
  limit: number;
};

const LIST_KEYS = [
  "pipelineId",
  "stageCategory",
  "ownerTenantUserId",
  "includeDeleted",
  "cursor",
  "limit"
];

/** Out-of-range values are REJECTED, not clamped. */
export function validateListLeadsQuery(
  params: URLSearchParams
): Validated<ListLeadsQuery> {
  const errors: FieldError[] = [];

  for (const key of params.keys()) {
    if (!LIST_KEYS.includes(key)) {
      errors.push({ field: key, message: "Unknown query parameter." });
    }
  }

  const pipelineId = params.get("pipelineId");
  const stageCategory = params.get("stageCategory");
  const owner = params.get("ownerTenantUserId");
  const includeDeleted = params.get("includeDeleted");
  const rawCursor = params.get("cursor");
  const rawLimit = params.get("limit");

  if (pipelineId !== null && !isUuid(pipelineId)) {
    errors.push({ field: "pipelineId", message: "pipelineId must be a UUID." });
  }

  if (
    stageCategory !== null &&
    !STAGE_CATEGORIES.includes(stageCategory as StageCategory)
  ) {
    errors.push({
      field: "stageCategory",
      message: `stageCategory must be one of: ${STAGE_CATEGORIES.join(", ")}.`
    });
  }

  if (owner !== null && !isUuid(owner)) {
    errors.push({
      field: "ownerTenantUserId",
      message: "ownerTenantUserId must be a UUID."
    });
  }

  if (includeDeleted !== null && !["true", "false"].includes(includeDeleted)) {
    errors.push({
      field: "includeDeleted",
      message: "includeDeleted must be true or false."
    });
  }

  const cursor = rawCursor === null ? null : decodeLeadCursor(rawCursor);

  if (rawCursor !== null && !cursor) {
    errors.push({ field: "cursor", message: "cursor is invalid." });
  }

  const limit = rawLimit === null ? 25 : Number(rawLimit);

  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    errors.push({ field: "limit", message: "limit must be 1-100." });
  }

  return errors.length > 0
    ? { valid: false, errors }
    : {
        valid: true,
        value: {
          pipelineId: pipelineId?.toLowerCase() ?? null,
          stageCategory: (stageCategory as StageCategory | null) ?? null,
          ownerTenantUserId: owner?.toLowerCase() ?? null,
          includeDeleted: includeDeleted === "true",
          cursor,
          limit
        }
      };
}
