import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Box, ChevronRight, Home, Layers3, RefreshCw, RotateCcw, Search, ShieldCheck } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { usePermissions } from '@/contexts/PermissionContext';
import { useModules } from '@/hooks/useModules';
import useSplatSegments from '@/hooks/useSplatSegments';
import { cn } from '@/lib/utils';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

const formatCreatedAt = (value) => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleDateString();
};

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

const MODULE_VIEW_SEGMENTS = ['overview'];

const ModulesManager = () => {
  const navigate = useNavigate();
  const segments = useSplatSegments();
  const { isPlatformAdmin, isFullAccess, hasPermission } = usePermissions();
  const {
    modules,
    loading,
    syncing,
    toggling,
    canManage,
    canRead,
    fetchModules,
    syncModules,
    toggleModuleStatus,
  } = useModules();

  const [searchQuery, setSearchQuery] = useState('');

  const isPlatformUser = isPlatformAdmin || isFullAccess;
  const activeView = MODULE_VIEW_SEGMENTS.includes(segments[0]) ? segments[0] : 'overview';
  const showOverview = activeView === 'overview';
  const canViewModules = canRead || hasPermission('platform.module.read');

  useEffect(() => {
    if (segments.length === 0) {
      return;
    }

    if (!MODULE_VIEW_SEGMENTS.includes(segments[0])) {
      navigate('/cmspanel/modules', { replace: true });
      return;
    }

    if (segments[0] === 'overview' && segments.length > 1) {
      navigate('/cmspanel/modules/overview', { replace: true });
    }
  }, [segments, navigate]);

  const displayModules = useMemo(() => {
    if (!searchQuery) return modules;
    const q = searchQuery.toLowerCase();
    return modules.filter(
      (module) =>
        module.name?.toLowerCase().includes(q)
        || module.slug?.toLowerCase().includes(q)
        || module.status?.toLowerCase().includes(q)
        || module.tenant?.name?.toLowerCase().includes(q)
        || module.description?.toLowerCase().includes(q)
        || module.group_label?.toLowerCase().includes(q)
    );
  }, [modules, searchQuery]);

  const activeCount = modules.filter((module) => module.status === 'active').length;
  const inactiveCount = modules.filter((module) => module.status === 'inactive').length;
  const maintenanceCount = modules.filter((module) => module.status === 'maintenance').length;

  const summaryCards = [
    {
      title: 'Available Modules',
      value: modules.length,
      description: 'Tenant and platform module registrations currently visible in this workspace.',
      accent: 'from-primary/15 via-primary/6 to-transparent',
    },
    {
      title: 'Active Toggles',
      value: activeCount,
      description: `${inactiveCount} inactive modules remain available for controlled re-enablement.`,
      accent: 'from-sky-500/15 via-sky-500/6 to-transparent',
    },
    {
      title: 'Registry Health',
      value: maintenanceCount > 0 ? 'Review' : 'Stable',
      description: maintenanceCount > 0
        ? `${maintenanceCount} modules are locked in maintenance state and cannot be toggled here.`
        : 'Sidebar registry sync and tenant toggles are currently aligned.',
      accent: maintenanceCount > 0 ? 'from-amber-500/15 via-amber-500/6 to-transparent' : 'from-emerald-500/15 via-emerald-500/6 to-transparent',
    },
  ];

  const summaryContent = showOverview ? (
    <div className="mb-8 grid gap-4 md:grid-cols-3">
      {summaryCards.map((card) => (
        <Card key={card.title} className="overflow-hidden rounded-2xl border-border/70 shadow-sm">
          <CardContent className="relative p-5">
            <div className={cn('pointer-events-none absolute inset-0 bg-gradient-to-br', card.accent)} />
            <div className="relative">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">{card.title}</p>
              <p className="mt-3 text-4xl font-semibold leading-none text-foreground">{card.value}</p>
              <p className="mt-3 max-w-xs text-sm leading-6 text-muted-foreground">{card.description}</p>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  ) : null;

  if (!canViewModules) {
    return (
      <div className="flex min-h-[400px] flex-col items-center justify-center rounded-xl border border-border bg-card p-12 text-center">
        <div className="mb-4 rounded-full bg-destructive/10 p-4">
          <Box className="h-12 w-12 text-destructive" />
        </div>
        <h3 className="text-xl font-bold text-foreground">Access Denied</h3>
        <p className="mt-2 text-muted-foreground">You do not have permission to view the Modules module.</p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="space-y-3">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Link to="/cmspanel" className="flex items-center gap-1 transition-colors hover:text-foreground">
            <Home className="h-4 w-4" />
            <span>Dashboard</span>
          </Link>
          <ChevronRight className="h-4 w-4" />
          <span className="font-medium text-foreground">Modules</span>
        </div>

        <div className="rounded-3xl border border-border/70 bg-gradient-to-br from-background via-background to-primary/5 p-6 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="space-y-1.5">
              <div className="flex items-center gap-3">
                <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary shadow-sm">
                  <Box className="h-5 w-5" />
                </span>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">System Registry</p>
                  <p className="text-lg font-semibold text-foreground">Module Management</p>
                </div>
              </div>
              <p className="max-w-3xl text-sm text-muted-foreground">
                Enable or disable tenant modules, keep sidebar-driven registrations synchronized, and maintain refresh-safe `/cmspanel/modules` views.
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <Badge variant="secondary" className="rounded-full border border-border/70 bg-background/80 px-3 py-1 text-xs font-medium shadow-sm">
                {modules.length} registered modules
              </Badge>
              <Badge variant="secondary" className="rounded-full border border-border/70 bg-background/80 px-3 py-1 text-xs font-medium shadow-sm">
                {isPlatformUser ? 'Platform scope' : 'Tenant scope'}
              </Badge>
            </div>
          </div>

          <div className="mt-5 flex flex-wrap gap-3 text-sm text-muted-foreground">
            <span className="inline-flex items-center gap-2 rounded-full bg-background/70 px-3 py-1.5 shadow-sm">
              <Layers3 className="h-4 w-4 text-primary" />
              Refresh-safe `/cmspanel/modules` routes
            </span>
            <span className="inline-flex items-center gap-2 rounded-full bg-background/70 px-3 py-1.5 shadow-sm">
              <ShieldCheck className="h-4 w-4 text-emerald-600" />
              Tenant-aware toggles and platform-safe registry sync
            </span>
          </div>
        </div>
      </div>

      {showOverview ? (
        <div className="rounded-[28px] border border-border/60 bg-gradient-to-br from-muted/50 via-background to-background p-3 shadow-sm">
          {summaryContent}
        </div>
      ) : null}

      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={() => navigate('/cmspanel/modules')}
            className={cn(
              'rounded-full border-border/70 bg-background/80 px-4 text-muted-foreground shadow-sm hover:bg-accent/70 hover:text-foreground',
              showOverview && 'border-primary/30 bg-primary/10 text-primary'
            )}
          >
            Overview
            <span className="ml-2 rounded-full bg-background/80 px-2 py-0.5 text-[11px] font-semibold text-foreground">{modules.length}</span>
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {isPlatformUser && canManage ? (
            <Button
              variant="outline"
              onClick={syncModules}
              disabled={loading || syncing}
              className="h-10 rounded-xl border-border/70 bg-background/80 px-3 text-muted-foreground shadow-sm hover:bg-accent/70 hover:text-foreground"
            >
              <RotateCcw className={cn('mr-2 h-4 w-4', (loading || syncing) && 'animate-spin')} />
              Sync from Sidebar
            </Button>
          ) : null}

          <Button
            variant="outline"
            onClick={fetchModules}
            disabled={loading}
            className="h-10 rounded-xl border-border/70 bg-background/80 px-3 text-muted-foreground shadow-sm hover:bg-accent/70 hover:text-foreground"
          >
            <RefreshCw className={cn('mr-2 h-4 w-4', loading && 'animate-spin')} />
            Refresh
          </Button>
        </div>
      </div>

      <div className="space-y-6">
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search modules..."
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            className="pl-9"
          />
        </div>

        <div className="rounded-2xl border border-border/70 bg-card/75 shadow-sm">
          <div className="overflow-x-auto rounded-2xl">
            <Table>
              <TableHeader>
                <TableRow>
                  {isPlatformUser ? <TableHead>Tenant</TableHead> : null}
                  <TableHead>Module Name</TableHead>
                  <TableHead>Slug</TableHead>
                  <TableHead>Status</TableHead>
                  {canManage ? <TableHead className="text-center">Toggle</TableHead> : null}
                  <TableHead>Created At</TableHead>
                </TableRow>
              </TableHeader>

              <TableBody>
                {loading ? (
                  Array.from({ length: 5 }).map((_, index) => (
                    <TableRow key={`module-skeleton-${index}`}>
                      {isPlatformUser ? (
                        <TableCell>
                          <div className="h-4 w-32 animate-pulse rounded bg-muted" />
                        </TableCell>
                      ) : null}
                      <TableCell>
                        <div className="h-4 w-40 animate-pulse rounded bg-muted" />
                      </TableCell>
                      <TableCell>
                        <div className="h-4 w-24 animate-pulse rounded bg-muted" />
                      </TableCell>
                      <TableCell>
                        <div className="h-6 w-16 animate-pulse rounded-full bg-muted" />
                      </TableCell>
                      {canManage ? (
                        <TableCell>
                          <div className="mx-auto h-5 w-9 animate-pulse rounded-full bg-muted" />
                        </TableCell>
                      ) : null}
                      <TableCell>
                        <div className="h-4 w-24 animate-pulse rounded bg-muted" />
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
                        <Box className="mb-2 h-8 w-8 opacity-20" />
                        <p>No modules found</p>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : (
                  displayModules.map((module) => (
                    <TableRow key={module.id}>
                      {isPlatformUser ? (
                        <TableCell className="font-medium">
                          {module.tenant?.name ?? <span className="italic text-muted-foreground">Restricted</span>}
                        </TableCell>
                      ) : null}
                      <TableCell>{module.name}</TableCell>
                      <TableCell>
                        <code className="rounded bg-muted px-2 py-0.5 text-xs font-mono text-foreground">
                          {module.slug}
                        </code>
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={module.status} />
                      </TableCell>
                      {canManage ? (
                        <TableCell className="text-center">
                          {module.status === 'maintenance' ? (
                            <span className="text-xs text-muted-foreground">—</span>
                          ) : (
                            <Switch
                              checked={module.status === 'active'}
                              disabled={toggling === module.id || !module.id}
                              onCheckedChange={() => toggleModuleStatus(module.id, module.status, module.tenant_id, module.slug)}
                              aria-label={`Toggle ${module.name}`}
                            />
                          )}
                        </TableCell>
                      ) : null}
                      <TableCell className="text-xs text-muted-foreground">{formatCreatedAt(module.created_at)}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </div>

        {!loading && displayModules.length > 0 ? (
          <p className="text-right text-xs text-muted-foreground">
            {searchQuery
              ? `${displayModules.length} of ${modules.length} modules matching search`
              : `${modules.length} modules`}
          </p>
        ) : null}
      </div>
    </div>
  );
};

export default ModulesManager;
