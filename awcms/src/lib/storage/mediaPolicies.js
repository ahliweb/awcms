/**
 * mediaPolicies.js
 * Deployment Cell — R2 Storage Access Policies
 *
 * Defines how media objects are accessed based on their visibility_class
 * and validates upload completeness before canonicalizing a media record.
 *
 * Spec reference: §13.3 Access policy rules, §13.4 Upload completion rule
 */

/**
 * Visibility class constants.
 * @enum {string}
 */
export const VisibilityClass = Object.freeze({
  /** Publicly cacheable; must be intentionally marked public. */
  PUBLIC:     'public',
  /** Worker-mediated access only; short-lived grants. */
  PRIVATE:    'private',
  /** Explicit permission checks; optional legal/audit retention. */
  RESTRICTED: 'restricted',
});

/**
 * Access policy descriptor per visibility class.
 * Used by Worker routing and admin policy audits.
 */
export const ACCESS_POLICIES = Object.freeze({
  [VisibilityClass.PUBLIC]: {
    cacheControl:        'public, max-age=31536000, immutable',
    workerMediated:      false,
    shortLivedGrantOnly: false,
    auditAccess:         false,
    description: 'Publicly cacheable. Can be delivered via CDN without Worker intermediation.',
  },
  [VisibilityClass.PRIVATE]: {
    cacheControl:        'no-store',
    workerMediated:      true,
    shortLivedGrantOnly: true,
    auditAccess:         false,
    description: 'Worker-mediated only. Grants are short-lived. No direct URL delivery.',
  },
  [VisibilityClass.RESTRICTED]: {
    cacheControl:        'no-store',
    workerMediated:      true,
    shortLivedGrantOnly: true,
    auditAccess:         true,
    description: 'Explicit permission check required. Audit logging applies. No direct URL delivery.',
  },
});

/**
 * Returns the access policy for a given visibility class.
 *
 * @param {string} visibilityClass
 * @returns {object} Policy descriptor
 * @throws {Error} If visibilityClass is unknown
 */
export function getAccessPolicy(visibilityClass) {
  const policy = ACCESS_POLICIES[visibilityClass];
  if (!policy) {
    throw new Error(
      `[mediaPolicies] Unknown visibilityClass: "${visibilityClass}". ` +
      `Must be one of: ${Object.values(VisibilityClass).join(', ')}`
    );
  }
  return policy;
}

/**
 * Validates that an upload is "canonical" per spec §13.4:
 *   1. The object exists in R2 (r2Confirmed = true from Worker response)
 *   2. The metadata row exists and has all required fields
 *   3. The object is linked to a tenant/module record (objectId present)
 *   4. visibility and retention classes are set
 *
 * @param {object} metadata - The media metadata object to validate
 * @param {boolean} r2Confirmed - Whether the Worker confirmed the object is in R2
 * @returns {{ valid: boolean, missing: string[] }}
 */
export function isUploadComplete(metadata, r2Confirmed = false) {
  const missing = [];

  if (!r2Confirmed)          missing.push('r2_object_not_confirmed');
  if (!metadata)             return { valid: false, missing: ['metadata_missing'] };

  const required = [
    'id', 'tenant_id', 'project_id', 'module',
    'object_id', 'object_key', 'visibility_class', 'retention_class',
    'content_type', 'size_bytes', 'status', 'created_by',
  ];

  for (const field of required) {
    if (!metadata[field] && metadata[field] !== 0) {
      missing.push(field);
    }
  }

  // Validate that visibility class is known
  if (metadata.visibility_class && !ACCESS_POLICIES[metadata.visibility_class]) {
    missing.push('visibility_class_invalid');
  }

  return { valid: missing.length === 0, missing };
}
