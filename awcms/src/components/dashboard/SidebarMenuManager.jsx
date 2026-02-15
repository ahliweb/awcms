
import { useState, useEffect, useMemo } from 'react';
import { Reorder, AnimatePresence } from 'framer-motion';
import { Helmet } from 'react-helmet-async';
import {
    GripVertical, Eye, EyeOff, Edit2, Save, RefreshCw,
    Settings2, ShieldAlert, FolderOpen, Puzzle, Plus
} from 'lucide-react';
import { useAdminMenu } from '@/hooks/useAdminMenu';
import { supabase } from '@/lib/customSupabaseClient';
import { usePermissions } from '@/contexts/PermissionContext';
import { useTenant } from '@/contexts/TenantContext';
import { usePlugins } from '@/contexts/PluginContext';
import { useSearch } from '@/hooks/useSearch';
import { getIconComponent } from '@/lib/adminIcons';
import { filterMenuItemsForSidebar } from '@/lib/adminMenuUtils';
import { Button } from '@/components/ui/button';
import { useTranslation } from 'react-i18next';
import { Input } from '@/components/ui/input';
import MinCharSearchInput from '@/components/common/MinCharSearchInput';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/components/ui/use-toast';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
    DialogDescription,
} from "@/components/ui/dialog";
import { Label } from '@/components/ui/label';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { AdminPageLayout, PageHeader } from '@/templates/flowbite-admin';

function SidebarMenuManager() {
    const { t } = useTranslation();
    const { menuItems, loading, updateMenuOrder, toggleVisibility, updateMenuItem, updateGroup, fetchMenu } = useAdminMenu();
    const { hasPermission, isPlatformAdmin, isFullAccess, userRole, loading: permsLoading } = usePermissions();
    const { currentTenant } = useTenant();
    const { applyFilters } = usePlugins();
    const { toast } = useToast();

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

    const [items, setItems] = useState([]);
    const [activeTab, setActiveTab] = useState('items');

    // Groups Management State
    const [groups, setGroups] = useState([]);
    const [editingGroup, setEditingGroup] = useState(null);
    const [groupEditForm, setGroupEditForm] = useState({ label: '', order: 0 });
    const [isSaving, setIsSaving] = useState(false);
    const [hasChanges, setHasChanges] = useState(false);

    // New Group Dialog State
    const [showNewGroupDialog, setShowNewGroupDialog] = useState(false);
    const [newGroupForm, setNewGroupForm] = useState({ label: '', order: 100 });

    // Edit Dialog State
    const [editingItem, setEditingItem] = useState(null);
    const [editForm, setEditForm] = useState({
        label: '',
        group_label: 'General',
        group_order: 0
    });

    const canView = hasPermission('platform.sidebar.read');
    const canEdit = hasPermission('platform.sidebar.update');
    const isSuperAdmin = isPlatformAdmin || isFullAccess;

    const visibleItems = useMemo(() => filterMenuItemsForSidebar({
        items: menuItems,
        hasPermission,
        isPlatformAdmin,
        isFullAccess,
        subscriptionTier: currentTenant?.subscription_tier,
        applyFilters,
        userRole
    }), [
        menuItems,
        hasPermission,
        isPlatformAdmin,
        isFullAccess,
        currentTenant?.subscription_tier,
        applyFilters,
        userRole
    ]);

    useEffect(() => {
        const sourceItems = visibleItems;

        const uniqueGroups = [];
        const seen = new Set();
        const groupSources = new Map();

        sourceItems.forEach(item => {
            const sources = groupSources.get(item.group_label) || new Set();
            if (item.source === 'extension') {
                sources.add('extension');
            } else if (item.source === 'plugin') {
                sources.add('plugin');
            } else {
                sources.add('core');
            }
            groupSources.set(item.group_label, sources);
        });

        sourceItems.forEach(item => {
            if (!seen.has(item.group_label)) {
                seen.add(item.group_label);
                const sources = groupSources.get(item.group_label) || new Set();
                const isExtension = sources.size === 1 && sources.has('extension');
                const isPlugin = sources.size === 1 && sources.has('plugin');
                uniqueGroups.push({
                    id: item.group_label,
                    label: item.group_label,
                    order: item.group_order || 999,
                    isExtension,
                    isPlugin
                });
            }
        });

        uniqueGroups.sort((a, b) => a.order - b.order);
        setGroups(uniqueGroups);
        setItems(sourceItems);
    }, [visibleItems]);


    const handleGroupReorder = (newOrder) => {
        if (!canEdit && !isSuperAdmin) return;
        setGroups(newOrder);
        setHasChanges(true);
    };

    const handleSaveGroupOrder = async () => {
        if (!canEdit && !isSuperAdmin) return;
        setIsSaving(true);
        try {
            // We need to update *all* items in each group to reflect the new group_order
            for (let i = 0; i < groups.length; i++) {
                const group = groups[i];
                await updateGroup(group.label, { newOrder: (i + 1) * 10 });
            }

            toast({ title: t('common.success'), description: t('sidebar_manager.toast.group_order_updated') });
            setHasChanges(false);
            fetchMenu(); // Refresh to get consistent state
        } catch {
            toast({ variant: 'destructive', title: t('common.error'), description: t('sidebar_manager.toast.error_save_group') });
        } finally {
            setIsSaving(false);
        }
    };

    const handleEditGroup = (group) => {
        setEditingGroup(group);
        setGroupEditForm({ label: group.label, order: group.order });
    };

    const saveGroupEdit = async () => {
        if (!editingGroup) return;
        try {
            await updateGroup(editingGroup.label, {
                newLabel: groupEditForm.label,
                newOrder: parseInt(groupEditForm.order)
            });
            setEditingGroup(null);
            toast({ title: t('common.success'), description: t('sidebar_manager.toast.group_updated') });
            fetchMenu();
        } catch {
            toast({ variant: 'destructive', title: t('common.error'), description: t('sidebar_manager.toast.error_update_group') });
        }
    };

    const handleCreateGroup = async () => {
        if (!newGroupForm.label.trim()) return;

        try {
            // To create a group, we create a placeholder menu item with that group
            // This will be a hidden item that just establishes the group
            const groupKey = newGroupForm.label.toLowerCase().replace(/\s+/g, '_');

            const { error } = await supabase
                .from('admin_menus')
                .insert({
                    key: `group_placeholder_${groupKey}`,
                    label: `[${newGroupForm.label} Placeholder]`,
                    path: '',
                    icon: 'FolderOpen',
                    permission: 'super_admin_only', // Hidden from non-platform admins
                    group_label: newGroupForm.label.toUpperCase(),
                    group_order: parseInt(newGroupForm.order) || 100,
                    order: 9999, // At the end of the group
                    is_visible: false, // Hidden placeholder
                    created_at: new Date().toISOString(),
                    updated_at: new Date().toISOString()
                });

            if (error) throw error;

            setShowNewGroupDialog(false);
            toast({ title: t('common.success'), description: t('sidebar_manager.toast.group_created', { name: newGroupForm.label }) });
            fetchMenu(); // Refresh to show new group
        } catch (err) {
            console.error('Error creating group:', err);
            toast({ variant: 'destructive', title: t('common.error'), description: t('sidebar_manager.toast.error_create_group') });
        }
    };

    const handleReorder = (newOrder) => {
        if (!canEdit && !isSuperAdmin) return;
        setItems(newOrder);
        setHasChanges(true);
    };

    const handleSaveOrder = async () => {
        if (!canEdit && !isSuperAdmin) {
            toast({ variant: 'destructive', title: t('sidebar_manager.toast.permission_denied'), description: t('sidebar_manager.toast.permission_desc') });
            return;
        }
        setIsSaving(true);
        try {
            await updateMenuOrder(items);
            setHasChanges(false);
            toast({ title: t('common.success'), description: t('sidebar_manager.toast.menu_order_updated') });
        } catch {
            toast({ variant: 'destructive', title: t('common.error'), description: t('sidebar_manager.toast.error_save_order') });
        } finally {
            setIsSaving(false);
        }
    };

    const handleToggleVisibility = async (e, item) => {
        e.stopPropagation();
        if (!canEdit && !isSuperAdmin) {
            toast({ variant: 'destructive', title: t('sidebar_manager.toast.permission_denied'), description: t('sidebar_manager.toast.permission_desc') });
            return;
        }
        try {
            await toggleVisibility(item.id, item.is_visible);
            setItems(prev => prev.map(i => i.id === item.id ? { ...i, is_visible: !i.is_visible } : i));
            toast({ title: item.is_visible ? t('sidebar_manager.hidden') : t('sidebar_manager.visible'), description: t('sidebar_manager.toast.visibility_updated', { status: item.is_visible ? t('sidebar_manager.hidden') : t('sidebar_manager.visible') }) });
        } catch {
            toast({ variant: 'destructive', title: t('common.error'), description: t('sidebar_manager.toast.error_visibility') });
        }
    };

    const handleEdit = (item) => {
        if (!canEdit && !isSuperAdmin) {
            toast({ variant: 'destructive', title: t('sidebar_manager.toast.permission_denied'), description: t('sidebar_manager.toast.permission_desc') });
            return;
        }
        setEditingItem(item);
        setEditForm({
            label: item.label,
            group_label: item.group_label || 'General',
            group_order: item.group_order || 0
        });
    };

    const saveEdit = async () => {
        if (!editingItem) return;
        try {
            await updateMenuItem(editingItem.id, {
                label: editForm.label,
                group_label: editForm.group_label,
                group_order: parseInt(editForm.group_order) || 0
            });

            // Update local state
            setItems(prev => prev.map(i => i.id === editingItem.id ? {
                ...i,
                label: editForm.label,
                group_label: editForm.group_label,
                group_order: parseInt(editForm.group_order) || 0
            } : i));

            setEditingItem(null);
            toast({ title: t('common.success'), description: t('sidebar_manager.toast.item_updated') });
        } catch {
            toast({ variant: 'destructive', title: t('common.error'), description: t('sidebar_manager.toast.error_update_item') });
        }
    };

    const filteredItems = items.filter(item =>
        !debouncedQuery ||
        item.label.toLowerCase().includes(debouncedQuery.toLowerCase()) ||
        item.key.toLowerCase().includes(debouncedQuery.toLowerCase()) ||
        (item.group_label || '').toLowerCase().includes(debouncedQuery.toLowerCase())
    );

    // Derive unique groups for autocomplete suggestion (optional)
    const existingGroups = [...new Set(items.map(i => i.group_label || 'General'))].sort();

    if (permsLoading) {
        return <div className="p-8 text-center text-slate-500">Checking permissions...</div>;
    }

    if (!canView && !isSuperAdmin) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[400px] bg-card rounded-xl border border-border p-12 text-center">
                <div className="p-4 bg-destructive/10 rounded-full mb-4">
                    <ShieldAlert className="w-12 h-12 text-destructive" />
                </div>
                <h3 className="text-xl font-bold text-foreground">{t('sidebar_manager.access_restricted.title')}</h3>
                <p className="text-muted-foreground mt-2">{t('sidebar_manager.access_restricted.desc')}</p>
            </div>
        );
    }

    return (
        <AdminPageLayout requiredPermission="platform.sidebar.read">
            <Helmet>
                <title>{t('sidebar_manager.title')} - CMS</title>
            </Helmet>

            <PageHeader
                title={t('sidebar_manager.title')}
                description={t('sidebar_manager.subtitle')}
                icon={Settings2}
                breadcrumbs={[{ label: t('sidebar_manager.breadcrumbs'), icon: Settings2 }]}
                actions={(
                    <div className="flex items-center gap-3">
                        <Button variant="outline" onClick={() => fetchMenu()} disabled={loading}>
                            <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
                            {t('sidebar_manager.refresh')}
                        </Button>
                        {hasChanges && (
                            <Button onClick={handleSaveOrder} disabled={isSaving}>
                                <Save className="w-4 h-4 mr-2" />
                                {isSaving ? t('sidebar_manager.saving') : t('sidebar_manager.save_order')}
                            </Button>
                        )}
                    </div>
                )}
            />

            <div>

                {/* Main Content */}
                <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
                    <div className="flex justify-between items-center mb-4">
                        <TabsList>
                            <TabsTrigger value="items">{t('sidebar_manager.tabs.items')}</TabsTrigger>
                            <TabsTrigger value="groups">{t('sidebar_manager.tabs.groups')}</TabsTrigger>
                        </TabsList>
                    </div>

                    <TabsContent value="items" className="space-y-4">
                        <div className="bg-card rounded-xl border border-border shadow-sm flex flex-col min-h-[500px]">
                            <div className="p-4 border-b border-border flex items-center justify-between bg-muted/30">
                                <div className="w-full max-w-sm">
                                    <MinCharSearchInput
                                        value={query}
                                        onChange={e => setQuery(e.target.value)}
                                        onClear={clearSearch}
                                        loading={loading || searchLoading}
                                        isValid={isSearchValid}
                                        message={searchMessage}
                                        minLength={minLength}
                                        placeholder={t('sidebar_manager.search_placeholder')}
                                    />
                                </div>
                                <div className="text-sm text-muted-foreground">
                                    {t('sidebar_manager.items_found', { count: filteredItems.length })}
                                </div>
                            </div>

                            <div className="flex-1 p-6">
                                {loading && items.length === 0 ? (
                                    <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
                                        <RefreshCw className="w-8 h-8 animate-spin mb-2" />
                                        <p>{t('sidebar_manager.loading_config')}</p>
                                    </div>
                                ) : (
                                    <Reorder.Group axis="y" values={items} onReorder={handleReorder} className="space-y-2">
                                        <AnimatePresence>
                                            {filteredItems.map(item => {
                                                const Icon = getIconComponent(item.icon);
                                                return (
                                                    <Reorder.Item
                                                        key={item.id}
                                                        value={item}
                                                        dragListener={canEdit || isSuperAdmin}
                                                        className={`
                                                flex items - center gap - 4 p - 3 rounded - lg border
bg - card shadow - sm transition - all
                                                ${item.is_visible ? 'border-border' : 'border-border bg-muted/30 opacity-75'}
                                                ${(canEdit || isSuperAdmin) ? 'hover:shadow-md cursor-grab active:cursor-grabbing hover:border-primary/50' : 'cursor-default'}
`}
                                                    >
                                                        {(canEdit || isSuperAdmin) ? (
                                                            <div className="text-muted-foreground hover:text-foreground p-1">
                                                                <GripVertical className="w-5 h-5" />
                                                            </div>
                                                        ) : (
                                                            <div className="w-5 h-5" />
                                                        )}

                                                        <div className={`p - 2 rounded - md ${item.is_visible ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'} `}>
                                                            <Icon className="w-5 h-5" />
                                                        </div>

                                                        <div className="flex-1 min-w-0">
                                                            <div className="flex items-center gap-2 mb-1">
                                                                <span className={`font - medium ${item.is_visible ? 'text-foreground' : 'text-muted-foreground line-through'} truncate`}>
                                                                    {item.label}
                                                                </span>
                                                                <Badge variant="outline" className="text-[10px] font-mono text-muted-foreground">
                                                                    {item.key}
                                                                </Badge>
                                                            </div>
                                                            <div className="flex items-center gap-2 text-xs">
                                                                <div className="flex items-center gap-1 text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                                                                    <FolderOpen className="w-3 h-3" />
                                                                    <span className="truncate max-w-[100px]">{item.group_label || 'General'}</span>
                                                                </div>
                                                                {item.permission && (
                                                                    <span className="flex items-center text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded border border-amber-100 dark:bg-amber-900/10 dark:text-amber-500 dark:border-amber-900/20">
                                                                        <Settings2 className="w-3 h-3 mr-1" />
                                                                        {item.permission}
                                                                    </span>
                                                                )}
                                                                {item.source === 'extension' && (
                                                                    <span className="flex items-center text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded border border-indigo-100 dark:bg-indigo-900/10 dark:text-indigo-400 dark:border-indigo-900/20">
                                                                        <Puzzle className="w-3 h-3 mr-1" />
                                                                        {t('sidebar_manager.module')}
                                                                    </span>
                                                                )}
                                                                {(item.plugin_type === 'core' || item.is_core) && (
                                                                    <span className="flex items-center text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-100 dark:bg-emerald-900/10 dark:text-emerald-400 dark:border-emerald-900/20">
                                                                        <Puzzle className="w-3 h-3 mr-1" />
                                                                        {t('sidebar_manager.core')}
                                                                    </span>
                                                                )}
                                                            </div>
                                                        </div>

                                                        <div className="flex items-center gap-2">
                                                            {(canEdit || isSuperAdmin) && (
                                                                <Button
                                                                    variant="ghost"
                                                                    size="sm"
                                                                    onClick={() => handleEdit(item)}
                                                                    disabled={item.source === 'extension'}
                                                                    className={`text - muted - foreground ${item.source === 'extension' ? 'opacity-50 cursor-not-allowed' : 'hover:text-primary'} `}
                                                                    title={item.source === 'extension' ? t('sidebar_manager.managed_by_ext') : t('sidebar_manager.edit_item')}
                                                                >
                                                                    <Edit2 className="w-4 h-4" />
                                                                </Button>
                                                            )}

                                                            <div className="flex items-center gap-2 border-l border-border pl-2">
                                                                <Label htmlFor={`visible - ${item.id} `} className="sr-only">Visibility</Label>
                                                                <Switch
                                                                    id={`visible - ${item.id} `}
                                                                    checked={item.is_visible}
                                                                    disabled={!canEdit && !isSuperAdmin}
                                                                    onCheckedChange={() => handleToggleVisibility({ stopPropagation: () => { } }, item)}
                                                                />
                                                                {item.is_visible ? (
                                                                    <Eye className="w-4 h-4 text-muted-foreground" />
                                                                ) : (
                                                                    <EyeOff className="w-4 h-4 text-muted-foreground/50" />
                                                                )}
                                                            </div>
                                                        </div>
                                                    </Reorder.Item>
                                                );
                                            })}
                                        </AnimatePresence>
                                    </Reorder.Group>
                                )}
                            </div>
                        </div>
                    </TabsContent>

                    <TabsContent value="groups" className="space-y-4">
                        <div className="bg-card rounded-xl border border-border shadow-sm flex flex-col min-h-[500px]">
                            <div className="p-4 border-b border-border flex items-center justify-between bg-muted/30">
                                <div>
                                    <h3 className="text-sm font-medium text-foreground">{t('sidebar_manager.tabs.groups')}</h3>
                                    <p className="text-xs text-muted-foreground">{t('sidebar_manager.subtitle')}</p>
                                </div>
                                {/* Show Save Button specific to Groups tab if changes exist */}
                                {hasChanges && activeTab === 'groups' && (
                                    <Button onClick={handleSaveGroupOrder} disabled={isSaving} size="sm">
                                        <Save className="w-4 h-4 mr-2" />
                                        {isSaving ? t('sidebar_manager.saving') : t('sidebar_manager.save_group_order')}
                                    </Button>
                                )}
                                {(canEdit || isSuperAdmin) && (
                                    <Button
                                        onClick={() => {
                                            setNewGroupForm({ label: '', order: (groups.length + 1) * 10 });
                                            setShowNewGroupDialog(true);
                                        }}
                                        size="sm"
                                        variant="outline"
                                        className="border-green-600/30 text-green-600 hover:bg-green-50 dark:hover:bg-green-900/10"
                                    >
                                        <Plus className="w-4 h-4 mr-2" />
                                        {t('sidebar_manager.add_group')}
                                    </Button>
                                )}
                            </div>
                            <div className="flex-1 p-6">
                                <Reorder.Group axis="y" values={groups} onReorder={handleGroupReorder} className="space-y-2">
                                    <AnimatePresence>
                                        {groups.map(group => (
                                                <Reorder.Item
                                                    key={group.id}
                                                    value={group}
                                                    drag={!group.isExtension && !group.isPlugin && (canEdit || isSuperAdmin) ? "y" : false}
                                                    className={`flex items-center gap-3 p-3 bg-card border rounded-lg shadow-sm ${group.isExtension ? 'bg-muted/30 border-dashed border-indigo-200 dark:border-indigo-900/30' : 'border-border'} ${(!group.isExtension && !group.isPlugin && (canEdit || isSuperAdmin)) ? 'cursor-grab active:cursor-grabbing hover:border-primary/50' : ''
                                                        }`}
                                                >
                                                {(!group.isExtension && !group.isPlugin && (canEdit || isSuperAdmin)) ? (
                                                    <div className="text-muted-foreground hover:text-foreground p-1">
                                                        <GripVertical className="w-5 h-5" />
                                                    </div>
                                                ) : (
                                                    <div className="p-1 w-7 flex justify-center">
                                                        {group.isExtension && <Puzzle className="w-4 h-4 text-indigo-400" />}
                                                    </div>
                                                )}

                                                <div className={`p-2 rounded-md ${group.isExtension ? 'bg-indigo-100/50 text-indigo-600 dark:bg-indigo-900/20 dark:text-indigo-400' : 'bg-muted text-muted-foreground'}`}>
                                                    <FolderOpen className="w-5 h-5" />
                                                </div>
                                                <div className="flex-1">
                                                    <div className="flex items-center gap-2">
                                                        <h4 className={`font-medium ${group.isExtension ? 'text-indigo-700 dark:text-indigo-300' : 'text-foreground'}`}>{group.label}</h4>
                                                        {group.isExtension && <span className="text-[10px] bg-indigo-100 text-indigo-700 px-1.5 rounded-full border border-indigo-200 dark:bg-indigo-900/20 dark:text-indigo-300 dark:border-indigo-800">{t('sidebar_manager.module')}</span>}
                                                        {group.isPlugin && <span className="text-[10px] bg-emerald-100 text-emerald-700 px-1.5 rounded-full border border-emerald-200 dark:bg-emerald-900/20 dark:text-emerald-300 dark:border-emerald-800">{t('sidebar_manager.core')}</span>}
                                                    </div>
                                                    <p className="text-xs text-muted-foreground">{t('sidebar_manager.order')}: {group.order}</p>
                                                </div>
                                                {(canEdit || isSuperAdmin) && (
                                                    <Button
                                                        variant="ghost"
                                                        size="sm"
                                                        disabled={group.isExtension || group.isPlugin}
                                                        onClick={() => handleEditGroup(group)}
                                                        className="text-muted-foreground hover:text-primary disabled:opacity-30 disabled:hover:text-muted-foreground"
                                                        title={group.isExtension || group.isPlugin ? t('sidebar_manager.managed_by_ext') : t('sidebar_manager.edit_group')}
                                                    >
                                                        <Edit2 className="w-4 h-4" />
                                                    </Button>
                                                )}
                                            </Reorder.Item>
                                        ))}
                                    </AnimatePresence>
                                </Reorder.Group>
                            </div>
                        </div>
                    </TabsContent>
                </Tabs >


                {/* Edit Dialog */}
                < Dialog open={!!editingItem
                } onOpenChange={(open) => !open && setEditingItem(null)}>
                    <DialogContent>
                        <DialogHeader>
                            <DialogTitle>{t('sidebar_manager.edit_item')}</DialogTitle>
                            <DialogDescription>
                                {t('sidebar_manager.dialogs.edit_item_desc')}
                            </DialogDescription>
                        </DialogHeader>
                        <div className="py-4 space-y-4">
                            <div className="space-y-2">
                                <Label>{t('sidebar_manager.label')}</Label>
                                <Input
                                    value={editForm.label}
                                    onChange={e => setEditForm({ ...editForm, label: e.target.value })}
                                    placeholder={t('sidebar_manager.label')}
                                />
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <Label>{t('sidebar_manager.group_label')}</Label>
                                    <div className="relative">
                                        <Input
                                            list="groups-list"
                                            value={editForm.group_label}
                                            onChange={e => setEditForm({ ...editForm, group_label: e.target.value })}
                                            placeholder="General"
                                        />
                                        <datalist id="groups-list">
                                            {existingGroups.map(g => (
                                                <option key={g} value={g} />
                                            ))}
                                        </datalist>
                                    </div>
                                </div>
                                <div className="space-y-2">
                                    <Label>{t('sidebar_manager.group_order')}</Label>
                                    <Input
                                        type="number"
                                        value={editForm.group_order}
                                        onChange={e => setEditForm({ ...editForm, group_order: e.target.value })}
                                        placeholder="0"
                                        min="0"
                                    />
                                    <p className="text-[10px] text-slate-500">{t('sidebar_manager.dialogs.group_order_helper')}</p>
                                </div>
                            </div>

                            <div className="space-y-2">
                                <Label>{t('sidebar_manager.key')}</Label>
                                <Input value={editingItem?.key || ''} disabled className="bg-muted" />
                            </div>
                        </div>
                        <DialogFooter>
                            <Button variant="outline" onClick={() => setEditingItem(null)}>{t('sidebar_manager.cancel')}</Button>
                            <Button onClick={saveEdit}>{t('sidebar_manager.save_changes')}</Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog >

                {/* Group Edit Dialog */}
                < Dialog open={!!editingGroup} onOpenChange={(open) => !open && setEditingGroup(null)}>
                    <DialogContent>
                        <DialogHeader>
                            <DialogTitle>{t('sidebar_manager.edit_group')}</DialogTitle>
                            <DialogDescription>
                                {t('sidebar_manager.dialogs.edit_group_desc')}
                            </DialogDescription>
                        </DialogHeader>
                        <div className="py-4 space-y-4">
                            <div className="space-y-2">
                                <Label>{t('sidebar_manager.group_label')}</Label>
                                <Input
                                    value={groupEditForm.label}
                                    onChange={e => setGroupEditForm({ ...groupEditForm, label: e.target.value })}
                                    placeholder={t('sidebar_manager.group_name')}
                                />
                            </div>
                            <div className="space-y-2">
                                <Label>Order</Label>
                                <Input
                                    type="number"
                                    value={groupEditForm.order}
                                    onChange={e => setGroupEditForm({ ...groupEditForm, order: e.target.value })}
                                    placeholder="0"
                                />
                            </div>
                        </div>
                        <DialogFooter>
                            <Button variant="outline" onClick={() => setEditingGroup(null)}>{t('sidebar_manager.cancel')}</Button>
                            <Button onClick={saveGroupEdit}>{t('sidebar_manager.save_group')}</Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog >

                {/* New Group Dialog */}
                < Dialog open={showNewGroupDialog} onOpenChange={(open) => !open && setShowNewGroupDialog(false)}>
                    <DialogContent>
                        <DialogHeader>
                            <DialogTitle>{t('sidebar_manager.create_group')}</DialogTitle>
                            <DialogDescription>
                                {t('sidebar_manager.dialogs.create_group_desc')}
                            </DialogDescription>
                        </DialogHeader>
                        <div className="py-4 space-y-4">
                            <div className="space-y-2">
                                <Label>{t('sidebar_manager.group_name')}</Label>
                                <Input
                                    value={newGroupForm.label}
                                    onChange={e => setNewGroupForm({ ...newGroupForm, label: e.target.value })}
                                    placeholder="e.g., MARKETING"
                                />
                                <p className="text-[10px] text-slate-500">{t('sidebar_manager.dialogs.create_group_helper')}</p>
                            </div>
                            <div className="space-y-2">
                                <Label>Order</Label>
                                <Input
                                    type="number"
                                    value={newGroupForm.order}
                                    onChange={e => setNewGroupForm({ ...newGroupForm, order: e.target.value })}
                                    placeholder="10"
                                    min="1"
                                />
                                <p className="text-[10px] text-muted-foreground">{t('sidebar_manager.dialogs.create_group_order_helper')}</p>
                            </div>
                        </div>
                        <DialogFooter>
                            <Button variant="outline" onClick={() => setShowNewGroupDialog(false)}>{t('sidebar_manager.cancel')}</Button>
                            <Button
                                onClick={handleCreateGroup}
                                disabled={!newGroupForm.label.trim()}
                                className="bg-green-600 hover:bg-green-700"
                            >
                                {t('sidebar_manager.create')}
                            </Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog >
            </div >
        </AdminPageLayout >
    );
}

export default SidebarMenuManager;
