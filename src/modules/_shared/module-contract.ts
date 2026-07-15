/**
 * Module descriptor contract (docs/awcms/10_template_kode_coding_standard.md
 * §Module descriptor). Trusted code-only metadata — written by a module's own
 * `module.ts`, never user/tenant-controlled, never carries a runtime secret.
 */

/** Descriptive category only — not itself an authorization or enable/disable mechanism. */
export type ModuleType = "base" | "system" | "domain" | "integration";

/**
 * `disabled` here means globally disabled by code/deployment — not a
 * per-tenant toggle (that is separate database state, added when the
 * module-management module lands).
 */
export type ModuleLifecycleStatus =
  "active" | "experimental" | "deprecated" | "maintenance" | "disabled";

export type ModuleApiContract = {
  openApiPath: string;
  basePath: string;
};

export type ModuleEventContract = {
  asyncApiPath?: string;
  publishes?: string[];
  subscribes?: string[];
};

export type ModulePermissionDescriptor = {
  activityCode: string;
  action: string;
  description: string;
};

export type ModuleNavigationEntry = {
  labelKey: string;
  path: string;
  icon?: string;
  order?: number;
  group?: string;
  requiredPermission?: string;
};

export type ModuleSettingsContract = {
  schemaVersion?: number;
  defaults?: Record<string, unknown>;
};

export type ModuleJobDescriptor = {
  command: string;
  purpose: string;
  recommendedSchedule?: string;
  environmentNotes?: string;
  safeInOfflineLan?: boolean;
};

export type ModuleHealthContract = {
  hasHealthCheck?: boolean;
  hasReadinessCheck?: boolean;
};

export type ModuleCompatibilityContract = {
  minAppVersion?: string;
};

export type ModuleDescriptor = {
  key: string;
  name: string;
  version: string;
  status: ModuleLifecycleStatus;
  description: string;
  dependencies: string[];
  api?: ModuleApiContract;
  events?: ModuleEventContract;
  type?: ModuleType;
  isCore?: boolean;
  permissions?: ModulePermissionDescriptor[];
  navigation?: ModuleNavigationEntry[];
  settings?: ModuleSettingsContract;
  jobs?: ModuleJobDescriptor[];
  health?: ModuleHealthContract;
  compatibility?: ModuleCompatibilityContract;
  maintainers?: string[];
};

/**
 * SemVer of this file's own exported type shape — independent of
 * `package.json` (release version) and OpenAPI/AsyncAPI `info.version`.
 * MAJOR: a field removed/renamed or an optional field becomes required.
 * MINOR: a new optional field added. PATCH: doc-only clarification.
 */
export const MODULE_CONTRACT_VERSION = "1.0.0";

export function defineModule(descriptor: ModuleDescriptor): ModuleDescriptor {
  return descriptor;
}
