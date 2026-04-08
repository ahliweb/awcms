import { getVersionString } from '@/lib/version';

const appVersion = getVersionString();

const SEMVER_PATTERN = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;
const PATH_PATTERN = /^[a-z0-9][a-z0-9/_:-]*$/i;

export const EXTENSION_SCHEMA_VERSION = 1;
export const EXTENSION_KIND_VALUES = ['bundled', 'external'];
export const EXTENSION_SCOPE_VALUES = ['platform', 'tenant'];
export const EXTENSION_STATUS_VALUES = ['draft', 'active', 'deprecated', 'retired'];
export const TENANT_EXTENSION_STATE_VALUES = ['installed', 'active', 'inactive', 'error', 'upgrade_required', 'uninstall_requested'];
export const EXTENSION_RUNTIME_MODE_VALUES = ['trusted'];
export const EXTENSION_VALIDATION_STATUS_VALUES = ['valid', 'invalid', 'warning'];
export const EXTENSION_REASON_CATEGORIES = [
  'invalid_manifest',
  'unsupported_runtime_mode',
  'capability_validation_failed',
  'missing_artifact',
  'compatibility_failed',
];

const CAPABILITY_PATTERN = /^[a-z]+(?:\.[a-z0-9_]+){2,}$/;
const SANDBOX_NETWORK_VALUES = ['none', 'outbound_http'];
const SANDBOX_STORAGE_VALUES = ['none', 'tenant_settings', 'tenant_template_parts'];

const isPlainObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const asArray = (value) => (Array.isArray(value) ? value : []);

const isNonEmptyString = (value) => typeof value === 'string' && value.trim().length > 0;

const normalizePermission = (permission, index, errors) => {
  if (typeof permission === 'string') {
    return { key: permission, description: null };
  }

  if (!isPlainObject(permission) || !isNonEmptyString(permission.key)) {
    errors.push(`permissions[${index}] must be a string or an object with a key`);
    return null;
  }

  return {
    key: permission.key.trim(),
    description: isNonEmptyString(permission.description) ? permission.description.trim() : null,
  };
};

const normalizeMenu = (menu, index, errors) => {
  if (!isPlainObject(menu)) {
    errors.push(`menus[${index}] must be an object`);
    return null;
  }

  if (!isNonEmptyString(menu.key) || !isNonEmptyString(menu.label) || !isNonEmptyString(menu.path)) {
    errors.push(`menus[${index}] requires key, label, and path`);
    return null;
  }

  return {
    key: menu.key.trim(),
    label: menu.label.trim(),
    path: menu.path.trim(),
    icon: isNonEmptyString(menu.icon) ? menu.icon.trim() : null,
    permission: isNonEmptyString(menu.permission) ? menu.permission.trim() : null,
    group: isNonEmptyString(menu.group) ? menu.group.trim() : 'EXTENSIONS',
    order: Number.isFinite(Number(menu.order)) ? Number(menu.order) : 90,
    parent: isNonEmptyString(menu.parent) ? menu.parent.trim() : null,
  };
};

const normalizeRoute = (route, index, errors) => {
  if (!isPlainObject(route)) {
    errors.push(`adminRoutes[${index}] must be an object`);
    return null;
  }

  if (!isNonEmptyString(route.path) || !isNonEmptyString(route.component)) {
    errors.push(`adminRoutes[${index}] requires path and component`);
    return null;
  }

  return {
    path: route.path.trim().replace(/^\//, ''),
    component: route.component.trim(),
    permission: isNonEmptyString(route.permission) ? route.permission.trim() : null,
    secureParams: asArray(route.secureParams).filter(isNonEmptyString).map((value) => value.trim()),
    secureScope: isNonEmptyString(route.secureScope) ? route.secureScope.trim() : null,
    title: isNonEmptyString(route.title) ? route.title.trim() : null,
  };
};

const normalizePublicModule = (moduleEntry, index, errors) => {
  if (!isPlainObject(moduleEntry)) {
    errors.push(`publicModules[${index}] must be an object`);
    return null;
  }

  if (!isNonEmptyString(moduleEntry.key) || !isNonEmptyString(moduleEntry.label) || !isNonEmptyString(moduleEntry.url)) {
    errors.push(`publicModules[${index}] requires key, label, and url`);
    return null;
  }

  return {
    key: moduleEntry.key.trim(),
    label: moduleEntry.label.trim(),
    url: moduleEntry.url.trim(),
    icon: isNonEmptyString(moduleEntry.icon) ? moduleEntry.icon.trim() : null,
    order: Number.isFinite(Number(moduleEntry.order)) ? Number(moduleEntry.order) : 900,
    permission: isNonEmptyString(moduleEntry.permission) ? moduleEntry.permission.trim() : null,
  };
};

const normalizeWidget = (widget, index, errors) => {
  if (!isPlainObject(widget)) {
    errors.push(`widgets[${index}] must be an object`);
    return null;
  }

  if (!isNonEmptyString(widget.key) || !isNonEmptyString(widget.component)) {
    errors.push(`widgets[${index}] requires key and component`);
    return null;
  }

  return {
    key: widget.key.trim(),
    component: widget.component.trim(),
    title: isNonEmptyString(widget.title) ? widget.title.trim() : null,
    icon: isNonEmptyString(widget.icon) ? widget.icon.trim() : null,
    badge: isNonEmptyString(widget.badge) ? widget.badge.trim() : null,
    position: isNonEmptyString(widget.position) ? widget.position.trim() : 'main',
    order: Number.isFinite(Number(widget.order)) ? Number(widget.order) : 100,
  };
};

const normalizeEdgeRoute = (route, index, errors) => {
  if (!isPlainObject(route)) {
    errors.push(`edgeRoutes[${index}] must be an object`);
    return null;
  }

  if (!isNonEmptyString(route.path) || !isNonEmptyString(route.capability)) {
    errors.push(`edgeRoutes[${index}] requires path and capability`);
    return null;
  }

  return {
    path: route.path.trim(),
    method: isNonEmptyString(route.method) ? route.method.trim().toUpperCase() : 'POST',
    capability: route.capability.trim(),
    permission: isNonEmptyString(route.permission) ? route.permission.trim() : null,
    visibility: isNonEmptyString(route.visibility) ? route.visibility.trim() : 'authenticated',
  };
};

const normalizeDependencies = (dependencies, errors) => {
  const normalized = {};
  if (!isPlainObject(dependencies)) return normalized;

  Object.entries(dependencies).forEach(([key, value]) => {
    if (!isNonEmptyString(value)) {
      errors.push(`dependencies.${key} must be a version string`);
      return;
    }
    normalized[key] = value.trim();
  });

  return normalized;
};

export const buildLegacyCompatibleManifest = (source = {}) => ({
  schemaVersion: EXTENSION_SCHEMA_VERSION,
  slug: source.slug,
  name: source.name,
  vendor: source.vendor || 'awcms',
  version: source.version || '1.0.0',
  kind: source.extension_type === 'external' ? 'external' : 'bundled',
  scope: source.scope || 'tenant',
  runtime_mode: source.runtime_mode || source.runtimeMode || 'trusted',
  compatibility: {
    awcms: source.awcms_version || source.compatibility?.awcms || `>=${appVersion}`,
  },
  capabilities: asArray(source.capabilities),
  resources: isPlainObject(source.resources) ? source.resources : {
    admin: {
      entry: source.entry || source.external_path || null,
    },
  },
  permissions: asArray(source.permissions || source.config?.permissions),
  adminRoutes: asArray(source.adminRoutes || source.routes),
  menus: asArray(source.menus || (source.menu ? [source.menu] : [])),
  publicModules: asArray(source.publicModules),
  settingsSchema: isPlainObject(source.settingsSchema) ? source.settingsSchema : {
    type: 'object',
    properties: isPlainObject(source.settings) ? source.settings : {},
  },
  sandbox_profile: isPlainObject(source.sandbox_profile || source.sandboxProfile)
    ? source.sandbox_profile || source.sandboxProfile
    : { requested: false },
  edgeRoutes: asArray(source.edgeRoutes),
  dependencies: isPlainObject(source.dependencies) ? source.dependencies : {},
  widgets: asArray(source.widgets),
  hooks: isPlainObject(source.hooks) ? source.hooks : {},
});

export const compareVersions = (left, right) => {
  const leftParts = String(left || '0.0.0').split('.').map((part) => Number.parseInt(part, 10) || 0);
  const rightParts = String(right || '0.0.0').split('.').map((part) => Number.parseInt(part, 10) || 0);
  for (let index = 0; index < 3; index += 1) {
    if (leftParts[index] > rightParts[index]) return 1;
    if (leftParts[index] < rightParts[index]) return -1;
  }
  return 0;
};

export const isManifestCompatible = (manifest, currentVersion = appVersion) => {
  const required = manifest?.compatibility?.awcms;
  if (!required || typeof required !== 'string') return true;
  if (required.startsWith('>=')) return compareVersions(currentVersion, required.slice(2)) >= 0;
  return compareVersions(currentVersion, required) === 0;
};

export const validateExtensionManifest = (manifestInput, options = {}) => {
  const { allowLegacy = false } = options;
  const errors = [];
  const warnings = [];
  const reasonCategories = new Set();
  const baseManifest = allowLegacy ? buildLegacyCompatibleManifest(manifestInput) : manifestInput;

  if (!isPlainObject(baseManifest)) {
    return {
      valid: false,
      errors: ['Manifest must be an object'],
      warnings: [],
      diagnostics: {
        validationStatus: 'invalid',
        runtimeMode: null,
        compatibilityStatus: 'unknown',
        reasonCategories: ['invalid_manifest'],
        invalidCapabilities: [],
        missingArtifacts: [],
      },
      manifest: null,
    };
  }

  const manifest = {
    schemaVersion: Number(baseManifest.schemaVersion),
    slug: isNonEmptyString(baseManifest.slug) ? baseManifest.slug.trim() : '',
    name: isNonEmptyString(baseManifest.name) ? baseManifest.name.trim() : '',
    vendor: isNonEmptyString(baseManifest.vendor) ? baseManifest.vendor.trim() : '',
    version: isNonEmptyString(baseManifest.version) ? baseManifest.version.trim() : '',
    kind: isNonEmptyString(baseManifest.kind) ? baseManifest.kind.trim() : '',
    scope: isNonEmptyString(baseManifest.scope) ? baseManifest.scope.trim() : '',
    runtime_mode: isNonEmptyString(baseManifest.runtime_mode || baseManifest.runtimeMode)
      ? String(baseManifest.runtime_mode || baseManifest.runtimeMode).trim()
      : '',
    compatibility: isPlainObject(baseManifest.compatibility) ? baseManifest.compatibility : {},
    capabilities: asArray(baseManifest.capabilities).filter(isNonEmptyString).map((value) => value.trim()),
    resources: isPlainObject(baseManifest.resources) ? baseManifest.resources : {},
    permissions: [],
    adminRoutes: [],
    menus: [],
    publicModules: [],
    settingsSchema: isPlainObject(baseManifest.settingsSchema) ? baseManifest.settingsSchema : { type: 'object', properties: {} },
    sandbox_profile: isPlainObject(baseManifest.sandbox_profile || baseManifest.sandboxProfile)
      ? baseManifest.sandbox_profile || baseManifest.sandboxProfile
      : { requested: false },
    edgeRoutes: [],
    dependencies: {},
    widgets: [],
    hooks: isPlainObject(baseManifest.hooks) ? baseManifest.hooks : {},
  };

  if (manifest.schemaVersion !== EXTENSION_SCHEMA_VERSION) {
    errors.push(`schemaVersion must equal ${EXTENSION_SCHEMA_VERSION}`);
  }
  if (!manifest.slug) errors.push('slug is required');
  if (!manifest.name) errors.push('name is required');
  if (!manifest.vendor) errors.push('vendor is required');
  if (!manifest.version) errors.push('version is required');
  if (!manifest.kind || !EXTENSION_KIND_VALUES.includes(manifest.kind)) {
    errors.push(`kind must be one of: ${EXTENSION_KIND_VALUES.join(', ')}`);
  }
  if (!manifest.scope || !EXTENSION_SCOPE_VALUES.includes(manifest.scope)) {
    errors.push(`scope must be one of: ${EXTENSION_SCOPE_VALUES.join(', ')}`);
  }
  if (!manifest.runtime_mode) {
    errors.push('runtime_mode is required');
    reasonCategories.add('invalid_manifest');
  } else if (!EXTENSION_RUNTIME_MODE_VALUES.includes(manifest.runtime_mode)) {
    errors.push(`runtime_mode must be one of: ${EXTENSION_RUNTIME_MODE_VALUES.join(', ')}`);
    reasonCategories.add('unsupported_runtime_mode');
  }
  if (manifest.version && !SEMVER_PATTERN.test(manifest.version)) {
    errors.push('version must be a semver string');
  }
  if (manifest.compatibility.awcms && !/^>=?\d+\.\d+\.\d+/.test(String(manifest.compatibility.awcms))) {
    errors.push('compatibility.awcms must be a semver string or >= semver range');
    reasonCategories.add('compatibility_failed');
  }

  if (!isPlainObject(manifest.sandbox_profile)) {
    errors.push('sandbox_profile must be an object when provided');
    reasonCategories.add('invalid_manifest');
  } else {
    const requested = Boolean(manifest.sandbox_profile.requested);
    const networkAccess = manifest.sandbox_profile.network_access;
    const storageAccess = manifest.sandbox_profile.storage_access;
    const workerBindings = asArray(manifest.sandbox_profile.worker_bindings).filter(isNonEmptyString).map((value) => value.trim());

    if (networkAccess && !SANDBOX_NETWORK_VALUES.includes(String(networkAccess))) {
      errors.push(`sandbox_profile.network_access must be one of: ${SANDBOX_NETWORK_VALUES.join(', ')}`);
      reasonCategories.add('invalid_manifest');
    }

    if (storageAccess && !SANDBOX_STORAGE_VALUES.includes(String(storageAccess))) {
      errors.push(`sandbox_profile.storage_access must be one of: ${SANDBOX_STORAGE_VALUES.join(', ')}`);
      reasonCategories.add('invalid_manifest');
    }

    manifest.sandbox_profile = {
      requested,
      network_access: requested ? String(networkAccess || 'none') : 'none',
      storage_access: requested ? String(storageAccess || 'none') : 'none',
      worker_bindings: requested ? workerBindings : [],
    };

    if (requested) {
      warnings.push('Sandbox execution is not enabled yet; sandbox_profile is metadata-only in this phase.');
    }
  }

  if (!isPlainObject(manifest.resources)) {
    errors.push('resources must be an object');
  } else {
    ['admin', 'public', 'edge', 'shared'].forEach((resourceKey) => {
      const resource = manifest.resources[resourceKey];
      if (resource !== undefined && !isPlainObject(resource)) {
        errors.push(`resources.${resourceKey} must be an object`);
      }
      if (isPlainObject(resource) && resource.entry && !isNonEmptyString(resource.entry)) {
        errors.push(`resources.${resourceKey}.entry must be a string`);
      }
    });
  }

  asArray(baseManifest.permissions).forEach((permission, index) => {
    const normalized = normalizePermission(permission, index, errors);
    if (normalized) manifest.permissions.push(normalized);
  });

  asArray(baseManifest.adminRoutes).forEach((route, index) => {
    const normalized = normalizeRoute(route, index, errors);
    if (normalized) manifest.adminRoutes.push(normalized);
  });

  asArray(baseManifest.menus).forEach((menu, index) => {
    const normalized = normalizeMenu(menu, index, errors);
    if (normalized) manifest.menus.push(normalized);
  });

  asArray(baseManifest.publicModules).forEach((moduleEntry, index) => {
    const normalized = normalizePublicModule(moduleEntry, index, errors);
    if (normalized) manifest.publicModules.push(normalized);
  });

  asArray(baseManifest.widgets).forEach((widget, index) => {
    const normalized = normalizeWidget(widget, index, errors);
    if (normalized) manifest.widgets.push(normalized);
  });

  asArray(baseManifest.edgeRoutes).forEach((route, index) => {
    const normalized = normalizeEdgeRoute(route, index, errors);
    if (normalized) manifest.edgeRoutes.push(normalized);
  });

  manifest.dependencies = normalizeDependencies(baseManifest.dependencies, errors);

  const invalidCapabilities = manifest.capabilities.filter((capability) => !CAPABILITY_PATTERN.test(capability));
  if (invalidCapabilities.length > 0) {
    if (allowLegacy) {
      warnings.push(`legacy capabilities should be migrated to scope.resource.action format: ${invalidCapabilities.join(', ')}`);
    } else {
      errors.push(`capabilities must use scope.resource.action format: ${invalidCapabilities.join(', ')}`);
      reasonCategories.add('capability_validation_failed');
    }
  }

  if (!isPlainObject(manifest.hooks)) {
    errors.push('hooks must be an object');
  }

  const missingArtifacts = [];
  manifest.adminRoutes.forEach((route) => {
    if (!route.component) missingArtifacts.push(`adminRoutes:${route.path}`);
  });
  manifest.widgets.forEach((widget) => {
    if (!widget.component) missingArtifacts.push(`widgets:${widget.key}`);
  });
  if (missingArtifacts.length > 0) {
    reasonCategories.add('missing_artifact');
  }

  manifest.adminRoutes.forEach((route, index) => {
    if (!PATH_PATTERN.test(route.path)) {
      errors.push(`adminRoutes[${index}].path contains invalid characters`);
    }
  });

  manifest.menus.forEach((menu, index) => {
    if (!PATH_PATTERN.test(menu.path)) {
      errors.push(`menus[${index}].path contains invalid characters`);
    }
  });

  const compatible = isManifestCompatible(manifest);
  if (!compatible) {
    warnings.push('compatibility.awcms does not match the current application version');
    reasonCategories.add('compatibility_failed');
  }

  if (errors.length > 0 && reasonCategories.size === 0) {
    reasonCategories.add('invalid_manifest');
  }

  const validationStatus = errors.length > 0 ? 'invalid' : warnings.length > 0 ? 'warning' : 'valid';
  const diagnostics = {
    validationStatus,
    runtimeMode: manifest.runtime_mode || null,
    compatibilityStatus: compatible ? 'compatible' : 'incompatible',
    sandboxReadinessStatus: manifest.sandbox_profile?.requested ? 'metadata_only' : 'not_requested',
    sandboxProfile: manifest.sandbox_profile,
    reasonCategories: Array.from(reasonCategories).filter((value) => EXTENSION_REASON_CATEGORIES.includes(value)),
    invalidCapabilities,
    missingArtifacts,
    warnings,
  };

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    diagnostics,
    manifest: errors.length === 0 ? manifest : null,
  };
};

export const getExtensionKey = ({ vendor, slug }) => `${vendor}/${slug}`;

export const normalizeCatalogManifest = (manifestInput, options = {}) => {
  const result = validateExtensionManifest(manifestInput, options);
  if (!result.valid) {
    throw new Error(result.errors.join('; '));
  }
  return result.manifest;
};
