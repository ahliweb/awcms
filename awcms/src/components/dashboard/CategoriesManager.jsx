
import { useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { FolderTree, Layers3, ShieldCheck } from 'lucide-react';
import DashboardModuleIntro from '@/components/dashboard/DashboardModuleIntro';
import GenericContentManager from '@/components/dashboard/GenericContentManager';
import { getCategoryScopeMeta, getCategoryScopeOptionsForModule, getCategoryTypesForModule } from '@/lib/taxonomy';
import { restoreCategory, softDeleteCategory } from '@/lib/taxonomyMutations';
import useSplatSegments from '@/hooks/useSplatSegments';

function CategoriesManager({
  embedded = false,
  basePath = '/cmspanel/categories',
  nestedSegment = null,
  lockedModule = null,
  title,
  description,
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const segments = useSplatSegments();
  const isNestedRoute = Boolean(nestedSegment);
  const showTrash = isNestedRoute ? segments[1] === 'trash' : segments[0] === 'trash';

  useEffect(() => {
    if (isNestedRoute) {
      if (segments[0] !== nestedSegment) {
        navigate(basePath, { replace: true });
        return;
      }

      if (segments[1] === 'trash' && segments.length > 2) {
        navigate(`${basePath}/trash`, { replace: true });
        return;
      }

      if (segments.length > 1 && segments[1] !== 'trash') {
        navigate(basePath, { replace: true });
        return;
      }
    } else {
      if (segments.length > 0 && segments[0] !== 'trash') {
        navigate(basePath, { replace: true });
        return;
      }

      if (segments[0] === 'trash' && segments.length > 1) {
        navigate(`${basePath}/trash`, { replace: true });
      }
    }
  }, [segments, isNestedRoute, nestedSegment, basePath, navigate]);

  const scopeOptions = useMemo(
    () => getCategoryScopeOptionsForModule(lockedModule),
    [lockedModule],
  );

  const defaultFilters = useMemo(
    () => (lockedModule ? { type: getCategoryTypesForModule(lockedModule) } : {}),
    [lockedModule],
  );

  const resolvedTitle = title || (lockedModule ? t('common.category') : 'Category');
  const resolvedDescription = description || (lockedModule
    ? 'Organize the current module with tenant-scoped categories that stay refresh-safe and easy to reuse.'
    : 'Manage tenant-scoped categories across modules with safe trash recovery and clearer scope labels.');

  const supportsSharedContent = scopeOptions.some((option) => option.value === 'content');
  const summaryCards = [
    {
      title: 'Available Scopes',
      value: scopeOptions.length,
      description: 'Only valid category scopes are offered in this view, reducing taxonomy drift.',
      accent: 'from-primary/15 via-primary/6 to-transparent',
    },
    {
      title: 'Shared Reuse',
      value: supportsSharedContent ? 'On' : 'Scoped',
      description: supportsSharedContent
        ? 'Shared content categories remain available where cross-module reuse is expected.'
        : 'This module stays focused on its own category scope for cleaner editorial choices.',
      accent: 'from-sky-500/15 via-sky-500/6 to-transparent',
    },
    {
      title: 'Trash Recovery',
      value: 'Safe',
      description: 'Soft-deleted categories can be restored from trash without leaving the current workflow.',
      accent: 'from-emerald-500/15 via-emerald-500/6 to-transparent',
    },
  ];

  const summaryContent = !showTrash ? (
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

  const headerContent = embedded ? (
    <div className="space-y-8">
      <div className="rounded-3xl border border-border/70 bg-gradient-to-br from-background via-background to-primary/5 p-6 shadow-sm">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-1.5">
            <h2 className="text-2xl font-semibold tracking-tight text-foreground">{showTrash ? `${resolvedTitle} Trash` : `${resolvedTitle}s`}</h2>
            <p className="max-w-3xl text-sm text-muted-foreground">{resolvedDescription}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {scopeOptions.map((option) => (
              <Badge key={option.value} variant="secondary" className="rounded-full border border-border/70 bg-background/80 px-3 py-1 text-xs font-medium shadow-sm">
                {option.label}
              </Badge>
            ))}
          </div>
        </div>
      </div>
      {summaryContent}
    </div>
  ) : (
    <div className="space-y-8">
      <DashboardModuleIntro
        icon={FolderTree}
        eyebrow="Taxonomy"
        title="Category Scopes"
        description="Keep categories aligned with the right module, preserve safe trash recovery, and avoid accidental cross-module taxonomy drift."
        badges={[
          { icon: Layers3, iconClassName: 'text-primary', label: 'Refresh-safe `/cmspanel` category route shell' },
          { icon: ShieldCheck, iconClassName: 'text-emerald-600', label: 'Tenant-scoped slugs and trash recovery' },
          ...scopeOptions.map((option) => ({ icon: FolderTree, iconClassName: 'text-primary', label: option.label })),
        ]}
      />
      {!showTrash && (
        <>{summaryContent}</>
      )}
    </div>
  );

  const columns = [
    { key: 'name', label: t('categories.columns.name'), className: 'font-medium' },
    { key: 'slug', label: t('categories.columns.slug') },
    {
      key: 'type',
      label: t('categories.columns.scope'),
      render: (value) => {
        const scope = getCategoryScopeMeta(value);

        return (
          <div className="space-y-1.5">
            <Badge variant="secondary" className="rounded-full border border-border/70 bg-background/80 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide shadow-sm">
              {scope?.label || value}
            </Badge>
            <p className="max-w-[220px] text-xs leading-5 text-muted-foreground">{scope?.description || t('categories.scope_default')}</p>
          </div>
        );
      }
    }
  ];

  const formFields = [
    { key: 'name', label: t('categories.fields.name'), required: true, description: 'Visible label shown across selectors and lists.' },
    { key: 'slug', label: t('categories.fields.slug') },
    { key: 'description', label: t('categories.fields.description'), type: 'textarea', description: 'Optional context so editors know when to reuse this taxonomy.' },
    {
      key: 'type',
      label: t('categories.fields.scope'),
      type: 'select',
      options: scopeOptions,
      description: lockedModule
        ? 'This view keeps category scopes aligned with the current module and its shared content rules.'
        : 'Pick the tenant module that should surface this category.',
      defaultValue: scopeOptions[0]?.value,
    }
  ];

  return (
    <GenericContentManager
      tableName="categories"
      resourceName={resolvedTitle}
      columns={columns}
      formFields={formFields}
      permissionPrefix="categories"
      customSelect="*, owner:users!created_by(email, full_name), tenant:tenants(name)"
      defaultFilters={defaultFilters}
      viewPermission="tenant.categories.read"
      createPermission="tenant.categories.create"
      restorePermission="tenant.categories.restore"
      defaultSortColumn="name"
      showBreadcrumbs={!embedded}
      showHeader={!embedded}
      headerContent={headerContent}
      onSoftDeleteOverride={softDeleteCategory}
      onRestoreOverride={restoreCategory}
    />
  );
}

export default CategoriesManager;
