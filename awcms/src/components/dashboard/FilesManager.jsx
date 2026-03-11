
import React, { useState, useMemo, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { Image, Trash2 } from 'lucide-react';
import MediaLibrary from './media/MediaLibrary';
import { FileStats } from './media/FileStats';
import { useToast } from '@/components/ui/use-toast';
import { useMedia } from '@/hooks/useMedia';
import { AdminPageLayout, PageHeader } from '@/templates/flowbite-admin';
import useSplatSegments from '@/hooks/useSplatSegments';
import FilesHeaderActions from '@/components/dashboard/files/FilesHeaderActions';
import FilesOverviewCards from '@/components/dashboard/files/FilesOverviewCards';
import FilesCategoriesPanel from '@/components/dashboard/files/FilesCategoriesPanel';

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

  const selectedCategoryName = useMemo(
    () => categories.find((category) => category.id === selectedCategory)?.name || null,
    [categories, selectedCategory]
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

  const loadCategories = React.useCallback(async () => {
    const data = await fetchCategories();
    setCategories(data);
  }, [fetchCategories]);

  // Load categories on mount
  React.useEffect(() => {
    loadCategories();
  }, [loadCategories]);

  useEffect(() => {
    if (segments.length > 0 && segments[0] !== 'trash') {
      navigate(basePath, { replace: true });
      return;
    }

    if (segments[0] === 'trash' && segments.length > 1) {
      navigate(`${basePath}/trash`, { replace: true });
    }
  }, [segments, basePath, navigate]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (showTrash) setSelectedCategory(null);
  }, [showTrash]);

  const handleCreateCategory = async () => {
    if (!newCategoryName.trim()) return;
    const newCat = await createCategory(newCategoryName);
    if (newCat) {
      setNewCategoryName('');
      setIsCreateCategoryOpen(false);
      loadCategories();
    }
  };

  const handleUpload = async (acceptedFiles) => {
    let successCount = 0;
    for (const file of acceptedFiles) {
      try {
        // Pass selectedCategory to uploadFile
        await uploadFile(file, '', selectedCategory, { sessionBoundAccess: uploadSessionBoundAccess });
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

  const breadcrumbs = [
    { label: 'Media Library', icon: Image, href: showTrash ? basePath : undefined },
    ...(showTrash ? [{ label: 'Trash Bin', icon: Trash2 }] : [])
  ];

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
    <AdminPageLayout>
      <Helmet>
        <title>{showTrash ? 'Trash - Media Library' : 'Media Library - CMS'}</title>
      </Helmet>

      <PageHeader
        title={showTrash ? 'Trash Bin' : 'Media Library'}
        description={showTrash
          ? 'Manage deleted files. You can restore them when needed.'
          : 'Manage and organize all your digital assets, images, and documents.'}
        breadcrumbs={breadcrumbs}
        actions={headerActions}
      />

      <FilesOverviewCards
        showTrash={showTrash}
        selectedCategoryName={selectedCategoryName}
        categoriesCount={categories.length}
        uploading={uploading}
      />

      <div className="flex flex-col space-y-6">
        {/* Stats Cards (Only show in main view) */}
        {!showTrash && (
          <div className="flex-shrink-0">
            <FileStats stats={stats} loading={statsLoading} />
          </div>
        )}

        <div className="flex flex-col md:flex-row gap-6 items-start">
          {/* Sidebar for Categories */}
          {!showTrash && (
            <div className="w-full md:w-64 flex-shrink-0 space-y-4">
              <FilesCategoriesPanel
                categories={categories}
                selectedCategory={selectedCategory}
                setSelectedCategory={setSelectedCategory}
                isCreateCategoryOpen={isCreateCategoryOpen}
                setIsCreateCategoryOpen={setIsCreateCategoryOpen}
                newCategoryName={newCategoryName}
                setNewCategoryName={setNewCategoryName}
                handleCreateCategory={handleCreateCategory}
              />
            </div>
          )}

          {/* Main Content Area */}
          <div className="min-h-[500px] w-full flex-1 overflow-hidden rounded-2xl border border-border/60 bg-card/75 shadow-sm backdrop-blur-sm">
            <MediaLibrary
              refreshTrigger={refreshTrigger}
              isTrashView={showTrash}
              categoryId={selectedCategory}
              edgeApiAvailable={edgeApiAvailable}
              edgeApiMessage={edgeApiMessage}
              refreshEdgeApiHealth={refreshEdgeApiHealth}
            />
          </div>
        </div>
      </div>
    </AdminPageLayout>
  );
}

export default FilesManager;
