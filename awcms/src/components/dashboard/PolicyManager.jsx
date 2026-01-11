import React, { useState, useEffect, useCallback } from 'react';
import { usePermissions } from '@/contexts/PermissionContext';
import { supabase } from '@/lib/customSupabaseClient';
import { useToast } from '@/components/ui/use-toast';
import { Plus, Trash2, Edit2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';

export default function PolicyManager() {
    const { tenantId, hasPermission, isPlatformAdmin } = usePermissions();
    const { toast } = useToast();
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
            toast({ variant: "destructive", title: "Error", description: "Failed to load policies." });
        } finally {
            setLoading(false);
        }
    }, [toast]);

    useEffect(() => {
        if (canView) {
            fetchPolicies();
        }
    }, [tenantId, canView, fetchPolicies]);

    if (!canView) return <div className="p-8 text-center text-red-500">Access Denied</div>;

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
            } catch (e) {
                toast({ variant: "destructive", title: "Invalid JSON", description: "Conditions must be valid JSON." });
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

            toast({ title: "Success", description: `Policy ${editingPolicy ? 'updated' : 'created'} successfully.` });
            setIsDialogOpen(false);
            fetchPolicies();

        } catch (err) {
            console.error('Error saving policy:', err);
            toast({ variant: "destructive", title: "Save Failed", description: err.message });
        }
    };

    const handleDelete = async (id) => {
        if (!window.confirm('Are you sure you want to delete this policy?')) return;

        try {
            const { error } = await supabase
                .from('policies')
                .update({ deleted_at: new Date().toISOString() })
                .eq('id', id);
            if (error) throw error;
            toast({ title: "Deleted", description: "Policy moved to trash." });
            fetchPolicies();
        } catch (err) {
            toast({ variant: "destructive", title: "Delete Failed", description: err.message });
        }
    };

    return (
        <div className="space-y-4">
            <div className="flex justify-between items-center">
                <div>
                    <h2 className="text-2xl font-bold tracking-tight">Policy Manager</h2>
                    <p className="text-slate-500 text-sm">Define ABAC rules for fine-grained access control.</p>
                </div>
                {canManage && (
                    <Button onClick={() => handleOpenDialog()}>
                        <Plus className="w-4 h-4 mr-2" /> New Policy
                    </Button>
                )}
            </div>

            <div className="bg-white rounded-md border shadow-sm">
                <div className="overflow-x-auto">
                    <table className="w-full text-sm text-left">
                        <thead className="bg-slate-50 text-slate-500 font-medium border-b">
                            <tr>
                                <th className="px-4 py-3">Policy Name</th>
                                <th className="px-4 py-3">Effect</th>
                                <th className="px-4 py-3">Actions</th>
                                <th className="px-4 py-3">Conditions</th>
                                <th className="px-4 py-3 text-right">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y">
                            {loading ? (
                                <tr><td colSpan="5" className="p-8 text-center text-slate-400">Loading policies...</td></tr>
                            ) : policies.length === 0 ? (
                                <tr><td colSpan="5" className="p-8 text-center text-slate-400">No policies defined.</td></tr>
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
                                                {policy.definition?.effect}
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
                        <DialogTitle>{editingPolicy ? 'Edit Policy' : 'Create ABAC Policy'}</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                        <div className="space-y-2">
                            <label className="text-sm font-medium">Name</label>
                            <Input
                                value={formData.name}
                                onChange={e => setFormData({ ...formData, name: e.target.value })}
                                placeholder="e.g. Deny Mobile Deletion"
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm font-medium">Description</label>
                            <Input
                                value={formData.description}
                                onChange={e => setFormData({ ...formData, description: e.target.value })}
                                placeholder="Explain what this policy does"
                            />
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <label className="text-sm font-medium">Effect</label>
                                <select
                                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                                    value={formData.effect}
                                    onChange={e => setFormData({ ...formData, effect: e.target.value })}
                                >
                                    <option value="deny">Deny</option>
                                    <option value="allow">Allow</option>
                                </select>
                            </div>
                            <div className="space-y-2">
                                <label className="text-sm font-medium">Actions</label>
                                <Input
                                    value={formData.actions}
                                    onChange={e => setFormData({ ...formData, actions: e.target.value })}
                                    placeholder="delete, edit_users, *"
                                />
                            </div>
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm font-medium">Conditions (JSON)</label>
                            <Textarea
                                value={formData.conditions}
                                onChange={e => setFormData({ ...formData, conditions: e.target.value })}
                                className="font-mono text-xs h-32"
                            />
                            <p className="text-xs text-slate-500">
                                Available context: channel, time, ip_address
                            </p>
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setIsDialogOpen(false)}>Cancel</Button>
                        <Button onClick={handleSave}>Save Policy</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
