/**
 * Read/write helpers for DSL ABAC policy authoring (Issue #179). Thin data
 * layer over `awcms_abac_policies`, always called inside a tenant transaction
 * (RLS-enforced). The DSL validation authority is `domain/abac-policy.ts`;
 * cache invalidation is `application/policy-cache.ts` — the endpoints compose
 * those with these queries.
 *
 * DISTINCT from `abac-admin.ts` (the #171 flat CRUD data layer for
 * `/api/v1/abac/policies`, which only reads/writes effect/description/is_active
 * and never touches the DSL columns). This directory is the full DSL surface:
 * it reads and writes `dsl_version`/`conditions`/`priority`/applicability too.
 */

import type { AbacPolicyValidated } from "../domain/abac-policy";

export type AbacPolicyRecord = {
  id: string;
  policyCode: string;
  effect: "allow" | "deny";
  description: string | null;
  moduleKey: string | null;
  activityCode: string | null;
  action: string | null;
  resourceType: string | null;
  dslVersion: number;
  priority: number;
  conditions: unknown;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

type PolicyDbRow = {
  id: string;
  policy_code: string;
  effect: "allow" | "deny";
  description: string | null;
  module_key: string | null;
  activity_code: string | null;
  action: string | null;
  resource_type: string | null;
  dsl_version: number;
  priority: number;
  conditions: unknown;
  is_active: boolean;
  created_at: string | Date;
  updated_at: string | Date;
};

function mapRow(row: PolicyDbRow): AbacPolicyRecord {
  return {
    id: row.id,
    policyCode: row.policy_code,
    effect: row.effect,
    description: row.description,
    moduleKey: row.module_key,
    activityCode: row.activity_code,
    action: row.action,
    resourceType: row.resource_type,
    dslVersion: row.dsl_version,
    priority: row.priority,
    conditions: row.conditions,
    isActive: row.is_active,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString()
  };
}

export async function listAbacPolicies(
  tx: Bun.SQL,
  tenantId: string
): Promise<AbacPolicyRecord[]> {
  const rows = (await tx`
    SELECT id, policy_code, effect, description, module_key, activity_code,
           action, resource_type, dsl_version, priority, conditions, is_active,
           created_at, updated_at
    FROM awcms_abac_policies
    WHERE tenant_id = ${tenantId}
    ORDER BY priority ASC, policy_code ASC
  `) as PolicyDbRow[];
  return rows.map(mapRow);
}

export async function getAbacPolicyById(
  tx: Bun.SQL,
  tenantId: string,
  id: string
): Promise<AbacPolicyRecord | null> {
  const rows = (await tx`
    SELECT id, policy_code, effect, description, module_key, activity_code,
           action, resource_type, dsl_version, priority, conditions, is_active,
           created_at, updated_at
    FROM awcms_abac_policies
    WHERE tenant_id = ${tenantId} AND id = ${id}
  `) as PolicyDbRow[];
  const row = rows[0];
  return row ? mapRow(row) : null;
}

export async function insertAbacPolicy(
  tx: Bun.SQL,
  tenantId: string,
  input: AbacPolicyValidated,
  isActive: boolean
): Promise<AbacPolicyRecord> {
  const rows = (await tx`
    INSERT INTO awcms_abac_policies
      (tenant_id, policy_code, effect, description, module_key, activity_code,
       action, resource_type, dsl_version, priority, conditions, is_active)
    VALUES (
      ${tenantId}, ${input.policyCode}, ${input.effect}, ${input.description},
      ${input.moduleKey}, ${input.activityCode}, ${input.action},
      ${input.resourceType}, ${input.dslVersion}, ${input.priority},
      ${input.conditions}, ${isActive}
    )
    RETURNING id, policy_code, effect, description, module_key, activity_code,
              action, resource_type, dsl_version, priority, conditions, is_active,
              created_at, updated_at
  `) as PolicyDbRow[];
  return mapRow(rows[0]!);
}

export async function updateAbacPolicy(
  tx: Bun.SQL,
  tenantId: string,
  id: string,
  input: AbacPolicyValidated
): Promise<AbacPolicyRecord | null> {
  const rows = (await tx`
    UPDATE awcms_abac_policies
    SET policy_code = ${input.policyCode},
        effect = ${input.effect},
        description = ${input.description},
        module_key = ${input.moduleKey},
        activity_code = ${input.activityCode},
        action = ${input.action},
        resource_type = ${input.resourceType},
        dsl_version = ${input.dslVersion},
        priority = ${input.priority},
        conditions = ${input.conditions},
        updated_at = now()
    WHERE tenant_id = ${tenantId} AND id = ${id}
    RETURNING id, policy_code, effect, description, module_key, activity_code,
              action, resource_type, dsl_version, priority, conditions, is_active,
              created_at, updated_at
  `) as PolicyDbRow[];
  const row = rows[0];
  return row ? mapRow(row) : null;
}

export async function setAbacPolicyActive(
  tx: Bun.SQL,
  tenantId: string,
  id: string,
  isActive: boolean
): Promise<AbacPolicyRecord | null> {
  const rows = (await tx`
    UPDATE awcms_abac_policies
    SET is_active = ${isActive}, updated_at = now()
    WHERE tenant_id = ${tenantId} AND id = ${id}
    RETURNING id, policy_code, effect, description, module_key, activity_code,
              action, resource_type, dsl_version, priority, conditions, is_active,
              created_at, updated_at
  `) as PolicyDbRow[];
  const row = rows[0];
  return row ? mapRow(row) : null;
}
