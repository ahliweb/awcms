/**
 * ABAC policy authoring — write side of the access-control admin surface
 * (Issue #171). READS live in `access-directory.ts` (`listAbacPolicies`); all
 * WRITE logic is here so the read module stays side-effect-free.
 *
 * Every write is a HIGH-RISK access-control change and is audit-logged
 * (`awcms_audit_events`, severity `warning`). Callers MUST already be inside a
 * `withTenant` transaction AND have passed the `identity_access.access_control`
 * ABAC guard for the matching action — RLS FORCE on `awcms_abac_policies` is
 * the real tenant boundary.
 *
 * `awcms_abac_policies` columns (schema unchanged): id, tenant_id, policy_code
 * (unique per tenant), effect (CHECK IN 'allow'|'deny'), description (nullable),
 * is_active, created_at, updated_at.
 */
import { recordAuditEvent } from "../../logging/application/audit-log";
import type { AbacPolicyView } from "./access-directory";
import type {
  CreateAbacPolicyInput,
  UpdateAbacPolicyInput
} from "../domain/abac-admin-validation";

const AUDIT_MODULE_KEY = "identity_access";
const AUDIT_RESOURCE_TYPE = "abac_policy";
const POSTGRES_UNIQUE_VIOLATION = "23505";

/**
 * `policy_code` is unique per tenant (`awcms_abac_policies` unique index on
 * `(tenant_id, policy_code)`). A collision is a rule the CALLER can act on —
 * pick another code — so it must surface as 409, not an unhandled 500.
 */
export class DuplicatePolicyCodeError extends Error {
  constructor(policyCode: string) {
    super(`An ABAC policy with code "${policyCode}" already exists.`);
    this.name = "DuplicatePolicyCodeError";
  }
}

type AbacPolicyRow = {
  id: string;
  policy_code: string;
  effect: string;
  description: string | null;
  is_active: boolean;
};

function toView(row: AbacPolicyRow): AbacPolicyView {
  return {
    id: row.id,
    policyCode: row.policy_code,
    effect: row.effect,
    description: row.description,
    isActive: row.is_active
  };
}

async function fetchPolicyById(
  tx: Bun.SQL,
  tenantId: string,
  policyId: string
): Promise<AbacPolicyRow | null> {
  const rows = (await tx`
    SELECT id, policy_code, effect, description, is_active
    FROM awcms_abac_policies
    WHERE tenant_id = ${tenantId} AND id = ${policyId}
  `) as AbacPolicyRow[];
  return rows[0] ?? null;
}

/**
 * @throws {DuplicatePolicyCodeError} `policyCode` already exists for the tenant.
 *   Raised from the unique-violation that has already ABORTED the transaction —
 *   the route must map it to 409 without writing anything further to `tx`.
 */
export async function createPolicy(
  tx: Bun.SQL,
  tenantId: string,
  actorTenantUserId: string,
  input: CreateAbacPolicyInput,
  correlationId?: string
): Promise<AbacPolicyView> {
  let rows: AbacPolicyRow[];

  try {
    // Flat #171 rows leave `is_dsl_managed` at its default (false), so the
    // evaluator NEVER consumes them (policy-cache.ts filters is_dsl_managed) —
    // a flat policy is inert (its pre-#179 behavior), and cannot brick a tenant.
    // Only the DSL surface (`/api/v1/access/policies`) produces consumed
    // policies. See ADR-0033 §3.
    rows = (await tx`
      INSERT INTO awcms_abac_policies (tenant_id, policy_code, effect, description)
      VALUES (${tenantId}, ${input.policyCode}, ${input.effect}, ${input.description})
      RETURNING id, policy_code, effect, description, is_active
    `) as AbacPolicyRow[];
  } catch (error) {
    if (
      error instanceof Bun.SQL.PostgresError &&
      String(error.errno) === POSTGRES_UNIQUE_VIOLATION
    ) {
      throw new DuplicatePolicyCodeError(input.policyCode);
    }
    throw error;
  }

  const view = toView(rows[0]!);

  await recordAuditEvent(tx, {
    tenantId,
    actorTenantUserId,
    moduleKey: AUDIT_MODULE_KEY,
    action: "create",
    resourceType: AUDIT_RESOURCE_TYPE,
    resourceId: view.id,
    severity: "warning",
    message: `ABAC policy created: ${view.policyCode} (${view.effect}).`,
    attributes: { effect: view.effect, isActive: view.isActive },
    correlationId
  });

  return view;
}

/**
 * Applies any subset of {effect, description, isActive} to one policy. The
 * single update path backs BOTH the edit form and the enable/disable toggle.
 * Returns `null` when the policy does not exist in this tenant (route → 404);
 * `description: null` explicitly clears the column (distinct from "unchanged").
 */
export async function updatePolicy(
  tx: Bun.SQL,
  tenantId: string,
  actorTenantUserId: string,
  policyId: string,
  input: UpdateAbacPolicyInput,
  correlationId?: string
): Promise<AbacPolicyView | null> {
  const existing = await fetchPolicyById(tx, tenantId, policyId);
  if (!existing) return null;

  // `description` must distinguish "not provided" (keep existing) from an
  // explicit null (clear it) — `??` can't, so key-presence decides.
  const nextDescription =
    "description" in input ? (input.description ?? null) : existing.description;
  const nextEffect = input.effect ?? existing.effect;
  const nextIsActive = input.isActive ?? existing.is_active;

  const rows = (await tx`
    UPDATE awcms_abac_policies
    SET
      effect = ${nextEffect},
      description = ${nextDescription},
      is_active = ${nextIsActive},
      updated_at = now()
    WHERE tenant_id = ${tenantId} AND id = ${policyId}
    RETURNING id, policy_code, effect, description, is_active
  `) as AbacPolicyRow[];

  if (rows.length === 0) return null;

  const view = toView(rows[0]!);

  await recordAuditEvent(tx, {
    tenantId,
    actorTenantUserId,
    moduleKey: AUDIT_MODULE_KEY,
    action: "update",
    resourceType: AUDIT_RESOURCE_TYPE,
    resourceId: view.id,
    severity: "warning",
    message: `ABAC policy updated: ${view.policyCode}.`,
    attributes: { fields: Object.keys(input), isActive: view.isActive },
    correlationId
  });

  return view;
}

/**
 * Enable/disable convenience over {@link updatePolicy} — the toggle is just an
 * `isActive`-only update, kept as a named function so callers reading like
 * `setPolicyActive(false)` don't have to construct the input object.
 */
export function setPolicyActive(
  tx: Bun.SQL,
  tenantId: string,
  actorTenantUserId: string,
  policyId: string,
  isActive: boolean,
  correlationId?: string
): Promise<AbacPolicyView | null> {
  return updatePolicy(
    tx,
    tenantId,
    actorTenantUserId,
    policyId,
    { isActive },
    correlationId
  );
}
