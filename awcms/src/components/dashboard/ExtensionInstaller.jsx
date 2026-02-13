
import { useState } from 'react';
import { Upload, FileJson } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { useToast } from '@/components/ui/use-toast';
import { supabase } from '@/lib/customSupabaseClient';
import { syncExtensionToRegistry } from '@/utils/extensionLifecycle';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { usePermissions } from '@/contexts/PermissionContext';
import { useTenant } from '@/contexts/TenantContext';

function ExtensionInstaller({ onInstallComplete }) {
  const { toast } = useToast();
  const { user } = useAuth();
  const { hasPermission, isPlatformAdmin, isFullAccess } = usePermissions();
  const { currentTenant } = useTenant();
  const [dragActive, setDragActive] = useState(false);
  const [preview, setPreview] = useState(null);
  const [installing, setInstalling] = useState(false);

  // Permission check - only platform admins or platform.module.create can install
  const isSuperAdmin = isPlatformAdmin || isFullAccess;
  const canInstall = isSuperAdmin || hasPermission('platform.module.create') || hasPermission('ext.manage');

  const handleDrag = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      processFile(e.dataTransfer.files[0]);
    }
  };

  const handleFileChange = (e) => {
    if (e.target.files && e.target.files[0]) {
      processFile(e.target.files[0]);
    }
  };

  const processFile = (file) => {
    if (file.type !== "application/json" && !file.name.endsWith('.json')) {
      toast({ variant: "destructive", title: "Invalid File", description: "Please upload a valid JSON configuration file." });
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const json = JSON.parse(e.target.result);
        setPreview(json);
      } catch {
        toast({ variant: "destructive", title: "Parse Error", description: "Could not parse JSON." });
        setPreview(null);
      }
    };
    reader.readAsText(file);
  };

  const handleInstall = async () => {
    if (!canInstall) {
      toast({ variant: "destructive", title: "Access Denied", description: "You do not have permission to install extensions." });
      return;
    }
    if (!preview) return;
    setInstalling(true);

    try {
      // 1. Create Extension Record
      const payload = {
        name: preview.name || 'Untitled Extension',
        slug: preview.slug || `ext-${Date.now()}`,
        description: preview.description,
        version: preview.version || '1.0.0',
        author: preview.author || user.email,
        icon: preview.icon || '🧩',
        is_active: true,
        config: preview,
        created_by: user.id,
        tenant_id: currentTenant?.id || null
      };

      const { data, error } = await supabase.from('extensions').insert([payload]).select().single();
      if (error) throw error;

      // 2. Run Lifecycle Sync
      await syncExtensionToRegistry(data.id, preview);

      toast({
        title: "Extension Installed",
        description: `${payload.name} has been successfully added to the system.`
      });

      setPreview(null);
      if (onInstallComplete) onInstallComplete();

    } catch (error) {
      console.error(error);
      toast({ variant: "destructive", title: "Installation Failed", description: error.message });
    } finally {
      setInstalling(false);
    }
  };

  return (
    <div className="space-y-6">
      <div
        className={`border-2 border-dashed rounded-xl p-10 text-center transition-colors ${dragActive ? 'border-blue-500 bg-blue-50' : 'border-slate-200 hover:bg-slate-50'}`}
        onDragEnter={handleDrag}
        onDragLeave={handleDrag}
        onDragOver={handleDrag}
        onDrop={handleDrop}
      >
        <input type="file" id="ext-file" className="hidden" accept=".json" onChange={handleFileChange} />
        <label htmlFor="ext-file" className="cursor-pointer flex flex-col items-center">
          <div className="w-16 h-16 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center mb-4">
            <Upload className="w-8 h-8" />
          </div>
          <h3 className="text-lg font-bold text-slate-700">Upload Extension Config</h3>
          <p className="text-slate-500 mb-4">Drag & drop a .json file here, or click to select</p>
          <Button variant="outline" onClick={() => document.getElementById('ext-file').click()}>Select File</Button>
        </label>
      </div>

      {preview && (
        <Card className="border-blue-200 bg-blue-50/30">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileJson className="w-5 h-5 text-blue-600" />
              {preview.name || 'Unknown Name'}
            </CardTitle>
            <CardDescription>Version {preview.version} • by {preview.author}</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-slate-600 mb-4">{preview.description}</p>
            <div className="space-y-2">
              <div className="flex gap-2 text-xs font-mono">
                <span className="bg-white px-2 py-1 rounded border">Routes: {preview.routes?.length || 0}</span>
                <span className="bg-white px-2 py-1 rounded border">Menus: {preview.menus?.length || 0}</span>
                <span className="bg-white px-2 py-1 rounded border">Permissions: {preview.permissions?.length || 0}</span>
              </div>
            </div>
            <div className="mt-6 flex justify-end">
              <Button onClick={handleInstall} disabled={installing} className="bg-blue-600 hover:bg-blue-700">
                {installing ? 'Installing...' : 'Confirm Installation'}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export default ExtensionInstaller;
