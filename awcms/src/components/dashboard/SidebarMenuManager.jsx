
import React, { useState, useEffect } from 'react';
import { Reorder, AnimatePresence } from 'framer-motion';
import { Helmet } from 'react-helmet';
import { Link } from 'react-router-dom';
import {
    GripVertical, Eye, EyeOff, Edit2, Save, RefreshCw,
    ChevronRight, Search, Settings2, ShieldAlert, X, Loader2, FolderOpen, Puzzle, Plus
} from 'lucide-react';
import { useAdminMenu } from '@/hooks/useAdminMenu';
import { supabase } from '@/lib/customSupabaseClient';
import { usePermissions } from '@/contexts/PermissionContext';
import { useSearch } from '@/hooks/useSearch';
import { getIconComponent } from '@/lib/adminIcons';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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

function SidebarMenuManager() {
    const { menuItems, loading, updateMenuOrder, toggleVisibility, updateMenuItem, updateGroup, fetchMenu } = useAdminMenu();
    const { hasPermission, userRole, loading: permsLoading } = usePermissions();
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

    const canView = hasPermission('tenant.setting.read');
    const canEdit = hasPermission('tenant.setting.update');
    const isSuperAdmin = ['super_admin', 'owner'].includes(userRole);

    useEffect(() => {
        if (!menuItems.length) return;

        const uniqueGroups = [];
        const seen = new Set();
        const groupSources = new Map(); // Track source of each group

        // First pass: identify sources
        menuItems.forEach(item => {
            if (item.source === 'extension') {
                groupSources.set(item.group_label, 'extension');
            } else if (item.source === 'plugin') {
                groupSources.set(item.group_label, 'plugin');
            }
        });

        menuItems.forEach(item => {
            if (!seen.has(item.group_label)) {
                seen.add(item.group_label);
                uniqueGroups.push({
                    id: item.group_label, // Use label as ID for reorder
                    label: item.group_label,
                    order: item.group_order || 999,
                    isExtension: groupSources.get(item.group_label) === 'extension',
                    isPlugin: groupSources.get(item.group_label) === 'plugin'
                });
            }
        });

        // Sort by group_order
        uniqueGroups.sort((a, b) => a.order - b.order);
        setGroups(uniqueGroups);

        // IMPORTANT: Also sync items state with menuItems
        setItems(menuItems);
    }, [menuItems]);


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

            toast({ title: 'Success', description: 'Group order updated.' });
            setHasChanges(false);
            fetchMenu(); // Refresh to get consistent state
        } catch (err) {
            toast({ variant: 'destructive', title: 'Error', description: 'Failed to save group order.' });
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
            toast({ title: 'Success', description: 'Group updated.' });
            fetchMenu();
        } catch (err) {
            toast({ variant: 'destructive', title: 'Error', description: 'Failed to update group.' });
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
                    permission: 'super_admin_only', // Hidden from non-super admins
                    group_label: newGroupForm.label.toUpperCase(),
                    group_order: parseInt(newGroupForm.order) || 100,
                    order: 9999, // At the end of the group
                    is_visible: false, // Hidden placeholder
                    created_at: new Date().toISOString(),
                    updated_at: new Date().toISOString()
                });

            if (error) throw error;

            setShowNewGroupDialog(false);
            toast({ title: 'Success', description: `Group "${newGroupForm.label}" created.` });
            fetchMenu(); // Refresh to show new group
        } catch (err) {
            console.error('Error creating group:', err);
            toast({ variant: 'destructive', title: 'Error', description: 'Failed to create group.' });
        }
    };

    const handleReorder = (newOrder) => {
        if (!canEdit && !isSuperAdmin) return;
        setItems(newOrder);
        setHasChanges(true);
    };

    const handleSaveOrder = async () => {
        if (!canEdit && !isSuperAdmin) {
            toast({ variant: 'destructive', title: 'Permission Denied', description: 'You do not have permission to edit sidebar.' });
            return;
        }
        setIsSaving(true);
        try {
            await updateMenuOrder(items);
            setHasChanges(false);
            toast({ title: 'Success', description: 'Menu order updated successfully.' });
        } catch (err) {
            toast({ variant: 'destructive', title: 'Error', description: 'Failed to save order.' });
        } finally {
            setIsSaving(false);
        }
    };

    const handleToggleVisibility = async (e, item) => {
        e.stopPropagation();
        if (!canEdit && !isSuperAdmin) {
            toast({ variant: 'destructive', title: 'Permission Denied', description: 'You do not have permission to edit sidebar.' });
            return;
        }
        try {
            await toggleVisibility(item.id, item.is_visible);
            setItems(prev => prev.map(i => i.id === item.id ? { ...i, is_visible: !i.is_visible } : i));
            toast({ title: item.is_visible ? 'Hidden' : 'Visible', description: `Menu item is now ${item.is_visible ? 'hidden' : 'visible'}.` });
        } catch (err) {
            toast({ variant: 'destructive', title: 'Error', description: 'Failed to update visibility.' });
        }
    };

    const handleEdit = (item) => {
        if (!canEdit && !isSuperAdmin) {
            toast({ variant: 'destructive', title: 'Permission Denied', description: 'You do not have permission to edit sidebar.' });
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
            toast({ title: 'Updated', description: 'Menu item details updated.' });
        } catch (err) {
            toast({ variant: 'destructive', title: 'Error', description: 'Failed to update item.' });
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
                <h3 className="text-xl font-bold text-foreground">Access Restricted</h3>
                <p className="text-muted-foreground mt-2">You do not have permission to view the Sidebar Manager.</p>
            </div>
        );
    }

    return (
        <div className="flex flex-col space-y-6 max-w-5xl mx-auto pb-10">
            <Helmet>
                <title>Sidebar Manager - CMS</title>
            </Helmet>

            {/* Header */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <nav className="flex items-center text-sm text-muted-foreground mb-2">
                        <Link to="/cmspanel" className="hover:text-primary transition-colors">Dashboard</Link>
                        <ChevronRight className="w-4 h-4 mx-2 text-muted-foreground/50" />
                        <span className="font-medium text-foreground">Sidebar Manager</span>
                    </nav>
                    <h1 className="text-2xl font-bold text-foreground">Sidebar Navigation</h1>
                    <p className="text-muted-foreground">Customize the admin sidebar menu order, grouping, and visibility.</p>
                </div>

                <div className="flex items-center gap-3">
                    <Button variant="outline" onClick={() => fetchMenu()} disabled={loading}>
                        <RefreshCw className={`w - 4 h - 4 mr - 2 ${loading ? 'animate-spin' : ''} `} />
                        Refresh
                    </Button>
                    {hasChanges && (
                        <Button onClick={handleSaveOrder} disabled={isSaving}>
                            <Save className="w-4 h-4 mr-2" />
                            {isSaving ? 'Saving...' : 'Save Order'}
                        </Button>
                    )}
                </div>
            </div>

            {/* Main Content */}
            <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
                <div className="flex justify-between items-center mb-4">
                    <TabsList>
                        <TabsTrigger value="items">Menu Items</TabsTrigger>
                        <TabsTrigger value="groups">Groups</TabsTrigger>
                    </TabsList>
                </div>

                <TabsContent value="items" className="space-y-4">
                    <div className="bg-card rounded-xl border border-border shadow-sm flex flex-col min-h-[500px]">
                        <div className="p-4 border-b border-border flex items-center justify-between bg-muted/30">
                            <div className="relative w-full max-w-sm">
                                <Search className="absolute left-3 top-2.5 w-4 h-4 text-muted-foreground" />
                                <Input
                                    placeholder={`Search menu or group... (${minLength} + chars)`}
                                    value={query}
                                    onChange={e => setQuery(e.target.value)}
                                    className={`pl - 9 pr - 24 bg - background ${!isSearchValid ? 'border-destructive focus:ring-destructive/30' : ''} `}
                                />
                                <div className="absolute right-3 top-2.5 flex items-center gap-2">
                                    {(loading || searchLoading) && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
                                    {query && (
                                        <button onClick={clearSearch} className="text-muted-foreground hover:text-foreground">
                                            <X className="h-4 w-4" />
                                        </button>
                                    )}
                                    <span className={`text - xs font - mono ${query.length > 0 && query.length < minLength ? 'text-destructive font-bold' : 'text-muted-foreground'} `}>
                                        {query.length}/{minLength}
                                    </span>
                                </div>
                                {!isSearchValid && (
                                    <div className="absolute top-full left-0 mt-1 text-xs text-destructive font-medium animate-in slide-in-from-top-1 px-1">
                                        {searchMessage}
                                    </div>
                                )}
                            </div>
                            <div className="text-sm text-muted-foreground">
                                {filteredItems.length} items found
                            </div>
                        </div>

                        <div className="flex-1 p-6">
                            {loading && items.length === 0 ? (
                                <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
                                    <RefreshCw className="w-8 h-8 animate-spin mb-2" />
                                    <p>Loading configuration...</p>
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
                                                                    Ext
                                                                </span>
                                                            )}
                                                            {(item.plugin_type === 'core' || item.is_core) && (
                                                                <span className="flex items-center text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-100 dark:bg-emerald-900/10 dark:text-emerald-400 dark:border-emerald-900/20">
                                                                    <Puzzle className="w-3 h-3 mr-1" />
                                                                    Core
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
                                                                title={item.source === 'extension' ? "Managed by Extension" : "Edit Item"}
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
                                                                onCheckedChange={(checked) => handleToggleVisibility({ stopPropagation: () => { } }, item)}
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
                                <h3 className="text-sm font-medium text-foreground">Manage Groups</h3>
                                <p className="text-xs text-muted-foreground">Drag to reorder groups. This updates the order for all items within.</p>
                            </div>
                            {/* Show Save Button specific to Groups tab if changes exist */}
                            {hasChanges && activeTab === 'groups' && (
                                <Button onClick={handleSaveGroupOrder} disabled={isSaving} size="sm">
                                    <Save className="w-4 h-4 mr-2" />
                                    {isSaving ? 'Saving...' : 'Save Group Order'}
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
                                    Add Group
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
                                            drag={!group.isExtension && (canEdit || isSuperAdmin) ? "y" : false}
                                            className={`flex items-center gap-3 p-3 bg-card border rounded-lg shadow-sm ${group.isExtension ? 'bg-muted/30 border-dashed border-indigo-200 dark:border-indigo-900/30' : 'border-border'} ${(!group.isExtension && (canEdit || isSuperAdmin)) ? 'cursor-grab active:cursor-grabbing hover:border-primary/50' : ''
                                                }`}
                                        >
                                            {(!group.isExtension && (canEdit || isSuperAdmin)) ? (
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
                                                    {group.isExtension && <span className="text-[10px] bg-indigo-100 text-indigo-700 px-1.5 rounded-full border border-indigo-200 dark:bg-indigo-900/20 dark:text-indigo-300 dark:border-indigo-800">Module</span>}
                                                    {group.isPlugin && <span className="text-[10px] bg-emerald-100 text-emerald-700 px-1.5 rounded-full border border-emerald-200 dark:bg-emerald-900/20 dark:text-emerald-300 dark:border-emerald-800">Core</span>}
                                                </div>
                                                <p className="text-xs text-muted-foreground">Order: {group.order}</p>
                                            </div>
                                            {(canEdit || isSuperAdmin) && (
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    disabled={group.isExtension}
                                                    onClick={() => handleEditGroup(group)}
                                                    className="text-muted-foreground hover:text-primary disabled:opacity-30 disabled:hover:text-muted-foreground"
                                                    title={group.isExtension ? "Managed by Extension" : "Edit Group"}
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
            </Tabs>


            {/* Edit Dialog */}
            <Dialog open={!!editingItem} onOpenChange={(open) => !open && setEditingItem(null)}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Edit Menu Item</DialogTitle>
                        <DialogDescription>
                            Customize the label and grouping for this sidebar item.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="py-4 space-y-4">
                        <div className="space-y-2">
                            <Label>Label</Label>
                            <Input
                                value={editForm.label}
                                onChange={e => setEditForm({ ...editForm, label: e.target.value })}
                                placeholder="Menu Label"
                            />
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label>Group Label</Label>
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
                                <Label>Group Order</Label>
                                <Input
                                    type="number"
                                    value={editForm.group_order}
                                    onChange={e => setEditForm({ ...editForm, group_order: e.target.value })}
                                    placeholder="0"
                                    min="0"
                                />
                                <p className="text-[10px] text-slate-500">Lower numbers appear higher.</p>
                            </div>
                        </div>

                        <div className="space-y-2">
                            <Label>Key (Read Only)</Label>
                            <Input value={editingItem?.key || ''} disabled className="bg-muted" />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setEditingItem(null)}>Cancel</Button>
                        <Button onClick={saveEdit}>Save Changes</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Group Edit Dialog */}
            <Dialog open={!!editingGroup} onOpenChange={(open) => !open && setEditingGroup(null)}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Edit Group</DialogTitle>
                        <DialogDescription>
                            Rename or reorder this group.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="py-4 space-y-4">
                        <div className="space-y-2">
                            <Label>Group Label</Label>
                            <Input
                                value={groupEditForm.label}
                                onChange={e => setGroupEditForm({ ...groupEditForm, label: e.target.value })}
                                placeholder="Group Name"
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
                        <Button variant="outline" onClick={() => setEditingGroup(null)}>Cancel</Button>
                        <Button onClick={saveGroupEdit}>Save Group</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* New Group Dialog */}
            <Dialog open={showNewGroupDialog} onOpenChange={(open) => !open && setShowNewGroupDialog(false)}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Create New Group</DialogTitle>
                        <DialogDescription>
                            Add a new menu group. Groups help organize sidebar items.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="py-4 space-y-4">
                        <div className="space-y-2">
                            <Label>Group Name</Label>
                            <Input
                                value={newGroupForm.label}
                                onChange={e => setNewGroupForm({ ...newGroupForm, label: e.target.value })}
                                placeholder="e.g., MARKETING"
                            />
                            <p className="text-[10px] text-slate-500">Use UPPERCASE for consistency with existing groups.</p>
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
                            <p className="text-[10px] text-muted-foreground">Lower numbers appear higher in the sidebar.</p>
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setShowNewGroupDialog(false)}>Cancel</Button>
                        <Button
                            onClick={handleCreateGroup}
                            disabled={!newGroupForm.label.trim()}
                            className="bg-green-600 hover:bg-green-700"
                        >
                            Create Group
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div >
    );
}

export default SidebarMenuManager;
