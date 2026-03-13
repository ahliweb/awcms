/**
 * deploymentCellRunbooks.js
 * Deployment Cell — Phase 6: Migration Runbooks A–D
 *
 * Provides structured state machine helpers for executing cell
 * migration runbooks. Each runbook corresponds to a specific
 * service profile transition path.
 *
 * Spec reference: §16 Migration Runbooks, §16.5 Migration validation checklist
 *
 * These helpers manage the tenant_migrations record lifecycle.
 * The actual data movement (Supabase export, Linode provisioning, etc.)
 * is performed by the platform operator following the runbook steps.
 */

import { supabase as publicClient } from '@/lib/customSupabaseClient';

// Valid runbook migration_kind values
export const MigrationKind = Object.freeze({
  SHARED_TO_DEDICATED_MANAGED:        'shared_to_dedicated_managed',
  DEDICATED_MANAGED_TO_HYBRID:        'dedicated_managed_to_hybrid',
  DEDICATED_MANAGED_TO_SELF_HOSTED:   'dedicated_managed_to_self_hosted',
  SELF_HOSTED_TO_DEDICATED_MANAGED:   'self_hosted_to_dedicated_managed',
  CELL_UPGRADE:                        'cell_upgrade',
  CELL_DOWNGRADE:                      'cell_downgrade',
  PROFILE_ONLY_CHANGE:                 'profile_only_change',
});

export const MigrationStatus = Object.freeze({
  PLANNED:     'planned',
  IN_PROGRESS: 'in_progress',
  VALIDATING:  'validating',
  COMPLETED:   'completed',
  ROLLED_BACK: 'rolled_back',
  FAILED:      'failed',
});

/**
 * Transitions a migration record from 'planned' → 'in_progress'.
 * Enforces that a rollback_deadline is set (spec §16.4).
 *
 * @param {string} migrationId
 * @param {object} [client]
 * @returns {Promise<{ error: Error|null }>}
 */
export async function startMigration(migrationId, client) {
  const db = client || publicClient;

  // Validate rollback_deadline before allowing start
  const { data: migration, error: lookupErr } = await db
    .from('tenant_migrations')
    .select('id, status, rollback_deadline')
    .eq('id', migrationId)
    .single();

  if (lookupErr || !migration) {
    return { error: new Error('startMigration: migration record not found.') };
  }
  if (migration.status !== MigrationStatus.PLANNED) {
    return { error: new Error(`startMigration: migration must be in 'planned' status, got '${migration.status}'.`) };
  }
  if (!migration.rollback_deadline) {
    return { error: new Error('startMigration: rollback_deadline must be set before starting a migration.') };
  }

  const { error } = await db
    .from('tenant_migrations')
    .update({ status: MigrationStatus.IN_PROGRESS })
    .eq('id', migrationId);

  return { error: error ? new Error(`startMigration: ${error.message}`) : null };
}

/**
 * Marks a migration as 'validating' (operator is running the validation checklist).
 * @param {string} migrationId
 * @param {object} [client]
 */
export async function enterValidation(migrationId, client) {
  const db = client || publicClient;
  const { error } = await db
    .from('tenant_migrations')
    .update({ status: MigrationStatus.VALIDATING })
    .eq('id', migrationId)
    .eq('status', MigrationStatus.IN_PROGRESS);
  return { error: error ? new Error(`enterValidation: ${error.message}`) : null };
}

/**
 * Completes a migration. Updates:
 *   - migration status → 'completed'
 *   - tenants_control.current_cell_id → target_cell_id
 *   - tenants_control.status → 'active'
 *
 * @param {object} params
 * @param {string} params.migrationId
 * @param {string} params.tenantId
 * @param {string} params.targetCellId
 * @param {object} [params.client]
 */
export async function completeMigration({ migrationId, tenantId, targetCellId, client }) {
  const db = client || publicClient;

  const { error: migErr } = await db
    .from('tenant_migrations')
    .update({
      status:             MigrationStatus.COMPLETED,
      actual_cutover_at:  new Date().toISOString(),
    })
    .eq('id', migrationId);

  if (migErr) return { error: new Error(`completeMigration: ${migErr.message}`) };

  const { error: tenantErr } = await db
    .from('tenants_control')
    .update({ current_cell_id: targetCellId, status: 'active' })
    .eq('id', tenantId);

  return { error: tenantErr ? new Error(`completeMigration (tenant): ${tenantErr.message}`) : null };
}

/**
 * Rolls back a migration within the rollback window.
 * - Sets migration status to 'rolled_back'
 * - Restores tenants_control.current_cell_id to source_cell_id
 * - Sets tenant status to 'active'
 *
 * Enforces: rollback_deadline must not have passed.
 *
 * @param {object} params
 * @param {string} params.migrationId
 * @param {string} params.tenantId
 * @param {object} [params.client]
 */
export async function rollbackMigration({ migrationId, tenantId, client }) {
  const db = client || publicClient;

  const { data: migration, error: lookupErr } = await db
    .from('tenant_migrations')
    .select('id, status, rollback_deadline, source_cell_id')
    .eq('id', migrationId)
    .single();

  if (lookupErr || !migration) {
    return { error: new Error('rollbackMigration: migration record not found.') };
  }

  if (migration.rollback_deadline && new Date(migration.rollback_deadline) < new Date()) {
    return { error: new Error('rollbackMigration: rollback window has expired.') };
  }

  const { error: migErr } = await db
    .from('tenant_migrations')
    .update({ status: MigrationStatus.ROLLED_BACK })
    .eq('id', migrationId);

  if (migErr) return { error: new Error(`rollbackMigration: ${migErr.message}`) };

  const { error: tenantErr } = await db
    .from('tenants_control')
    .update({ current_cell_id: migration.source_cell_id, status: 'active' })
    .eq('id', tenantId);

  return { error: tenantErr ? new Error(`rollbackMigration (tenant): ${tenantErr.message}`) : null };
}

/**
 * Validates the migration checklist per spec §16.5.
 * Returns which checks pass/fail. Does NOT auto-complete the migration;
 * operator must review and call completeMigration() explicitly.
 *
 * @param {object} counts - operator-supplied row counts from source and target
 * @param {string} counts.sourceTenantRowCount
 * @param {string} counts.targetTenantRowCount
 * @param {boolean} counts.domainsMatch
 * @param {boolean} counts.routesResolve
 * @param {boolean} counts.authWorking
 * @param {boolean} counts.backgroundJobsWorking
 * @param {boolean} counts.rlsChecksPass
 * @returns {{ passed: boolean, results: object }}
 */
export function validateMigrationChecklist(counts) {
  const results = {
    tenant_counts_match:       counts.sourceTenantRowCount === counts.targetTenantRowCount,
    domains_match:             !!counts.domainsMatch,
    routes_resolve:            !!counts.routesResolve,
    auth_working:              !!counts.authWorking,
    background_jobs_working:   !!counts.backgroundJobsWorking,
    rls_checks_pass:           !!counts.rlsChecksPass,
  };
  const passed = Object.values(results).every(Boolean);
  return { passed, results };
}
