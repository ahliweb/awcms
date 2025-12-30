import React, { useState, useEffect } from 'react';
import ContentTable from '@/components/dashboard/ContentTable';
import GenericResourceEditor from '@/components/dashboard/GenericResourceEditor';
import { usePermissions } from '@/contexts/PermissionContext';
import { useToast } from '@/components/ui/use-toast';
import { udm } from '@/lib/data/UnifiedDataManager'; // Changed from supabase
import { Button } from '@/components/ui/button';
import { Plus, Trash2, Search, X, RefreshCw, Archive, RotateCcw, ShieldAlert, User, Home, ChevronRight } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { Link } from 'react-router-dom';
import { useTenant } from '@/contexts/TenantContext';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '@/components/ui/alert-dialog';

const GenericContentManager = ({
    tableName,
    resourceName,
    columns,
    formFields,
    permissionPrefix,
    customSelect, // Allow overriding the default select query
    defaultFilters = {}, // Allow filtering by default (e.g., { type: 'articles' })
    customRowActions, // Allow injecting custom action buttons
    viewPermission,
    createPermission,
    restorePermission,
    permanentDeletePermission,
    showBreadcrumbs = true
}) => {
    const { toast } = useToast();
    const { user } = useAuth();
    const { hasPermission, checkAccess } = usePermissions();
    const { currentTenant } = useTenant();

    const [items, setItems] = useState([]);
    const [loading, setLoading] = useState(false);
    const [showEditor, setShowEditor] = useState(false);
    const [selectedItem, setSelectedItem] = useState(null);
    const [query, setQuery] = useState('');
    const [showTrash, setShowTrash] = useState(false);

    const [totalItems, setTotalItems] = useState(0);
    const [currentPage, setCurrentPage] = useState(1);
    const [itemsPerPage, setItemsPerPage] = useState(10);

    // Delete confirmation state
    const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
    const [itemToDelete, setItemToDelete] = useState(null);

    // Permanent delete confirmation state
    const [permanentDeleteDialogOpen, setPermanentDeleteDialogOpen] = useState(false);
    const [itemToPermanentDelete, setItemToPermanentDelete] = useState(null);

    // Computed Permissions - Using frontend pattern (tenant.module.*)
    const canView = viewPermission
        ? hasPermission(viewPermission)
        : hasPermission(`tenant.${permissionPrefix}.read`);
    const canCreate = createPermission
        ? hasPermission(createPermission)
        : hasPermission(`tenant.${permissionPrefix}.create`);
    const canRestore = restorePermission
        ? hasPermission(restorePermission)
        : hasPermission(`tenant.${permissionPrefix}.restore`);
    const canPermanentDelete = permanentDeletePermission
        ? hasPermission(permanentDeletePermission)
        : hasPermission(`tenant.${permissionPrefix}.permanent_delete`);

    const fetchItems = async () => {
        if (!canView) return;

        // Wait for tenant context to resolve, unless we are in a special global mode (future proofing)
        if (!currentTenant?.id && !hasPermission('manage_platform')) return;

        setLoading(true);
        try {
            // Updated default select query to use valid PostgREST syntax for embedding 'users' via 'created_by' column.
            const selectQuery = customSelect || '*, owner:users!created_by(email, full_name)';

            // UnifiedDataManager Integration
            let q = udm.from(tableName)
                .select(selectQuery, { count: 'exact' });

            // STRICT TENANT FILTERING
            if (currentTenant?.id) {
                q = q.eq('tenant_id', currentTenant.id);
            } else if (hasPermission('manage_platform')) {
                // Platform admin view (no tenant selected) logic could go here
                console.log('Platform Admin View: showing all records (careful)');
            } else {
                setItems([]);
                setLoading(false);
                return;
            }

            if (showTrash) {
                q = q.not('deleted_at', 'is', null);
            } else {
                q = q.is('deleted_at', null);
            }

            // Apply default filters (e.g., { type: 'articles' } for categories)
            if (defaultFilters && Object.keys(defaultFilters).length > 0) {
                Object.entries(defaultFilters).forEach(([key, value]) => {
                    q = q.eq(key, value);
                });
            }

            if (query) {
                const searchCol = columns.find(c => c.key === 'title' || c.key === 'name')?.key || 'id';
                q = q.ilike(searchCol, `%${query}%`);
            }

            const from = (currentPage - 1) * itemsPerPage;
            const to = from + itemsPerPage - 1;

            const { data, count, error } = await q
                .range(from, to)
                .order('created_at', { ascending: false });

            if (error) throw error;

            setItems(data || []);
            setTotalItems(count || 0);
        } catch (err) {
            console.error(err);
            toast({ variant: 'destructive', title: 'Error', description: `Failed to load ${resourceName}s` });
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchItems();
    }, [currentPage, itemsPerPage, query, canView, showTrash, tableName, currentTenant?.id]);

    const handleEdit = (item) => {
        if (!checkAccess('edit', permissionPrefix, item)) {
            toast({ variant: 'destructive', title: 'Access Denied', description: 'You can only edit your own content.' });
            return;
        }
        setSelectedItem(item);
        setShowEditor(true);
    };

    // Show delete confirmation dialog
    const handleDelete = (id, item) => {
        if (!checkAccess('delete', permissionPrefix, item)) {
            toast({ variant: 'destructive', title: 'Access Denied', description: 'You can only delete your own content.' });
            return;
        }
        setItemToDelete({ id, item });
        setDeleteDialogOpen(true);
    };

    // Perform actual delete after confirmation
    const confirmDelete = async () => {
        if (!itemToDelete) return;

        try {
            const deletedAt = new Date().toISOString();

            // UnifiedDataManager Update
            const { data, error } = await udm.from(tableName)
                .update({ deleted_at: deletedAt })
                .eq('id', itemToDelete.id); // UDM update expects filters to apply to update WHERE clause

            if (error) throw error;

            // Note: UDM update returns { data: payload } for optimistic, so checks on data might need adjustment 
            // but our UDM wrapper returns standard {data, error} format.
            // If offline, data is just the payload.

            toast({ title: 'Success', description: `${resourceName} moved to trash` });
            fetchItems();
        } catch (err) {
            console.error('Delete error:', err);
            toast({ variant: 'destructive', title: 'Error', description: err.message });
        } finally {
            setDeleteDialogOpen(false);
            setItemToDelete(null);
        }
    };

    const handleRestore = async (id) => {
        try {
            const { data, error } = await udm.from(tableName)
                .update({ deleted_at: null })
                .eq('id', id);

            if (error) throw error;

            toast({ title: 'Restored', description: `${resourceName} restored from trash.` });
            fetchItems();
        } catch (err) {
            console.error('Restore error:', err);
            toast({ variant: 'destructive', title: 'Error', description: err.message });
        }
    };

    const openPermanentDeleteDialog = (id) => {
        setItemToPermanentDelete(id);
        setPermanentDeleteDialogOpen(true);
    };

    const confirmPermanentDelete = async () => {
        if (!itemToPermanentDelete) return;
        try {
            const { error } = await udm.from(tableName).delete().eq('id', itemToPermanentDelete);
            if (error) throw error;
            toast({ title: 'Deleted', description: `${resourceName} permanently deleted.` });
            fetchItems();
        } catch (err) {
            toast({ variant: 'destructive', title: 'Error', description: err.message });
        } finally {
            setPermanentDeleteDialogOpen(false);
            setItemToPermanentDelete(null);
        }
    };

    if (!canView) return (
        <div className="flex flex-col items-center justify-center min-h-[400px] bg-white rounded-xl border border-slate-200 p-12 text-center">
            <div className="p-4 bg-red-50 rounded-full mb-4">
                <ShieldAlert className="w-12 h-12 text-red-500" />
            </div>
            <h3 className="text-xl font-bold text-slate-800">Access Denied</h3>
            <p className="text-slate-500 mt-2">You do not have permission to view {resourceName}s.</p>
        </div>
    );

    // Enhance columns with Owner info if available
    const displayColumns = [
        ...columns,
        {
            key: 'owner',
            label: 'Owner',
            render: (_, row) => (
                <div className="flex items-center gap-2 text-xs text-slate-600">
                    <User className="w-3 h-3 text-slate-400" />
                    <span>{row.owner?.full_name || row.owner?.email || 'System'}</span>
                    {user?.id === row.created_by && <span className="bg-blue-100 text-blue-700 px-1.5 rounded-full text-[10px] font-bold">You</span>}
                </div>
            )
        }
    ];

    // Added Tenant Column for Platform Admins (if not filtered by tenant)
    if (!currentTenant?.id && hasPermission('manage_platform')) {
        displayColumns.unshift({
            key: 'tenant_id',
            label: 'Tenant',
            render: (_, row) => (
                <span className="text-[10px] font-mono bg-slate-100 text-slate-500 px-1 rounded">
                    {row.tenant_id?.substring(0, 8)}...
                </span>
            )
        });
    }

    return (
        <div className="space-y-6">
            {showEditor ? (
                <GenericResourceEditor
                    tableName={tableName}
                    resourceName={resourceName}
                    fields={formFields}
                    initialData={selectedItem}
                    permissionPrefix={permissionPrefix}
                    onClose={() => { setShowEditor(false); setSelectedItem(null); }}
                    onSuccess={fetchItems}
                    createPermission={createPermission}
                />
            ) : (
                <>
                    {/* Enhanced Breadcrumb Navigation */}
                    {showBreadcrumbs && (
                        <nav className="flex items-center gap-1 text-sm mb-6">
                            <Link
                                to="/cmspanel"
                                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-slate-100 hover:bg-blue-100 text-slate-600 hover:text-blue-700 transition-all duration-200 group"
                            >
                                <Home className="w-4 h-4 group-hover:scale-110 transition-transform" />
                                <span className="font-medium">Dashboard</span>
                            </Link>

                            <ChevronRight className="w-4 h-4 text-slate-300" />

                            <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full font-semibold ${showTrash
                                ? 'bg-slate-100 text-slate-600 cursor-pointer hover:bg-slate-200'
                                : 'bg-gradient-to-r from-blue-500 to-blue-600 text-white shadow-sm'
                                }`}
                                onClick={showTrash ? () => setShowTrash(false) : undefined}
                            >
                                <span>{resourceName}s</span>
                            </div>

                            {showTrash && (
                                <>
                                    <ChevronRight className="w-4 h-4 text-slate-300" />
                                    <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-gradient-to-r from-red-500 to-red-600 text-white font-semibold shadow-sm">
                                        <Trash2 className="w-3.5 h-3.5" />
                                        <span>Trash</span>
                                    </div>
                                </>
                            )}
                        </nav>
                    )}
                    <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                        <div>
                            <h2 className="text-3xl font-bold text-slate-800 flex items-center gap-2">
                                {resourceName}s
                                {showTrash && <span className="text-lg font-normal text-red-500 bg-red-50 px-2 py-0.5 rounded-md">Trash Bin</span>}
                            </h2>
                            <p className="text-slate-600">Manage {resourceName.toLowerCase()} entries.</p>
                        </div>
                        <div className="flex gap-2">
                            <Button
                                variant={showTrash ? "default" : "outline"}
                                onClick={() => { setShowTrash(!showTrash); setCurrentPage(1); }}
                                className={showTrash ? "bg-red-600 hover:bg-red-700" : ""}
                            >
                                {showTrash ? <RotateCcw className="w-4 h-4 mr-2" /> : <Trash2 className="w-4 h-4 mr-2" />}
                                {showTrash ? "Back to Active" : "Trash"}
                            </Button>
                            {canCreate && !showTrash && (
                                <Button onClick={() => { setSelectedItem(null); setShowEditor(true); }} className="bg-blue-600">
                                    <Plus className="w-4 h-4 mr-2" /> New {resourceName}
                                </Button>
                            )}
                        </div>
                    </div>

                    <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex items-center gap-2">
                        <div className="relative flex-1 max-w-sm">
                            <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                            <Input
                                placeholder={`Search ${resourceName}s...`}
                                value={query}
                                onChange={e => setQuery(e.target.value)}
                                className="pl-9"
                            />
                        </div>
                        <div className="flex-1"></div>
                        <Button variant="ghost" size="icon" onClick={fetchItems} title="Refresh">
                            <RefreshCw className="w-4 h-4 text-slate-500" />
                        </Button>
                    </div>

                    <ContentTable
                        data={items}
                        columns={displayColumns}
                        loading={loading}
                        // Dynamically check permissions for each row
                        onEdit={!showTrash ? (item) => {
                            if (checkAccess('edit', permissionPrefix, item)) handleEdit(item);
                            else toast({ variant: 'destructive', title: 'Access Denied', description: 'You can only edit your own content.' });
                        } : null}

                        onDelete={!showTrash ? (item) => handleDelete(item.id, item) : null}

                        extraActions={(item) => (
                            <div className="flex gap-1">
                                {customRowActions && customRowActions(item)}
                                {showTrash && (
                                    <>
                                        {canRestore && (
                                            <Button size="icon" variant="ghost" onClick={() => handleRestore(item.id)} className="text-green-600 hover:bg-green-50" title="Restore">
                                                <RotateCcw className="w-4 h-4" />
                                            </Button>
                                        )}
                                        {canPermanentDelete && (
                                            <Button size="icon" variant="ghost" onClick={() => openPermanentDeleteDialog(item.id)} className="text-red-600 hover:bg-red-50" title="Delete Forever">
                                                <X className="w-4 h-4" />
                                            </Button>
                                        )}
                                    </>
                                )}
                            </div>
                        )}

                        pagination={{
                            currentPage,
                            totalPages: Math.ceil(totalItems / itemsPerPage),
                            totalItems,
                            itemsPerPage,
                            onPageChange: setCurrentPage,
                            onLimitChange: setItemsPerPage
                        }}
                    />
                </>
            )}

            {/* Delete Confirmation Dialog */}
            <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Move to Trash?</AlertDialogTitle>
                        <AlertDialogDescription>
                            This will move the {resourceName.toLowerCase()} to trash. You can restore it later from the trash bin.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel onClick={() => setItemToDelete(null)}>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={confirmDelete} className="bg-red-600 hover:bg-red-700">
                            Delete
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            {/* Permanent Delete Confirmation Dialog */}
            <AlertDialog open={permanentDeleteDialogOpen} onOpenChange={setPermanentDeleteDialogOpen}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle className="flex items-center gap-2 text-red-600">
                            <Trash2 className="w-5 h-5" />
                            Permanent Delete
                        </AlertDialogTitle>
                        <AlertDialogDescription asChild>
                            <div className="space-y-3">
                                <p>Are you sure you want to <strong>permanently delete</strong> this {resourceName.toLowerCase()}?</p>
                                <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-red-700 text-sm">
                                    <p className="font-medium">🚫 Warning:</p>
                                    <p>This action is <strong>irreversible</strong>. The data will be permanently removed and cannot be recovered.</p>
                                </div>
                            </div>
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel onClick={() => setItemToPermanentDelete(null)}>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={confirmPermanentDelete} className="bg-red-600 hover:bg-red-700">
                            Delete Forever
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
};

export default GenericContentManager;
