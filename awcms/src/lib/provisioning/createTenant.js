/**
 * createTenant.js
 * Deployment Cell — Provisioning Workflow C
 *
 * Creates a new tenant in the control-plane and initializes
 * the first service contract. All steps are documented in
 * spec §15.3 Workflow C — Create tenant.
 *
 * @param {object} supabaseAdmin - Admin client that bypasses RLS
 */

import { supabase as publicClient } from '@/lib/customSupabaseClient';

/**
 * Creates a new tenant record and its initial service contract.
 *
 * Steps (spec §15.3):
 *   1. create tenants_control row in 'draft'
 *   2. assign current_cell_id
 *   3. create tenant_service_contracts row
 *   4. (app-level) initialize tenant-scoped app data — caller's responsibility
 *   5. return created tenant
 *
 * @param {object} params
 * @param {string} params.projectId           - platform_projects.id
 * @param {string} params.tenantCode          - Short immutable slug (e.g. 'acme')
 * @param {string} params.displayName         - Human-readable name
 * @param {string} params.currentCellId       - deployment_cells.id to assign
 * @param {string} params.serviceProfile      - ServiceProfile enum value
 * @param {string} params.runtimeIsolation    - e.g. 'shared'
 * @param {string} params.dataIsolation       - e.g. 'shared'
 * @param {string} params.edgeIsolation       - e.g. 'shared'
 * @param {string} [params.billingModel]      - Optional billing model label
 * @param {object} [params.client]            - Override Supabase client (defaults to publicClient)
 * @returns {Promise<{ tenant: object, contract: object, error: Error|null }>}
 */
export async function createTenant({
  projectId,
  tenantCode,
  displayName,
  currentCellId,
  serviceProfile,
  runtimeIsolation,
  dataIsolation,
  edgeIsolation,
  billingModel,
  client,
}) {
  const db = client || publicClient;

  // Step 1–2: create tenant in draft
  const { data: tenant, error: tenantErr } = await db
    .from('tenants_control')
    .insert({
      project_id:       projectId,
      tenant_code:      tenantCode,
      display_name:     displayName,
      status:           'draft',
      current_cell_id:  currentCellId,
      billing_model:    billingModel || null,
    })
    .select()
    .single();

  if (tenantErr) {
    return { tenant: null, contract: null, error: new Error(`createTenant: ${tenantErr.message}`) };
  }

  // Step 3: create initial service contract
  const { data: contract, error: contractErr } = await db
    .from('tenant_service_contracts')
    .insert({
      tenant_id:               tenant.id,
      service_profile:         serviceProfile,
      runtime_isolation_level: runtimeIsolation,
      data_isolation_level:    dataIsolation,
      edge_isolation_level:    edgeIsolation,
    })
    .select()
    .single();

  if (contractErr) {
    return { tenant, contract: null, error: new Error(`createTenant (contract): ${contractErr.message}`) };
  }

  return { tenant, contract, error: null };
}
