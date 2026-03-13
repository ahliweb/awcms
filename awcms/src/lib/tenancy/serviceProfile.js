/**
 * serviceProfile.js
 * Deployment Cell — Service-Profile Engine
 *
 * Defines the ServiceProfile enum and runtime behavior metadata
 * for each profile. Source of truth for profile-to-behavior mapping
 * in AWCMS code (spec §11).
 */

/**
 * Canonical service profile identifiers.
 * Assigned via provisioning or tenant_service_contracts; never inferred
 * from server names or domain patterns.
 * @enum {string}
 */
export const ServiceProfile = Object.freeze({
  SHARED_MANAGED:         'shared_managed',
  DEDICATED_MANAGED:      'dedicated_managed',
  DEDICATED_HYBRID:       'dedicated_hybrid',
  DEDICATED_SELF_HOSTED:  'dedicated_self_hosted',
  VANITY_DOMAIN_SAAS:     'vanity_domain_saas',
});

/**
 * Runtime behavior descriptors per profile.
 * Used by provisioning logic and admin UIs to communicate constraints.
 */
export const SERVICE_PROFILE_META = Object.freeze({
  [ServiceProfile.SHARED_MANAGED]: {
    label: 'Shared Managed',
    runtimeIsolation: 'shared',
    dataIsolation: 'shared',
    edgeIsolation: 'shared',
    quotaCheckRequired: true,
    abuseCheckRequired: true,
    description: 'Tenant shares runtime and data plane with others. Quota and abuse checks are mandatory.',
  },
  [ServiceProfile.DEDICATED_MANAGED]: {
    label: 'Dedicated Managed',
    runtimeIsolation: 'dedicated',
    dataIsolation: 'dedicated',
    edgeIsolation: 'shared',
    quotaCheckRequired: false,
    abuseCheckRequired: false,
    description: 'Tenant gets a dedicated runtime cell and dedicated managed Supabase project.',
  },
  [ServiceProfile.DEDICATED_HYBRID]: {
    label: 'Dedicated Hybrid',
    runtimeIsolation: 'dedicated',
    dataIsolation: 'dedicated',  // still Supabase managed
    edgeIsolation: 'shared',
    quotaCheckRequired: false,
    abuseCheckRequired: false,
    description: 'Dedicated runtime on Linode; managed Supabase data plane retained.',
  },
  [ServiceProfile.DEDICATED_SELF_HOSTED]: {
    label: 'Dedicated Self-Hosted',
    runtimeIsolation: 'dedicated',
    dataIsolation: 'dedicated',  // self-hosted data plane
    edgeIsolation: 'byod',
    quotaCheckRequired: false,
    abuseCheckRequired: false,
    description: 'Fully dedicated runtime and self-hosted data plane. Maximum isolation.',
  },
  [ServiceProfile.VANITY_DOMAIN_SAAS]: {
    label: 'Vanity Domain SaaS',
    runtimeIsolation: 'shared',   // overlays on top of another profile
    dataIsolation: 'shared',
    edgeIsolation: 'dedicated',   // per-hostname Cloudflare Custom Hostnames
    quotaCheckRequired: true,
    abuseCheckRequired: true,
    description: 'Vanity hostname overlay; adds custom-hostname routing workflows. Must overlay another profile.',
  },
});

/**
 * Returns the metadata for a given service profile.
 * @param {string} profile - A ServiceProfile value
 * @returns {object} Profile metadata
 * @throws {Error} If profile is unknown
 */
export function getServiceProfileMeta(profile) {
  const meta = SERVICE_PROFILE_META[profile];
  if (!meta) {
    throw new Error(
      `[serviceProfile] Unknown profile: "${profile}". ` +
      `Must be one of: ${Object.values(ServiceProfile).join(', ')}`
    );
  }
  return meta;
}

/**
 * Returns true if this profile requires a cell migration when changing
 * from the currentProfile to newProfile.
 * Profiles with different runtimeIsolation or dataIsolation levels
 * always require a migration record and infra move.
 *
 * @param {string} currentProfile
 * @param {string} newProfile
 * @returns {boolean}
 */
export function requiresCellMigration(currentProfile, newProfile) {
  if (currentProfile === newProfile) return false;
  const current = SERVICE_PROFILE_META[currentProfile];
  const next    = SERVICE_PROFILE_META[newProfile];
  if (!current || !next) return true; // unknown → conservative assumption
  return (
    current.runtimeIsolation !== next.runtimeIsolation ||
    current.dataIsolation    !== next.dataIsolation
  );
}
