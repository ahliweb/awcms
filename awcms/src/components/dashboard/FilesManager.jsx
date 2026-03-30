
import { useState, useMemo, useEffect } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { Calendar, ChevronRight, FolderOpen, Home, Layers3, ShieldCheck, Trash2 } from 'lucide-react';
import MediaLibrary from './media/MediaLibrary';
import { FileStats } from './media/FileStats';
import { useToast } from '@/components/ui/use-toast';
import { useMedia } from '@/hooks/useMedia';
import useSplatSegments from '@/hooks/useSplatSegments';
import DashboardModuleIntro from '@/components/dashboard/DashboardModuleIntro';
import FilesHeaderActions from '@/components/dashboard/files/FilesHeaderActions';
import FilesOverviewCards from '@/components/dashboard/files/FilesOverviewCards';
import FilesCategoriesPanel from '@/components/dashboard/files/FilesCategoriesPanel';
import { usePermissions } from '@/contexts/PermissionContext';
import { useTenant } from '@/contexts/TenantContext';

const FilesManager = () => {
  const [isUploadOpen, setIsUploadOpen] = useState(false);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const navigate = useNavigate();
  const location = useLocation();
  const segments = useSplatSegments();
  const showTrash = segments[0] === 'trash';
  const basePath = useMemo(() => (
    location.pathname.startsWith('/cmspanel/media') ? '/cmspanel/media' : '/cmspanel/files'
  ), [location.pathname]);

  // Category State
  const [categories, setCategories] = useState([]);
  const [selectedCategory, setSelectedCategory] = useState(null);
  const [isCreateCategoryOpen, setIsCreateCategoryOpen] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [uploadSessionBoundAccess, setUploadSessionBoundAccess] = useState(false);
  const { hasPermission, isPlatformAdmin, loading: permissionsLoading } = usePermissions();
  const { currentTenant, loading: tenantLoading } = useTenant();

  const effectiveSelectedCategory = showTrash ? null : selectedCategory;

  const selectedCategoryName = useMemo(
    () => categories.find((category) => category.id === effectiveSelectedCategory)?.name || null,
    [categories, effectiveSelectedCategory]
  );

  // Use new statsLoading prop
  const {
    uploadFile,
    uploading,
    syncFiles,
    syncing,
    stats,
    statsLoading,
    fetchCategories,
    createCategory,
    edgeApiAvailable,
    edgeApiMessage,
    refreshEdgeApiHealth,
  } = useMedia();
  const { toast } = useToast();
  const hasAccess = hasPermission('tenant.files.read');
  const isPageLoading = permissionsLoading || tenantLoading;

  // Load categories on mount
  useEffect(() => {
    let active = true;

    const loadCategories = async () => {
      const data = await fetchCategories();
      if (active) {
        setCategories(data);
      }
    };

    void loadCategories();

    return () => {
      active = false;
    };
  }, [fetchCategories]);

  useEffect(() => {
    if (segments.length > 0 && segments[0] !== 'trash') {
      navigate(basePath, { replace: true });
      return;
    }

    if (segments[0] === 'trash' && segments.length > 1) {
      navigate(`${basePath}/trash`, { replace: true });
    }
  }, [segments, basePath, navigate]);

  const handleCreateCategory = async () => {
    if (!newCategoryName.trim()) return;
    const newCat = await createCategory(newCategoryName);
    if (newCat) {
      setNewCategoryName('');
      setIsCreateCategoryOpen(false);
      const refreshedCategories = await fetchCategories();
      setCategories(refreshedCategories);
    }
  };

  const handleUpload = async (acceptedFiles) => {
    let successCount = 0;
    for (const file of acceptedFiles) {
      try {
        // Pass selectedCategory to uploadFile
        await uploadFile(file, '', effectiveSelectedCategory, { sessionBoundAccess: uploadSessionBoundAccess });
        successCount++;
      } catch (err) {
        toast({ variant: 'destructive', title: `Failed to upload ${file.name}`, description: err.message });
      }
    }
    if (successCount > 0) {
      toast({ title: 'Success', description: `${successCount} files uploaded successfully.` });
      setIsUploadOpen(false);
      setUploadSessionBoundAccess(false);
      setRefreshTrigger(prev => prev + 1);
    }
  };

  const handleSync = async () => {
    const success = await syncFiles();
    if (success) setRefreshTrigger(prev => prev + 1);
  };

  const headerActions = (
    <FilesHeaderActions
      showTrash={showTrash}
      selectedCategoryName={selectedCategoryName}
      handleSync={handleSync}
      syncing={syncing}
      edgeApiAvailable={edgeApiAvailable}
      edgeApiMessage={edgeApiMessage}
      refreshEdgeApiHealth={refreshEdgeApiHealth}
      navigate={navigate}
      basePath={basePath}
      isUploadOpen={isUploadOpen}
      setIsUploadOpen={setIsUploadOpen}
      uploadSessionBoundAccess={uploadSessionBoundAccess}
      setUploadSessionBoundAccess={setUploadSessionBoundAccess}
      handleUpload={handleUpload}
      uploading={uploading}
    />
  );

  return (
    <div className="space-y-6">
      <Helmet>
        <title>{showTrash ? 'Media Library Trash - CMS' : 'Media Library - CMS'}</title>
      </Helmet>

      {!permissionsLoading && !hasAccess && (
        <div
          className="mb-4 rounded-2xl border border-destructive/25 bg-destructive/8 px-4 py-3 text-sm text-destructive shadow-sm"
          role="alert"
        >
          <span className="font-semibold">Access denied.</span> You do not have permission to view this page.
        </div>
      )}

      {isPageLoading && (
        <div className="grid min-h-[420px] place-items-center rounded-2xl border border-border/60 bg-card/55 p-8 backdrop-blur-sm">
          <div className="text-center text-muted-foreground">
            <div role="status">
              <svg aria-hidden="true" className="inline h-8 w-8 animate-spin fill-primary text-muted-foreground" viewBox="0 0 100 101" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M100 50.5908C100 78.2051 77.6142 100.591 50 100.591C22.3858 100.591 0 78.2051 0 50.5908C0 22.9766 22.3858 0.59082 50 0.59082C77.6142 0.59082 100 22.9766 100 50.5908ZM9.08144 50.5908C9.08144 73.1895 27.4013 91.5094 50 91.5094C72.5987 91.5094 90.9186 73.1895 90.9186 50.5908C90.9186 27.9921 72.5987 9.67226 50 9.67226C27.4013 9.67226 9.08144 27.9921 9.08144 50.5908Z" fill="currentColor" />
                <path d="M93.9676 39.0409C96.393 38.4038 97.8624 35.9116 97.0079 33.5539C95.2932 28.8227 92.871 24.3692 89.8167 20.348C85.8452 15.1192 80.8826 10.7238 75.2124 7.41289C69.5422 4.10194 63.2754 1.94025 56.7698 1.05124C51.7666 0.367541 46.6976 0.446843 41.7345 1.27873C39.2613 1.69328 37.813 4.19778 38.4501 6.62326C39.0873 9.04874 41.5694 10.4717 44.0505 10.1071C47.8511 9.54855 51.7191 9.52689 55.5402 10.0491C60.8642 10.7766 65.9928 12.5457 70.6331 15.2552C75.2735 17.9648 79.3347 21.5619 82.5849 25.841C84.9175 28.9121 86.7997 32.2913 88.1811 35.8758C89.083 38.2158 91.5421 39.6781 93.9676 39.0409Z" fill="currentFill" />
              </svg>
              <span className="sr-only">Loading...</span>
            </div>
            <p className="mt-3 text-sm font-medium">Loading module data...</p>
          </div>
        </div>
      )}

      {!isPageLoading && hasAccess && (
        <>
          <nav className="mb-6">
            <ol className="flex flex-wrap items-center gap-1.5 break-words text-sm text-muted-foreground sm:gap-2.5">
              <li className="inline-flex items-center gap-1.5">
                <Link to="/cmspanel" className="flex items-center gap-1 transition-colors hover:text-foreground">
                  <Home className="h-4 w-4" />
                  Dashboard
                </Link>
              </li>
              <li aria-hidden="true" className="[&>svg]:size-3.5"><ChevronRight /></li>
              <li className="inline-flex items-center gap-1.5">
                <div
                  className={`flex items-center gap-1.5 rounded-full px-3 py-1 font-medium transition-colors ${showTrash
                    ? 'cursor-pointer bg-muted text-muted-foreground hover:bg-muted/80'
                    : 'bg-primary text-primary-foreground shadow-sm'
                    }`}
                  onClick={showTrash ? () => navigate(basePath, { replace: true }) : undefined}
                >
                  <span>Media Library</span>
                </div>
              </li>
              {showTrash && (
                <>
                  <li aria-hidden="true" className="[&>svg]:size-3.5"><ChevronRight /></li>
                  <li className="inline-flex items-center gap-1.5">
                    <div className="flex items-center gap-1.5 rounded-full bg-destructive px-3 py-1 font-medium text-destructive-foreground shadow-sm">
                      <Trash2 className="h-3.5 w-3.5" />
                      <span>Trash</span>
                    </div>
                  </li>
                </>
              )}
            </ol>
          </nav>

          <div className="space-y-8">
            <DashboardModuleIntro
              icon={FolderOpen}
              eyebrow="Media"
              title={showTrash ? 'Media Library Trash' : 'Media Library'}
              description={showTrash
                ? 'Manage deleted files. Restore assets or review removed items without leaving the media workspace.'
                : 'Manage and organize digital assets, sync cloud storage, and keep file delivery aligned with tenant access controls.'}
              actions={headerActions}
              badges={[
                { icon: Layers3, iconClassName: 'text-primary', label: `Refresh-safe \`${basePath}\` routes` },
                { icon: ShieldCheck, iconClassName: 'text-emerald-600', label: isPlatformAdmin ? 'Platform ABAC scope active' : `Tenant ABAC scope: ${currentTenant?.name || 'Current tenant'}` },
                { icon: Calendar, iconClassName: 'text-primary', label: selectedCategoryName || 'All files' },
              ]}
            />

            <FilesOverviewCards
              showTrash={showTrash}
              selectedCategoryName={selectedCategoryName}
              categoriesCount={categories.length}
              uploading={uploading}
            />
          </div>

          <div className="space-y-6">
            {!showTrash && (
              <div className="flex-shrink-0">
                <FileStats stats={stats} loading={statsLoading} />
              </div>
            )}

            <div className="flex flex-col items-start gap-6 md:flex-row">
              {!showTrash && (
                <div className="w-full flex-shrink-0 space-y-4 md:w-64">
                  <FilesCategoriesPanel
                    categories={categories}
                    selectedCategory={effectiveSelectedCategory}
                    setSelectedCategory={setSelectedCategory}
                    isCreateCategoryOpen={isCreateCategoryOpen}
                    setIsCreateCategoryOpen={setIsCreateCategoryOpen}
                    newCategoryName={newCategoryName}
                    setNewCategoryName={setNewCategoryName}
                    handleCreateCategory={handleCreateCategory}
                  />
                </div>
              )}

              <div className="min-h-[500px] w-full flex-1 overflow-hidden rounded-2xl border border-border/60 bg-card/75 shadow-sm backdrop-blur-sm">
                <MediaLibrary
                  refreshTrigger={refreshTrigger}
                  isTrashView={showTrash}
                  categoryId={effectiveSelectedCategory}
                  edgeApiAvailable={edgeApiAvailable}
                  edgeApiMessage={edgeApiMessage}
                  refreshEdgeApiHealth={refreshEdgeApiHealth}
                />
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default FilesManager;
