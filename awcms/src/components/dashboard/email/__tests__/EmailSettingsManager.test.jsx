import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import EmailSettingsManager from '../EmailSettingsManager';

const usePermissionsMock = vi.fn();
const usePluginsMock = vi.fn();

vi.mock('@/contexts/PermissionContext', () => ({
  usePermissions: () => usePermissionsMock(),
}));

vi.mock('@/contexts/PluginContext', () => ({
  usePlugins: () => usePluginsMock(),
}));

vi.mock('@/templates/flowbite-admin', () => ({
  AdminPageLayout: ({ children, requiredPermission }) => (
    <div data-testid="admin-layout" data-required-permission={requiredPermission}>{children}</div>
  ),
  PageHeader: ({ title }) => <h1>{title}</h1>,
}));

vi.mock('@/plugins/mailketing/components/EmailSettings', () => ({
  default: () => <div>mailketing-settings-panel</div>,
}));

vi.mock('@/components/ui/button', () => ({
  Button: ({ children, asChild, ...props }) => {
    if (asChild && React.isValidElement(children)) {
      return React.cloneElement(children, props);
    }
    return <button {...props}>{children}</button>;
  },
}));

vi.mock('@/components/ui/card', () => ({
  Card: ({ children, ...props }) => <div {...props}>{children}</div>,
  CardContent: ({ children, ...props }) => <div {...props}>{children}</div>,
}));

function renderManager() {
  return render(
    <MemoryRouter>
      <EmailSettingsManager />
    </MemoryRouter>
  );
}

describe('EmailSettingsManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows activation guidance with permission-aware links when Mailketing is inactive', () => {
    usePluginsMock.mockReturnValue({ activePlugins: [] });
    usePermissionsMock.mockReturnValue({
      hasPermission: (permission) => ['platform.module.read', 'platform.extensions.read'].includes(permission),
      isPlatformAdmin: false,
      isFullAccess: false,
    });

    renderManager();

    expect(screen.getByText('Mailketing is not active')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open Modules' })).toHaveAttribute('href', '/cmspanel/modules');
    expect(screen.getByRole('link', { name: 'Open Extensions' })).toHaveAttribute('href', '/cmspanel/extensions');
    expect(screen.getByTestId('admin-layout')).toHaveAttribute('data-required-permission', 'tenant.setting.update');
  });

  it('hides activation links when the user lacks permission to open those destinations', () => {
    usePluginsMock.mockReturnValue({ activePlugins: [] });
    usePermissionsMock.mockReturnValue({
      hasPermission: () => false,
      isPlatformAdmin: false,
      isFullAccess: false,
    });

    renderManager();

    expect(screen.getByText('Mailketing is not active')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Open Modules' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Open Extensions' })).not.toBeInTheDocument();
  });

  it('renders the Mailketing settings panel when the plugin is active', () => {
    usePluginsMock.mockReturnValue({ activePlugins: [{ slug: 'mailketing' }] });
    usePermissionsMock.mockReturnValue({
      hasPermission: () => true,
      isPlatformAdmin: false,
      isFullAccess: false,
    });

    renderManager();

    expect(screen.getByText('mailketing-settings-panel')).toBeInTheDocument();
    expect(screen.queryByText('Mailketing is not active')).not.toBeInTheDocument();
  });
});
