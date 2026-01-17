import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import SeoManager from '../SeoManager';
import WidgetsManager from '../widgets/WidgetsManager';
// Note: We import mocked hooks but verify them in the test
import { usePermissions } from '@/contexts/PermissionContext';

// --- MOCKS ---
vi.mock('@/contexts/PermissionContext', () => ({
    usePermissions: vi.fn(),
}));

vi.mock('@/contexts/SupabaseAuthContext', () => ({
    useAuth: vi.fn(() => ({ user: { id: '123' } })),
}));

vi.mock('@/contexts/TenantContext', () => ({
    useTenant: vi.fn(() => ({ currentTenant: { id: 'tenant-1' } })),
}));

vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (key) => key }),
}));

vi.mock('react-helmet-async', () => ({
    Helmet: ({ children }) => <>{children}</>
}));

// Mock Supabase client
vi.mock('@/lib/customSupabaseClient', () => ({
    supabase: {
        from: vi.fn(() => ({
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            is: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({ data: {}, error: null }),
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
            in: vi.fn().mockReturnThis(),
            order: vi.fn().mockReturnThis(),
            range: vi.fn().mockReturnThis(),
            delete: vi.fn().mockReturnThis(),
            update: vi.fn().mockReturnThis(),
            insert: vi.fn().mockReturnThis(),
        }))
    }
}));

// Mock AdminPageLayout to capture props
vi.mock('@/templates/flowbite-admin', () => ({
    AdminPageLayout: ({ children, requiredPermission }) => (
        <div data-testid="admin-layout" data-required-permission={requiredPermission}>
            {children}
        </div>
    ),
    PageHeader: ({ title }) => <h1>{title}</h1>,
}));

// Mock UI components that might be used
vi.mock('@/components/ui/use-toast', () => ({
    useToast: () => ({ toast: vi.fn() })
}));

// Mock UI button/shadcn
vi.mock('@/components/ui/button', () => ({
    Button: ({ children, ...props }) => <button {...props}>{children}</button>
}));
// --- END MOCKS ---

describe('Access Control', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('SeoManager', () => {
        it('renders Access Denied when "tenant.seo.read" is missing', async () => {
            // Setup: User has NO permissions
            usePermissions.mockReturnValue({
                hasPermission: (perm) => false,
                userRole: 'editor',
                loading: false
            });

            render(<SeoManager />);

            // Expect Access Denied UI
            await waitFor(() => {
                expect(screen.getByText(/Access Denied/i)).toBeInTheDocument();
            });
            // Expect AdminPageLayout NOT to be rendered
            expect(screen.queryByTestId('admin-layout')).not.toBeInTheDocument();
        });

        it('renders AdminPageLayout with correct requiredPermission when granted', async () => {
            // Setup: User HAS "tenant.seo.read"
            usePermissions.mockReturnValue({
                hasPermission: (perm) => perm === 'tenant.seo.read',
                userRole: 'editor',
                loading: false
            });

            render(<SeoManager />);

            // Expect AdminLayout
            await waitFor(() => {
                const layout = screen.getByTestId('admin-layout');
                expect(layout).toBeInTheDocument();
                // Verify verification: The layout prop must match the new granular permission
                expect(layout).toHaveAttribute('data-required-permission', 'tenant.seo.read');
            });
        });
    });

    describe('WidgetsManager', () => {
        it('renders Access Denied when "tenant.widgets.read" is missing', async () => {
            usePermissions.mockReturnValue({
                hasPermission: (perm) => false,
                userRole: 'editor',
                loading: false
            });

            render(<WidgetsManager />);

            await waitFor(() => {
                expect(screen.getByText(/Access Denied/i)).toBeInTheDocument();
            });
        });

        it('renders content when "tenant.widgets.read" is granted', async () => {
            usePermissions.mockReturnValue({
                hasPermission: (perm) => perm === 'tenant.widgets.read',
                userRole: 'editor',
                loading: false
            });

            render(<WidgetsManager />);

            // If granted, it should NOT show Access Denied.
            await waitFor(() => {
                expect(screen.queryByText(/Access Denied/i)).not.toBeInTheDocument();
            });
        });
    });
});
