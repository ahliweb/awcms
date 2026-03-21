/**
 * PortalSitesManager - Manage public portal site URLs per tenant.
 *
 * Allows tenant admins to add/edit/remove portal sites (e.g., primary,
 * smandapbun) so the PageEditor preview and other features can target
 * the correct portal.
 */
import { useState } from 'react';
import { Globe, Plus, Trash2, Save, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/use-toast';
import { useTranslation } from 'react-i18next';
import { usePortalSites } from '@/hooks/usePortalSites';

export default function PortalSitesManager() {
    const { t } = useTranslation();
    const { portals, loading, savePortals } = usePortalSites();
    const { toast } = useToast();
    const [localPortals, setLocalPortals] = useState(null);
    const [saving, setSaving] = useState(false);

    // Use local copy once user starts editing
    const currentPortals = localPortals ?? portals;

    const handleChange = (idx, field, value) => {
        const updated = [...currentPortals];
        updated[idx] = { ...updated[idx], [field]: value };
        setLocalPortals(updated);
    };

    const handleAdd = () => {
        setLocalPortals([...currentPortals, { name: '', url: '' }]);
    };

    const handleRemove = (idx) => {
        if (currentPortals.length <= 1) {
            toast({ variant: 'destructive', title: t('common.error'), description: t('portal_sites.toast.error_min') });
            return;
        }
        const updated = currentPortals.filter((_, i) => i !== idx);
        setLocalPortals(updated);
    };

    const handleSave = async () => {
        for (const portal of currentPortals) {
            if (!portal.name?.trim() || !portal.url?.trim()) {
                toast({ variant: 'destructive', title: t('common.validation_error'), description: t('portal_sites.toast.error_validation') });
                return;
            }
            try {
                new URL(portal.url);
            } catch {
                toast({ variant: 'destructive', title: t('common.invalid_url'), description: `"${portal.url}" ${t('portal_sites.toast.error_invalid_url')}` });
                return;
            }
        }

        setSaving(true);
        const { error } = await savePortals(currentPortals);
        setSaving(false);

        if (error) {
            toast({ variant: 'destructive', title: t('portal_sites.toast.save_error'), description: error });
        } else {
            setLocalPortals(null);
            toast({ title: t('common.saved'), description: t('portal_sites.toast.save_success') });
        }
    };

    if (loading) {
        return (
            <div className="bg-card p-6 rounded-xl border border-border shadow-sm">
                <div className="flex items-center gap-2 text-muted-foreground">
                    <Loader2 className="w-4 h-4 animate-spin" /> {t('portal_sites.loading')}
                </div>
            </div>
        );
    }

    return (
        <div className="bg-card p-6 rounded-xl border border-border shadow-sm space-y-4">
            <div className="flex items-center justify-between border-b border-border/60 pb-3">
                <h4 className="font-semibold text-foreground flex items-center gap-2 text-base">
                    <Globe className="w-4 h-4 text-primary" /> {t('portal_sites.title')}
                </h4>
                <Button variant="outline" size="sm" onClick={handleAdd}>
                    <Plus className="w-4 h-4 mr-1" /> {t('portal_sites.add_portal')}
                </Button>
            </div>

            <p className="text-xs text-muted-foreground">
                {t('portal_sites.description')}
            </p>

            <div className="space-y-3">
                {currentPortals.map((portal, idx) => (
                    <div key={idx} className="flex items-end gap-3 p-3 bg-muted/40 rounded-lg border border-border/60">
                        <div className="flex-1 space-y-1">
                            <Label className="text-xs text-muted-foreground">{t('portal_sites.field_name')}</Label>
                            <Input
                                value={portal.name}
                                onChange={(e) => handleChange(idx, 'name', e.target.value)}
                                placeholder="e.g., Primary, Smandapbun"
                                className="h-9"
                            />
                        </div>
                        <div className="flex-[2] space-y-1">
                            <Label className="text-xs text-muted-foreground">{t('portal_sites.field_url')}</Label>
                            <Input
                                value={portal.url}
                                onChange={(e) => handleChange(idx, 'url', e.target.value)}
                                placeholder="https://example.com"
                                className="h-9 font-mono text-sm"
                            />
                        </div>
                        <Button
                            variant="ghost"
                            size="icon"
                            className="text-destructive hover:text-destructive hover:bg-destructive/10 h-9 w-9"
                            onClick={() => handleRemove(idx)}
                            disabled={currentPortals.length <= 1}
                        >
                            <Trash2 className="w-4 h-4" />
                        </Button>
                    </div>
                ))}
            </div>

            {localPortals && (
                <div className="flex justify-end pt-2">
                    <Button onClick={handleSave} disabled={saving} size="sm">
                        {saving ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Save className="w-4 h-4 mr-1" />}
                        {saving ? t('portal_sites.saving') : t('portal_sites.save')}
                    </Button>
                </div>
            )}
        </div>
    );
}
