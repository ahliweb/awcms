export type ExtensionManifest = {
  schemaVersion: number
  slug: string
  name: string
  vendor: string
  version: string
  kind: 'bundled' | 'external'
  scope: 'platform' | 'tenant'
  compatibility?: { awcms?: string }
  capabilities?: string[]
  permissions?: Array<string | { key: string; description?: string | null }>
  adminRoutes?: Array<Record<string, unknown>>
  menus?: Array<Record<string, unknown>>
  publicModules?: Array<Record<string, unknown>>
  settingsSchema?: Record<string, unknown>
  edgeRoutes?: Array<Record<string, unknown>>
  dependencies?: Record<string, string>
  widgets?: Array<Record<string, unknown>>
  hooks?: Record<string, unknown>
  resources?: Record<string, Record<string, unknown>>
}

const isObject = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value)

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
  if (!isObject(value)) return { valid: false, errors: ['Manifest must be an object'], manifest: null as ExtensionManifest | null }

  const manifest = value as Partial<ExtensionManifest>
  const errors: string[] = []

  if (manifest.schemaVersion !== 1) errors.push('schemaVersion must equal 1')
  if (typeof manifest.slug !== 'string' || !manifest.slug.trim()) errors.push('slug is required')
  if (typeof manifest.name !== 'string' || !manifest.name.trim()) errors.push('name is required')
  if (typeof manifest.vendor !== 'string' || !manifest.vendor.trim()) errors.push('vendor is required')
  if (typeof manifest.version !== 'string' || !manifest.version.trim()) errors.push('version is required')
  if (manifest.kind !== 'bundled' && manifest.kind !== 'external') errors.push('kind must be bundled or external')
  if (manifest.scope !== 'platform' && manifest.scope !== 'tenant') errors.push('scope must be platform or tenant')

  return {
    valid: errors.length === 0,
    errors,
    manifest: errors.length === 0 ? manifest as ExtensionManifest : null,
  }
}

export const getExtensionKey = (manifest: Pick<ExtensionManifest, 'vendor' | 'slug'>) => `${manifest.vendor}/${manifest.slug}`
