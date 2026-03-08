
import React, { useState, useEffect, useCallback } from 'react';
import ContentTable from '@/components/dashboard/ContentTable';
import { usePermissions } from '@/contexts/PermissionContext';
import { useToast } from '@/components/ui/use-toast';
import { supabase } from '@/lib/customSupabaseClient';
import { Button } from '@/components/ui/button';
import { Plus, Building, RefreshCw } from 'lucide-react';
import { format } from 'date-fns';
import { useSearch } from '@/hooks/useSearch';
import { AdminPageLayout, PageHeader } from '@/templates/flowbite-admin';
import TenantOverviewCards from '@/components/dashboard/tenants/TenantOverviewCards';
import TenantsListToolbar from '@/components/dashboard/tenants/TenantsListToolbar';
import TenantsPagination from '@/components/dashboard/tenants/TenantsPagination';
import TenantEditorDialog from '@/components/dashboard/tenants/TenantEditorDialog';
import TenantDeleteDialog from '@/components/dashboard/tenants/TenantDeleteDialog';

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

    const activeTenantCount = filteredTenants.filter((tenant) => tenant.status === 'active').length;
    const suspendedTenantCount = filteredTenants.filter((tenant) => tenant.status === 'suspended').length;
    const expiringSoonCount = filteredTenants.filter((tenant) => {
        if (!tenant.subscription_expires_at) {
            return false;
        }
        const expiryDate = new Date(tenant.subscription_expires_at);
        return expiryDate >= new Date() && expiryDate < new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    }).length;

    if (!isPlatformAdmin) return (
        <div className="flex min-h-[400px] flex-col items-center justify-center rounded-2xl border border-border/60 bg-card/70 p-12 text-center shadow-sm">
            <Building className="mb-4 h-12 w-12 text-muted-foreground" />
            <h3 className="text-xl font-bold text-foreground">Access Denied</h3>
            <p className="text-muted-foreground">Platform Admins Only</p>
        </div>
    );

    return (
        <AdminPageLayout requiredPermission="platform.tenant.read">
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

            <TenantOverviewCards
                filteredTenants={filteredTenants}
                activeTenantCount={activeTenantCount}
                expiringSoonCount={expiringSoonCount}
            />

            <div className="overflow-hidden rounded-2xl border border-border/60 bg-card/75 shadow-sm backdrop-blur-sm">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/70 bg-background/35 px-4 py-3 text-xs sm:px-5">
                    <span className="font-medium text-muted-foreground">
                        Tenant registry snapshot - {filteredTenants.length} visible
                    </span>
                    <div className="flex flex-wrap items-center gap-2">
                        <span className="inline-flex items-center rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-semibold text-emerald-700 dark:text-emerald-300">
                            {activeTenantCount} active
                        </span>
                        <span className="inline-flex items-center rounded-full border border-amber-500/25 bg-amber-500/10 px-2.5 py-1 text-[11px] font-semibold text-amber-700 dark:text-amber-300">
                            {suspendedTenantCount} suspended
                        </span>
                    </div>
                </div>
                <TenantsListToolbar
                    query={query}
                    setQuery={setQuery}
                    clearSearch={clearSearch}
                    loading={loading}
                    searchLoading={searchLoading}
                    isSearchValid={isSearchValid}
                    searchMessage={searchMessage}
                    minLength={minLength}
                    itemsPerPage={itemsPerPage}
                    resultCount={filteredTenants.length}
                    onItemsPerPageChange={(value) => {
                        setItemsPerPage(value);
                        setCurrentPage(1);
                    }}
                />
                <ContentTable
                    data={paginatedTenants}
                    columns={columns}
                    loading={loading}
                    onEdit={handleEdit}
                    onDelete={(t) => { setTenantToDelete(t); setDeleteDialogOpen(true); }}
                />
                <TenantsPagination
                    totalPages={totalPages}
                    currentPage={currentPage}
                    startIndex={startIndex}
                    endIndex={endIndex}
                    totalItems={filteredTenants.length}
                    setCurrentPage={setCurrentPage}
                />
            </div>

            <TenantEditorDialog
                open={showEditor}
                onOpenChange={setShowEditor}
                editingTenant={editingTenant}
                formData={formData}
                setFormData={setFormData}
                tenants={tenants}
                channelDomains={channelDomains}
                setChannelDomains={setChannelDomains}
                resourceRules={resourceRules}
                setResourceRules={setResourceRules}
                hasRegistry={hasRegistry}
                rulesLoading={rulesLoading}
                roleLinks={roleLinks}
                setRoleLinks={setRoleLinks}
                roleLinksLoading={roleLinksLoading}
                loading={loading}
                onSave={handleSave}
            />

            <TenantDeleteDialog
                open={deleteDialogOpen}
                onOpenChange={setDeleteDialogOpen}
                tenantName={tenantToDelete?.name}
                onConfirm={handleDelete}
            />
        </AdminPageLayout>
    );
}

export default TenantsManager;
