
import React, { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { Tag, Trash2, Search, Filter, RefreshCw, Edit, Plus, RotateCcw, CheckCircle, AlertCircle, SortAsc, SortDesc, X, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/use-toast';
import { supabase } from '@/lib/customSupabaseClient';
import { usePermissions } from '@/contexts/PermissionContext';
import { useTenant } from '@/contexts/TenantContext';
import { useSearch } from '@/hooks/useSearch';
import { Pagination } from '@/components/ui/pagination';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Label } from '@/components/ui/label';

const MODULES = [
    { value: 'all', label: 'All Modules' },
    { value: 'articles', label: 'Articles' },
    { value: 'pages', label: 'Pages' },
    { value: 'products', label: 'Products' },
    { value: 'portfolio', label: 'Portfolio' },
    { value: 'announcements', label: 'Announcements' },
    { value: 'promotions', label: 'Promotions' },
    { value: 'testimonies', label: 'Testimonials' },
    { value: 'photo_gallery', label: 'Photo Gallery' },
    { value: 'video_gallery', label: 'Video Gallery' },
    { value: 'contacts', label: 'Contacts' },
    { value: 'contact_messages', label: 'Messages' },
    { value: 'product_types', label: 'Product Types' },
];

function TagsManager() {
    const { toast } = useToast();
    const { hasPermission, userRole } = usePermissions();
    const { currentTenant } = useTenant();

    // Search
    const {
        query,
        setQuery,
        debouncedQuery,
        isValid: isSearchValid,
        message: searchMessage,
        loading: searchLoading,
        minLength,
        clearSearch
    } = useSearch({ context: 'admin' });

    // Data State
    const [rawTags, setRawTags] = useState([]);
    const [displayedTags, setDisplayedTags] = useState([]);
    const [loading, setLoading] = useState(true);

    // Filters State
    const [moduleFilter, setModuleFilter] = useState('all');
    const [activeFilter, setActiveFilter] = useState('all');
    const [showTrash, setShowTrash] = useState(false);

    // Sort State
    const [sortConfig, setSortConfig] = useState({ key: 'total_usage', direction: 'desc' });

    // Pagination State
    const [currentPage, setCurrentPage] = useState(1);
    const [itemsPerPage, setItemsPerPage] = useState(10);

    // Edit/Create State
    const [dialogOpen, setDialogOpen] = useState(false);
    const [editingTag, setEditingTag] = useState(null);
    const [formData, setFormData] = useState({
        name: '',
        slug: '',
        color: '#3b82f6',
        description: '',
        icon: '',
        is_active: true
    });
    const [saving, setSaving] = useState(false);

    // Permissions (using tenant.tag.* pattern)
    const isPlatformAdmin = userRole === 'super_admin' || userRole === 'owner';
    const canCreate = hasPermission('tenant.tag.create');
    const canEdit = hasPermission('tenant.tag.update');
    const canSoftDelete = hasPermission('tenant.tag.delete');
    const canRestore = hasPermission('tenant.tag.restore') || hasPermission('tenant.tag.delete');

    const fetchTags = useCallback(async () => {
        setLoading(true);
        try {
            let data = [];

            if (showTrash) {
                let trashQuery = supabase
                    .from('tags')
                    .select('*, tenant:tenants(name)')
                    .not('deleted_at', 'is', null);

                // Apply tenant filter for non-platform admins
                if (currentTenant?.id && !isPlatformAdmin) {
                    trashQuery = trashQuery.eq('tenant_id', currentTenant.id);
                }

                const { data: trashData, error } = await trashQuery;

                if (error) throw error;

                data = trashData.map(t => ({
                    id: t.id,
                    tag_id: t.id,
                    tag_name: t.name,
                    tag_slug: t.slug,
                    tag_color: t.color,
                    tag_icon: t.icon,
                    tag_description: t.description,
                    tag_is_active: t.is_active,
                    tag_created_at: t.created_at,
                    tag_updated_at: t.updated_at,
                    tenant_name: t.tenant?.name,
                    module: 'trash', // dummy
                    count: 0
                }));

            } else {
                // Regular View
                let tagsQuery = supabase
                    .from('tags')
                    .select('*, tenant:tenants(name)')
                    .is('deleted_at', null);

                // Apply tenant filter for non-platform admins
                if (currentTenant?.id && !isPlatformAdmin) {
                    tagsQuery = tagsQuery.eq('tenant_id', currentTenant.id);
                }

                const { data: allTags, error: tagsError } = await tagsQuery;

                if (tagsError) throw tagsError;

                // Then get usage stats
                const { data: usageData, error: usageError } = await supabase.rpc('get_detailed_tag_usage');
                if (usageError) throw usageError;

                // Merge: Create a base list from allTags
                const mergedMap = new Map();

                allTags.forEach(t => {
                    mergedMap.set(t.id, {
                        ...t,
                        tag_id: t.id,
                        tag_name: t.name,
                        tag_slug: t.slug,
                        tag_color: t.color,
                        tag_icon: t.icon,
                        tag_description: t.description,
                        tag_is_active: t.is_active,
                        tag_created_at: t.created_at,
                        tag_updated_at: t.updated_at,
                        tenant_name: t.tenant?.name,
                        count: 0,
                        modules: new Set(),
                        breakdown: {}
                    });
                });

                if (usageData) {
                    usageData.forEach(u => {
                        if (mergedMap.has(u.tag_id)) {
                            const tag = mergedMap.get(u.tag_id);
                            tag.count += parseInt(u.count);
                            tag.modules.add(u.module);
                            tag.breakdown[u.module] = (tag.breakdown[u.module] || 0) + parseInt(u.count);
                        }
                    });
                }

                data = Array.from(mergedMap.values()).map(t => ({
                    ...t,
                    modules: Array.from(t.modules)
                }));
            }

            setRawTags(data);

        } catch (error) {
            console.error(error);
            toast({
                variant: "destructive",
                title: "Error fetching tags",
                description: error.message
            });
        } finally {
            setLoading(false);
        }
    }, [showTrash, toast, currentTenant?.id, isPlatformAdmin]);

    useEffect(() => {
        fetchTags();
    }, [fetchTags]);

    useEffect(() => {
        let filtered = [...rawTags];

        if (debouncedQuery) {
            const lower = debouncedQuery.toLowerCase();
            filtered = filtered.filter(t =>
                t.tag_name?.toLowerCase().includes(lower) ||
                t.tag_slug?.toLowerCase().includes(lower) ||
                t.tag_description?.toLowerCase().includes(lower)
            );
        }

        if (!showTrash && moduleFilter !== 'all') {
            filtered = filtered.filter(t => t.modules && t.modules.includes(moduleFilter));
        }

        if (activeFilter !== 'all') {
            const isActive = activeFilter === 'active';
            filtered = filtered.filter(t => t.tag_is_active === isActive);
        }

        filtered.sort((a, b) => {
            let valA = a[sortConfig.key];
            let valB = b[sortConfig.key];

            if (sortConfig.key === 'total_usage') {
                valA = a.count || 0;
                valB = b.count || 0;
            } else if (sortConfig.key === 'name') {
                valA = a.tag_name?.toLowerCase();
                valB = b.tag_name?.toLowerCase();
            } else if (sortConfig.key === 'created_at') {
                valA = new Date(a.tag_created_at);
                valB = new Date(b.tag_created_at);
            } else if (sortConfig.key === 'updated_at') {
                valA = new Date(a.tag_updated_at);
                valB = new Date(b.tag_updated_at);
            }

            if (valA < valB) return sortConfig.direction === 'asc' ? -1 : 1;
            if (valA > valB) return sortConfig.direction === 'asc' ? 1 : -1;
            return 0;
        });

        setDisplayedTags(filtered);
    }, [rawTags, debouncedQuery, moduleFilter, activeFilter, sortConfig, showTrash]);

    const handleSort = (key) => {
        setSortConfig(current => ({
            key,
            direction: current.key === key && current.direction === 'asc' ? 'desc' : 'asc'
        }));
    };

    const handleDelete = async (id) => {
        if (!canSoftDelete) {
            toast({ variant: "destructive", title: "Action Denied", description: "You do not have permission to delete tags." });
            return;
        }

        const message = 'Are you sure? This tag will be moved to trash.';

        if (!window.confirm(message)) return;

        try {
            const { error } = await supabase
                .from('tags')
                .update({ deleted_at: new Date().toISOString() })
                .eq('id', id);
            if (error) throw error;

            toast({ title: "Success", description: "Tag moved to trash." });
            fetchTags();
        } catch (error) {
            toast({ variant: "destructive", title: "Error deleting tag", description: error.message });
        }
    };

    const handleRestore = async (id) => {
        if (!canRestore) {
            toast({ variant: "destructive", title: "Action Denied", description: "You do not have permission to restore tags." });
            return;
        }
        try {
            const { error } = await supabase
                .from('tags')
                .update({ deleted_at: null })
                .eq('id', id);

            if (error) throw error;
            toast({ title: "Success", description: "Tag restored." });
            fetchTags();
        } catch (error) {
            toast({ variant: "destructive", title: "Error restoring tag", description: error.message });
        }
    };

    const openModal = (tag = null) => {
        if (tag) {
            setEditingTag(tag);
            setFormData({
                name: tag.tag_name,
                slug: tag.tag_slug,
                color: tag.tag_color || '#3b82f6',
                description: tag.tag_description || '',
                icon: tag.tag_icon || '',
                is_active: tag.tag_is_active
            });
        } else {
            setEditingTag(null);
            setFormData({
                name: '',
                slug: '',
                color: '#3b82f6',
                description: '',
                icon: '',
                is_active: true
            });
        }
        setDialogOpen(true);
    };

    const handleSave = async () => {
        if (editingTag && !canEdit) {
            toast({ variant: "destructive", title: "Action Denied", description: "You do not have permission to edit tags." });
            return;
        }
        if (!editingTag && !canCreate) {
            toast({ variant: "destructive", title: "Action Denied", description: "You do not have permission to create tags." });
            return;
        }

        if (!formData.name) {
            toast({ variant: "destructive", title: "Validation Error", description: "Name is required" });
            return;
        }

        setSaving(true);
        try {
            const payload = {
                name: formData.name,
                slug: formData.slug || formData.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
                color: formData.color,
                description: formData.description,
                icon: formData.icon,
                is_active: formData.is_active,
                updated_at: new Date().toISOString()
            };

            if (editingTag) {
                const { error } = await supabase
                    .from('tags')
                    .update(payload)
                    .eq('id', editingTag.tag_id);
                if (error) throw error;
                toast({ title: "Success", description: "Tag updated successfully" });
            } else {
                // Always use current tenant context for new tags
                const insertPayload = {
                    ...payload,
                    tenant_id: currentTenant?.id
                };
                const { error } = await supabase
                    .from('tags')
                    .insert([insertPayload]);
                if (error) throw error;
                toast({ title: "Success", description: "New tag created successfully" });
            }

            setDialogOpen(false);
            fetchTags();
        } catch (error) {
            console.error(error);
            toast({ variant: "destructive", title: "Error saving tag", description: error.message });
        } finally {
            setSaving(false);
        }
    };

    // Pagination Logic
    const totalPages = Math.ceil(displayedTags.length / itemsPerPage);
    const currentData = displayedTags.slice(
        (currentPage - 1) * itemsPerPage,
        currentPage * itemsPerPage
    );

    return (
        <div className="space-y-6">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-card p-6 rounded-xl border border-border shadow-sm">
                <div>
                    <h2 className="text-3xl font-bold text-foreground flex items-center gap-2">
                        Tags Manager {showTrash && <span className="text-destructive text-lg font-normal bg-destructive/10 px-2 rounded">(Trash)</span>}
                    </h2>
                    <p className="text-muted-foreground mt-1">Manage content tags, colors, and view usage statistics across the system.</p>
                </div>
                <div className="flex flex-wrap gap-3">
                    {(canSoftDelete || showTrash) && (
                        <Button
                            variant={showTrash ? "destructive" : "outline"}
                            onClick={() => { setShowTrash(!showTrash); setCurrentPage(1); }}
                            className={showTrash ? "bg-destructive hover:bg-destructive/90 text-destructive-foreground" : "text-muted-foreground hover:text-foreground"}
                        >
                            {showTrash ? "View Active Tags" : "Trash / Deleted"}
                            <Trash2 className="w-4 h-4 ml-2" />
                        </Button>
                    )}

                    {!showTrash && canCreate && (
                        <Button onClick={() => openModal(null)} className="bg-primary text-primary-foreground hover:bg-primary/90">
                            <Plus className="w-4 h-4 mr-2" /> Create Tag
                        </Button>
                    )}
                </div>
            </div>

            <div className="flex flex-col lg:flex-row gap-4 bg-card p-4 rounded-xl border border-border shadow-sm">
                <div className="relative flex-1">
                    <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input
                        placeholder={`Search tags... (${minLength}+ chars)`}
                        value={query}
                        onChange={e => { setQuery(e.target.value); setCurrentPage(1); }}
                        className={`pl-9 pr-24 bg-background ${!isSearchValid ? 'border-destructive focus:ring-destructive' : ''}`}
                    />
                    <div className="absolute right-3 top-2.5 flex items-center gap-2">
                        {(loading || searchLoading) && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
                        {query && (
                            <button onClick={() => { clearSearch(); setCurrentPage(1); }} className="text-muted-foreground hover:text-foreground">
                                <X className="h-4 w-4" />
                            </button>
                        )}
                        <span className={`text-xs font-mono ${query.length > 0 && query.length < minLength ? 'text-destructive font-bold' : 'text-muted-foreground'}`}>
                            {query.length}/{minLength}
                        </span>
                    </div>
                    {!isSearchValid && (
                        <div className="absolute top-full left-0 mt-1 text-xs text-destructive font-medium animate-in slide-in-from-top-1 px-1">
                            {searchMessage}
                        </div>
                    )}
                </div>

                {!showTrash && (
                    <div className="flex flex-col sm:flex-row gap-3">
                        <div className="relative w-full sm:w-48">
                            <Filter className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                            <select
                                value={moduleFilter}
                                onChange={(e) => { setModuleFilter(e.target.value); setCurrentPage(1); }}
                                className="flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm pl-9 appearance-none focus:ring-2 focus:ring-ring"
                            >
                                {MODULES.map(m => (
                                    <option key={m.value} value={m.value}>{m.label}</option>
                                ))}
                            </select>
                        </div>
                        <div className="relative w-full sm:w-40">
                            <CheckCircle className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                            <select
                                value={activeFilter}
                                onChange={(e) => { setActiveFilter(e.target.value); setCurrentPage(1); }}
                                className="flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm pl-9 appearance-none focus:ring-2 focus:ring-ring"
                            >
                                <option value="all">All Status</option>
                                <option value="active">Active</option>
                                <option value="inactive">Inactive</option>
                            </select>
                        </div>
                    </div>
                )}

                <Button variant="ghost" size="icon" onClick={fetchTags} title="Refresh Data" className="text-muted-foreground hover:text-foreground">
                    <RefreshCw className="w-4 h-4" />
                </Button>
            </div>

            <div className="bg-card rounded-xl shadow-sm border border-border overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full">
                        <thead className="bg-muted/50 border-b border-border">
                            <tr>
                                {isPlatformAdmin && <th className="px-6 py-4 text-left text-xs font-bold text-muted-foreground uppercase">Nama Tenant</th>}
                                <th
                                    className="px-6 py-4 text-left text-xs font-bold text-muted-foreground uppercase cursor-pointer hover:text-foreground group"
                                    onClick={() => handleSort('name')}
                                >
                                    <div className="flex items-center gap-1">
                                        Tag Details
                                        {sortConfig.key === 'name' && (sortConfig.direction === 'asc' ? <SortAsc className="w-3 h-3" /> : <SortDesc className="w-3 h-3" />)}
                                    </div>
                                </th>
                                <th className="px-6 py-4 text-left text-xs font-bold text-muted-foreground uppercase">Color</th>
                                {!showTrash && <th className="px-6 py-4 text-left text-xs font-bold text-muted-foreground uppercase">Usage Breakdown</th>}
                                <th
                                    className="px-6 py-4 text-center text-xs font-bold text-muted-foreground uppercase cursor-pointer hover:text-foreground"
                                    onClick={() => handleSort('total_usage')}
                                >
                                    <div className="flex items-center justify-center gap-1">
                                        Total Usage
                                        {sortConfig.key === 'total_usage' && (sortConfig.direction === 'asc' ? <SortAsc className="w-3 h-3" /> : <SortDesc className="w-3 h-3" />)}
                                    </div>
                                </th>
                                <th className="px-6 py-4 text-center text-xs font-bold text-muted-foreground uppercase">Status</th>
                                <th className="px-6 py-4 text-right text-xs font-bold text-muted-foreground uppercase">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                            {loading ? (
                                <tr><td colSpan="6" className="p-12 text-center text-slate-500">
                                    <div className="flex flex-col items-center gap-2">
                                        <RefreshCw className="w-6 h-6 animate-spin text-blue-500" />
                                        <span>Loading tags...</span>
                                    </div>
                                </td></tr>
                            ) : currentData.length === 0 ? (
                                <tr><td colSpan="6" className="p-12 text-center text-slate-500">
                                    <div className="flex flex-col items-center gap-2">
                                        <AlertCircle className="w-8 h-8 text-slate-300" />
                                        <span>No tags found matching your criteria.</span>
                                    </div>
                                </td></tr>
                            ) : (
                                currentData.map((tag) => (
                                    <motion.tr
                                        key={tag.tag_id}
                                        initial={{ opacity: 0 }}
                                        animate={{ opacity: 1 }}
                                        className="hover:bg-muted/50 transition-colors"
                                    >
                                        {isPlatformAdmin && (
                                            <td className="px-6 py-4">
                                                <span className="text-xs font-medium text-slate-600 bg-slate-100 px-2 py-0.5 rounded">
                                                    {tag.tenant_name || '(Unknown Tenant)'}
                                                </span>
                                            </td>
                                        )}
                                        <td className="px-6 py-4">
                                            <div className="flex flex-col">
                                                <div className="flex items-center gap-2">
                                                    <Tag className="w-4 h-4 text-muted-foreground" />
                                                    <span className="font-medium text-foreground">{tag.tag_name}</span>
                                                </div>
                                                <span className="text-xs text-muted-foreground pl-6">{tag.tag_slug}</span>
                                                {tag.tag_description && <span className="text-xs text-muted-foreground pl-6 mt-1 truncate max-w-[200px]">{tag.tag_description}</span>}
                                            </div>
                                        </td>
                                        <td className="px-6 py-4">
                                            <div className="flex items-center gap-2 group relative">
                                                <div className="w-6 h-6 rounded-full border border-border shadow-sm transition-transform hover:scale-110 cursor-help" style={{ backgroundColor: tag.tag_color }} />
                                                <span className="text-xs text-muted-foreground font-mono opacity-0 group-hover:opacity-100 transition-opacity absolute left-8 bg-card border border-border px-1 rounded shadow-sm z-10">
                                                    {tag.tag_color}
                                                </span>
                                            </div>
                                        </td>
                                        {!showTrash && (
                                            <td className="px-6 py-4">
                                                <div className="flex flex-wrap gap-1 max-w-[250px]">
                                                    {Object.entries(tag.breakdown || {}).slice(0, 4).map(([mod, count]) => (
                                                        <span key={mod} className="text-[10px] uppercase bg-secondary text-secondary-foreground px-1.5 py-0.5 rounded border border-border flex items-center gap-1">
                                                            {mod.replace('_', ' ').slice(0, 8)}
                                                            <span className="bg-background px-1 rounded-full text-[9px] font-bold">{count}</span>
                                                        </span>
                                                    ))}
                                                    {Object.keys(tag.breakdown || {}).length > 4 && (
                                                        <span className="text-[10px] bg-muted text-muted-foreground px-2 py-0.5 rounded">+{Object.keys(tag.breakdown).length - 4} more</span>
                                                    )}
                                                </div>
                                            </td>
                                        )}
                                        <td className="px-6 py-4 text-center">
                                            <span className={`inline-flex items-center justify-center px-2.5 py-0.5 rounded-full text-xs font-medium ${tag.count > 0 ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'
                                                }`}>
                                                {tag.count || 0} uses
                                            </span>
                                        </td>
                                        <td className="px-6 py-4 text-center">
                                            {tag.tag_is_active ? (
                                                <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-500/10 text-green-600 dark:text-green-400 border border-green-500/20">Active</span>
                                            ) : (
                                                <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-muted text-muted-foreground border border-border">Inactive</span>
                                            )}
                                        </td>
                                        <td className="px-6 py-4 text-right">
                                            <div className="flex justify-end gap-1">
                                                {showTrash ? (
                                                    <>
                                                        {canRestore && (
                                                            <Button variant="ghost" size="icon" onClick={() => handleRestore(tag.tag_id)} className="text-green-600 hover:text-green-700 hover:bg-green-50" title="Restore">
                                                                <RotateCcw className="w-4 h-4" />
                                                            </Button>
                                                        )}
                                                    </>
                                                ) : (
                                                    <>
                                                        {canEdit && (
                                                            <Button variant="ghost" size="icon" onClick={() => openModal(tag)} className="text-muted-foreground hover:text-primary hover:bg-primary/10">
                                                                <Edit className="w-4 h-4" />
                                                            </Button>
                                                        )}
                                                        {canSoftDelete && (
                                                            <Button variant="ghost" size="icon" onClick={() => handleDelete(tag.tag_id)} className="text-muted-foreground hover:text-destructive hover:bg-destructive/10">
                                                                <Trash2 className="w-4 h-4" />
                                                            </Button>
                                                        )}
                                                    </>
                                                )}
                                            </div>
                                        </td>
                                    </motion.tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {displayedTags.length > 0 && (
                <div className="flex flex-col sm:flex-row justify-between items-center gap-4 px-2">
                    <div className="text-sm text-muted-foreground">
                        Showing <span className="font-medium text-foreground">{((currentPage - 1) * itemsPerPage) + 1}</span> to <span className="font-medium text-foreground">{Math.min(currentPage * itemsPerPage, displayedTags.length)}</span> of <span className="font-medium text-foreground">{displayedTags.length}</span> items
                    </div>
                    <div className="flex items-center gap-4">
                        <select
                            className="h-8 rounded-md border border-input bg-background text-sm text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                            value={itemsPerPage}
                            onChange={(e) => { setItemsPerPage(Number(e.target.value)); setCurrentPage(1); }}
                        >
                            <option value={10}>10 / page</option>
                            <option value={20}>20 / page</option>
                            <option value={50}>50 / page</option>
                            <option value={100}>100 / page</option>
                        </select>
                        <Pagination
                            currentPage={currentPage}
                            totalPages={totalPages}
                            onPageChange={setCurrentPage}
                        />
                    </div>
                </div>
            )}

            {/* Create/Edit Dialog */}
            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                <DialogContent className="sm:max-w-[500px]">
                    <DialogHeader>
                        <DialogTitle>{editingTag ? 'Edit Tag' : 'Create New Tag'}</DialogTitle>
                        <DialogDescription>
                            {editingTag ? 'Update tag details. Changes reflect across all modules immediately.' : 'Create a new tag to categorize content.'}
                        </DialogDescription>
                    </DialogHeader>
                    <div className="grid gap-4 py-4">
                        <div className="grid grid-cols-4 items-center gap-4">
                            <Label htmlFor="name" className="text-right">Name <span className="text-destructive">*</span></Label>
                            <Input
                                id="name"
                                value={formData.name}
                                onChange={(e) => {
                                    setFormData(prev => ({
                                        ...prev,
                                        name: e.target.value,
                                        slug: !editingTag ? e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, '-') : prev.slug
                                    }))
                                }}
                                className="col-span-3"
                                placeholder="e.g. Technology"
                            />
                        </div>
                        <div className="grid grid-cols-4 items-center gap-4">
                            <Label htmlFor="slug" className="text-right">Slug</Label>
                            <Input
                                id="slug"
                                value={formData.slug}
                                onChange={(e) => setFormData(prev => ({ ...prev, slug: e.target.value }))}
                                className="col-span-3"
                                placeholder="e.g. technology"
                            />
                        </div>
                        <div className="grid grid-cols-4 items-center gap-4">
                            <Label htmlFor="description" className="text-right">Description</Label>
                            <Input
                                id="description"
                                value={formData.description}
                                onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
                                className="col-span-3"
                            />
                        </div>
                        <div className="grid grid-cols-4 items-center gap-4">
                            <Label htmlFor="color" className="text-right">Color</Label>
                            <div className="col-span-3 flex gap-2">
                                <Input
                                    id="color"
                                    type="color"
                                    value={formData.color}
                                    onChange={(e) => setFormData(prev => ({ ...prev, color: e.target.value }))}
                                    className="w-12 h-10 p-1 cursor-pointer bg-transparent border-input"
                                />
                                <Input
                                    value={formData.color}
                                    onChange={(e) => setFormData(prev => ({ ...prev, color: e.target.value }))}
                                    className="font-mono uppercase"
                                />
                            </div>
                        </div>
                        <div className="grid grid-cols-4 items-center gap-4">
                            <Label htmlFor="is_active" className="text-right">Status</Label>
                            <div className="col-span-3 flex items-center gap-2">
                                <input
                                    type="checkbox"
                                    id="is_active"
                                    checked={formData.is_active}
                                    onChange={(e) => setFormData(prev => ({ ...prev, is_active: e.target.checked }))}
                                    className="h-4 w-4 rounded border-input text-primary focus:ring-primary bg-background"
                                />
                                <Label htmlFor="is_active" className="font-normal text-muted-foreground">Active (Visible in selectors)</Label>
                            </div>
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
                        <Button onClick={handleSave} disabled={saving} className="bg-primary text-primary-foreground hover:bg-primary/90">
                            {saving ? 'Saving...' : 'Save Changes'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}

export default TagsManager;
