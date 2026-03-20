import { useState, useMemo } from 'react';
import { Box, Search, RefreshCw, RotateCcw } from 'lucide-react';
import { PageHeader, AdminPageLayout } from '@/templates/flowbite-admin';
import { Card } from '@/components/ui/card';
import { usePermissions } from '@/contexts/PermissionContext';
import { useModules } from '@/hooks/useModules';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const formatCreatedAt = (value) => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleDateString();
};

// ─── Status badge — semantic tokens only ─────────────────────────────────────

const StatusBadge = ({ status }) => {
  switch (status) {
    case 'active':
      return (
        <Badge className="border-transparent bg-primary/10 text-primary hover:bg-primary/10">
          Active
        </Badge>
      );
    case 'inactive':
      return (
        <Badge className="border-transparent bg-muted text-muted-foreground hover:bg-muted">
          Inactive
        </Badge>
      );
    case 'maintenance':
      return (
        <Badge className="border-transparent bg-accent text-accent-foreground hover:bg-accent">
          Maintenance
        </Badge>
      );
    default:
      return <Badge variant="outline">{status || '—'}</Badge>;
  }
};

// ─── Component ────────────────────────────────────────────────────────────────

const ModulesManager = () => {
  const { isPlatformAdmin, isFullAccess } = usePermissions();

  const {
    modules,
    loading,
    toggling,
    canManage,
    fetchModules,
    syncModules,
    toggleModuleStatus,
  } = useModules();

  const [searchQuery, setSearchQuery] = useState('');

  const isPlatformUser = isPlatformAdmin || isFullAccess;

  // ─── Filtered list ──────────────────────────────────────────────────────
  const displayModules = useMemo(() => {
    if (!searchQuery) return modules;
    const q = searchQuery.toLowerCase();
    return modules.filter(
      (m) =>
        m.name?.toLowerCase().includes(q) ||
        m.slug?.toLowerCase().includes(q) ||
        m.status?.toLowerCase().includes(q) ||
        m.tenant?.name?.toLowerCase().includes(q) ||
        m.description?.toLowerCase().includes(q) ||
        m.group_label?.toLowerCase().includes(q)
    );
  }, [modules, searchQuery]);

  // ─── Render ─────────────────────────────────────────────────────────────
  return (
    <AdminPageLayout
      requiredPermission={['platform.module.read', 'platform.module.manage']}
      loading={false}
    >
      <div className="space-y-6">
        <PageHeader
          title="Module Management"
          description="Enable or disable modules across tenants. Platform admins can sync from the sidebar registry."
          icon={Box}
          breadcrumbs={[
            { label: 'Platform', href: '/cmspanel' },
            { label: 'Modules' },
          ]}
          actions={
            isPlatformUser && canManage ? (
              <Button
                variant="outline"
                size="sm"
                onClick={syncModules}
                disabled={loading}
              >
                <RotateCcw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
                Sync from Sidebar
              </Button>
            ) : null
          }
        />

        <Card className="p-6 dashboard-surface">
          {/* ── Toolbar ── */}
          <div className="flex flex-col md:flex-row gap-4 mb-6 justify-between items-center">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-2.5 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search modules…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
              />
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={fetchModules}
              disabled={loading}
            >
              <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
          </div>

          {/* ── Table ── */}
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  {isPlatformUser && <TableHead>Tenant</TableHead>}
                  <TableHead>Module Name</TableHead>
                  <TableHead>Slug</TableHead>
                  <TableHead>Status</TableHead>
                  {canManage && <TableHead className="text-center">Toggle</TableHead>}
                  <TableHead>Created At</TableHead>
                </TableRow>
              </TableHeader>

              <TableBody>
                {loading ? (
                  Array(5)
                    .fill(0)
                    .map((_, i) => (
                      <TableRow key={i}>
                        {isPlatformUser && (
                          <TableCell>
                            <div className="h-4 w-32 bg-muted rounded animate-pulse" />
                          </TableCell>
                        )}
                        <TableCell>
                          <div className="h-4 w-40 bg-muted rounded animate-pulse" />
                        </TableCell>
                        <TableCell>
                          <div className="h-4 w-24 bg-muted rounded animate-pulse" />
                        </TableCell>
                        <TableCell>
                          <div className="h-6 w-16 bg-muted rounded-full animate-pulse" />
                        </TableCell>
                        {canManage && (
                          <TableCell>
                            <div className="h-5 w-9 bg-muted rounded-full animate-pulse mx-auto" />
                          </TableCell>
                        )}
                        <TableCell>
                          <div className="h-4 w-24 bg-muted rounded animate-pulse" />
                        </TableCell>
                      </TableRow>
                    ))
                ) : displayModules.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={isPlatformUser ? (canManage ? 6 : 5) : (canManage ? 5 : 4)}
                      className="h-32 text-center text-muted-foreground"
                    >
                      <div className="flex flex-col items-center justify-center p-4">
                        <Box className="w-8 h-8 mb-2 opacity-20" />
                        <p>No modules found</p>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : (
                  displayModules.map((module) => (
                    <TableRow key={module.id}>
                      {isPlatformUser && (
                        <TableCell className="font-medium">
                          {module.tenant?.name ?? (
                            <span className="text-muted-foreground italic">Restricted</span>
                          )}
                        </TableCell>
                      )}
                      <TableCell>{module.name}</TableCell>
                      <TableCell>
                        <code className="px-2 py-0.5 bg-muted rounded text-xs font-mono text-foreground">
                          {module.slug}
                        </code>
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={module.status} />
                      </TableCell>
                      {canManage && (
                        <TableCell className="text-center">
                          {/* Only active/inactive are toggleable; maintenance is left alone */}
                          {module.status === 'maintenance' ? (
                            <span className="text-xs text-muted-foreground">—</span>
                          ) : (
                            <Switch
                              checked={module.status === 'active'}
                              disabled={toggling === module.id || !module.id}
                              onCheckedChange={() =>
                                toggleModuleStatus(module.id, module.status)
                              }
                              aria-label={`Toggle ${module.name}`}
                            />
                          )}
                        </TableCell>
                      )}
                      <TableCell className="text-muted-foreground text-xs">
                        {formatCreatedAt(module.created_at)}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>

          {/* ── Module count ── */}
          {!loading && displayModules.length > 0 && (
            <p className="mt-3 text-xs text-muted-foreground text-right">
              {searchQuery
                ? `${displayModules.length} of ${modules.length} modules matching search`
                : `${modules.length} modules`
              }
            </p>
          )}
        </Card>
      </div>
    </AdminPageLayout>
  );
};

export default ModulesManager;
