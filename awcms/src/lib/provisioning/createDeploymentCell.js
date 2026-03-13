/**
 * createDeploymentCell.js
 * Deployment Cell — Provisioning Workflow B
 *
 * Creates a deployment cell record, validates it, then marks it
 * active once the operator confirms external resources are ready.
 *
 * Spec reference: §15.2 Workflow B — Create deployment cell
 */

import { supabase as publicClient } from '@/lib/customSupabaseClient';

/**
 * Step 1–6 of Workflow B: Create a deployment cell in 'draft' status.
 * Caller is responsible for provisioning external resources (Coolify, Cloudflare)
 * after this call. Then call activateDeploymentCell() when validation passes.
 *
 * @param {object} params
 * @param {string} params.projectId
 * @param {string} params.environment         - 'production' | 'staging' | 'preview' | 'development'
 * @param {string} params.serviceProfile
 * @param {string} params.coolifyMode         - 'self_hosted' | 'coolify_cloud'
 * @param {string} params.supabaseMode        - 'managed' | 'self_hosted'
 * @param {string} [params.coolifyServerRef]
 * @param {string} [params.cloudflareAccountRef]
 * @param {string} [params.cloudflareZoneRef]
 * @param {string} [params.supabaseProjectRef]
 * @param {string} [params.linodeRegion]
 * @param {string} [params.runtimeCapacityClass]
 * @param {string} [params.notes]
 * @param {object} [params.client]
 * @returns {Promise<{ cell: object, error: Error|null }>}
 */
export async function createDeploymentCell({
  projectId,
  environment,
  serviceProfile,
  coolifyMode,
  supabaseMode,
  coolifyServerRef,
  cloudflareAccountRef,
  cloudflareZoneRef,
  supabaseProjectRef,
  linodeRegion,
  runtimeCapacityClass,
  notes,
  client,
}) {
  const db = client || publicClient;

  const { data: cell, error } = await db
    .from('deployment_cells')
    .insert({
      project_id:              projectId,
      environment,
      service_profile:         serviceProfile,
      coolify_mode:            coolifyMode,
      supabase_mode:           supabaseMode,
      coolify_server_ref:      coolifyServerRef || null,
      cloudflare_account_ref:  cloudflareAccountRef || null,
      cloudflare_zone_ref:     cloudflareZoneRef || null,
      supabase_project_ref:    supabaseProjectRef || null,
      linode_region:           linodeRegion || null,
      runtime_capacity_class:  runtimeCapacityClass || null,
      notes:                   notes || null,
      status:                  'draft',
    })
    .select()
    .single();

  if (error) {
    return { cell: null, error: new Error(`createDeploymentCell: ${error.message}`) };
  }

  return { cell, error: null };
}

/**
 * Step 7 of Workflow B: Mark a deployment cell as active.
 * Should only be called after external validation is complete.
 *
 * @param {object} params
 * @param {string} params.cellId
 * @param {object} [params.client]
 * @returns {Promise<{ cell: object, error: Error|null }>}
 */
export async function activateDeploymentCell({ cellId, client }) {
  const db = client || publicClient;

  const { data: cell, error } = await db
    .from('deployment_cells')
    .update({ status: 'active' })
    .eq('id', cellId)
    .eq('status', 'draft') // safety guard: only transition from draft
    .select()
    .single();

  if (error || !cell) {
    return {
      cell: null,
      error: new Error(
        error ? `activateDeploymentCell: ${error.message}` :
          'activateDeploymentCell: cell not found or not in draft status.'
      ),
    };
  }

  return { cell, error: null };
}
