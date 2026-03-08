import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { RefreshCw, Save } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/components/ui/use-toast';
import { supabase } from '@/lib/customSupabaseClient';
import { usePermissions } from '@/contexts/PermissionContext';
import { useTenant } from '@/contexts/TenantContext';
import { encodeRouteParam } from '@/lib/routeSecurity';
import useSecureRouteParam from '@/hooks/useSecureRouteParam';

function ExtensionSettings() {
  const { toast } = useToast();
  const { isPlatformAdmin } = usePermissions();
  const { currentTenant } = useTenant();
  const navigate = useNavigate();
  const { id: routeParam } = useParams();
  const { value: extensionId, loading: routeLoading, isLegacy } = useSecureRouteParam(routeParam, 'extensions.settings');
  const [extensions, setExtensions] = useState([]);
  const [selectedExtension, setSelectedExtension] = useState(null);
  const [settings, setSettings] = useState({});
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!routeParam || routeLoading) return;
    if (!extensionId) {
      navigate('/cmspanel/extensions');
      return;
    }
    if (!isLegacy) return;

    const redirectLegacy = async () => {
      const signedId = await encodeRouteParam({ value: extensionId, scope: 'extensions.settings' });
      if (!signedId || signedId === routeParam) return;
      navigate(`/cmspanel/extensions/settings/${signedId}`, { replace: true });
    };

    redirectLegacy();
  }, [extensionId, isLegacy, navigate, routeLoading, routeParam]);

  useEffect(() => {
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
          const preferred = extensionId ? data.find((extension) => extension.id === extensionId) : null;
          const next = preferred || data[0];
          setSelectedExtension(next.id);
          setSettings(next.config || {});
        }
      } catch (error) {
        console.error('Error fetching extensions:', error);
      }
    };

    fetchActiveExtensions();
  }, [currentTenant?.id, extensionId, isPlatformAdmin]);

  const handleExtensionChange = (id) => {
    const extension = extensions.find((item) => item.id === id);
    setSelectedExtension(id);
    setSettings(extension?.config || {});
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
        title: 'Settings Saved',
        description: 'Extension configuration updated successfully.',
      });

      setExtensions((prev) => prev.map((item) => (
        item.id === selectedExtension ? { ...item, config: settings } : item
      )));
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Save Failed',
        description: error.message,
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <Card className="border-border/60 bg-card/75">
        <CardHeader>
          <CardTitle>Extension Configuration</CardTitle>
          <CardDescription>Manage individual settings for active extensions.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Select Extension</Label>
            <Select value={selectedExtension || ''} onValueChange={handleExtensionChange}>
              <SelectTrigger className="w-full md:w-[300px]">
                <SelectValue placeholder="Select extension to configure" />
              </SelectTrigger>
              <SelectContent>
                {extensions.map((extension) => (
                  <SelectItem key={extension.id} value={extension.id}>{extension.name}</SelectItem>
                ))}
                {extensions.length === 0 ? <SelectItem value="none" disabled>No active extensions</SelectItem> : null}
              </SelectContent>
            </Select>
          </div>

          {selectedExtension ? (
            <div className="space-y-4 border-t pt-4">
              <div className="rounded-xl border border-border/60 bg-card/65 p-4 font-mono text-sm">
                <div className="mb-2 flex items-center justify-between">
                  <Label>Raw Configuration (JSON)</Label>
                  <span className="text-xs text-muted-foreground">Editable</span>
                </div>
                <textarea
                  className="h-64 w-full rounded-lg border border-border/70 bg-background p-2 text-foreground outline-none focus:ring-2 focus:ring-primary/30"
                  value={JSON.stringify(settings, null, 2)}
                  onChange={(event) => {
                    try {
                      setSettings(JSON.parse(event.target.value));
                    } catch {
                      // Keep allowing edits while JSON is incomplete.
                    }
                  }}
                />
              </div>

              <Button onClick={handleSave} disabled={loading} className="rounded-xl bg-primary text-primary-foreground hover:opacity-95">
                {loading ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                Save Configuration
              </Button>
            </div>
          ) : (
            <div className="py-12 text-center text-muted-foreground">
              Select an extension to view its settings.
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default ExtensionSettings;
