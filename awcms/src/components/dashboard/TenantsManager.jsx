
import React, { useState, useEffect } from 'react';
import ContentTable from '@/components/dashboard/ContentTable';
import { usePermissions } from '@/contexts/PermissionContext';
import { useToast } from '@/components/ui/use-toast';
import { supabase } from '@/lib/customSupabaseClient';
import { Button } from '@/components/ui/button';
import { Plus, Building, RefreshCw, Trash2, Edit, Calendar, DollarSign, Mail, FileText, Globe, ChevronLeft, ChevronRight } from 'lucide-react';
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

    // Delete state
    const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
    const [tenantToDelete, setTenantToDelete] = useState(null);

    useEffect(() => {
        if (isPlatformAdmin) {
            fetchTenants();
        }
    }, [isPlatformAdmin]);

    const fetchTenants = async () => {
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
    };

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
        setShowEditor(true);
    };

    const handleEdit = (tenant) => {
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
            if (editingTenant) {
                const { error: updateError } = await supabase
                    .from('tenants')
                    .update(payload)
                    .eq('id', editingTenant.id);
                error = updateError;
            } else {
                const { error: insertError } = await supabase
                    .from('tenants')
                    .insert(payload);
                error = insertError;
            }

            if (error) throw error;

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
        { key: 'slug', label: 'Slug', className: 'text-slate-500 font-mono text-xs' },
        {
            key: 'status',
            label: 'Status',
            render: (status) => (
                <span className={`px-2 py-1 rounded-full text-xs font-bold ${status === 'active' ? 'bg-green-100 text-green-700' :
                    status === 'suspended' ? 'bg-red-100 text-red-700' : 'bg-slate-100 text-slate-700'
                    }`}>
                    {status.toUpperCase()}
                </span>
            )
        },
        {
            key: 'subscription_tier',
            label: 'Plan',
            render: (tier) => (
                <span className="uppercase text-xs font-bold text-blue-600 border border-blue-200 px-2 py-0.5 rounded bg-blue-50">
                    {tier}
                </span>
            )
        },
        {
            key: 'created_at',
            label: 'Created',
            render: (date) => date ? (
                <span className="text-xs text-slate-500">{format(new Date(date), 'dd MMM yyyy')}</span>
            ) : '-'
        },
        {
            key: 'subscription_expires_at',
            label: 'Expires',
            render: (date, row) => {
                if (!date) return <span className="text-xs text-slate-400">-</span>;
                const expDate = new Date(date);
                const isExpired = expDate < new Date();
                const isExpiringSoon = expDate < new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days
                return (
                    <span className={`text-xs font-medium ${isExpired ? 'text-red-600' : isExpiringSoon ? 'text-amber-600' : 'text-green-600'}`}>
                        {format(expDate, 'dd MMM yyyy')}
                    </span>
                );
            }
        },
        {
            key: 'billing_amount',
            label: 'Billing',
            render: (amount, row) => {
                if (!amount) return <span className="text-xs text-slate-400">-</span>;
                const currencySymbols = { IDR: 'Rp', USD: '$', EUR: '€', SGD: 'S$', MYR: 'RM' };
                const symbol = currencySymbols[row.currency] || row.currency || '$';
                const cycleLabel = row.billing_cycle === 'yearly' ? '/yr' : row.billing_cycle === 'monthly' ? '/mo' : '';
                return (
                    <span className="text-xs text-slate-600 font-medium">
                        {symbol}{parseFloat(amount).toLocaleString()}{cycleLabel}
                    </span>
                );
            }
        }
    ];

    if (!isPlatformAdmin) return <div className="p-8 text-center text-slate-500">Access Denied: Platform Admins Only</div>;

    return (
        <div className="space-y-6">
            {/* Breadcrumb Navigation */}
            <nav className="flex items-center text-sm text-slate-500">
                <a href="/cmspanel" className="hover:text-blue-600 transition-colors flex items-center gap-1">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" /></svg>
                    Dashboard
                </a>
                <svg className="w-4 h-4 mx-2 text-slate-300" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
                <span className="flex items-center gap-1 text-slate-700 font-medium">
                    <Building className="w-4 h-4" />
                    Tenants
                </span>
            </nav>

            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
                <div>
                    <h2 className="text-3xl font-bold text-slate-800 flex items-center gap-2">
                        <Building className="w-8 h-8 text-blue-600" />
                        Tenants
                    </h2>
                    <p className="text-slate-500 mt-1">Manage platform tenants, subscriptions, and domains.</p>
                </div>
                <div className="flex gap-2">
                    <Button variant="ghost" onClick={fetchTenants} title="Refresh">
                        <RefreshCw className="w-4 h-4" />
                    </Button>
                    <Button onClick={handleCreate} className="bg-blue-600 hover:bg-blue-700">
                        <Plus className="w-4 h-4 mr-2" /> New Tenant
                    </Button>
                </div>
            </div>

            <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                <div className="p-4 border-b border-slate-100 bg-slate-50/50 flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
                    <Input
                        placeholder="Search tenants..."
                        value={query}
                        onChange={e => setQuery(e.target.value)}
                        className="max-w-sm bg-white"
                    />
                    <div className="flex items-center gap-2">
                        <span className="text-sm text-slate-500">Show:</span>
                        <Select value={String(itemsPerPage)} onValueChange={(v) => { setItemsPerPage(Number(v)); setCurrentPage(1); }}>
                            <SelectTrigger className="w-[70px] h-8 bg-white">
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
                    <div className="flex items-center justify-between px-4 py-3 border-t border-slate-100 bg-slate-50/50">
                        <div className="text-sm text-slate-500">
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
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>{editingTenant ? 'Edit Tenant' : 'New Tenant'}</DialogTitle>
                        <DialogDescription>Configure tenant details and subscription.</DialogDescription>
                    </DialogHeader>
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
                                    <SelectTrigger><SelectValue /></SelectTrigger>
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
                                    <SelectTrigger><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="free">Free</SelectItem>
                                        <SelectItem value="pro">Pro</SelectItem>
                                        <SelectItem value="enterprise">Enterprise</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>

                        {/* Billing Section */}
                        <div className="pt-4 border-t border-slate-100">
                            <h4 className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-2">
                                <DollarSign className="w-4 h-4" /> Billing Information
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
                                        <SelectTrigger><SelectValue /></SelectTrigger>
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
                                        <SelectTrigger><SelectValue /></SelectTrigger>
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
                                <Label className="flex items-center gap-1"><Globe className="w-3 h-3" /> Default Language</Label>
                                <Select value={formData.locale} onValueChange={v => setFormData({ ...formData, locale: v })}>
                                    <SelectTrigger className="max-w-[200px]"><SelectValue /></SelectTrigger>
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
                        <div className="pt-4 border-t border-slate-100">
                            <h4 className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-2">
                                <FileText className="w-4 h-4" /> Administrative Notes
                            </h4>
                            <div className="grid gap-4">
                                <div className="grid gap-2">
                                    <Label className="flex items-center gap-1"><Mail className="w-3 h-3" /> Contact Email</Label>
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
                                        className="flex min-h-[80px] w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                                    />
                                </div>
                            </div>
                        </div>
                    </div>
                    <DialogFooter>
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
