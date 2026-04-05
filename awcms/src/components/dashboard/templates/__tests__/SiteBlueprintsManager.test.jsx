import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import SiteBlueprintsManager from '../SiteBlueprintsManager';

const useTenantMock = vi.fn();
const usePermissionsMock = vi.fn();
const useSiteBlueprintsMock = vi.fn();

vi.mock('@/contexts/TenantContext', () => ({
  useTenant: () => useTenantMock(),
}));

vi.mock('@/contexts/PermissionContext', () => ({
  usePermissions: () => usePermissionsMock(),
}));

vi.mock('@/hooks/useSiteBlueprints', () => ({
  useSiteBlueprints: () => useSiteBlueprintsMock(),
}));

vi.mock('@/components/ui/button', () => ({
  Button: ({ children, ...props }) => <button {...props}>{children}</button>,
}));

vi.mock('@/components/ui/input', () => ({
  Input: (props) => <input {...props} />,
}));

vi.mock('@/components/ui/textarea', () => ({
  Textarea: (props) => <textarea {...props} />,
}));

describe('SiteBlueprintsManager', () => {
  const saveBlueprint = vi.fn();
  const deleteBlueprint = vi.fn();
  const applyBlueprint = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    useTenantMock.mockReturnValue({ currentTenant: { id: 'tenant-1' } });
    usePermissionsMock.mockReturnValue({
      hasPermission: (permission) => permission === 'tenant.setting.update',
      isPlatformAdmin: false,
      isFullAccess: false,
    });
    useSiteBlueprintsMock.mockReturnValue({
      blueprints: [
        {
          id: 'bp-1',
          name: 'School Starter',
          slug: 'school-starter',
          status: 'active',
          description: 'Starter blueprint',
          owner_tenant_id: null,
        },
      ],
      activeBlueprintState: { blueprint_id: 'bp-1' },
      loading: false,
      saveBlueprint,
      deleteBlueprint,
      applyBlueprint,
    });
  });

  it('renders blueprint state and applies a blueprint', async () => {
    render(<SiteBlueprintsManager />);

    expect(screen.getByText('School Starter')).toBeInTheDocument();
    expect(screen.getByText('Active')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /apply/i }));

    await waitFor(() => {
      expect(applyBlueprint).toHaveBeenCalledWith({ blueprintId: 'bp-1' });
    });
  });

  it('saves a tenant-scoped blueprint draft', async () => {
    render(<SiteBlueprintsManager />);

    fireEvent.change(screen.getByPlaceholderText('Blueprint name'), { target: { value: 'Tenant Variant' } });
    fireEvent.change(screen.getByPlaceholderText('blueprint-slug'), { target: { value: 'tenant-variant' } });
    fireEvent.click(screen.getByRole('button', { name: /save blueprint/i }));

    await waitFor(() => {
      expect(saveBlueprint).toHaveBeenCalledWith(expect.objectContaining({
        name: 'Tenant Variant',
        slug: 'tenant-variant',
        owner_tenant_id: 'tenant-1',
      }));
    });
  });
});
