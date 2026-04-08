export type ExtensionManifest = {
  schemaVersion: number
  slug: string
  name: string
  vendor: string
  version: string
  kind: 'bundled' | 'external'
  scope: 'platform' | 'tenant'
  runtime_mode: 'trusted'
  compatibility?: { awcms?: string }
  capabilities?: string[]
  permissions?: Array<string | { key: string; description?: string | null }>
  adminRoutes?: Array<Record<string, unknown>>
  menus?: Array<Record<string, unknown>>
  publicModules?: Array<Record<string, unknown>>
  settingsSchema?: Record<string, unknown>
  sandbox_profile?: Record<string, unknown>
  edgeRoutes?: Array<Record<string, unknown>>
  dependencies?: Record<string, string>
  widgets?: Array<Record<string, unknown>>
  hooks?: Record<string, unknown>
  resources?: Record<string, Record<string, unknown>>
}

const isObject = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
const CAPABILITY_PATTERN = /^[a-z]+(?:\.[a-z0-9_]+){2,}$/
const RUNTIME_MODE_VALUES = ['trusted'] as const
const SANDBOX_NETWORK_VALUES = ['none', 'outbound_http'] as const
const SANDBOX_STORAGE_VALUES = ['none', 'tenant_settings', 'tenant_template_parts'] as const
const EDGE_ROUTE_VISIBILITY_VALUES = ['public', 'authenticated'] as const
const REASON_CATEGORIES = [
  'invalid_manifest',
  'unsupported_runtime_mode',
  'capability_validation_failed',
  'missing_artifact',
  'compatibility_failed',
] as const

export const compareVersions = (left: string, right: string) => {
  const leftParts = String(left || '0.0.0').split('.').map((part) => Number.parseInt(part, 10) || 0)
  const rightParts = String(right || '0.0.0').split('.').map((part) => Number.parseInt(part, 10) || 0)
  for (let index = 0; index < 3; index += 1) {
    if ((leftParts[index] || 0) > (rightParts[index] || 0)) return 1
    if ((leftParts[index] || 0) < (rightParts[index] || 0)) return -1
  }
  return 0
}

export const validateExtensionManifest = (value: unknown) => {
  if (!isObject(value)) {
    return {
      valid: false,
      errors: ['Manifest must be an object'],
      diagnostics: {
        validationStatus: 'invalid',
        runtimeMode: null,
        compatibilityStatus: 'unknown',
        reasonCategories: ['invalid_manifest'],
        invalidCapabilities: [],
        missingArtifacts: [],
        warnings: [],
      },
      manifest: null as ExtensionManifest | null,
    }
  }

  const manifest = value as Partial<ExtensionManifest>
  const errors: string[] = []
  const warnings: string[] = []
  const reasonCategories = new Set<string>()

  if (manifest.schemaVersion !== 1) errors.push('schemaVersion must equal 1')
  if (typeof manifest.slug !== 'string' || !manifest.slug.trim()) errors.push('slug is required')
  if (typeof manifest.name !== 'string' || !manifest.name.trim()) errors.push('name is required')
  if (typeof manifest.vendor !== 'string' || !manifest.vendor.trim()) errors.push('vendor is required')
  if (typeof manifest.version !== 'string' || !manifest.version.trim()) errors.push('version is required')
  if (manifest.kind !== 'bundled' && manifest.kind !== 'external') errors.push('kind must be bundled or external')
  if (manifest.scope !== 'platform' && manifest.scope !== 'tenant') errors.push('scope must be platform or tenant')
  if (manifest.runtime_mode !== 'trusted') {
    errors.push(`runtime_mode must be one of: ${RUNTIME_MODE_VALUES.join(', ')}`)
    reasonCategories.add('unsupported_runtime_mode')
  }

  const sandboxProfile = isObject(manifest.sandbox_profile) ? manifest.sandbox_profile : { requested: false }
  const sandboxRequested = Boolean(sandboxProfile.requested)
  if (sandboxProfile.network_access && !SANDBOX_NETWORK_VALUES.includes(String(sandboxProfile.network_access) as any)) {
    errors.push(`sandbox_profile.network_access must be one of: ${SANDBOX_NETWORK_VALUES.join(', ')}`)
    reasonCategories.add('invalid_manifest')
  }
  if (sandboxProfile.storage_access && !SANDBOX_STORAGE_VALUES.includes(String(sandboxProfile.storage_access) as any)) {
    errors.push(`sandbox_profile.storage_access must be one of: ${SANDBOX_STORAGE_VALUES.join(', ')}`)
    reasonCategories.add('invalid_manifest')
  }
  if (sandboxRequested) {
    warnings.push('Sandbox execution is not enabled yet; sandbox_profile is metadata-only in this phase.')
  }

  const invalidCapabilities = Array.isArray(manifest.capabilities)
    ? manifest.capabilities.filter((capability) => typeof capability !== 'string' || !CAPABILITY_PATTERN.test(capability))
    : []
  if (invalidCapabilities.length > 0) {
    errors.push(`capabilities must use scope.resource.action format: ${invalidCapabilities.join(', ')}`)
    reasonCategories.add('capability_validation_failed')
  }

  const missingArtifacts: string[] = []
  if (Array.isArray(manifest.adminRoutes)) {
    manifest.adminRoutes.forEach((route, index) => {
      if (!isObject(route) || typeof route.component !== 'string' || !route.component.trim()) {
        missingArtifacts.push(`adminRoutes:${index}`)
      }
    })
  }
  if (Array.isArray(manifest.widgets)) {
    manifest.widgets.forEach((widget, index) => {
      if (!isObject(widget) || typeof widget.component !== 'string' || !widget.component.trim()) {
        missingArtifacts.push(`widgets:${index}`)
      }
    })
  }
  if (Array.isArray(manifest.edgeRoutes)) {
    manifest.edgeRoutes.forEach((route, index) => {
      if (!isObject(route) || typeof route.path !== 'string' || !route.path.trim() || typeof route.capability !== 'string' || !route.capability.trim()) {
        errors.push(`edgeRoutes[${index}] requires path and capability`)
        missingArtifacts.push(`edgeRoutes:${index}`)
        return
      }
      if (route.visibility && !EDGE_ROUTE_VISIBILITY_VALUES.includes(String(route.visibility) as any)) {
        errors.push(`edgeRoutes[${index}].visibility must be one of: ${EDGE_ROUTE_VISIBILITY_VALUES.join(', ')}`)
        reasonCategories.add('invalid_manifest')
      }
    })
  }
  if (missingArtifacts.length > 0) {
    reasonCategories.add('missing_artifact')
  }

  const compatibility = manifest.compatibility?.awcms
  if (typeof compatibility === 'string' && !/^>=?\d+\.\d+\.\d+/.test(compatibility)) {
    errors.push('compatibility.awcms must be a semver string or >= semver range')
    reasonCategories.add('compatibility_failed')
  }

  if (errors.length > 0 && reasonCategories.size === 0) {
    reasonCategories.add('invalid_manifest')
  }

  const diagnostics = {
    validationStatus: errors.length > 0 ? 'invalid' : warnings.length > 0 ? 'warning' : 'valid',
    runtimeMode: manifest.runtime_mode ?? null,
    compatibilityStatus: 'compatible',
    sandboxReadinessStatus: sandboxRequested ? 'metadata_only' : 'not_requested',
    sandboxProfile: {
      requested: sandboxRequested,
      network_access: sandboxRequested ? String(sandboxProfile.network_access || 'none') : 'none',
      storage_access: sandboxRequested ? String(sandboxProfile.storage_access || 'none') : 'none',
      worker_bindings: Array.isArray(sandboxProfile.worker_bindings) ? sandboxProfile.worker_bindings.filter((value): value is string => typeof value === 'string' && value.trim().length > 0) : [],
    },
    reasonCategories: Array.from(reasonCategories).filter((value) => REASON_CATEGORIES.includes(value as any)),
    invalidCapabilities,
    missingArtifacts,
    warnings,
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    diagnostics,
    manifest: errors.length === 0 ? manifest as ExtensionManifest : null,
  }
}

export const getExtensionKey = (manifest: Pick<ExtensionManifest, 'vendor' | 'slug'>) => `${manifest.vendor}/${manifest.slug}`
