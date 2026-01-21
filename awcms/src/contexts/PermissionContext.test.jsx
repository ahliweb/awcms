import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { PermissionProvider, usePermissions } from './PermissionContext';
import { useAuth } from './SupabaseAuthContext';

// Mock dependencies
vi.mock('./SupabaseAuthContext', () => ({
    useAuth: vi.fn(),
}));

// Mock UDM
vi.mock('@/lib/data/UnifiedDataManager', () => ({
    udm: {
        from: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        is: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: null, error: null }),
        in: vi.fn().mockReturnThis()
    }
}));

// Test component
const TestComponent = ({ checkPermission, checkRole }) => {
    const { hasPermission, userRole, loading } = usePermissions();

    if (loading) return <div>Loading...</div>;

    if (checkRole) {
        return <div>Role: {userRole}</div>;
    }

    return (
        <div>
            Access: {hasPermission(checkPermission) ? 'Granted' : 'Denied'}
        </div>
    );
};

describe('PermissionContext', () => {
    it('allows super_admin to access everything', async () => {
        // Mock UDM to return a super_admin user
        const { udm } = await import('@/lib/data/UnifiedDataManager');
        udm.from().select().eq().single.mockResolvedValueOnce({
            data: {
                id: '123',
                email: 'admin@example.com',
                roles: { name: 'super_admin' },
                role_id: '1',
                tenant_id: 'tenant-1'
            }
        });

        useAuth.mockReturnValue({
            user: {
                role: 'super_admin',
                app_metadata: { role: 'super_admin' },
                email: 'admin@example.com'
            },
            session: { user: { id: '123' } }
        });

        render(
            <PermissionProvider>
                <TestComponent checkPermission="any.random.permission" />
            </PermissionProvider>
        );

        // Wait for Access: Granted
        await waitFor(() => {
            expect(screen.getByText('Access: Granted')).toBeInTheDocument();
        });
    });

    it('denies access if permission is missing', async () => {
        // Mock UDM for editor without specific permission
        const { udm } = await import('@/lib/data/UnifiedDataManager');
        udm.from().select().eq().single.mockResolvedValueOnce({
            data: {
                id: '456',
                roles: {
                    name: 'editor',
                    role_permissions: [
                        { permissions: { name: 'blog.read' } }
                    ]
                }
            }
        });

        useAuth.mockReturnValue({
            user: {
                role: 'editor',
                app_metadata: { role: 'editor' },
                email: 'editor@example.com'
            },
            session: { user: { id: '456' } }
        });

        render(
            <PermissionProvider>
                <TestComponent checkPermission="blog.delete" />
            </PermissionProvider>
        );

        await waitFor(() => {
            expect(screen.getByText('Access: Denied')).toBeInTheDocument();
        });
    });

    it('grants access if permission is present', async () => {
        // Mock UDM for editor WITH permission
        const { udm } = await import('@/lib/data/UnifiedDataManager');
        udm.from().select().eq().single.mockResolvedValueOnce({
            data: {
                id: '789',
                roles: {
                    name: 'editor',
                    role_permissions: [
                        { permissions: { name: 'blog.create' } }
                    ]
                }
            }
        });

        useAuth.mockReturnValue({
            user: { id: '789', email: 'editor@example.com', role: 'editor' },
            session: { user: { id: '789' } }
        });

        render(
            <PermissionProvider>
                <TestComponent checkPermission="blog.create" />
            </PermissionProvider>
        );

        await waitFor(() => {
            expect(screen.getByText('Access: Granted')).toBeInTheDocument();
        });
    });

    it('correctly identifies role', async () => {
        const { udm } = await import('@/lib/data/UnifiedDataManager');
        udm.from().select().eq().single.mockResolvedValueOnce({
            data: {
                id: '101',
                roles: { name: 'author' }
            }
        });

        useAuth.mockReturnValue({
            user: { id: '101' },
            session: { user: { id: '101' } }
        });

        render(
            <PermissionProvider>
                <TestComponent checkRole={true} />
            </PermissionProvider>
        );

        await waitFor(() => {
            expect(screen.getByText('Role: author')).toBeInTheDocument();
        });
    });
});
