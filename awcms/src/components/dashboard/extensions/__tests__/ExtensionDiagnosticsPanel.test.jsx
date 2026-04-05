import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import ExtensionDiagnosticsPanel from '@/components/dashboard/extensions/ExtensionDiagnosticsPanel';

const extension = {
  validation_status: 'invalid',
  runtime_mode: 'trusted',
  activation_state: 'inactive',
  desired_activation_state: 'active',
  auto_deactivated_at: '2026-04-05T10:00:00.000Z',
  auto_restored_at: '2026-04-05T11:00:00.000Z',
  invalidated_by_catalog_version: '1.0.1',
  restored_by_catalog_version: '1.0.2',
  validation_summary: {
    compatibilityStatus: 'compatible',
    reasonCategories: ['capability_validation_failed', 'missing_artifact'],
    invalidCapabilities: ['events:health'],
    missingArtifacts: ['adminRoutes:events'],
    warnings: [],
  },
};

describe('ExtensionDiagnosticsPanel', () => {
  it('renders redacted diagnostics without privileged details', () => {
    render(<ExtensionDiagnosticsPanel extension={extension} canViewDiagnostics={false} />);

    expect(screen.getByText('Diagnostics')).toBeInTheDocument();
    expect(screen.getByText('Redacted')).toBeInTheDocument();
    expect(screen.getByText('capability_validation_failed')).toBeInTheDocument();
    expect(screen.getByText('missing_artifact')).toBeInTheDocument();
    expect(screen.getByText(/Detailed diagnostics require/)).toBeInTheDocument();
    expect(screen.queryByText('events:health')).not.toBeInTheDocument();
    expect(screen.queryByText('adminRoutes:events')).not.toBeInTheDocument();
  });

  it('renders full diagnostics when permission is granted', () => {
    render(<ExtensionDiagnosticsPanel extension={extension} canViewDiagnostics />);

    expect(screen.getByText('Invalid capabilities')).toBeInTheDocument();
    expect(screen.getByText('Missing artifacts')).toBeInTheDocument();
    expect(screen.getByText('events:health')).toBeInTheDocument();
    expect(screen.getByText('adminRoutes:events')).toBeInTheDocument();
    expect(screen.queryByText('Redacted')).not.toBeInTheDocument();
    expect(screen.queryByText(/Detailed diagnostics require/)).not.toBeInTheDocument();
  });
});
