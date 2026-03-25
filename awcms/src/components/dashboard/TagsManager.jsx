import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Tag, Trash2 } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import { supabase } from '@/lib/customSupabaseClient';
import { usePermissions } from '@/contexts/PermissionContext';
import { useTenant } from '@/contexts/TenantContext';
import { useSearch } from '@/hooks/useSearch';
import { AdminPageLayout, PageHeader } from '@/templates/flowbite-admin';
import useSplatSegments from '@/hooks/useSplatSegments';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import TagsHeaderActions from '@/components/dashboard/tags/TagsHeaderActions';
import TagsFiltersBar from '@/components/dashboard/tags/TagsFiltersBar';
import TagsTable from '@/components/dashboard/tags/TagsTable';
import TagsPaginationBar from '@/components/dashboard/tags/TagsPaginationBar';
import TagEditorDialog from '@/components/dashboard/tags/TagEditorDialog';
import TagDeleteDialog from '@/components/dashboard/tags/TagDeleteDialog';
import { TAG_MODULE_OPTIONS, getTagUsageMeta, matchesTagModuleFilter } from '@/lib/taxonomy';
import { createTag, restoreTag, softDeleteTag, updateTag } from '@/lib/taxonomyMutations';

function slugifyTag(value) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

function TagsManager({
  embedded = false,
  basePath = '/cmspanel/tags',
  nestedSegment = null,
  lockedModuleFilter = null,
  title = 'Tags',
  description = 'Manage tenant-scoped tags shared across content modules, with reuse visibility and safer cleanup from trash.',
}) {
  const { toast } = useToast();
  const { hasPermission, isPlatformAdmin } = usePermissions();
  const { currentTenant } = useTenant();
  const navigate = useNavigate();
  const segments = useSplatSegments();
  const isNestedRoute = Boolean(nestedSegment);
  const showTrash = isNestedRoute ? segments[1] === 'trash' : segments[0] === 'trash';

  const {
    query,
    setQuery,
    debouncedQuery,
    isValid: isSearchValid,
    message: searchMessage,
    loading: searchLoading,
    minLength,
    clearSearch,
  } = useSearch({ context: 'admin' });

  const [rawTags, setRawTags] = useState([]);
  const [displayedTags, setDisplayedTags] = useState([]);
  const [loading, setLoading] = useState(true);

  const [moduleFilter, setModuleFilter] = useState(lockedModuleFilter || 'all');
  const [activeFilter, setActiveFilter] = useState('all');
  const [sortConfig, setSortConfig] = useState({ key: 'total_usage', direction: 'desc' });

  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(10);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingTag, setEditingTag] = useState(null);
  const [formData, setFormData] = useState({
    name: '',
    slug: '',
    color: '#3b82f6',
    description: '',
    icon: '',
    is_active: true,
  });
  const [saving, setSaving] = useState(false);

  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);

  const canCreate = hasPermission('tenant.tag.create');
  const canEdit = hasPermission('tenant.tag.update');
  const canSoftDelete = hasPermission('tenant.tag.delete');
  const canRestore = hasPermission('tenant.tag.restore') || hasPermission('tenant.tag.delete');
  const hasTenantScope = Boolean(currentTenant?.id);
  const showTenantColumn = isPlatformAdmin && !hasTenantScope;

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
  }, [segments, navigate, isNestedRoute, nestedSegment, basePath]);

  useEffect(() => {
    if (lockedModuleFilter) {
      setModuleFilter(lockedModuleFilter);
    }
  }, [lockedModuleFilter]);

  const fetchTags = useCallback(async () => {
    setLoading(true);
    try {
      let data = [];

      if (showTrash) {
        let trashQuery = supabase
          .from('tags')
          .select('*, tenant:tenants(name)')
          .not('deleted_at', 'is', null);

        if (hasTenantScope) {
          trashQuery = trashQuery.eq('tenant_id', currentTenant.id);
        }

        const { data: trashData, error } = await trashQuery;
        if (error) throw error;

        data = trashData.map((tag) => ({
          id: tag.id,
          tag_id: tag.id,
          tag_name: tag.name,
          tag_slug: tag.slug,
          tag_color: tag.color,
          tag_icon: tag.icon,
          tag_description: tag.description,
          tag_is_active: tag.is_active,
          tag_created_at: tag.created_at,
          tag_updated_at: tag.updated_at,
          tenant_name: tag.tenant?.name,
          module: 'trash',
          count: 0,
        }));
      } else {
        let tagsQuery = supabase
          .from('tags')
          .select('*, tenant:tenants(name)')
          .is('deleted_at', null);

        if (hasTenantScope) {
          tagsQuery = tagsQuery.eq('tenant_id', currentTenant.id);
        }

        const { data: allTags, error: tagsError } = await tagsQuery;
        if (tagsError) throw tagsError;

        const { data: usageData, error: usageError } = await supabase.rpc('get_detailed_tag_usage');
        if (usageError) throw usageError;

        const mergedMap = new Map();

        allTags.forEach((tag) => {
          mergedMap.set(tag.id, {
            ...tag,
            tag_id: tag.id,
            tag_name: tag.name,
            tag_slug: tag.slug,
            tag_color: tag.color,
            tag_icon: tag.icon,
            tag_description: tag.description,
            tag_is_active: tag.is_active,
            tag_created_at: tag.created_at,
            tag_updated_at: tag.updated_at,
            tenant_name: tag.tenant?.name,
            count: 0,
            modules: new Set(),
            breakdown: {},
          });
        });

        if (usageData) {
          usageData.forEach((usage) => {
            if (mergedMap.has(usage.tag_id)) {
              const tag = mergedMap.get(usage.tag_id);
              tag.count += parseInt(usage.count, 10);
               const usageMeta = getTagUsageMeta(usage.module);
                tag.modules.add(usageMeta.key);
                if (usageMeta.sharedKey) {
                  tag.modules.add(usageMeta.sharedKey);
                }
                tag.breakdown[usageMeta.label] = (tag.breakdown[usageMeta.label] || 0) + parseInt(usage.count, 10);
              }
            });
          }

        data = Array.from(mergedMap.values()).map((tag) => ({
          ...tag,
          modules: Array.from(tag.modules),
        }));
      }

      setRawTags(data);
    } catch (error) {
      console.error(error);
      toast({
        variant: 'destructive',
        title: 'Error fetching tags',
        description: error.message,
      });
    } finally {
      setLoading(false);
    }
  }, [showTrash, toast, currentTenant?.id, hasTenantScope]);

  useEffect(() => {
    fetchTags();
  }, [fetchTags]);

  useEffect(() => {
    let filtered = [...rawTags];

    if (debouncedQuery) {
      const lower = debouncedQuery.toLowerCase();
      filtered = filtered.filter((tag) => (
        tag.tag_name?.toLowerCase().includes(lower)
        || tag.tag_slug?.toLowerCase().includes(lower)
        || tag.tag_description?.toLowerCase().includes(lower)
      ));
    }

    if (!showTrash && moduleFilter !== 'all') {
      filtered = filtered.filter((tag) => (
        tag.modules && tag.modules.some((moduleKey) => matchesTagModuleFilter(moduleKey, moduleFilter))
      ));
    }

    if (activeFilter !== 'all') {
      const isActive = activeFilter === 'active';
      filtered = filtered.filter((tag) => tag.tag_is_active === isActive);
    }

    filtered.sort((a, b) => {
      let valA = a[sortConfig.key];
      let valB = b[sortConfig.key];

      if (sortConfig.key === 'total_usage') {
        valA = a.count || 0;
        valB = b.count || 0;
      } else if (sortConfig.key === 'name') {
        valA = a.tag_name?.toLowerCase();
        valB = b.tag_name?.toLowerCase();
      } else if (sortConfig.key === 'created_at') {
        valA = new Date(a.tag_created_at);
        valB = new Date(b.tag_created_at);
      } else if (sortConfig.key === 'updated_at') {
        valA = new Date(a.tag_updated_at);
        valB = new Date(b.tag_updated_at);
      }

      if (valA < valB) return sortConfig.direction === 'asc' ? -1 : 1;
      if (valA > valB) return sortConfig.direction === 'asc' ? 1 : -1;
      return 0;
    });

    setDisplayedTags(filtered);
  }, [rawTags, debouncedQuery, moduleFilter, activeFilter, sortConfig, showTrash]);

  const handleSort = (key) => {
    setSortConfig((current) => ({
      key,
      direction: current.key === key && current.direction === 'asc' ? 'desc' : 'asc',
    }));
  };

  const handleDelete = async (id) => {
    if (!canSoftDelete) {
      toast({
        variant: 'destructive',
        title: 'Action Denied',
        description: 'You do not have permission to delete tags.',
      });
      return;
    }

    try {
      await softDeleteTag(id);

      toast({ title: 'Success', description: 'Tag moved to trash.' });
      fetchTags();
    } catch (error) {
      toast({ variant: 'destructive', title: 'Error deleting tag', description: error.message });
    }
  };

  const handleRequestDelete = (tag) => {
    setDeleteTarget(tag);
    setDeleteDialogOpen(true);
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget?.tag_id) return;
    await handleDelete(deleteTarget.tag_id);
    setDeleteDialogOpen(false);
    setDeleteTarget(null);
  };

  const handleRestore = async (id) => {
    if (!canRestore) {
      toast({
        variant: 'destructive',
        title: 'Action Denied',
        description: 'You do not have permission to restore tags.',
      });
      return;
    }
    try {
      await restoreTag(id);
      toast({ title: 'Success', description: 'Tag restored.' });
      fetchTags();
    } catch (error) {
      toast({ variant: 'destructive', title: 'Error restoring tag', description: error.message });
    }
  };

  const openModal = (tag = null) => {
    if (tag) {
      setEditingTag(tag);
      setFormData({
        name: tag.tag_name,
        slug: tag.tag_slug,
        color: tag.tag_color || '#3b82f6',
        description: tag.tag_description || '',
        icon: tag.tag_icon || '',
        is_active: tag.tag_is_active,
      });
    } else {
      setEditingTag(null);
      setFormData({
        name: '',
        slug: '',
        color: '#3b82f6',
        description: '',
        icon: '',
        is_active: true,
      });
    }
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (editingTag && !canEdit) {
      toast({
        variant: 'destructive',
        title: 'Action Denied',
        description: 'You do not have permission to edit tags.',
      });
      return;
    }

    if (!editingTag && !canCreate) {
      toast({
        variant: 'destructive',
        title: 'Action Denied',
        description: 'You do not have permission to create tags.',
      });
      return;
    }

    if (!formData.name) {
      toast({ variant: 'destructive', title: 'Validation Error', description: 'Name is required' });
      return;
    }

    const normalizedName = formData.name.trim();
    const normalizedSlug = (formData.slug || slugifyTag(formData.name)).trim();

    if (!normalizedSlug) {
      toast({ variant: 'destructive', title: 'Validation Error', description: 'Slug is required' });
      return;
    }

    if (!editingTag && !currentTenant?.id) {
      toast({
        variant: 'destructive',
        title: 'Tenant Required',
        description: 'Select a tenant before creating shared tags.',
      });
      return;
    }

    setSaving(true);
    try {
      const payload = {
        name: normalizedName,
        slug: normalizedSlug,
        color: formData.color,
        description: formData.description,
        icon: formData.icon,
        is_active: formData.is_active,
      };

      if (editingTag) {
        await updateTag(editingTag.tag_id, payload, { tenantId: currentTenant?.id });
        toast({ title: 'Success', description: 'Tag updated successfully' });
      } else {
        await createTag({
          tenantId: currentTenant.id,
          ...payload,
        });
        toast({ title: 'Success', description: 'New tag created successfully' });
      }

      setDialogOpen(false);
      fetchTags();
    } catch (error) {
      console.error(error);
      toast({ variant: 'destructive', title: 'Error saving tag', description: error.message });
    } finally {
      setSaving(false);
    }
  };

  const totalPages = Math.ceil(displayedTags.length / itemsPerPage);
  const currentData = displayedTags.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);
  const activeCount = rawTags.filter((tag) => tag.tag_is_active).length;
  const inactiveCount = rawTags.filter((tag) => !tag.tag_is_active).length;
  const totalUsage = rawTags.reduce((sum, tag) => sum + (tag.count || 0), 0);

  const breadcrumbs = [
    { label: title, icon: Tag },
    ...(showTrash ? [{ label: 'Trash', icon: Trash2 }] : []),
  ];

  const statCards = [
    {
      title: 'Reusable Tags',
      value: rawTags.length,
      description: 'Tenant tags available in selectors and editors.',
      accent: 'from-primary/15 via-primary/6 to-transparent',
    },
    {
      title: 'Usage Links',
      value: totalUsage,
      description: 'Total active assignments across connected modules.',
      accent: 'from-sky-500/15 via-sky-500/6 to-transparent',
    },
    {
      title: 'Selector Health',
      value: activeCount,
      description: `${inactiveCount} inactive tags hidden from autocomplete and pickers.`,
      accent: 'from-emerald-500/15 via-emerald-500/6 to-transparent',
    },
  ];

  const body = (
    <>
      {embedded ? (
        <div className="mb-8 flex flex-col gap-5 rounded-3xl border border-border/70 bg-gradient-to-br from-background via-background to-primary/5 p-6 shadow-sm lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-1">
            <h2 className="text-2xl font-semibold tracking-tight text-foreground">{showTrash ? `${title} Trash` : title}</h2>
            <p className="max-w-3xl text-sm text-muted-foreground">{description}</p>
          </div>
          <TagsHeaderActions
            showTrash={showTrash}
            canSoftDelete={canSoftDelete}
            canCreate={canCreate}
            onToggleTrash={() => {
              navigate(showTrash ? basePath : `${basePath}/trash`);
              setCurrentPage(1);
            }}
            onCreate={() => openModal(null)}
          />
        </div>
      ) : (
        <PageHeader
          title={showTrash ? `${title} Trash` : title}
          description={description}
          icon={Tag}
          breadcrumbs={breadcrumbs}
          actions={(
            <TagsHeaderActions
              showTrash={showTrash}
              canSoftDelete={canSoftDelete}
              canCreate={canCreate}
              onToggleTrash={() => {
                navigate(showTrash ? basePath : `${basePath}/trash`);
                setCurrentPage(1);
              }}
              onCreate={() => openModal(null)}
            />
          )}
        />
      )}

      {!showTrash && (
        <div className="mb-8 grid gap-4 md:grid-cols-3">
          {statCards.map((stat) => (
            <Card key={stat.title} className="overflow-hidden rounded-2xl border-border/70 shadow-sm">
              <CardContent className="relative p-5">
                <div className={cn('pointer-events-none absolute inset-0 bg-gradient-to-br', stat.accent)} />
                <div className="relative">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">{stat.title}</p>
                  <p className="mt-3 text-4xl font-semibold leading-none text-foreground">{stat.value}</p>
                  <p className="mt-3 max-w-xs text-sm leading-6 text-muted-foreground">{stat.description}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <div className="mb-6">
        <TagsFiltersBar
        query={query}
        setQuery={setQuery}
        clearSearch={clearSearch}
        loading={loading}
        searchLoading={searchLoading}
        isSearchValid={isSearchValid}
        searchMessage={searchMessage}
        minLength={minLength}
        showTrash={showTrash}
        moduleFilter={moduleFilter}
        setModuleFilter={setModuleFilter}
        activeFilter={activeFilter}
        setActiveFilter={setActiveFilter}
        modules={TAG_MODULE_OPTIONS}
        showModuleFilter={!lockedModuleFilter}
        fetchTags={fetchTags}
        setCurrentPage={setCurrentPage}
        />
      </div>

      <div className="mb-6">
        <TagsTable
        showTenantColumn={showTenantColumn}
        sortConfig={sortConfig}
        handleSort={handleSort}
        showTrash={showTrash}
        loading={loading}
        currentData={currentData}
        canRestore={canRestore}
        canEdit={canEdit}
        canSoftDelete={canSoftDelete}
        onRestore={handleRestore}
        onEdit={openModal}
        onRequestDelete={handleRequestDelete}
        />
      </div>

      <TagsPaginationBar
        displayedTags={displayedTags}
        currentPage={currentPage}
        itemsPerPage={itemsPerPage}
        setItemsPerPage={setItemsPerPage}
        setCurrentPage={setCurrentPage}
        totalPages={totalPages}
      />

      <TagEditorDialog
        dialogOpen={dialogOpen}
        setDialogOpen={setDialogOpen}
        editingTag={editingTag}
        formData={formData}
        setFormData={setFormData}
        handleSave={handleSave}
        saving={saving}
      />

      <TagDeleteDialog
        open={deleteDialogOpen}
        onOpenChange={(open) => {
          setDeleteDialogOpen(open);
          if (!open) setDeleteTarget(null);
        }}
        tagName={deleteTarget?.tag_name}
        onConfirm={handleConfirmDelete}
      />
    </>
  );

  if (embedded) {
    return body;
  }

  return (
    <AdminPageLayout requiredPermission="tenant.tag.read">
      {body}
    </AdminPageLayout>
  );
}

export default TagsManager;
