import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import ReusableSectionActionRequestsManager from '../ReusableSectionActionRequestsManager';

const useReusableSectionsMock = vi.fn();
const usePermissionsMock = vi.fn();

vi.mock('@/hooks/useReusableSections', () => ({
  useReusableSections: () => useReusableSectionsMock(),
}));

vi.mock('@/contexts/PermissionContext', () => ({
  usePermissions: () => usePermissionsMock(),
}));

vi.mock('@/components/ui/button', () => ({
  Button: ({ children, ...props }) => <button {...props}>{children}</button>,
}));

describe('ReusableSectionActionRequestsManager', () => {
  const approveActionRequest = vi.fn();
  const rejectActionRequest = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    usePermissionsMock.mockReturnValue({
      hasPermission: (permission) => permission === 'platform.approvals.read',
      isPlatformAdmin: false,
      isFullAccess: false,
    });
    useReusableSectionsMock.mockReturnValue({
      sections: [
        { id: 'section-1', name: 'Hero Section' },
      ],
      actionRequestsBySection: {
        'section-1': [
          { id: 'request-1', reusable_section_id: 'section-1', action_type: 'update_linked', status: 'pending', requested_at: '2026-04-05T10:00:00.000Z' },
          { id: 'request-2', reusable_section_id: 'section-1', action_type: 'detach_all', status: 'completed', reviewed_at: '2026-04-05T11:00:00.000Z', completed_at: '2026-04-05T11:05:00.000Z' },
        ],
      },
      loading: false,
      approveActionRequest,
      rejectActionRequest,
    });
  });

  it('renders pending and historical requests and allows approval', async () => {
    render(<ReusableSectionActionRequestsManager />);

    expect(screen.getByText('Pending Requests')).toBeInTheDocument();
    expect(screen.getByText('Request History')).toBeInTheDocument();
    expect(screen.getByText(/update_linked/)).toBeInTheDocument();
    expect(screen.getByText(/detach_all • completed/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /approve/i }));

    await waitFor(() => {
      expect(approveActionRequest).toHaveBeenCalledWith(expect.objectContaining({ id: 'request-1' }));
    });
  });
});
