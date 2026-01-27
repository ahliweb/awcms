import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import ContentTable from '@/components/dashboard/ContentTable';
import GenericResourceEditor from '@/components/dashboard/GenericResourceEditor';
import { usePermissions } from '@/contexts/PermissionContext';
import { useToast } from '@/components/ui/use-toast';
import { udm } from '@/lib/data/UnifiedDataManager'; // Changed from supabase
import { Button } from '@/components/ui/button';
import { Plus, Trash2, RefreshCw, RotateCcw, ShieldAlert, User, Home, ChevronRight } from 'lucide-react';
import MinCharSearchInput from '@/components/common/MinCharSearchInput';
import { useSearch } from '@/hooks/useSearch';
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
    defaultFilters = {}, // Allow filtering by default (e.g., { type: 'blogs' })
    customRowActions, // Allow injecting custom action buttons
    viewPermission,
    createPermission,
    restorePermission,
    showBreadcrumbs = true,
    defaultSortColumn = 'created_at',
    EditorComponent, // Optional custom editor component
    customToolbarActions // ({ openEditor }) => ReactNode
}) => {
    const { t } = useTranslation();
    const { toast } = useToast();
    const { user } = useAuth();
    const { hasPermission, checkAccess } = usePermissions();
    const { currentTenant } = useTenant();

    const [items, setItems] = useState([]);
    const [loading, setLoading] = useState(false);
    const [showEditor, setShowEditor] = useState(false);
    const [selectedItem, setSelectedItem] = useState(null);
    const [showTrash, setShowTrash] = useState(false);

    // Integrated useSearch hook
    const {
        query,
        setQuery,
        debouncedQuery,
        isValid: isSearchValid,
        message: searchMessage,
        loading: searchLoading,
        minLength,
        clearSearch
    } = useSearch({
        minLength: 5, // Standardized 5 char limit
        initialQuery: ''
    });

    const [totalItems, setTotalItems] = useState(0);
    const [currentPage, setCurrentPage] = useState(1);
    const [itemsPerPage, setItemsPerPage] = useState(10);

    // Delete confirmation state
    const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
    const [itemToDelete, setItemToDelete] = useState(null);

    // Permanent Delete state
    const [permDeleteDialogOpen, setPermDeleteDialogOpen] = useState(false);
    const [itemToPermDelete, setItemToPermDelete] = useState(null);

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
    const canPermDelete = hasPermission(`tenant.${permissionPrefix}.delete_permanent`);
    const softDeleteEnabled = true;

    const fetchItems = async () => {
        if (!canView) return;

        // Wait for tenant context to resolve, unless we are in a special global mode (future proofing)
        if (!currentTenant?.id && !hasPermission('manage_platform')) return;

        setLoading(true);
        try {
            // Updated default select query to use valid PostgREST syntax for embedding 'users' via 'created_by' column.
            const selectQuery = customSelect || '*, owner:users!created_by(email, full_name), tenant:tenants(name)';

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

            if (softDeleteEnabled) {
                if (showTrash) {
                    q = q.not('deleted_at', 'is', null);
                } else {
                    q = q.is('deleted_at', null);
                }
            }

            // Apply default filters (e.g., { type: 'blogs' } for categories)
            if (defaultFilters && Object.keys(defaultFilters).length > 0) {
                Object.entries(defaultFilters).forEach(([key, value]) => {
                    q = q.eq(key, value);
                });
            }

            if (debouncedQuery) {
                const searchCol = columns.find(c => c.key === 'title' || c.key === 'name')?.key || 'id';
                q = q.ilike(searchCol, `%${debouncedQuery}%`);
            }

            const from = (currentPage - 1) * itemsPerPage;
            const to = from + itemsPerPage - 1;

            const { data, count, error } = await q
                .range(from, to)
                .order(defaultSortColumn, { ascending: false });

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
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [currentPage, itemsPerPage, debouncedQuery, canView, showTrash, tableName, currentTenant?.id]);

    const handleEdit = (item) => {
        if (!checkAccess('update', permissionPrefix, item)) {
            toast({ variant: 'destructive', title: 'Access Denied', description: 'You can only edit your own content.' });
            return;
        }
        setSelectedItem(item);
        setShowEditor(true);
    };

    // Show delete confirmation dialog
    const handleDelete = (id, item) => {
        if (!checkAccess('soft_delete', permissionPrefix, item)) {
            toast({ variant: 'destructive', title: 'Access Denied', description: 'You do not have permission to delete this content.' });
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

            const { error } = await udm.from(tableName)
                .update({ deleted_at: deletedAt })
                .eq('id', itemToDelete.id);

            if (error) throw error;
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
            const { error } = await udm.from(tableName)
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

    const handlePermDelete = (item) => {
        if (!checkAccess('delete_permanent', permissionPrefix)) {
            toast({ variant: 'destructive', title: 'Access Denied', description: 'You generally do not have permission to permanently delete content.' });
            return;
        }
        setItemToPermDelete(item);
        setPermDeleteDialogOpen(true);
    };

    const confirmPermDelete = async () => {
        if (!itemToPermDelete) return;

        try {
            const { error } = await udm.from(tableName)
                .delete({ force: true })
                .eq('id', itemToPermDelete.id);

            if (error) throw error;
            toast({ title: 'Permanently Deleted', description: `${resourceName} has been permanently removed.` });

            fetchItems();
        } catch (err) {
            console.error('Permanent Delete error:', err);
            toast({ variant: 'destructive', title: 'Error', description: err.message });
        } finally {
            setPermDeleteDialogOpen(false);
            setItemToPermDelete(null);
        }
    };


    if (!canView) return (
        <div className="flex flex-col items-center justify-center min-h-[400px] bg-card rounded-xl border border-border p-12 text-center">
            <div className="p-4 bg-destructive/10 rounded-full mb-4">
                <ShieldAlert className="w-12 h-12 text-destructive" />
            </div>
            <h3 className="text-xl font-bold text-foreground">{t('common.access_denied')}</h3>
            <p className="text-muted-foreground mt-2">{t('common.permission_required_resource', { resource: resourceName })}</p>
        </div>
    );

    // Enhance columns with Owner info if available
    const displayColumns = [
        ...columns,
        {
            key: 'owner',
            label: t('common.owner'),
            render: (_, row) => (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <User className="w-3 h-3 text-muted-foreground" />
                    <span>{row.owner?.full_name || row.owner?.email || t('common.system')}</span>
                    {user?.id === row.created_by && <span className="bg-primary/10 text-primary px-1.5 rounded-full text-[10px] font-bold">{t('common.you')}</span>}
                </div>
            )
        }
    ];

    // Added Tenant Column for platform admins
    const isPlatformAdmin = hasPermission('manage_platform');
    if (isPlatformAdmin) {
        displayColumns.unshift({
            key: 'tenant_id',
            label: 'Nama Tenant',
            render: (_, row) => (
                <span className="text-xs font-medium text-muted-foreground bg-secondary px-2 py-0.5 rounded">
                    {row.tenant?.name || '(Unknown Tenant)'}
                </span>
            )
        });
    }

    const handleManualRefresh = async () => {
        await fetchItems();
        toast({ title: 'Refreshed', description: `Latest ${resourceName.toLowerCase()}s loaded.` });
    };

    return (
        <div className="space-y-6">
            {showEditor ? (
                EditorComponent ? (
                    <EditorComponent
                        item={selectedItem}
                        onClose={() => { setShowEditor(false); setSelectedItem(null); }}
                        onSuccess={fetchItems}
                    />
                ) : (
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
                )
            ) : (
                <>

                    {/* Enhanced Breadcrumb Navigation */}
                    {showBreadcrumbs && (
                        <nav className="mb-6">
                            <ol className="flex flex-wrap items-center gap-1.5 break-words text-sm text-muted-foreground sm:gap-2.5">
                                <li className="inline-flex items-center gap-1.5">
                                    <Link to="/cmspanel" className="transition-colors hover:text-foreground flex items-center gap-1">
                                        <Home className="w-4 h-4" />
                                        {t('menu.dashboard')}
                                    </Link>
                                </li>
                                <li aria-hidden="true" className="[&>svg]:size-3.5"><ChevronRight /></li>

                                <li className="inline-flex items-center gap-1.5">
                                    <div
                                        className={`flex items-center gap-1.5 px-3 py-1 rounded-full font-medium transition-colors ${showTrash
                                            ? 'bg-muted text-muted-foreground cursor-pointer hover:bg-muted/80'
                                            : 'bg-primary text-primary-foreground shadow-sm'
                                            }`}
                                        onClick={showTrash ? () => setShowTrash(false) : undefined}
                                    >
                                        <span>{resourceName}s</span>
                                    </div>
                                </li>

                                {showTrash && (
                                    <>
                                        <li aria-hidden="true" className="[&>svg]:size-3.5"><ChevronRight /></li>
                                        <li className="inline-flex items-center gap-1.5">
                                            <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-destructive text-destructive-foreground font-medium shadow-sm">
                                                <Trash2 className="w-3.5 h-3.5" />
                                                <span>{t('common.trash')}</span>
                                            </div>
                                        </li>
                                    </>
                                )}
                            </ol>
                        </nav>
                    )}
                    <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                        <div>
                            <h2 className="text-3xl font-bold tracking-tight text-foreground flex items-center gap-2">
                                {resourceName}s
                                {showTrash && <span className="text-lg font-normal text-destructive bg-destructive/10 px-2 py-0.5 rounded-md">{t('common.trash_bin')}</span>}
                            </h2>
                            <p className="text-muted-foreground">{t('common.manage_resource', { resource: resourceName.toLowerCase() })}</p>
                        </div>
                        <div className="flex gap-2">
                            {softDeleteEnabled && (
                                <Button
                                    variant={showTrash ? "destructive" : "outline"}
                                    onClick={() => { setShowTrash(!showTrash); setCurrentPage(1); }}
                                    className={showTrash ? "bg-destructive hover:bg-destructive/90" : ""}
                                >
                                    {showTrash ? <RotateCcw className="w-4 h-4 mr-2" /> : <Trash2 className="w-4 h-4 mr-2" />}
                                    {showTrash ? t('common.back_to_active') : t('common.trash')}
                                </Button>
                            )}

                            {/* Custom Toolbar Actions */}
                            {customToolbarActions && customToolbarActions({
                                openEditor: (data = null) => { setSelectedItem(data); setShowEditor(true); }
                            })}

                            {canCreate && !showTrash && (
                                <Button onClick={() => { setSelectedItem(null); setShowEditor(true); }} className="bg-primary text-primary-foreground hover:bg-primary/90">
                                    <Plus className="w-4 h-4 mr-2" /> {t('common.create_resource', { resource: resourceName })}
                                </Button>
                            )}
                        </div>
                    </div>

                    <div className="bg-card p-4 rounded-xl border border-border shadow-sm flex items-center gap-2">
                        <div className="flex-1 max-w-sm">
                            <MinCharSearchInput
                                value={query}
                                onChange={e => setQuery(e.target.value)}
                                onClear={clearSearch}
                                loading={loading || searchLoading}
                                isValid={isSearchValid}
                                message={searchMessage}
                                minLength={minLength}
                                placeholder={t('common.search_resource', { resource: resourceName })}
                            />
                        </div>
                        <div className="flex-1"></div>
                        <Button
                            variant="ghost"
                            size="icon"
                            onClick={handleManualRefresh}
                            disabled={loading}
                            title={t('common.refresh')}
                            className="text-muted-foreground hover:text-foreground disabled:opacity-50"
                        >
                            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                        </Button>
                    </div>

                    <ContentTable
                        data={items}
                        columns={displayColumns}
                        loading={loading}
                        // Dynamically check permissions for each row
                        onEdit={!showTrash ? (item) => {
                            if (checkAccess('update', permissionPrefix, item)) handleEdit(item);
                            else toast({ variant: 'destructive', title: 'Access Denied', description: 'You can only edit your own content.' });
                        } : null}

                        onDelete={!showTrash ? (item) => handleDelete(item.id, item) : null}

                        extraActions={(item) => (
                            <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
                                {customRowActions && customRowActions(item, {
                                    openEditor: (data) => { setSelectedItem(data || item); setShowEditor(true); }
                                })}
                                {showTrash && (
                                    <>
                                        {canRestore && (
                                            <Button size="icon" variant="ghost" onClick={() => handleRestore(item.id)} className="text-green-600 hover:bg-green-50" title={t('common.restore')}>
                                                <RotateCcw className="w-4 h-4" />
                                            </Button>
                                        )}
                                        {canPermDelete && (
                                            <Button size="icon" variant="ghost" onClick={() => handlePermDelete(item)} className="text-red-700 hover:bg-red-100" title="Permanently Delete">
                                                <div className="relative">
                                                    <Trash2 className="w-4 h-4" />
                                                    <span className="absolute -top-1 -right-1 text-[10px] font-bold">×</span>
                                                </div>
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
            )
            }

            {/* Delete Confirmation Dialog */}
            <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>{t('common.move_to_trash')}</AlertDialogTitle>
                        <AlertDialogDescription>
                            {t('common.move_to_trash_confirm', { resource: resourceName.toLowerCase() })}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel onClick={() => setItemToDelete(null)}>{t('common.cancel')}</AlertDialogCancel>
                        <AlertDialogAction onClick={confirmDelete} className="bg-red-600 hover:bg-red-700">
                            {t('common.delete')}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            {/* Permanent Delete Confirmation Dialog */}
            <AlertDialog open={permDeleteDialogOpen} onOpenChange={setPermDeleteDialogOpen}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle className="text-destructive">Permanently Delete?</AlertDialogTitle>
                        <AlertDialogDescription>
                            This action cannot be undone. This will permanently delete the <strong>{resourceName}</strong> from the database.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel onClick={() => setItemToPermDelete(null)}>{t('common.cancel')}</AlertDialogCancel>
                        <AlertDialogAction onClick={confirmPermDelete} className="bg-destructive hover:bg-destructive/90">
                            Delete Permanently
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

        </div >
    );
};

export default GenericContentManager;
