/**
 * attachDomain.js
 * Deployment Cell — Provisioning Workflows D & E
 *
 * Workflow D: Attach a domain hostname to a tenant
 * Workflow E: Promote a domain to the tenant's primary
 *
 * Spec reference: §15.4 Workflow D, §15.5 Workflow E
 */

import { supabase as publicClient } from '@/lib/customSupabaseClient';

/**
 * Workflow D — Attach a domain to a tenant (starts in 'pending').
 * Steps: create tenant_domains row, await external verification,
 * then call activateDomain() when DNS/TLS is confirmed.
 *
 * @param {object} params
 * @param {string} params.tenantId
 * @param {string} params.cellId
 * @param {string} params.hostname
 * @param {string} params.domainKind        - RouteClass domain_kind
 * @param {string} [params.certificateMode]
 * @param {string} [params.routingMode]
 * @param {string} [params.cloudflareHostnameRef]
 * @param {string} [params.originHint]
 * @param {string} [params.notes]
 * @param {object} [params.client]
 * @returns {Promise<{ domain: object, error: Error|null }>}
 */
export async function attachDomain({
  tenantId,
  cellId,
  hostname,
  domainKind,
  certificateMode,
  routingMode,
  cloudflareHostnameRef,
  originHint,
  notes,
  client,
}) {
  const db = client || publicClient;

  const { data: domain, error } = await db
    .from('tenant_domains')
    .insert({
      tenant_id:               tenantId,
      cell_id:                 cellId,
      hostname:                hostname.toLowerCase().trim(),
      domain_kind:             domainKind,
      is_primary:              false,
      certificate_mode:        certificateMode || null,
      routing_mode:            routingMode || null,
      verification_status:     'pending',
      cloudflare_hostname_ref: cloudflareHostnameRef || null,
      origin_hint:             originHint || null,
      notes:                   notes || null,
    })
    .select()
    .single();

  if (error) {
    return { domain: null, error: new Error(`attachDomain: ${error.message}`) };
  }

  return { domain, error: null };
}

/**
 * Marks a domain as verified and activates it.
 * Called after external DNS/TLS verification is confirmed.
 *
 * @param {object} params
 * @param {string} params.domainId
 * @param {object} [params.client]
 * @returns {Promise<{ domain: object, error: Error|null }>}
 */
export async function activateDomain({ domainId, client }) {
  const db = client || publicClient;

  const { data: domain, error } = await db
    .from('tenant_domains')
    .update({
      verification_status: 'verified',
      active_from:         new Date().toISOString(),
    })
    .eq('id', domainId)
    .select()
    .single();

  if (error) {
    return { domain: null, error: new Error(`activateDomain: ${error.message}`) };
  }
  return { domain, error: null };
}

/**
 * Workflow E — Promote a domain to primary public domain for the tenant.
 * Demotes the previous primary (if any) first.
 *
 * Steps (spec §15.5):
 *   1. validate domain belongs to tenant
 *   2. validate domain is active and verified
 *   3. demote previous primary
 *   4. set is_primary = true
 *   5. update tenants_control.primary_domain_id
 *
 * @param {object} params
 * @param {string} params.tenantId
 * @param {string} params.domainId
 * @param {object} [params.client]
 * @returns {Promise<{ error: Error|null }>}
 */
export async function promotePrimaryDomain({ tenantId, domainId, client }) {
  const db = client || publicClient;

  // Step 1–2: verify the domain belongs to tenant and is active/verified
  const { data: domain, error: lookupErr } = await db
    .from('tenant_domains')
    .select('id, tenant_id, verification_status, active_from, active_to')
    .eq('id', domainId)
    .single();

  if (lookupErr || !domain) {
    return { error: new Error('promotePrimaryDomain: domain not found.') };
  }
  if (domain.tenant_id !== tenantId) {
    return { error: new Error('promotePrimaryDomain: domain does not belong to this tenant.') };
  }
  if (domain.verification_status !== 'verified') {
    return { error: new Error('promotePrimaryDomain: domain is not verified.') };
  }
  const now = new Date();
  if (domain.active_from && new Date(domain.active_from) > now) {
    return { error: new Error('promotePrimaryDomain: domain is not yet active.') };
  }
  if (domain.active_to && new Date(domain.active_to) <= now) {
    return { error: new Error('promotePrimaryDomain: domain has expired.') };
  }

  // Step 3: demote all existing primary domains for this tenant
  const { error: demoteErr } = await db
    .from('tenant_domains')
    .update({ is_primary: false })
    .eq('tenant_id', tenantId)
    .eq('is_primary', true);

  if (demoteErr) {
    return { error: new Error(`promotePrimaryDomain (demote): ${demoteErr.message}`) };
  }

  // Step 4: set new primary
  const { error: promoteErr } = await db
    .from('tenant_domains')
    .update({ is_primary: true })
    .eq('id', domainId);

  if (promoteErr) {
    return { error: new Error(`promotePrimaryDomain (promote): ${promoteErr.message}`) };
  }

  // Step 5: update tenants_control.primary_domain_id
  const { error: tenantUpdateErr } = await db
    .from('tenants_control')
    .update({ primary_domain_id: domainId })
    .eq('id', tenantId);

  if (tenantUpdateErr) {
    return { error: new Error(`promotePrimaryDomain (tenant update): ${tenantUpdateErr.message}`) };
  }

  return { error: null };
}
