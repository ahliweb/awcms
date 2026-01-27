
import React, { useState } from 'react';
import { ArrowLeft, Save, Code, ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/use-toast';
import { supabase } from '@/lib/customSupabaseClient';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { usePermissions } from '@/contexts/PermissionContext';
import { useTenant } from '@/contexts/TenantContext';
import { useTranslation } from 'react-i18next';
import { syncExtensionToRegistry } from '@/utils/extensionLifecycle';

function ExtensionEditor({ extension = {}, onClose, onSave }) {
  const { toast } = useToast();
  const { t } = useTranslation();
  const { user } = useAuth();
  const { isPlatformAdmin, isFullAccess } = usePermissions();
  const { currentTenant } = useTenant();
  const [loading, setLoading] = useState(false);

  // Ownership check
  const isOwner = user?.id === extension.created_by;
  const isSuperAdmin = isPlatformAdmin || isFullAccess;
  const canEdit = !extension.id || isOwner || isSuperAdmin;

  const [formData, setFormData] = useState({
    name: extension.name || '',
    slug: extension.slug || '',
    version: extension.version || '1.0.0',
    description: extension.description || '',
    author: extension.author || user?.user_metadata?.full_name || 'Admin',
    icon: extension.icon || '🧩',
    config: extension.config ? JSON.stringify(extension.config, null, 2) : '{\n  "routes": [],\n  "permissions": []\n}'
  });

  const handleSave = async (e) => {
    e.preventDefault();

    if (!canEdit) {
      toast({ variant: "destructive", title: t('common.access_denied'), description: "You cannot edit extensions you do not own." });
      return;
    }

    setLoading(true);

    try {
      // Validate JSON config
      let parsedConfig;
      try {
        parsedConfig = JSON.parse(formData.config);
      } catch (err) {
        throw new Error("Invalid JSON configuration. Please check format.");
      }

      const payload = {
        name: formData.name,
        slug: formData.slug.toLowerCase().replace(/\s+/g, '-'),
        version: formData.version,
        description: formData.description,
        author: formData.author,
        icon: formData.icon,
        config: parsedConfig,
        updated_at: new Date().toISOString()
      };

      let extensionId;

      if (extension.id) {
        // Update existing
        const { error: updateError } = await supabase
          .from('extensions')
          .update(payload)
          .eq('id', extension.id);

        if (updateError) throw updateError;
        extensionId = extension.id;

      } else {
        // Create new
        payload.created_by = user.id;
        payload.is_active = true; // Default active on creation
        payload.tenant_id = currentTenant?.id || null;
        const { data, error: insertError } = await supabase
          .from('extensions')
          .insert([payload])
          .select()
          .single();

        if (insertError) throw insertError;
        extensionId = data.id;
      }

      // Sync lifecycle
      await syncExtensionToRegistry(extensionId, parsedConfig);

      toast({
        title: t('common.success'),
        description: extension.id ? "Extension updated successfully." : "Extension created successfully."
      });

      onSave();
    } catch (error) {
      toast({
        variant: "destructive",
        title: t('common.error'),
        description: error.message
      });
    } finally {
      setLoading(false);
    }
  };

  if (!canEdit) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={onClose}>
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <h2 className="text-2xl font-bold text-slate-800">Extension Details</h2>
        </div>
        <div className="bg-red-50 p-6 rounded-lg border border-red-200 text-center">
          <ShieldAlert className="w-12 h-12 text-red-500 mx-auto mb-3" />
          <h3 className="text-lg font-bold text-red-700">Read Only Mode</h3>
          <p className="text-red-600">You do not have permission to edit this extension.</p>
        </div>
        <div className="bg-white p-6 rounded-lg border border-slate-200">
          <pre className="text-xs text-slate-500 overflow-auto">{JSON.stringify(extension, null, 2)}</pre>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={onClose}>
          <ArrowLeft className="w-5 h-5" />
        </Button>
        <div>
          <h2 className="text-2xl font-bold text-slate-800">
            {extension.id ? `Edit ${extension.name}` : 'New Extension'}
          </h2>
          <p className="text-slate-500">Configure extension metadata and settings</p>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <form onSubmit={handleSave} className="p-6 space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <Label>Extension Name</Label>
              <Input
                value={formData.name}
                onChange={e => setFormData({ ...formData, name: e.target.value })}
                placeholder="My Awesome Plugin"
                required
              />
            </div>

            <div className="space-y-2">
              <Label>Slug (Unique ID)</Label>
              <Input
                value={formData.slug}
                onChange={e => setFormData({ ...formData, slug: e.target.value })}
                placeholder="my-awesome-plugin"
                required
              />
            </div>

            <div className="space-y-2">
              <Label>Version</Label>
              <Input
                value={formData.version}
                onChange={e => setFormData({ ...formData, version: e.target.value })}
                placeholder="1.0.0"
                required
              />
            </div>

            <div className="space-y-2">
              <Label>Author</Label>
              <Input
                value={formData.author}
                onChange={e => setFormData({ ...formData, author: e.target.value })}
                placeholder="Developer Name"
              />
            </div>

            <div className="space-y-2">
              <Label>Icon Emoji</Label>
              <div className="flex gap-2">
                <div className="w-10 h-10 bg-slate-100 rounded-lg flex items-center justify-center text-xl border border-slate-200">
                  {formData.icon || '🧩'}
                </div>
                <Input
                  value={formData.icon}
                  onChange={e => setFormData({ ...formData, icon: e.target.value })}
                  placeholder="🧩"
                  maxLength={2}
                  className="w-20"
                />
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Description</Label>
            <Textarea
              value={formData.description}
              onChange={e => setFormData({ ...formData, description: e.target.value })}
              placeholder="What does this extension do?"
              className="h-20"
            />
          </div>

          <div className="space-y-2">
            <div className="flex justify-between items-center">
              <Label className="flex items-center gap-2">
                <Code className="w-4 h-4 text-slate-500" />
                Configuration (JSON)
              </Label>
              <span className="text-xs text-slate-400">Define routes, menus, and permissions</span>
            </div>
            <Textarea
              value={formData.config}
              onChange={e => setFormData({ ...formData, config: e.target.value })}
              className="font-mono text-sm h-64 bg-slate-50"
              spellCheck="false"
            />
          </div>

          <div className="pt-4 flex justify-end border-t border-slate-100">
            <Button type="submit" disabled={loading} className="bg-blue-600 hover:bg-blue-700">
              {loading ? t('common.saving') : (
                <>
                  <Save className="w-4 h-4 mr-2" />
                  {t('common.save')}
                </>
              )}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default ExtensionEditor;
