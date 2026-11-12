/**
 * Inbox SLA policies (Issue #1164, ADR-0160 section 4): create, retire, list,
 * and resolve the policy that applies to a conversation's business scope.
 *
 * A policy's terms are immutable (sql/384): a change is a new policy, which
 * retires the active one for the same scope in the same transaction, so a
 * breach always names the terms it was measured against.
 */
import { isUniqueViolation } from "./sql-errors";
import type { SlaCalendar, WorkingHours } from "../domain/sla-calendar";

export type ScopeRef = { type: string; id: string };

export type SlaPolicyView = {
  id: string;
  businessScope: ScopeRef | null;
  name: string;
  timezone: string;
  firstResponseMinutes: number;
  nextResponseMinutes: number;
  workingHours: WorkingHours;
  holidays: string[];
  status: "active" | "retired";
  createdAt: string;
  retiredAt: string | null;
};

type PolicyRow = {
  id: string;
  business_scope_type: string | null;
  business_scope_id: string | null;
  name: string;
  timezone: string;
  first_response_minutes: number;
  next_response_minutes: number;
  working_hours: WorkingHours | string;
  holidays: (string | Date)[] | string;
  status: "active" | "retired";
  created_at: Date;
  retired_at: Date | null;
};

export type ResolvedSlaPolicy = {
  id: string;
  firstResponseMinutes: number;
  nextResponseMinutes: number;
  calendar: SlaCalendar;
};

function isoDate(value: string | Date): string {
  return typeof value === "string" ? value : value.toISOString().slice(0, 10);
}

/** `date[]` arrives either as an array or, through some drivers, as `{a,b}` text. */
function readHolidays(raw: PolicyRow["holidays"]): string[] {
  if (Array.isArray(raw)) return raw.map(isoDate);

  const trimmed = String(raw).replace(/^\{|\}$/g, "");

  return trimmed === "" ? [] : trimmed.split(",");
}

function readHours(raw: PolicyRow["working_hours"]): WorkingHours {
  return (typeof raw === "string" ? JSON.parse(raw) : raw) as WorkingHours;
}

function toView(row: PolicyRow): SlaPolicyView {
  return {
    id: row.id,
    businessScope:
      row.business_scope_type && row.business_scope_id
        ? { type: row.business_scope_type, id: row.business_scope_id }
        : null,
    name: row.name,
    timezone: row.timezone,
    firstResponseMinutes: row.first_response_minutes,
    nextResponseMinutes: row.next_response_minutes,
    workingHours: readHours(row.working_hours),
    holidays: readHolidays(row.holidays),
    status: row.status,
    createdAt: row.created_at.toISOString(),
    retiredAt: row.retired_at ? row.retired_at.toISOString() : null
  };
}

/**
 * The policies the caller may see (#1275 audit, L-1): everything when acting
 * tenant-wide; otherwise the tenant default (it governs their conversations
 * too) plus the policies of the scopes they cover, never another brand's.
 */
export async function listSlaPolicies(
  tx: Bun.SQL,
  tenantId: string,
  visibility: { unconfined: true } | { unconfined: false; scopeKeys: string[] }
): Promise<SlaPolicyView[]> {
  const unconfined = visibility.unconfined;
  const keys = visibility.unconfined ? [] : visibility.scopeKeys;
  // Bounded: one active policy per scope plus their retired predecessors; the
  // newest 200 are more than any screen shows.
  const rows = (await tx`
    SELECT id, business_scope_type, business_scope_id, name, timezone,
           first_response_minutes, next_response_minutes, working_hours,
           holidays::text[] AS holidays, status, created_at, retired_at
    FROM awcms_inbox_sla_policies
    WHERE tenant_id = ${tenantId}
      AND (
        ${unconfined}::boolean
        OR business_scope_type IS NULL
        OR (business_scope_type || ':' || business_scope_id::text)
             = ANY(${tx.array(keys, "text")}::text[])
      )
    ORDER BY created_at DESC, id DESC
    LIMIT 200
  `) as PolicyRow[];

  return rows.map(toView);
}

export async function fetchSlaPolicy(
  tx: Bun.SQL,
  tenantId: string,
  id: string
): Promise<SlaPolicyView | null> {
  const rows = (await tx`
    SELECT id, business_scope_type, business_scope_id, name, timezone,
           first_response_minutes, next_response_minutes, working_hours,
           holidays::text[] AS holidays, status, created_at, retired_at
    FROM awcms_inbox_sla_policies
    WHERE tenant_id = ${tenantId} AND id = ${id}
  `) as PolicyRow[];

  return rows[0] ? toView(rows[0]) : null;
}

export type CreateSlaPolicyInput = {
  businessScope: ScopeRef | null;
  name: string;
  firstResponseMinutes: number;
  nextResponseMinutes: number;
  calendar: SlaCalendar;
};

/**
 * Creates a policy and retires the active one for the same scope, atomically.
 * A concurrent creator for the same scope loses on the partial unique index and
 * gets `conflict` (never two active policies).
 */
export async function createSlaPolicy(
  tx: Bun.TransactionSQL,
  tenantId: string,
  actorTenantUserId: string,
  input: CreateSlaPolicyInput
): Promise<
  | { outcome: "created"; policy: SlaPolicyView; retiredId: string | null }
  | { outcome: "conflict" }
> {
  const scopeType = input.businessScope?.type ?? null;
  const scopeId = input.businessScope?.id ?? null;

  // One writer per (tenant, scope) at a time: retire-then-insert is atomic.
  await tx`
    SELECT pg_advisory_xact_lock(
      hashtext(${`awcms_inbox_sla_policy:${tenantId}:${scopeType ?? ""}:${scopeId ?? ""}`})
    )
  `;

  try {
    return await tx.savepoint(async (sp) => {
      const retired = (await sp`
    UPDATE awcms_inbox_sla_policies
    SET status = 'retired', retired_at = now(), retired_by = ${actorTenantUserId},
        updated_at = now()
    WHERE tenant_id = ${tenantId} AND status = 'active'
      AND business_scope_type IS NOT DISTINCT FROM ${scopeType}
      AND business_scope_id IS NOT DISTINCT FROM ${scopeId}::uuid
    RETURNING id
  `) as { id: string }[];
      const rows = (await sp`
      INSERT INTO awcms_inbox_sla_policies
        (tenant_id, business_scope_type, business_scope_id, name, timezone,
         first_response_minutes, next_response_minutes, working_hours, holidays,
         created_by)
      VALUES (${tenantId}, ${scopeType}, ${scopeId}::uuid, ${input.name},
              ${input.calendar.timezone}, ${input.firstResponseMinutes},
              ${input.nextResponseMinutes},
              ${input.calendar.workingHours as object}::jsonb,
              ${sp.array([...input.calendar.holidays], "text")}::date[],
              ${actorTenantUserId})
      RETURNING id
    `) as { id: string }[];
      const policy = await fetchSlaPolicy(sp, tenantId, rows[0]!.id);

      return {
        outcome: "created" as const,
        policy: policy!,
        retiredId: retired[0]?.id ?? null
      };
    });
  } catch (error) {
    // The savepoint rolled back BOTH the retirement and the insert.
    if (isUniqueViolation(error)) return { outcome: "conflict" };

    throw error;
  }
}

export async function retireSlaPolicy(
  tx: Bun.SQL,
  tenantId: string,
  actorTenantUserId: string,
  id: string
): Promise<"retired" | "already_retired" | "not_found"> {
  const rows = (await tx`
    UPDATE awcms_inbox_sla_policies
    SET status = 'retired', retired_at = now(), retired_by = ${actorTenantUserId},
        updated_at = now()
    WHERE tenant_id = ${tenantId} AND id = ${id} AND status = 'active'
    RETURNING id
  `) as { id: string }[];

  if (rows.length > 0) return "retired";

  return (await fetchSlaPolicy(tx, tenantId, id))
    ? "already_retired"
    : "not_found";
}

/**
 * The active policy for `scope`, else the tenant default (scope-less), else
 * `null` (no SLA is measured).
 */
export async function resolveSlaPolicy(
  tx: Bun.SQL,
  tenantId: string,
  scope: ScopeRef | null
): Promise<ResolvedSlaPolicy | null> {
  const scopeType = scope?.type ?? "";
  const scopeId = scope?.id ?? null;
  const rows = (await tx`
    SELECT id, business_scope_type, business_scope_id, name, timezone,
           first_response_minutes, next_response_minutes, working_hours,
           holidays::text[] AS holidays, status, created_at, retired_at
    FROM awcms_inbox_sla_policies
    WHERE tenant_id = ${tenantId} AND status = 'active'
      AND (
        (business_scope_type IS NULL AND business_scope_id IS NULL)
        OR (business_scope_type = ${scopeType} AND business_scope_id = ${scopeId}::uuid)
      )
    ORDER BY (business_scope_type IS NULL) ASC
    LIMIT 1
  `) as PolicyRow[];
  const row = rows[0];

  if (!row) return null;

  return {
    id: row.id,
    firstResponseMinutes: row.first_response_minutes,
    nextResponseMinutes: row.next_response_minutes,
    calendar: {
      timezone: row.timezone,
      workingHours: readHours(row.working_hours),
      holidays: readHolidays(row.holidays)
    }
  };
}
