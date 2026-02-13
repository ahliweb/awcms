import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import PublicLayout from '../PublicLayout';

// Mock hooks and components
vi.mock('@/hooks/usePublicTenant', () => ({
    usePublicTenant: vi.fn(() => ({
        tenant: { id: 'test-tenant-123', name: 'Test Tenant' },
        loading: false,
    })),
}));

vi.mock('../PublicHeader', () => ({
    default: ({ tenant }) => (
        <header data-testid="public-header">
            Header: {tenant?.name || 'No Tenant'}
        </header>
    ),
}));

vi.mock('../PublicFooter', () => ({
    default: ({ tenant }) => (
        <footer data-testid="public-footer">
            Footer: {tenant?.name || 'No Tenant'}
        </footer>
    ),
}));

vi.mock('../DynamicTemplate', () => ({
    default: ({ type: _type, fallback: Fallback, context }) => {
        return <Fallback {...context} />;
    },
}));

const renderWithRouter = (ui) => {
    return render(
        <MemoryRouter>
            {ui}
        </MemoryRouter>
    );
};

describe('PublicLayout', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('renders header and footer', () => {
        renderWithRouter(<PublicLayout />);

        expect(screen.getByTestId('public-header')).toBeInTheDocument();
        expect(screen.getByTestId('public-footer')).toBeInTheDocument();
    });

    it('passes tenant to header', () => {
        renderWithRouter(<PublicLayout />);

        expect(screen.getByText(/Header: Test Tenant/)).toBeInTheDocument();
    });

    it('passes tenant to footer', () => {
        renderWithRouter(<PublicLayout />);

        expect(screen.getByText(/Footer: Test Tenant/)).toBeInTheDocument();
    });

    it('has proper layout structure', () => {
        const { container } = renderWithRouter(<PublicLayout />);

        // Should have flex column layout
        const layout = container.querySelector('.flex.flex-col');
        expect(layout).toBeInTheDocument();
        expect(layout).toHaveClass('min-h-screen');
    });

    it('renders main content area with flex-1', () => {
        const { container } = renderWithRouter(<PublicLayout />);

        const main = container.querySelector('main');
        expect(main).toBeInTheDocument();
        expect(main).toHaveClass('flex-1');
    });
});
