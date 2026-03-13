/**
 * objectKeys.js
 * Deployment Cell — R2 Storage Contract
 *
 * Implements the canonical object key format for all media/assets
 * stored in Cloudflare R2 via AWCMS.
 *
 * Spec reference: §13.1 Canonical object key pattern
 *
 * Format:
 *   {project_code}/{environment}/{tenant_id}/{module}/{object_id}/{variant_or_filename}
 *
 * Example:
 *   sikesra/prod/550e8400-e29b-41d4-a716/media/images/b5e3.../original.jpg
 */

/**
 * Generates a canonical R2 object key.
 *
 * @param {object} params
 * @param {string} params.projectCode   - Short code from platform_projects.code (e.g. 'sikesra')
 * @param {string} params.environment   - Cell environment (e.g. 'production', 'staging')
 * @param {string} params.tenantId      - UUID of the tenant (never changes after creation)
 * @param {string} params.module        - Logical module name (e.g. 'media', 'documents', 'avatars')
 * @param {string} params.objectId      - UUID or stable ID of the parent record
 * @param {string} params.variantOrFilename - Variant path or filename (e.g. 'original.jpg', 'thumb_300.webp')
 * @returns {string} The canonical object key
 * @throws {Error} If any required param is missing or contains invalid characters
 *
 * @example
 * generateObjectKey({
 *   projectCode: 'sikesra',
 *   environment: 'production',
 *   tenantId: '550e8400-e29b-41d4-a716-446655440000',
 *   module: 'media',
 *   objectId: 'b5e300aa-1234-5678-abcd-000000000001',
 *   variantOrFilename: 'original.jpg',
 * });
 * // => 'sikesra/production/550e8400-e29b-41d4-a716-446655440000/media/b5e300aa-1234-5678-abcd-000000000001/original.jpg'
 */
export function generateObjectKey({
  projectCode,
  environment,
  tenantId,
  module,
  objectId,
  variantOrFilename,
}) {
  const required = { projectCode, environment, tenantId, module, objectId, variantOrFilename };
  for (const [key, val] of Object.entries(required)) {
    if (!val || typeof val !== 'string' || val.trim() === '') {
      throw new Error(`[objectKeys] generateObjectKey: "${key}" is required and must be a non-empty string.`);
    }
  }

  // Sanitize each segment: lowercase, no leading/trailing slashes or spaces
  const sanitize = (s) => s.trim().toLowerCase().replace(/^\/+|\/+$/g, '');

  return [
    sanitize(projectCode),
    sanitize(environment),
    sanitize(tenantId),
    sanitize(module),
    sanitize(objectId),
    variantOrFilename.trim(), // filename case is intentionally preserved
  ].join('/');
}

/**
 * Parses a canonical object key back into its component parts.
 * Useful for server-side access policy checks.
 *
 * @param {string} objectKey
 * @returns {{ projectCode, environment, tenantId, module, objectId, variantOrFilename }}
 * @throws {Error} if the key doesn't have 6 segments
 */
export function parseObjectKey(objectKey) {
  const parts = (objectKey || '').split('/');
  if (parts.length < 6) {
    throw new Error(
      `[objectKeys] parseObjectKey: key "${objectKey}" must have at least 6 segments.`
    );
  }
  return {
    projectCode:        parts[0],
    environment:        parts[1],
    tenantId:           parts[2],
    module:             parts[3],
    objectId:           parts[4],
    variantOrFilename:  parts.slice(5).join('/'), // handle nested filenames
  };
}
