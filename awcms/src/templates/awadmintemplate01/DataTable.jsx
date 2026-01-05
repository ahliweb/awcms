import React from 'react';
import ContentTable from '@/components/dashboard/ContentTable';
import { usePermissions } from '@/contexts/PermissionContext';
import { useTenant } from '@/contexts/TenantContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Search, RefreshCw } from 'lucide-react';
import EmptyState from './EmptyState';
import LoadingSkeleton from './LoadingSkeleton';

/**
 * DataTable - Standardized data table wrapper for admin modules.
 * Includes search, filters, pagination, and ABAC-aware column visibility.
 * 
 * @param {Array} data - Table data
 * @param {Array} columns - Column definitions
 * @param {boolean} loading - Loading state
 * @param {string} searchPlaceholder - Search input placeholder
 * @param {string} searchValue - Current search value
 * @param {function} onSearchChange - Search change handler
 * @param {function} onRefresh - Refresh button handler
 * @param {function} onEdit - Edit row handler (ABAC filtered)
 * @param {function} onDelete - Delete row handler (ABAC filtered)
 * @param {function} extraActions - Additional row actions renderer
 * @param {object} pagination - Pagination config
 * @param {boolean} showTenantColumn - Auto-inject tenant column for platform admins
 * @param {React.ReactNode} filterSlot - Custom filter components
 * @param {React.ReactNode} bulkActionsSlot - Bulk action components
 * @param {object} emptyState - Empty state config {icon, title, description, action}
 */
const DataTable = ({
    data = [],
    columns = [],
    loading = false,
    searchPlaceholder = 'Search...',
    searchValue = '',
    onSearchChange,
    onRefresh,
    onEdit,
    onDelete,
    extraActions,
    pagination,
    showTenantColumn = true,
    filterSlot,
    bulkActionsSlot,
    emptyState = {},
}) => {
    const { isPlatformAdmin } = usePermissions();
    const { currentTenant } = useTenant();

    // Auto-inject tenant column for platform admins
    const displayColumns = React.useMemo(() => {
        if (!showTenantColumn || !isPlatformAdmin) return columns;

        // Check if tenant column already exists
        const hasTenantCol = columns.some(c => c.key === 'tenant_id' || c.key === 'tenant');
        if (hasTenantCol) return columns;

        return [
            {
                key: 'tenant_id',
                label: 'Nama Tenant',
                render: (_, row) => (
                    <span className="text-xs font-medium text-slate-600 bg-slate-100 px-2 py-0.5 rounded">
                        {row.tenant?.name || '(Unknown)'}
                    </span>
                ),
            },
            ...columns,
        ];
    }, [columns, isPlatformAdmin, showTenantColumn]);

    // Loading skeleton
    if (loading && data.length === 0) {
        return <LoadingSkeleton type="table" rows={5} />;
    }

    return (
        <div className="space-y-4">
            {/* Search and Filter Bar */}
            <div className="bg-card p-4 rounded-xl border border-border shadow-sm flex flex-col sm:flex-row items-start sm:items-center gap-4">
                {/* Search Input */}
                {onSearchChange && (
                    <div className="relative flex-1 max-w-sm w-full">
                        <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" aria-hidden="true" />
                        <Input
                            placeholder={searchPlaceholder}
                            value={searchValue}
                            onChange={(e) => onSearchChange(e.target.value)}
                            className="pl-9 bg-background"
                            aria-label={searchPlaceholder}
                        />
                    </div>
                )}

                {/* Custom Filters Slot */}
                {filterSlot && (
                    <div className="flex items-center gap-2">
                        {filterSlot}
                    </div>
                )}

                {/* Spacer */}
                <div className="flex-1 hidden sm:block" />

                {/* Bulk Actions Slot */}
                {bulkActionsSlot}

                {/* Refresh Button */}
                {onRefresh && (
                    <Button
                        variant="ghost"
                        size="icon"
                        onClick={onRefresh}
                        title="Refresh"
                        aria-label="Refresh data"
                        className="text-muted-foreground hover:text-foreground"
                    >
                        <RefreshCw className="w-4 h-4" />
                    </Button>
                )}
            </div>

            {/* Empty State */}
            {!loading && data.length === 0 ? (
                <EmptyState
                    icon={emptyState.icon}
                    title={emptyState.title || 'No data found'}
                    description={emptyState.description || 'There are no items to display.'}
                    action={emptyState.action}
                />
            ) : (
                /* Data Table */
                <ContentTable
                    data={data}
                    columns={displayColumns}
                    loading={loading}
                    onEdit={onEdit}
                    onDelete={onDelete}
                    extraActions={extraActions}
                    pagination={pagination}
                />
            )}
        </div>
    );
};

export default DataTable;
