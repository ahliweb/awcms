
import React, { useState, useEffect } from 'react';
import ContentTable from '@/components/dashboard/ContentTable';
import { usePermissions } from '@/contexts/PermissionContext';
import { useToast } from '@/components/ui/use-toast';
import { supabase } from '@/lib/customSupabaseClient';
import { Button } from '@/components/ui/button';
import { Plus, Building, RefreshCw, DollarSign, Mail, FileText, Globe, ChevronLeft, ChevronRight, Radio } from 'lucide-react';
import { format } from 'date-fns';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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

function TenantsManager() {
    const { toast } = useToast();
    const { isPlatformAdmin } = usePermissions();

    const [tenants, setTenants] = useState([]);
    const [loading, setLoading] = useState(true);
    const [showEditor, setShowEditor] = useState(false);
    const [editingTenant, setEditingTenant] = useState(null);
    const [query, setQuery] = useState('');
    const [currentPage, setCurrentPage] = useState(1);
    const [itemsPerPage, setItemsPerPage] = useState(10);

    const [formData, setFormData] = useState({
        name: '',
        slug: '',
        domain: '',
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
        setShowEditor(true);
    };

    const handleEdit = async (tenant) => {
        setEditingTenant(tenant);
        setFormData({
            name: tenant.name,
            slug: tenant.slug,
            domain: tenant.domain || '',
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

        setShowEditor(true);
    };

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
                .single();

            if (existing) {
                throw new Error('Tenant Slug is already taken. Please choose another.');
            }

            const payload = {
                name: formData.name,
                slug: formData.slug,
                domain: formData.domain || null,
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
                const { data: insertedTenant, error: insertError } = await supabase
                    .from('tenants')
                    .insert(payload)
                    .select('id, slug')
                    .single();
                error = insertError;
                if (insertedTenant) newTenantId = insertedTenant.id;
            }

            if (error) throw error;

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

    const filteredTenants = tenants.filter(t =>
        t.name.toLowerCase().includes(query.toLowerCase()) ||
        t.slug.toLowerCase().includes(query.toLowerCase())
    );

    // Pagination logic
    const totalPages = Math.ceil(filteredTenants.length / itemsPerPage);
    const startIndex = (currentPage - 1) * itemsPerPage;
    const endIndex = startIndex + itemsPerPage;
    const paginatedTenants = filteredTenants.slice(startIndex, endIndex);

    // Reset to page 1 when search changes
    useEffect(() => {
        setCurrentPage(1);
    }, [query]);

    const columns = [
        { key: 'name', label: 'Name', className: 'font-semibold' },
        { key: 'slug', label: 'Slug', className: 'text-muted-foreground font-mono text-xs' },
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
            render: (date, row) => {
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
        <div className="space-y-6">
            {/* Breadcrumb Navigation */}
            <nav className="flex items-center text-sm text-muted-foreground">
                <a href="/cmspanel" className="hover:text-foreground transition-colors flex items-center gap-1">
                    <RefreshCw className="w-4 h-4" /> {/* Fallback icon */}
                    Dashboard
                </a>
                <span className="w-4 h-4 mx-2 text-muted">/</span>
                <span className="flex items-center gap-1 text-foreground font-medium">
                    <Building className="w-4 h-4" />
                    Tenants
                </span>
            </nav>

            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-card p-6 rounded-xl border border-border shadow-sm">
                <div>
                    <h2 className="text-3xl font-bold text-foreground flex items-center gap-2">
                        <Building className="w-8 h-8 text-primary" />
                        Tenants
                    </h2>
                    <p className="text-muted-foreground mt-1">Manage platform tenants, subscriptions, and domains.</p>
                </div>
                <div className="flex gap-2">
                    <Button variant="ghost" onClick={fetchTenants} title="Refresh" className="text-muted-foreground hover:text-foreground">
                        <RefreshCw className="w-4 h-4" />
                    </Button>
                    <Button onClick={handleCreate} className="bg-primary text-primary-foreground hover:bg-primary/90">
                        <Plus className="w-4 h-4 mr-2" /> New Tenant
                    </Button>
                </div>
            </div>

            <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
                <div className="p-4 border-b border-border bg-muted/20 flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
                    <Input
                        placeholder="Search tenants..."
                        value={query}
                        onChange={e => setQuery(e.target.value)}
                        className="max-w-sm bg-background border-input"
                    />
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
        </div>
    );
}

export default TenantsManager;
