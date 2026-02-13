
import { useState, useEffect } from 'react';
import { Save, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { useToast } from '@/components/ui/use-toast';
import { supabase } from '@/lib/customSupabaseClient';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { usePermissions } from '@/contexts/PermissionContext';
import { useTenant } from '@/contexts/TenantContext';

function ExtensionSettings() {
  const { toast } = useToast();
  const { isPlatformAdmin } = usePermissions();
  const { currentTenant } = useTenant();
  const [extensions, setExtensions] = useState([]);
  const [selectedExtension, setSelectedExtension] = useState(null);
  const [settings, setSettings] = useState({});
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetchActiveExtensions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTenant?.id, isPlatformAdmin]);

  const fetchActiveExtensions = async () => {
    try {
      let query = supabase
        .from('extensions')
        .select('id, name, config')
        .eq('is_active', true)
        .is('deleted_at', null);

      if (currentTenant?.id) {
        query = query.eq('tenant_id', currentTenant.id);
      } else if (!isPlatformAdmin) {
        query = query.eq('tenant_id', null);
      }

      const { data, error } = await query;

      if (error) throw error;
      setExtensions(data || []);
      if (data && data.length > 0) {
        setSelectedExtension(data[0].id);
        setSettings(data[0].config || {});
      }
    } catch (error) {
      console.error('Error fetching extensions:', error);
    }
  };

  const handleExtensionChange = (id) => {
    const ext = extensions.find(e => e.id === id);
    setSelectedExtension(id);
    setSettings(ext?.config || {});
  };

  const handleSave = async () => {
    if (!selectedExtension) return;
    setLoading(true);
    try {
      const { error } = await supabase
        .from('extensions')
        .update({ config: settings, updated_at: new Date().toISOString() })
        .eq('id', selectedExtension);

      if (error) throw error;

      toast({
        title: "Settings Saved",
        description: "Extension configuration updated successfully."
      });

      // Update local state
      setExtensions(prev => prev.map(e => e.id === selectedExtension ? { ...e, config: settings } : e));
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Save Failed",
        description: error.message
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Extension Configuration</CardTitle>
          <CardDescription>Manage individual settings for active extensions.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Select Extension</Label>
            <Select value={selectedExtension || ""} onValueChange={handleExtensionChange}>
              <SelectTrigger className="w-full md:w-[300px]">
                <SelectValue placeholder="Select extension to configure" />
              </SelectTrigger>
              <SelectContent>
                {extensions.map(ext => (
                  <SelectItem key={ext.id} value={ext.id}>{ext.name}</SelectItem>
                ))}
                {extensions.length === 0 && <SelectItem value="none" disabled>No active extensions</SelectItem>}
              </SelectContent>
            </Select>
          </div>

          {selectedExtension ? (
            <div className="border-t pt-4 space-y-4">
              <div className="bg-slate-50 p-4 rounded-md border border-slate-100 font-mono text-sm">
                <div className="flex justify-between items-center mb-2">
                  <Label>Raw Configuration (JSON)</Label>
                  <span className="text-xs text-slate-500">Editable</span>
                </div>
                <textarea
                  className="w-full h-64 p-2 bg-white border border-slate-200 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                  value={JSON.stringify(settings, null, 2)}
                  onChange={(e) => {
                    try {
                      setSettings(JSON.parse(e.target.value));
                    } catch {
                      // Allow typing, validate on save/blur or show error
                    }
                  }}
                />
              </div>
              <Button onClick={handleSave} disabled={loading}>
                {loading ? <RefreshCw className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
                Save Configuration
              </Button>
            </div>
          ) : (
            <div className="py-12 text-center text-slate-500">
              Select an extension to view its settings.
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default ExtensionSettings;
