import { useState, useEffect, useCallback, useMemo } from 'react';
import { Box, Search, RefreshCw } from 'lucide-react';
import { supabase } from '@/lib/customSupabaseClient';
import { PageHeader } from '@/templates/flowbite-admin';
import { Card } from '@/components/ui/card';
import { useToast } from '@/components/ui/use-toast';
import { useAdminMenu } from '@/hooks/useAdminMenu';
import { useTenant } from '@/contexts/TenantContext';
import { usePermissions } from '@/contexts/PermissionContext';
import { usePlugins } from '@/contexts/PluginContext';
import { filterMenuItemsForSidebar, normalizeMenuPath } from '@/lib/adminMenuUtils';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

const ModulesManager = () => {
  /* const supabase = useSupabaseClient(); - Replaced by global import */
  const { toast } = useToast();
  const { menuItems, loading: menuLoading } = useAdminMenu();
  const { currentTenant } = useTenant();
  const { hasPermission, isPlatformAdmin, isFullAccess, userRole } = usePermissions();
  const { applyFilters, registeredPlugins, externalPlugins } = usePlugins();

  const [modules, setModules] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');

  const isLoading = loading || menuLoading;

  const slugify = useCallback((value) => {
    return String(value || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '');
  }, []);

  const buildModuleSlug = useCallback((item) => {
    if (!item) return '';
    if (item.source === 'extension') {
      const extensionKey = item.key || 'extension';
      const menuPath = normalizeMenuPath(item.path);
      const slugSuffix = slugify(menuPath || item.label || 'menu');
      return `ext-${extensionKey}-${slugSuffix}`;
    }
    return item.key || item.id || '';
  }, [slugify]);

  const fetchModules = useCallback(async () => {
    setLoading(true);
    try {
      let query = supabase
        .from('modules')
        .select(`
          *,
          tenant:tenants(name)
        `)
        .order('created_at', { ascending: false });

      if (currentTenant?.id) {
        query = query.eq('tenant_id', currentTenant.id);
      }

      // If user is admin (restriced by RLS policies we just added), they only see their own.
      // Owner/SuperAdmin see all.

      const { data, error } = await query;

      if (error) throw error;
      setModules(data || []);
    } catch (error) {
      console.error('Error fetching modules:', error);
      toast({
        title: "Error",
        description: "Failed to load modules list",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [currentTenant?.id, toast]);

  useEffect(() => {
    fetchModules();
  }, [fetchModules]);

  const visibleMenuItems = useMemo(() => filterMenuItemsForSidebar({
    items: menuItems,
    hasPermission,
    isPlatformAdmin,
    isFullAccess,
    subscriptionTier: currentTenant?.subscription_tier,
    applyFilters,
    userRole
  }), [
    menuItems,
    hasPermission,
    isPlatformAdmin,
    isFullAccess,
    currentTenant?.subscription_tier,
    applyFilters,
    userRole,
    registeredPlugins,
    externalPlugins
  ]);

  const displayModules = useMemo(() => {
    const moduleMap = new Map(modules.map((module) => [module.slug, module]));
    const seen = new Set();

    const merged = visibleMenuItems
      .map((item) => {
        const slug = buildModuleSlug(item);
        if (!slug || seen.has(slug)) return null;
        seen.add(slug);
        const module = moduleMap.get(slug);
        return {
          id: module?.id || slug,
          name: module?.name || item.label,
          slug,
          description: module?.description || null,
          status: module?.status || 'missing',
          created_at: module?.created_at || null,
          tenant: module?.tenant || (currentTenant ? { name: currentTenant.name } : null),
          group_label: item.group_label,
          menu_path: item.path
        };
      })
      .filter(Boolean);

    if (!searchQuery) return merged;

    const query = searchQuery.toLowerCase();
    return merged.filter((module) => (
      module.name?.toLowerCase().includes(query) ||
      module.slug?.toLowerCase().includes(query) ||
      module.group_label?.toLowerCase().includes(query) ||
      module.menu_path?.toLowerCase().includes(query)
    ));
  }, [modules, visibleMenuItems, buildModuleSlug, searchQuery, currentTenant]);

  const getStatusBadge = (status) => {
    switch (status) {
      case 'active':
        return <Badge className="bg-green-100 text-green-800 hover:bg-green-100">Active</Badge>;
      case 'inactive':
        return <Badge className="bg-slate-100 text-slate-800 hover:bg-slate-100">Inactive</Badge>;
      case 'maintenance':
        return <Badge className="bg-yellow-100 text-yellow-800 hover:bg-yellow-100">Maintenance</Badge>;
      case 'missing':
        return <Badge className="bg-rose-100 text-rose-800 hover:bg-rose-100">Missing</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Module Management"
        description="Manage system modules and their status across tenants."
        icon={Box}
      />

      <Card className="p-6">
        <div className="flex flex-col md:flex-row gap-4 mb-6 justify-between items-center">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
            <Input
              placeholder="Search modules..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
            />
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={fetchModules} disabled={isLoading}>
              <RefreshCw className={`w-4 h-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
          </div>
        </div>

        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tenant</TableHead>
                <TableHead>Module Name</TableHead>
                <TableHead>Slug</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Created At</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array(5).fill(0).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell><div className="h-4 w-32 bg-slate-100 rounded animate-pulse" /></TableCell>
                    <TableCell><div className="h-4 w-40 bg-slate-100 rounded animate-pulse" /></TableCell>
                    <TableCell><div className="h-4 w-24 bg-slate-100 rounded animate-pulse" /></TableCell>
                    <TableCell><div className="h-4 w-48 bg-slate-100 rounded animate-pulse" /></TableCell>
                    <TableCell><div className="h-6 w-16 bg-slate-100 rounded-full animate-pulse" /></TableCell>
                    <TableCell><div className="h-4 w-24 bg-slate-100 rounded animate-pulse" /></TableCell>
                  </TableRow>
                ))
              ) : displayModules.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="h-32 text-center text-slate-500">
                    <div className="flex flex-col items-center justify-center p-4">
                      <Box className="w-8 h-8 mb-2 opacity-20" />
                      <p>No modules found</p>
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                displayModules.map((module) => (
                  <TableRow key={module.id}>
                    <TableCell className="font-medium">
                      {module.tenant?.name || <span className="text-slate-400 italic">Restricted</span>}
                    </TableCell>
                    <TableCell>{module.name}</TableCell>
                    <TableCell>
                      <code className="px-2 py-0.5 bg-slate-100 rounded text-xs font-mono text-slate-700">
                        {module.slug}
                      </code>
                    </TableCell>
                    <TableCell className="max-w-xs truncate" title={module.description}>
                      {module.description || '-'}
                    </TableCell>
                    <TableCell>{getStatusBadge(module.status)}</TableCell>
                    <TableCell className="text-slate-500 text-xs">
                      {new Date(module.created_at).toLocaleDateString()}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </Card>
    </div>
  );
};

export default ModulesManager;
