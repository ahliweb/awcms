import { useMemo } from 'react';

const REASON_CATEGORIES = [
  'invalid_manifest',
  'unsupported_runtime_mode',
  'capability_validation_failed',
  'missing_artifact',
  'compatibility_failed',
];

export default function useExtensionDiagnostics(extension, canViewDiagnostics) {
  return useMemo(() => {
    const summary = extension?.validation_summary || extension?.catalog_validation_summary || {};
    const categories = Array.isArray(summary.reasonCategories)
      ? summary.reasonCategories.filter((value) => typeof value === 'string')
      : [];

    return {
      isRedacted: !canViewDiagnostics,
      validationStatus: extension?.validation_status || extension?.catalog_validation_status || 'valid',
      runtimeMode: extension?.runtime_mode || extension?.manifest?.runtime_mode || 'trusted',
      compatibilityStatus: summary.compatibilityStatus || 'compatible',
      sandboxReadinessStatus: summary.sandboxReadinessStatus || 'not_requested',
      sandboxProfile: summary.sandboxProfile || extension?.manifest?.sandbox_profile || { requested: false, network_access: 'none', storage_access: 'none', worker_bindings: [] },
      reasonCategories: REASON_CATEGORIES.map((category) => ({
        key: category,
        active: categories.includes(category) || extension?.deactivation_reason_category === category,
      })),
      invalidCapabilities: canViewDiagnostics && Array.isArray(summary.invalidCapabilities) ? summary.invalidCapabilities : [],
      missingArtifacts: canViewDiagnostics && Array.isArray(summary.missingArtifacts) ? summary.missingArtifacts : [],
      warnings: canViewDiagnostics && Array.isArray(summary.warnings) ? summary.warnings : [],
      lastValidatedAt: extension?.last_validated_at || null,
      lastInvalidatedAt: extension?.last_invalidated_at || null,
      autoDeactivatedAt: extension?.auto_deactivated_at || null,
      autoRestoredAt: extension?.auto_restored_at || null,
      invalidatedByCatalogVersion: extension?.invalidated_by_catalog_version || null,
      restoredByCatalogVersion: extension?.restored_by_catalog_version || null,
      activationState: extension?.activation_state || (extension?.is_active ? 'active' : 'inactive'),
      desiredActivationState: extension?.desired_activation_state || (extension?.is_active ? 'active' : 'inactive'),
    };
  }, [canViewDiagnostics, extension]);
}
