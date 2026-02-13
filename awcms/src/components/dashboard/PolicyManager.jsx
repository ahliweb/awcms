import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { usePermissions } from '@/contexts/PermissionContext';
import { supabase } from '@/lib/customSupabaseClient';
import { useToast } from '@/components/ui/use-toast';
import { Plus, Trash2, Edit2, Shield } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { AdminPageLayout, PageHeader } from '@/templates/flowbite-admin';

export default function PolicyManager() {
    const { tenantId, hasPermission, isPlatformAdmin } = usePermissions();
    const { toast } = useToast();
    const { t } = useTranslation();
    const [policies, setPolicies] = useState([]);
    const [loading, setLoading] = useState(false);

    const canManage = isPlatformAdmin || hasPermission('tenant.policy.create'); // Simplified for now, usually create/update/delete separate
    const canView = isPlatformAdmin || hasPermission('tenant.policy.read');

    // Editor State
    const [isDialogOpen, setIsDialogOpen] = useState(false);
    const [editingPolicy, setEditingPolicy] = useState(null);
    const [formData, setFormData] = useState({
        name: '',
        description: '',
        effect: 'deny',
        actions: '',
        conditions: '{}'
    });

    const fetchPolicies = useCallback(async () => {
        setLoading(true);
        try {
            const { data, error } = await supabase
                .from('policies')
                .select('*')
                .is('deleted_at', null)
                .order('created_at', { ascending: false });

            if (error) throw error;
            setPolicies(data || []);
        } catch (err) {
            console.error('Error fetching policies:', err);
            toast({ variant: "destructive", title: t('policies.toasts.save_failed'), description: t('policies.toasts.load_error') });
        } finally {
            setLoading(false);
        }
    }, [toast, t]);

    useEffect(() => {
        if (canView) {
            fetchPolicies();
        }
    }, [tenantId, canView, fetchPolicies]);

    if (!canView) return <div className="p-8 text-center text-red-500">{t('policies.access_denied')}</div>;

    const handleOpenDialog = (policy = null) => {
        if (policy) {
            setEditingPolicy(policy);
            setFormData({
                name: policy.name,
                description: policy.description || '',
                effect: policy.definition?.effect || 'deny',
                actions: (policy.definition?.actions || []).join(', '),
                conditions: JSON.stringify(policy.definition?.conditions || {}, null, 2)
            });
        } else {
            setEditingPolicy(null);
            setFormData({
                name: '',
                description: '',
                effect: 'deny',
                actions: '',
                conditions: '{\n  "channel": "mobile"\n}'
            });
        }
        setIsDialogOpen(true);
    };

    const handleSave = async () => {
        try {
            // Validate JSON
            let conditions = {};
            try {
                conditions = JSON.parse(formData.conditions);
            } catch {
                toast({ variant: "destructive", title: t('policies.toasts.save_failed'), description: t('policies.toasts.invalid_json') });
                return;
            }

            const definition = {
                effect: formData.effect,
                actions: formData.actions.split(',').map(s => s.trim()).filter(Boolean),
                conditions
            };

            const payload = {
                name: formData.name,
                description: formData.description,
                definition,
                tenant_id: tenantId, // Context ensures correct tenant
                deleted_at: null
            };

            let error;
            if (editingPolicy) {
                const { error: updateError } = await supabase
                    .from('policies')
                    .update(payload)
                    .eq('id', editingPolicy.id);
                error = updateError;
            } else {
                const { error: insertError } = await supabase
                    .from('policies')
                    .insert(payload);
                error = insertError;
            }

            if (error) throw error;

            toast({ title: t('policies.toasts.success_title'), description: editingPolicy ? t('policies.toasts.updated') : t('policies.toasts.created') });
            setIsDialogOpen(false);
            fetchPolicies();

        } catch (err) {
            console.error('Error saving policy:', err);
            toast({ variant: "destructive", title: t('policies.toasts.save_failed'), description: err.message });
        }
    };

    const handleDelete = async (id) => {
        if (!window.confirm(t('policies.toasts.delete_confirm'))) return;

        try {
            const { error } = await supabase
                .from('policies')
                .update({ deleted_at: new Date().toISOString() })
                .eq('id', id);
            if (error) throw error;
            toast({ title: t('policies.toasts.deleted'), description: t('policies.toasts.deleted') });
            fetchPolicies();
        } catch (err) {
            toast({ variant: "destructive", title: t('policies.toasts.delete_failed'), description: err.message });
        }
    };

    return (
        <AdminPageLayout requiredPermission="tenant.policy.read">
            <PageHeader
                title={t('policies.page_title')}
                description={t('policies.page_desc')}
                icon={Shield}
                breadcrumbs={[{ label: t('policies.page_title'), icon: Shield }]}
                actions={canManage && (
                    <Button onClick={() => handleOpenDialog()}>
                        <Plus className="w-4 h-4 mr-2" /> {t('policies.new_policy')}
                    </Button>
                )}
            />

            <div className="bg-white rounded-md border shadow-sm">
                <div className="overflow-x-auto">
                    <table className="w-full text-sm text-left">
                        <thead className="bg-slate-50 text-slate-500 font-medium border-b">
                            <tr>
                                <th className="px-4 py-3">{t('policies.table.name')}</th>
                                <th className="px-4 py-3">{t('policies.table.effect')}</th>
                                <th className="px-4 py-3">{t('policies.table.actions')}</th>
                                <th className="px-4 py-3">{t('policies.table.conditions')}</th>
                                <th className="px-4 py-3 text-right">{t('policies.table.actions')}</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y">
                            {loading ? (
                                <tr><td colSpan="5" className="p-8 text-center text-slate-400">{t('policies.table.loading')}</td></tr>
                            ) : policies.length === 0 ? (
                                <tr><td colSpan="5" className="p-8 text-center text-slate-400">{t('policies.table.empty')}</td></tr>
                            ) : (
                                policies.map(policy => (
                                    <tr key={policy.id} className="hover:bg-slate-50/50">
                                        <td className="px-4 py-3 font-medium">
                                            {policy.name}
                                            {policy.description && <p className="text-xs text-slate-400 font-normal">{policy.description}</p>}
                                        </td>
                                        <td className="px-4 py-3">
                                            <span className={`inline-flex px-2 py-0.5 rounded text-xs font-bold uppercase ${policy.definition?.effect === 'deny'
                                                ? 'bg-red-100 text-red-700'
                                                : 'bg-green-100 text-green-700'
                                                }`}>
                                                {policy.definition?.effect === 'deny' ? t('policies.effects.deny') : t('policies.effects.allow')}
                                            </span>
                                        </td>
                                        <td className="px-4 py-3 font-mono text-xs text-slate-600">
                                            {policy.definition?.actions?.join(', ') || '*'}
                                        </td>
                                        <td className="px-4 py-3 font-mono text-xs text-slate-500 max-w-xs truncate">
                                            {JSON.stringify(policy.definition?.conditions)}
                                        </td>
                                        <td className="px-4 py-3 text-right space-x-2">
                                            {canManage && (
                                                <>
                                                    <Button variant="ghost" size="sm" onClick={() => handleOpenDialog(policy)}>
                                                        <Edit2 className="w-4 h-4 text-slate-500" />
                                                    </Button>
                                                    <Button variant="ghost" size="sm" onClick={() => handleDelete(policy.id)}>
                                                        <Trash2 className="w-4 h-4 text-red-500" />
                                                    </Button>
                                                </>
                                            )}
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
                <DialogContent className="max-w-md">
                    <DialogHeader>
                        <DialogTitle>{editingPolicy ? t('policies.dialog.edit_title') : t('policies.dialog.create_title')}</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                        <div className="space-y-2">
                            <label className="text-sm font-medium">{t('policies.dialog.name')}</label>
                            <Input
                                value={formData.name}
                                onChange={e => setFormData({ ...formData, name: e.target.value })}
                                placeholder={t('policies.dialog.name_placeholder')}
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm font-medium">{t('policies.dialog.description')}</label>
                            <Input
                                value={formData.description}
                                onChange={e => setFormData({ ...formData, description: e.target.value })}
                                placeholder={t('policies.dialog.desc_placeholder')}
                            />
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <label className="text-sm font-medium">{t('policies.dialog.effect')}</label>
                                <select
                                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-slate-800 dark:text-slate-200 dark:border-slate-600"
                                    value={formData.effect}
                                    onChange={e => setFormData({ ...formData, effect: e.target.value })}
                                >
                                    <option value="deny">{t('policies.effects.deny')}</option>
                                    <option value="allow">{t('policies.effects.allow')}</option>
                                </select>
                            </div>
                            <div className="space-y-2">
                                <label className="text-sm font-medium">{t('policies.dialog.actions')}</label>
                                <Input
                                    value={formData.actions}
                                    onChange={e => setFormData({ ...formData, actions: e.target.value })}
                                    placeholder={t('policies.dialog.actions_placeholder')}
                                />
                            </div>
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm font-medium">{t('policies.dialog.conditions')}</label>
                            <Textarea
                                value={formData.conditions}
                                onChange={e => setFormData({ ...formData, conditions: e.target.value })}
                                className="font-mono text-xs h-32"
                            />
                            <p className="text-xs text-slate-500">
                                {t('policies.dialog.context_help')}
                            </p>
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setIsDialogOpen(false)}>{t('policies.dialog.cancel')}</Button>
                        <Button onClick={handleSave}>{t('policies.dialog.save')}</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </AdminPageLayout>
    );
}
