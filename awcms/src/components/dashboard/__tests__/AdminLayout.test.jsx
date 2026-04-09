import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

import AdminLayout from '../AdminLayout';

vi.mock('react-router-dom', () => ({
  Outlet: () => <div data-testid="outlet">outlet</div>,
}));

vi.mock('../Header', () => ({
  default: ({ toggleSidebar }) => (
    <button type="button" data-testid="header" onClick={toggleSidebar}>
      header
    </button>
  ),
}));

vi.mock('@/templates/emdash-admin/components/Sidebar', () => ({
  default: ({ isOpen, onClose }) => (
    <div>
      <div data-testid="sidebar">{isOpen ? 'open' : 'closed'}</div>
      <button type="button" data-testid="sidebar-close" onClick={onClose}>close</button>
    </div>
  ),
}));

vi.mock('@/templates/emdash-admin/components/Footer', () => ({
  default: () => <div data-testid="footer">footer</div>,
}));

describe('AdminLayout', () => {
  it('renders the shell using emdash-admin subpath exports', () => {
    render(<AdminLayout />);

    expect(screen.getByTestId('header')).toBeInTheDocument();
    expect(screen.getByTestId('sidebar')).toHaveTextContent('closed');
    expect(screen.getByTestId('outlet')).toBeInTheDocument();
    expect(screen.getByTestId('footer')).toBeInTheDocument();
  });
});
