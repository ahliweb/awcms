import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import ReusableSectionsManager from '../ReusableSectionsManager';

const useTenantMock = vi.fn();
const usePermissionsMock = vi.fn();
const useReusableSectionsMock = vi.fn();

vi.mock('@/contexts/TenantContext', () => ({
  useTenant: () => useTenantMock(),
}));

vi.mock('@/contexts/PermissionContext', () => ({
  usePermissions: () => usePermissionsMock(),
}));

vi.mock('@/hooks/useReusableSections', () => ({
  useReusableSections: () => useReusableSectionsMock(),
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

describe('ReusableSectionsManager', () => {
  const saveSection = vi.fn();
  const deleteSection = vi.fn();
  const materializeSection = vi.fn();
  const detachUsage = vi.fn();
  const detachAllUsages = vi.fn();
  const relinkDetachEvent = vi.fn();
  const relinkAllDetachEvents = vi.fn();
  const updateAllLinkedReferences = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    useTenantMock.mockReturnValue({ currentTenant: { id: 'tenant-1' } });
    usePermissionsMock.mockReturnValue({
      hasPermission: (permission) => permission === 'tenant.setting.update',
      isPlatformAdmin: false,
      isFullAccess: false,
    });
    useReusableSectionsMock.mockReturnValue({
      sections: [
        {
          id: 'section-1',
          name: 'Hero Section',
          slug: 'hero-section',
          status: 'active',
          section_mode: 'visual',
          owner_tenant_id: null,
        },
      ],
      usagesBySection: {
        'section-1': [
          { id: 'usage-1', source_type: 'page', source_label: 'Homepage', locale: null },
          { id: 'usage-2', source_type: 'template', source_label: 'Landing Template', locale: 'en' },
        ],
      },
      detachEventsBySection: {
        'section-1': [
          { id: 'detach-1', source_type: 'page', source_label: 'Homepage', locale: null },
        ],
      },
      revisionsBySection: {
        'section-1': [
          { id: 'revision-2', revision_number: 2, created_at: '2026-04-05T12:00:00.000Z' },
          { id: 'revision-1', revision_number: 1, created_at: '2026-04-05T11:00:00.000Z' },
        ],
      },
      loading: false,
      saveSection,
      deleteSection,
      materializeSection,
      detachUsage,
      detachAllUsages,
      relinkDetachEvent,
      relinkAllDetachEvents,
      updateAllLinkedReferences,
    });
  });

  it('renders reusable sections and materializes one', async () => {
    render(<ReusableSectionsManager />);

    expect(screen.getByText('Hero Section')).toBeInTheDocument();
    expect(screen.getByText('2 reference(s)')).toBeInTheDocument();
    expect(screen.getAllByText('page: Homepage').length).toBeGreaterThan(0);
    expect(screen.getByText('2 revision(s)')).toBeInTheDocument();
    expect(screen.getByText(/Revision 2/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /materialize/i }));

    await waitFor(() => {
      expect(materializeSection).toHaveBeenCalledWith({ sectionId: 'section-1' });
    });

    fireEvent.click(screen.getAllByRole('button', { name: /detach/i })[0]);

    await waitFor(() => {
      expect(detachUsage).toHaveBeenCalledWith(expect.objectContaining({ id: 'usage-1' }));
    });

    fireEvent.click(screen.getByRole('button', { name: /detach all/i }));

    await waitFor(() => {
      expect(detachAllUsages).toHaveBeenCalledWith({ sectionId: 'section-1' });
    });

    fireEvent.click(screen.getAllByRole('button', { name: /relink/i })[0]);

    await waitFor(() => {
      expect(relinkDetachEvent).toHaveBeenCalledWith(expect.objectContaining({ id: 'detach-1' }));
    });

    fireEvent.click(screen.getByRole('button', { name: /relink all/i }));

    await waitFor(() => {
      expect(relinkAllDetachEvents).toHaveBeenCalledWith({ sectionId: 'section-1' });
    });

    fireEvent.click(screen.getByRole('button', { name: /update linked/i }));

    await waitFor(() => {
      expect(updateAllLinkedReferences).toHaveBeenCalledWith({ sectionId: 'section-1' });
    });
  });

  it('saves a tenant reusable section draft', async () => {
    render(<ReusableSectionsManager />);

    fireEvent.change(screen.getByPlaceholderText('Section name'), { target: { value: 'Promo Band' } });
    fireEvent.change(screen.getByPlaceholderText('section-slug'), { target: { value: 'promo-band' } });
    fireEvent.click(screen.getByRole('button', { name: /save reusable section/i }));

    await waitFor(() => {
      expect(saveSection).toHaveBeenCalledWith(expect.objectContaining({
        name: 'Promo Band',
        slug: 'promo-band',
        owner_tenant_id: 'tenant-1',
      }));
    });
  });
});
