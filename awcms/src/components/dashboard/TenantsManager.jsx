
import React, { useState, useEffect, useCallback } from 'react';
import ContentTable from '@/components/dashboard/ContentTable';
import { usePermissions } from '@/contexts/PermissionContext';
import { useToast } from '@/components/ui/use-toast';
import { supabase } from '@/lib/customSupabaseClient';
import { Button } from '@/components/ui/button';
import { Plus, Building, RefreshCw, DollarSign, Mail, FileText, Globe, ChevronLeft, ChevronRight, Radio } from 'lucide-react';
import { format } from 'date-fns';
import { Input } from '@/components/ui/input';
import { useSearch } from '@/hooks/useSearch';
import MinCharSearchInput from '@/components/common/MinCharSearchInput';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
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
import { AdminPageLayout, PageHeader } from '@/templates/flowbite-admin';

function TenantsManager() {
    const { toast } = useToast();
    const { isPlatformAdmin } = usePermissions();

    const [tenants, setTenants] = useState([]);
    const [loading, setLoading] = useState(true);
    const [showEditor, setShowEditor] = useState(false);
    const [editingTenant, setEditingTenant] = useState(null);

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

    const [currentPage, setCurrentPage] = useState(1);
    const [itemsPerPage, setItemsPerPage] = useState(10);

    const [formData, setFormData] = useState({
        name: '',
        slug: '',
        domain: '',
        parent_tenant_id: '',
        role_inheritance_mode: 'auto',
        status: 'active',
        subscription_tier: 'free',
        subscription_expires_at: '',
        billing_amount: '',
        billing_cycle: 'monthly',
        currency: 'USD',
        locale: 'en',
        notes: '',
        contact_email: ''
    });

    // Channel domains state
    const [channelDomains, setChannelDomains] = useState({
        web_public: '',
        mobile: '',
        esp32: ''
    });

    const [resourceRegistry, setResourceRegistry] = useState([]);
    const [resourceRules, setResourceRules] = useState([]);
    const [rulesLoading, setRulesLoading] = useState(false);
    const [roleLinks, setRoleLinks] = useState([]);
    const [roleLinksLoading, setRoleLinksLoading] = useState(false);

    // Delete state
    const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
    const [tenantToDelete, setTenantToDelete] = useState(null);

    const fetchTenants = React.useCallback(async () => {
        setLoading(true);
        try {
            const { data, error } = await supabase
                .from('tenants')
                .select('*')
                .is('deleted_at', null)
                .order('created_at', { ascending: false });

            if (error) throw error;
            setTenants(data || []);
        } catch (err) {
            console.error(err);
            toast({ variant: 'destructive', title: 'Error', description: 'Failed to load tenants' });
        } finally {
            setLoading(false);
        }
    }, [toast]);

    useEffect(() => {
        if (isPlatformAdmin) {
            fetchTenants();
        }
    }, [isPlatformAdmin, fetchTenants]);

    const handleCreate = () => {
        setEditingTenant(null);
        setFormData({
            name: '',
            slug: '',
            domain: '',
            parent_tenant_id: '',
            role_inheritance_mode: 'auto',
            status: 'active',
            subscription_tier: 'free',
            subscription_expires_at: '',
            billing_amount: '',
            billing_cycle: 'monthly',
            currency: 'USD',
            locale: 'en',
            notes: '',
            contact_email: ''
        });
        setChannelDomains({ web_public: '', mobile: '', esp32: '' });
        loadResourceRules(null);
        setShowEditor(true);
    };

    const handleEdit = async (tenant) => {
        setEditingTenant(tenant);
        setFormData({
            name: tenant.name,
            slug: tenant.slug,
            domain: tenant.domain || '',
            parent_tenant_id: tenant.parent_tenant_id || '',
            role_inheritance_mode: tenant.role_inheritance_mode || 'auto',
            status: tenant.status,
            subscription_tier: tenant.subscription_tier || 'free',
            subscription_expires_at: tenant.subscription_expires_at ? tenant.subscription_expires_at.split('T')[0] : '',
            billing_amount: tenant.billing_amount || '',
            billing_cycle: tenant.billing_cycle || 'monthly',
            currency: tenant.currency || 'USD',
            locale: tenant.locale || 'en',
            notes: tenant.notes || '',
            contact_email: tenant.contact_email || ''
        });

        // Fetch channel domains
        try {
            const { data: channels } = await supabase
                .from('tenant_channels')
                .select('channel, domain')
                .eq('tenant_id', tenant.id)
                .in('channel', ['web_public', 'mobile', 'esp32']);

            const domains = { web_public: '', mobile: '', esp32: '' };
            channels?.forEach(c => { domains[c.channel] = c.domain || ''; });
            setChannelDomains(domains);
        } catch (err) {
            console.error('Failed to load channels:', err);
        }
        loadResourceRules(tenant.id);
        setShowEditor(true);
    };

    const loadResourceRules = useCallback(async (tenantId) => {
        setRulesLoading(true);
        try {
            const { data: registryData, error: registryError } = await supabase
                .from('tenant_resource_registry')
                .select('resource_key, description, default_share_mode, default_access_mode')
                .order('resource_key');

            if (registryError) throw registryError;
            setResourceRegistry(registryData || []);

            let existingRules = [];
            if (tenantId) {
                const { data: rulesData, error: rulesError } = await supabase
                    .from('tenant_resource_rules')
                    .select('resource_key, share_mode, access_mode')
                    .eq('tenant_id', tenantId);

                if (rulesError) throw rulesError;
                existingRules = rulesData || [];
            }

            const ruleMap = new Map(existingRules.map(rule => [rule.resource_key, rule]));
            const rules = (registryData || []).map(rule => ({
                resource_key: rule.resource_key,
                description: rule.description,
                share_mode: ruleMap.get(rule.resource_key)?.share_mode || rule.default_share_mode,
                access_mode: ruleMap.get(rule.resource_key)?.access_mode || rule.default_access_mode
            }));
            setResourceRules(rules);
        } catch (err) {
            console.error('Failed to load resource rules:', err);
            toast({ variant: 'destructive', title: 'Error', description: 'Failed to load resource sharing rules.' });
        } finally {
            setRulesLoading(false);
        }
    }, [toast]);

    const loadRoleLinks = useCallback(async (tenantId, parentTenantId) => {
        if (!tenantId || !parentTenantId) {
            setRoleLinks([]);
            return;
        }
        setRoleLinksLoading(true);
        try {
            const [{ data: parentRoles, error: parentError }, { data: childRoles, error: childError }, { data: linkData, error: linkError }] = await Promise.all([
                supabase
                    .from('roles')
                    .select('id, name')
                    .eq('tenant_id', parentTenantId)
                    .is('deleted_at', null),
                supabase
                    .from('roles')
                    .select('id, name')
                    .eq('tenant_id', tenantId)
                    .is('deleted_at', null),
                supabase
                    .from('tenant_role_links')
                    .select('parent_role_id, child_role_id')
                    .eq('tenant_id', tenantId)
            ]);

            if (parentError || childError || linkError) throw parentError || childError || linkError;

            const childMap = new Map((childRoles || []).map(role => [role.name, role]));
            const linkSet = new Set((linkData || []).map(link => `${link.parent_role_id}:${link.child_role_id}`));

            const merged = (parentRoles || []).map(parentRole => {
                const childRole = childMap.get(parentRole.name);
                const linkKey = childRole ? `${parentRole.id}:${childRole.id}` : null;
                return {
                    name: parentRole.name,
                    parent_role_id: parentRole.id,
                    child_role_id: childRole?.id || null,
                    linked: linkKey ? linkSet.has(linkKey) : false
                };
            });

            setRoleLinks(merged);
        } catch (err) {
            console.error('Failed to load role links:', err);
            toast({ variant: 'destructive', title: 'Error', description: 'Failed to load role links.' });
        } finally {
            setRoleLinksLoading(false);
        }
    }, [toast]);

    useEffect(() => {
        if (!showEditor || !editingTenant) {
            return;
        }
        if (formData.role_inheritance_mode === 'linked' && formData.parent_tenant_id) {
            loadRoleLinks(editingTenant.id, formData.parent_tenant_id);
        } else {
            setRoleLinks([]);
        }
    }, [showEditor, editingTenant, formData.parent_tenant_id, formData.role_inheritance_mode, loadRoleLinks]);

    const handleSave = async () => {
        if (!formData.name || !formData.slug) {
            toast({ variant: 'destructive', title: 'Error', description: 'Name and Slug are required' });
            return;
        }

        setLoading(true);
        try {
            // Check for duplicate slug
            const { data: existing } = await supabase
                .from('tenants')
                .select('id')
                .eq('slug', formData.slug)
                .neq('id', editingTenant?.id || '00000000-0000-0000-0000-000000000000') // Exclude self
                .maybeSingle();

            if (existing) {
                throw new Error('Tenant Slug is already taken. Please choose another.');
            }

            const payload = {
                name: formData.name,
                slug: formData.slug,
                domain: formData.domain || null,
                parent_tenant_id: formData.parent_tenant_id || null,
                role_inheritance_mode: formData.role_inheritance_mode || 'auto',
                status: formData.status,
                subscription_tier: formData.subscription_tier,
                subscription_expires_at: formData.subscription_expires_at || null,
                billing_amount: formData.billing_amount ? parseFloat(formData.billing_amount) : null,
                billing_cycle: formData.billing_cycle,
                currency: formData.currency,
                locale: formData.locale,
                notes: formData.notes || null,
                contact_email: formData.contact_email || null
            };

            let error;
            let newTenantId = null;
            if (editingTenant) {
                const { error: updateError } = await supabase
                    .from('tenants')
                    .update(payload)
                    .eq('id', editingTenant.id);
                error = updateError;
            } else {
                const { data: createdTenant, error: insertError } = await supabase
                    .rpc('create_tenant_with_defaults', {
                        p_name: payload.name,
                        p_slug: payload.slug,
                        p_domain: payload.domain,
                        p_tier: payload.subscription_tier,
                        p_parent_tenant_id: payload.parent_tenant_id,
                        p_role_inheritance_mode: payload.role_inheritance_mode
                    });
                error = insertError;
                if (createdTenant?.tenant_id) newTenantId = createdTenant.tenant_id;
            }

            if (error) throw error;

            if (!editingTenant && newTenantId) {
                const { error: updateError } = await supabase
                    .from('tenants')
                    .update(payload)
                    .eq('id', newTenantId);
                if (updateError) throw updateError;
            }

            // Save channel domains for tenant (both new and existing)
            const tenantId = editingTenant?.id || newTenantId;
            const tenantSlug = editingTenant?.slug || formData.slug;
            if (tenantId) {
                for (const channel of ['web_public', 'mobile', 'esp32']) {
                    if (channelDomains[channel]) {
                        // Upsert channel domain
                        const { error: channelError } = await supabase
                            .from('tenant_channels')
                            .upsert({
                                tenant_id: tenantId,
                                channel,
                                domain: channelDomains[channel].toLowerCase().trim(),
                                base_path: channel === 'web_public' ? `/awcms-public/${tenantSlug}/` :
                                    channel === 'mobile' ? `/awcms-mobile/${tenantSlug}/` :
                                        `/awcms-esp32/${tenantSlug}/`,
                                is_primary: true,
                                is_active: true
                            }, { onConflict: 'tenant_id,channel,is_primary' });
                        if (channelError) console.error('Channel upsert error:', channelError);
                    }
                }
            }

            if (tenantId && resourceRules.length > 0) {
                const rulesPayload = resourceRules.map(rule => ({
                    tenant_id: tenantId,
                    resource_key: rule.resource_key,
                    share_mode: rule.share_mode,
                    access_mode: rule.access_mode
                }));
                const { error: rulesError } = await supabase
                    .from('tenant_resource_rules')
                    .upsert(rulesPayload, { onConflict: 'tenant_id,resource_key' });
                if (rulesError) throw rulesError;
            }

            if (tenantId && payload.role_inheritance_mode === 'linked') {
                await supabase
                    .from('tenant_role_links')
                    .delete()
                    .eq('tenant_id', tenantId);

                const linkPayload = roleLinks
                    .filter(link => link.linked && link.child_role_id)
                    .map(link => ({
                        tenant_id: tenantId,
                        parent_role_id: link.parent_role_id,
                        child_role_id: link.child_role_id
                    }));

                if (linkPayload.length > 0) {
                    const { error: linkError } = await supabase
                        .from('tenant_role_links')
                        .insert(linkPayload);
                    if (linkError) throw linkError;
                }
            }

            if (tenantId && payload.parent_tenant_id) {
                await supabase.rpc('apply_tenant_role_inheritance', { p_tenant_id: tenantId });
            }

            toast({ title: 'Success', description: `Tenant ${editingTenant ? 'updated' : 'created'} successfully` });
            setShowEditor(false);
            fetchTenants();
        } catch (err) {
            console.error(err);
            toast({ variant: 'destructive', title: 'Error', description: err.message });
        } finally {
            setLoading(false);
        }
    };

    const handleDelete = async () => {
        if (!tenantToDelete) return;
        setLoading(true);
        try {
            // Soft Delete Implementation
            const { error } = await supabase
                .from('tenants')
                .update({
                    deleted_at: new Date().toISOString(),
                    status: 'archived' // Optional: also mark as archived
                })
                .eq('id', tenantToDelete.id);

            if (error) throw error;

            toast({ title: 'Success', description: 'Tenant deleted successfully (Soft Delete)' });
            setDeleteDialogOpen(false);
            setTenantToDelete(null);
            fetchTenants();
        } catch (err) {
            console.error(err);
            toast({ variant: 'destructive', title: 'Error', description: `Failed to delete: ${err.message}` });
        } finally {
            setLoading(false);
        }
    };

    const filteredTenants = tenants.filter(t => {
        if (!debouncedQuery) return true;
        const lower = debouncedQuery.toLowerCase();
        return t.name.toLowerCase().includes(lower) ||
            t.slug.toLowerCase().includes(lower);
    });

    // Pagination logic
    const totalPages = Math.ceil(filteredTenants.length / itemsPerPage);
    const startIndex = (currentPage - 1) * itemsPerPage;
    const endIndex = startIndex + itemsPerPage;
    const paginatedTenants = filteredTenants.slice(startIndex, endIndex);

    // Reset to page 1 when search changes
    useEffect(() => {
        setCurrentPage(1);
    }, [debouncedQuery]);

    const hasRegistry = resourceRegistry.length > 0;

    const columns = [
        { key: 'name', label: 'Name', className: 'font-semibold' },
        { key: 'slug', label: 'Slug', className: 'text-muted-foreground font-mono text-xs' },
        { key: 'level', label: 'Level', className: 'text-xs text-muted-foreground text-center w-[80px]' },
        {
            key: 'status',
            label: 'Status',
            render: (status) => (
                <span className={`px-2 py-1 rounded-full text-xs font-bold ${status === 'active' ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300' :
                    status === 'suspended' ? 'bg-destructive/10 text-destructive' : 'bg-muted text-muted-foreground'
                    }`}>
                    {status.toUpperCase()}
                </span>
            )
        },
        {
            key: 'subscription_tier',
            label: 'Plan',
            render: (tier) => (
                <span className="uppercase text-xs font-bold text-primary border border-primary/20 px-2 py-0.5 rounded bg-primary/10">
                    {tier}
                </span>
            )
        },
        {
            key: 'created_at',
            label: 'Created',
            render: (date) => date ? (
                <span className="text-xs text-muted-foreground">{format(new Date(date), 'dd MMM yyyy')}</span>
            ) : '-'
        },
        {
            key: 'subscription_expires_at',
            label: 'Expires',
            render: (date, _row) => {
                if (!date) return <span className="text-xs text-muted-foreground">-</span>;
                const expDate = new Date(date);
                const isExpired = expDate < new Date();
                const isExpiringSoon = expDate < new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days
                return (
                    <span className={`text-xs font-medium ${isExpired ? 'text-destructive' : isExpiringSoon ? 'text-amber-600 dark:text-amber-400' : 'text-green-600 dark:text-green-400'}`}>
                        {format(expDate, 'dd MMM yyyy')}
                    </span>
                );
            }
        },
        {
            key: 'billing_amount',
            label: 'Billing',
            render: (amount, row) => {
                if (!amount) return <span className="text-xs text-muted-foreground">-</span>;
                const currencySymbols = { IDR: 'Rp', USD: '$', EUR: '€', SGD: 'S$', MYR: 'RM' };
                const symbol = currencySymbols[row.currency] || row.currency || '$';
                const cycleLabel = row.billing_cycle === 'yearly' ? '/yr' : row.billing_cycle === 'monthly' ? '/mo' : '';
                return (
                    <span className="text-xs text-muted-foreground font-medium">
                        {symbol}{parseFloat(amount).toLocaleString()}{cycleLabel}
                    </span>
                );
            }
        }
    ];

    if (!isPlatformAdmin) return (
        <div className="flex flex-col items-center justify-center min-h-[400px] bg-card rounded-xl border border-border p-12 text-center">
            <Building className="w-12 h-12 text-muted-foreground mb-4" />
            <h3 className="text-xl font-bold text-foreground">Access Denied</h3>
            <p className="text-muted-foreground">Platform Admins Only</p>
        </div>
    );

    return (
        <AdminPageLayout requiredPermission="platform.tenants.read">
            <PageHeader
                title="Tenants"
                description="Manage platform tenants, subscriptions, and domains."
                icon={Building}
                breadcrumbs={[{ label: 'Tenants', icon: Building }]}
                actions={(
                    <div className="flex gap-2">
                        <Button variant="ghost" onClick={fetchTenants} title="Refresh" className="text-muted-foreground hover:text-foreground">
                            <RefreshCw className="w-4 h-4" />
                        </Button>
                        <Button onClick={handleCreate} className="bg-primary text-primary-foreground hover:bg-primary/90">
                            <Plus className="w-4 h-4 mr-2" /> New Tenant
                        </Button>
                    </div>
                )}
            />

            <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
                <div className="p-4 border-b border-border bg-muted/20 flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
                    <div className="flex-1 max-w-sm">
                        <MinCharSearchInput
                            value={query}
                            onChange={e => setQuery(e.target.value)}
                            onClear={clearSearch}
                            loading={loading || searchLoading}
                            isValid={isSearchValid}
                            message={searchMessage}
                            minLength={minLength}
                            placeholder="Search tenants"
                        />
                    </div>
                    <div className="flex items-center gap-2">
                        <span className="text-sm text-muted-foreground">Show:</span>
                        <Select value={String(itemsPerPage)} onValueChange={(v) => { setItemsPerPage(Number(v)); setCurrentPage(1); }}>
                            <SelectTrigger className="w-[70px] h-8 bg-background border-input">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="5">5</SelectItem>
                                <SelectItem value="10">10</SelectItem>
                                <SelectItem value="25">25</SelectItem>
                                <SelectItem value="50">50</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                </div>
                <ContentTable
                    data={paginatedTenants}
                    columns={columns}
                    loading={loading}
                    onEdit={handleEdit}
                    onDelete={(t) => { setTenantToDelete(t); setDeleteDialogOpen(true); }}
                />
                {/* Pagination Controls */}
                {totalPages > 1 && (
                    <div className="flex items-center justify-between px-4 py-3 border-t border-border bg-muted/20">
                        <div className="text-sm text-muted-foreground">
                            Showing {startIndex + 1} - {Math.min(endIndex, filteredTenants.length)} of {filteredTenants.length} tenants
                        </div>
                        <div className="flex items-center gap-1">
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                                disabled={currentPage === 1}
                                className="h-8 w-8 p-0"
                            >
                                <ChevronLeft className="w-4 h-4" />
                            </Button>
                            {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                                let pageNum;
                                if (totalPages <= 5) {
                                    pageNum = i + 1;
                                } else if (currentPage <= 3) {
                                    pageNum = i + 1;
                                } else if (currentPage >= totalPages - 2) {
                                    pageNum = totalPages - 4 + i;
                                } else {
                                    pageNum = currentPage - 2 + i;
                                }
                                return (
                                    <Button
                                        key={pageNum}
                                        variant={currentPage === pageNum ? "default" : "outline"}
                                        size="sm"
                                        onClick={() => setCurrentPage(pageNum)}
                                        className={`h-8 w-8 p-0 ${currentPage === pageNum ? 'bg-blue-600 hover:bg-blue-700' : ''}`}
                                    >
                                        {pageNum}
                                    </Button>
                                );
                            })}
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                                disabled={currentPage === totalPages}
                                className="h-8 w-8 p-0"
                            >
                                <ChevronRight className="w-4 h-4" />
                            </Button>
                        </div>
                    </div>
                )}
            </div>

            {/* Editor Dialog */}
            <Dialog open={showEditor} onOpenChange={setShowEditor}>
                <DialogContent className="max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
                    <DialogHeader>
                        <DialogTitle>{editingTenant ? 'Edit Tenant' : 'New Tenant'}</DialogTitle>
                        <DialogDescription>Configure tenant details and subscription.</DialogDescription>
                    </DialogHeader>
                    <div className="flex-1 overflow-y-auto pr-2">
                        <div className="space-y-4 py-4">
                            <div className="grid gap-2">
                                <Label>Name</Label>
                                <Input
                                    value={formData.name}
                                    onChange={e => setFormData({ ...formData, name: e.target.value })}
                                    placeholder="Acme Corp"
                                />
                            </div>
                            <div className="grid gap-2">
                                <Label>Slug (Unique ID)</Label>
                                <Input
                                    value={formData.slug}
                                    onChange={e => setFormData({ ...formData, slug: e.target.value.toLowerCase().replace(/\s+/g, '-') })}
                                    placeholder="acme-corp"
                                    disabled={!!editingTenant}
                                />
                            </div>
                            <div className="grid gap-2">
                                <Label>Custom Domain (Optional)</Label>
                                <Input
                                    value={formData.domain}
                                    onChange={e => setFormData({ ...formData, domain: e.target.value })}
                                    placeholder="app.acme.com"
                                />
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div className="grid gap-2">
                                    <Label>Parent Tenant</Label>
                                    <Select
                                        value={formData.parent_tenant_id || 'none'}
                                        onValueChange={v => setFormData({ ...formData, parent_tenant_id: v === 'none' ? '' : v })}
                                    >
                                        <SelectTrigger className="bg-background border-input"><SelectValue /></SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="none">None (Top-Level)</SelectItem>
                                            {tenants
                                                .filter(t => !editingTenant || t.id !== editingTenant.id)
                                                .map(t => (
                                                    <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                                                ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="grid gap-2">
                                    <Label>Role Inheritance</Label>
                                    <Select
                                        value={formData.role_inheritance_mode}
                                        onValueChange={v => setFormData({ ...formData, role_inheritance_mode: v })}
                                    >
                                        <SelectTrigger className="bg-background border-input"><SelectValue /></SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="auto">Auto Inherit</SelectItem>
                                            <SelectItem value="linked">Linked Only</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                            </div>
                            {formData.role_inheritance_mode === 'linked' && formData.parent_tenant_id && (
                                <div className="pt-4 border-t border-border">
                                    <h4 className="text-sm font-semibold text-foreground mb-3">Linked Roles</h4>
                                    {roleLinksLoading ? (
                                        <div className="text-xs text-muted-foreground">Loading role links...</div>
                                    ) : (
                                        <div className="space-y-2">
                                            {roleLinks.map(link => (
                                                <div key={link.parent_role_id} className="flex items-center gap-2">
                                                    <Checkbox
                                                        checked={link.linked}
                                                        disabled={!link.child_role_id}
                                                        onCheckedChange={value => setRoleLinks(prev => prev.map(item => item.parent_role_id === link.parent_role_id ? { ...item, linked: Boolean(value) } : item))}
                                                    />
                                                    <span className="text-sm text-foreground">
                                                        {link.name}
                                                    </span>
                                                    {!link.child_role_id && (
                                                        <span className="text-xs text-muted-foreground">Missing child role</span>
                                                    )}
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            )}
                            <div className="grid grid-cols-2 gap-4">
                                <div className="grid gap-2">
                                    <Label>Status</Label>
                                    <Select value={formData.status} onValueChange={v => setFormData({ ...formData, status: v })}>
                                        <SelectTrigger className="bg-background border-input"><SelectValue /></SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="active">Active</SelectItem>
                                            <SelectItem value="suspended">Suspended</SelectItem>
                                            <SelectItem value="archived">Archived</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="grid gap-2">
                                    <Label>Subscription</Label>
                                    <Select value={formData.subscription_tier} onValueChange={v => setFormData({ ...formData, subscription_tier: v })}>
                                        <SelectTrigger className="bg-background border-input"><SelectValue /></SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="free">Free</SelectItem>
                                            <SelectItem value="pro">Pro</SelectItem>
                                            <SelectItem value="enterprise">Enterprise</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                            </div>

                            {/* Billing Section */}
                            <div className="pt-4 border-t border-border">
                                <h4 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
                                    <DollarSign className="w-4 h-4 text-muted-foreground" /> Billing Information
                                </h4>
                                <div className="grid grid-cols-4 gap-4">
                                    <div className="grid gap-2">
                                        <Label>Expiry Date</Label>
                                        <Input
                                            type="date"
                                            value={formData.subscription_expires_at}
                                            onChange={e => setFormData({ ...formData, subscription_expires_at: e.target.value })}
                                        />
                                    </div>
                                    <div className="grid gap-2">
                                        <Label>Amount</Label>
                                        <Input
                                            type="number"
                                            value={formData.billing_amount}
                                            onChange={e => setFormData({ ...formData, billing_amount: e.target.value })}
                                            placeholder="99.00"
                                        />
                                    </div>
                                    <div className="grid gap-2">
                                        <Label>Currency</Label>
                                        <Select value={formData.currency} onValueChange={v => setFormData({ ...formData, currency: v })}>
                                            <SelectTrigger className="bg-background border-input"><SelectValue /></SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="IDR">IDR (Rupiah)</SelectItem>
                                                <SelectItem value="USD">USD (Dollar)</SelectItem>
                                                <SelectItem value="EUR">EUR (Euro)</SelectItem>
                                                <SelectItem value="SGD">SGD (Singapore)</SelectItem>
                                                <SelectItem value="MYR">MYR (Ringgit)</SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </div>
                                    <div className="grid gap-2">
                                        <Label>Cycle</Label>
                                        <Select value={formData.billing_cycle} onValueChange={v => setFormData({ ...formData, billing_cycle: v })}>
                                            <SelectTrigger className="bg-background border-input"><SelectValue /></SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="monthly">Monthly</SelectItem>
                                                <SelectItem value="yearly">Yearly</SelectItem>
                                                <SelectItem value="custom">Custom</SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </div>
                                </div>

                                {/* Locale / Language */}
                                <div className="grid gap-2 mt-4">
                                    <Label className="flex items-center gap-1"><Globe className="w-3 h-3 text-muted-foreground" /> Default Language</Label>
                                    <Select value={formData.locale} onValueChange={v => setFormData({ ...formData, locale: v })}>
                                        <SelectTrigger className="max-w-[200px] bg-background border-input"><SelectValue /></SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="id">🇮🇩 Bahasa Indonesia</SelectItem>
                                            <SelectItem value="en">🇺🇸 English</SelectItem>
                                            <SelectItem value="zh">🇨🇳 中文 (Chinese)</SelectItem>
                                            <SelectItem value="ja">🇯🇵 日本語 (Japanese)</SelectItem>
                                            <SelectItem value="ko">🇰🇷 한국어 (Korean)</SelectItem>
                                            <SelectItem value="ar">🇸🇦 العربية (Arabic)</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                            </div>

                            {/* Resource Sharing Section */}
                            <div className="pt-4 border-t border-border">
                                <h4 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
                                    <Building className="w-4 h-4 text-muted-foreground" /> Resource Sharing
                                </h4>
                                <p className="text-xs text-muted-foreground mb-3">
                                    Configure which resources are shared across tenant levels. Shared resources allow read/write access for tenant admins.
                                </p>
                                {rulesLoading ? (
                                    <div className="text-xs text-muted-foreground">Loading resource rules...</div>
                                ) : !hasRegistry ? (
                                    <div className="text-xs text-muted-foreground">Resource registry not available.</div>
                                ) : (
                                    <div className="space-y-3">
                                        {resourceRules.map(rule => (
                                            <div key={rule.resource_key} className="grid grid-cols-[1fr_160px_160px] gap-3 items-center">
                                                <div>
                                                    <div className="text-sm font-medium text-foreground">{rule.resource_key}</div>
                                                    {rule.description && (
                                                        <div className="text-xs text-muted-foreground">{rule.description}</div>
                                                    )}
                                                </div>
                                                <Select
                                                    value={rule.share_mode}
                                                    onValueChange={value => setResourceRules(prev => prev.map(item => item.resource_key === rule.resource_key ? { ...item, share_mode: value } : item))}
                                                >
                                                    <SelectTrigger className="bg-background border-input"><SelectValue /></SelectTrigger>
                                                    <SelectContent>
                                                        <SelectItem value="isolated">Isolated</SelectItem>
                                                        <SelectItem value="shared_descendants">Share to Descendants</SelectItem>
                                                        <SelectItem value="shared_ancestors">Share to Ancestors</SelectItem>
                                                        <SelectItem value="shared_all">Share All Levels</SelectItem>
                                                    </SelectContent>
                                                </Select>
                                                <Select
                                                    value={rule.access_mode}
                                                    onValueChange={value => setResourceRules(prev => prev.map(item => item.resource_key === rule.resource_key ? { ...item, access_mode: value } : item))}
                                                >
                                                    <SelectTrigger className="bg-background border-input"><SelectValue /></SelectTrigger>
                                                    <SelectContent>
                                                        <SelectItem value="read">Read Only</SelectItem>
                                                        <SelectItem value="write">Write Only</SelectItem>
                                                        <SelectItem value="read_write">Read & Write</SelectItem>
                                                    </SelectContent>
                                                </Select>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>

                            {/* Contact & Notes */}
                            <div className="pt-4 border-t border-border">
                                <h4 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
                                    <FileText className="w-4 h-4 text-muted-foreground" /> Administrative Notes
                                </h4>
                                <div className="grid gap-4">
                                    <div className="grid gap-2">
                                        <Label className="flex items-center gap-1"><Mail className="w-3 h-3 text-muted-foreground" /> Contact Email</Label>
                                        <Input
                                            type="email"
                                            value={formData.contact_email}
                                            onChange={e => setFormData({ ...formData, contact_email: e.target.value })}
                                            placeholder="admin@tenant.com"
                                        />
                                    </div>
                                    <div className="grid gap-2">
                                        <Label>Notes</Label>
                                        <textarea
                                            value={formData.notes}
                                            onChange={e => setFormData({ ...formData, notes: e.target.value })}
                                            placeholder="Internal notes about this tenant..."
                                            className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                                        />
                                    </div>
                                </div>
                            </div>

                            {/* Channel Domains Section */}
                            <div className="pt-4 border-t border-border">
                                <h4 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
                                    <Radio className="w-4 h-4 text-muted-foreground" /> Channel Domains
                                </h4>
                                <p className="text-xs text-muted-foreground mb-3">Configure domain mappings for each channel.</p>
                                <div className="space-y-3">
                                    <div className="grid grid-cols-[120px_1fr] gap-2 items-center">
                                        <Label className="text-xs font-medium">Web Public</Label>
                                        <Input
                                            value={channelDomains.web_public}
                                            onChange={e => setChannelDomains({ ...channelDomains, web_public: e.target.value })}
                                            placeholder="primarypublic.example.com"
                                            className="text-sm"
                                        />
                                    </div>
                                    <div className="grid grid-cols-[120px_1fr] gap-2 items-center">
                                        <Label className="text-xs font-medium">Mobile</Label>
                                        <Input
                                            value={channelDomains.mobile}
                                            onChange={e => setChannelDomains({ ...channelDomains, mobile: e.target.value })}
                                            placeholder="primarymobile.example.com"
                                            className="text-sm"
                                        />
                                    </div>
                                    <div className="grid grid-cols-[120px_1fr] gap-2 items-center">
                                        <Label className="text-xs font-medium">ESP32</Label>
                                        <Input
                                            value={channelDomains.esp32}
                                            onChange={e => setChannelDomains({ ...channelDomains, esp32: e.target.value })}
                                            placeholder="primaryesp32.example.com"
                                            className="text-sm"
                                        />
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                    <DialogFooter className="pt-4 border-t">
                        <Button variant="outline" onClick={() => setShowEditor(false)}>Cancel</Button>
                        <Button onClick={handleSave} disabled={loading}>Save Changes</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Delete Confirmation */}
            <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Delete Tenant?</AlertDialogTitle>
                        <AlertDialogDescription>
                            Are you sure you want to delete <strong>{tenantToDelete?.name}</strong>? This action cannot be undone.
                            If the tenant has associated users or data, deletion might fail.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={handleDelete} className="bg-red-600 hover:bg-red-700">Delete</AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </AdminPageLayout>
    );
}

export default TenantsManager;
