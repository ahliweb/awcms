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
import TagsHeaderActions from '@/components/dashboard/tags/TagsHeaderActions';
import TagsFiltersBar from '@/components/dashboard/tags/TagsFiltersBar';
import TagsTable from '@/components/dashboard/tags/TagsTable';
import TagsPaginationBar from '@/components/dashboard/tags/TagsPaginationBar';
import TagEditorDialog from '@/components/dashboard/tags/TagEditorDialog';
import TagDeleteDialog from '@/components/dashboard/tags/TagDeleteDialog';

const MODULES = [
  { value: 'all', label: 'All Modules' },
  { value: 'blogs', label: 'Blogs' },
  { value: 'pages', label: 'Pages' },
  { value: 'products', label: 'Products' },
  { value: 'portfolio', label: 'Portfolio' },
  { value: 'announcements', label: 'Announcements' },
  { value: 'promotions', label: 'Promotions' },
  { value: 'testimonies', label: 'Testimonials' },
  { value: 'files', label: 'Media Library' },
  { value: 'contacts', label: 'Contacts' },
  { value: 'contact_messages', label: 'Messages' },
  { value: 'product_types', label: 'Product Types' },
];

function TagsManager() {
  const { toast } = useToast();
  const { hasPermission, isPlatformAdmin } = usePermissions();
  const { currentTenant } = useTenant();
  const navigate = useNavigate();
  const segments = useSplatSegments();
  const showTrash = segments[0] === 'trash';

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

  const [moduleFilter, setModuleFilter] = useState('all');
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

  const canCreate = hasPermission('tenant.tags.create');
  const canEdit = hasPermission('tenant.tags.update');
  const canSoftDelete = hasPermission('tenant.tag.delete');
  const canRestore = hasPermission('tenant.tag.restore') || hasPermission('tenant.tag.delete');

  useEffect(() => {
    if (segments.length > 0 && segments[0] !== 'trash') {
      navigate('/cmspanel/tags', { replace: true });
      return;
    }

    if (segments[0] === 'trash' && segments.length > 1) {
      navigate('/cmspanel/tags/trash', { replace: true });
    }
  }, [segments, navigate]);

  const fetchTags = useCallback(async () => {
    setLoading(true);
    try {
      let data = [];

      if (showTrash) {
        let trashQuery = supabase
          .from('tags')
          .select('*, tenant:tenants(name)')
          .not('deleted_at', 'is', null);

        if (currentTenant?.id && !isPlatformAdmin) {
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

        if (currentTenant?.id && !isPlatformAdmin) {
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
              tag.modules.add(usage.module);
              tag.breakdown[usage.module] = (tag.breakdown[usage.module] || 0) + parseInt(usage.count, 10);
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
  }, [showTrash, toast, currentTenant?.id, isPlatformAdmin]);

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
      filtered = filtered.filter((tag) => tag.modules && tag.modules.includes(moduleFilter));
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
      const { error } = await supabase
        .from('tags')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', id);
      if (error) throw error;

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
      const { error } = await supabase
        .from('tags')
        .update({ deleted_at: null })
        .eq('id', id);

      if (error) throw error;
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

    setSaving(true);
    try {
      const payload = {
        name: formData.name,
        slug: formData.slug || formData.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
        color: formData.color,
        description: formData.description,
        icon: formData.icon,
        is_active: formData.is_active,
        updated_at: new Date().toISOString(),
      };

      if (editingTag) {
        const { error } = await supabase
          .from('tags')
          .update(payload)
          .eq('id', editingTag.tag_id);
        if (error) throw error;
        toast({ title: 'Success', description: 'Tag updated successfully' });
      } else {
        const insertPayload = {
          ...payload,
          tenant_id: currentTenant?.id,
        };
        const { error } = await supabase.from('tags').insert([insertPayload]);
        if (error) throw error;
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

  const breadcrumbs = [
    { label: 'Tags', icon: Tag },
    ...(showTrash ? [{ label: 'Trash', icon: Trash2 }] : []),
  ];

  return (
    <AdminPageLayout requiredPermission="tenant.tag.read">
      <PageHeader
        title={showTrash ? 'Tags - Trash' : 'Tags Manager'}
        description="Manage content tags, colors, and view usage statistics across the system."
        icon={Tag}
        breadcrumbs={breadcrumbs}
        actions={(
          <TagsHeaderActions
            showTrash={showTrash}
            canSoftDelete={canSoftDelete}
            canCreate={canCreate}
            onToggleTrash={() => {
              navigate(showTrash ? '/cmspanel/tags' : '/cmspanel/tags/trash');
              setCurrentPage(1);
            }}
            onCreate={() => openModal(null)}
          />
        )}
      />

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
        modules={MODULES}
        fetchTags={fetchTags}
        setCurrentPage={setCurrentPage}
      />

      <TagsTable
        isPlatformAdmin={isPlatformAdmin}
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
    </AdminPageLayout>
  );
}

export default TagsManager;
