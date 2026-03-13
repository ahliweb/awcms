/**
 * assignServiceProfile.js
 * Deployment Cell — Provisioning Workflow F
 *
 * Assigns or changes a service profile for a tenant.
 * Uses spec §15.6 Workflow F logic:
 *   - If no infra move required: creates new contract row only
 *   - If infra move required: also creates a tenant_migrations row
 *     and sets tenant to 'migrating'
 *
 * Spec reference: §15.6 Workflow F
 */

import { supabase as publicClient } from '@/lib/customSupabaseClient';
import { requiresCellMigration } from '@/lib/tenancy/serviceProfile';

/**
 * @param {object} params
 * @param {string} params.tenantId
 * @param {string} params.currentProfile      - Current ServiceProfile value
 * @param {string} params.newProfile          - Target ServiceProfile value
 * @param {string} params.runtimeIsolation
 * @param {string} params.dataIsolation
 * @param {string} params.edgeIsolation
 * @param {string} [params.targetCellId]      - Required if infra move is needed
 * @param {string} [params.migrationKind]     - Required if infra move is needed
 * @param {string} [params.plannedCutoverAt]  - ISO timestamp
 * @param {string} [params.rollbackDeadline]  - ISO timestamp; required if infra move
 * @param {string} [params.operatorNotes]
 * @param {object} [params.client]
 * @returns {Promise<{ contract: object, migration: object|null, error: Error|null }>}
 */
export async function assignServiceProfile({
  tenantId,
  currentProfile,
  newProfile,
  runtimeIsolation,
  dataIsolation,
  edgeIsolation,
  targetCellId,
  migrationKind,
  plannedCutoverAt,
  rollbackDeadline,
  operatorNotes,
  client,
}) {
  const db = client || publicClient;
  const needsMigration = requiresCellMigration(currentProfile, newProfile);

  if (needsMigration && (!targetCellId || !migrationKind || !rollbackDeadline)) {
    return {
      contract: null,
      migration: null,
      error: new Error(
        'assignServiceProfile: targetCellId, migrationKind, and rollbackDeadline are required when changing isolation levels.'
      ),
    };
  }

  // Step 1: Insert new service contract row
  const { data: contract, error: contractErr } = await db
    .from('tenant_service_contracts')
    .insert({
      tenant_id:               tenantId,
      service_profile:         newProfile,
      runtime_isolation_level: runtimeIsolation,
      data_isolation_level:    dataIsolation,
      edge_isolation_level:    edgeIsolation,
    })
    .select()
    .single();

  if (contractErr) {
    return { contract: null, migration: null, error: new Error(`assignServiceProfile: ${contractErr.message}`) };
  }

  // Policy-only change: return early
  if (!needsMigration) {
    return { contract, migration: null, error: null };
  }

  // Step 2: Create migration record
  const { data: migration, error: migErr } = await db
    .from('tenant_migrations')
    .insert({
      tenant_id:           tenantId,
      target_cell_id:      targetCellId,
      migration_kind:      migrationKind,
      status:              'planned',
      planned_cutover_at:  plannedCutoverAt || null,
      rollback_deadline:   rollbackDeadline,
      operator_notes:      operatorNotes || null,
    })
    .select()
    .single();

  if (migErr) {
    return { contract, migration: null, error: new Error(`assignServiceProfile (migration): ${migErr.message}`) };
  }

  // Step 3: Set tenant status to 'migrating'
  const { error: tenantErr } = await db
    .from('tenants_control')
    .update({ status: 'migrating' })
    .eq('id', tenantId);

  if (tenantErr) {
    return { contract, migration, error: new Error(`assignServiceProfile (tenant status): ${tenantErr.message}`) };
  }

  return { contract, migration, error: null };
}
