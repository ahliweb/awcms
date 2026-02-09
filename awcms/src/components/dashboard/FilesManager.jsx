
import React, { useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { UploadCloud, Trash2, RefreshCw, FolderClosed, Image } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import MediaLibrary from './media/MediaLibrary';
import { FileUploader } from './media/FileUploader';
import { FileStats } from './media/FileStats';
import { useToast } from '@/components/ui/use-toast';
import { useMedia } from '@/hooks/useMedia';
import { AdminPageLayout, PageHeader } from '@/templates/flowbite-admin';

const FilesManager = () => {
  const [isUploadOpen, setIsUploadOpen] = useState(false);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [showTrash, setShowTrash] = useState(false);

  // Category State
  const [categories, setCategories] = useState([]);
  const [selectedCategory, setSelectedCategory] = useState(null);
  const [isCreateCategoryOpen, setIsCreateCategoryOpen] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');

  // Use new statsLoading prop
  const { uploadFile, uploading, syncFiles, syncing, stats, statsLoading, fetchCategories, createCategory } = useMedia();
  const { toast } = useToast();

  const loadCategories = React.useCallback(async () => {
    const data = await fetchCategories();
    setCategories(data);
  }, [fetchCategories]);

  // Load categories on mount
  React.useEffect(() => {
    loadCategories();
  }, [loadCategories]);

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
        await uploadFile(file, '', selectedCategory);
        successCount++;
      } catch (err) {
        toast({ variant: 'destructive', title: `Failed to upload ${file.name}`, description: err.message });
      }
    }
    if (successCount > 0) {
      toast({ title: 'Success', description: `${successCount} files uploaded successfully.` });
      setIsUploadOpen(false);
      setRefreshTrigger(prev => prev + 1);
    }
  };

  const handleSync = async () => {
    const success = await syncFiles();
    if (success) setRefreshTrigger(prev => prev + 1);
  };

  const breadcrumbs = [
    { label: 'Media Library', icon: Image, href: showTrash ? '/cmspanel/files' : undefined },
    ...(showTrash ? [{ label: 'Trash Bin', icon: Trash2 }] : [])
  ];

  const headerActions = (
    <div className="flex items-center gap-3">
      {!showTrash && (
        <Button
          variant="outline"
          onClick={handleSync}
          disabled={syncing}
          title="Sync files from Storage Bucket if missing in DB"
        >
          <RefreshCw className={`w-4 h-4 mr-2 ${syncing ? 'animate-spin' : ''}`} />
          {syncing ? 'Syncing...' : 'Sync Storage'}
        </Button>
      )}

      <Button
        variant={showTrash ? "outline" : "outline"}
        onClick={() => {
          setShowTrash(!showTrash);
          if (!showTrash) setSelectedCategory(null); // Reset category when going to trash
        }}
        className={`transition-colors border-border ${showTrash ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
      >
        {showTrash ? (
          <>
            <FolderClosed className="w-4 h-4 mr-2" />
            Back to Library
          </>
        ) : (
          <>
            <Trash2 className="w-4 h-4 mr-2 text-destructive" />
            Trash Bin
          </>
        )}
      </Button>

      {!showTrash && (
        <Dialog open={isUploadOpen} onOpenChange={setIsUploadOpen}>
          <DialogTrigger asChild>
            <Button className="shadow-sm">
              <UploadCloud className="w-4 h-4 mr-2" />
              Upload Files
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-xl">
            <DialogHeader>
              <DialogTitle>Upload Files</DialogTitle>
              <DialogDescription>
                Drag and drop files here to upload directly to your media library. Supported formats: JPG, PNG, WEBP, PDF.
                {selectedCategory && categories.find(c => c.id === selectedCategory) && (
                  <span className="block mt-2 text-blue-600 font-medium">
                    Uploading to category: {categories.find(c => c.id === selectedCategory)?.name}
                  </span>
                )}
              </DialogDescription>
            </DialogHeader>
            <div className="mt-4">
              <FileUploader onUpload={handleUpload} uploading={uploading} />
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
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
              <div className="bg-card rounded-xl border border-border shadow-sm p-4">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-semibold text-sm text-foreground">Categories</h3>
                  <Dialog open={isCreateCategoryOpen} onOpenChange={setIsCreateCategoryOpen}>
                    <DialogTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-6 w-6">
                        <div className="h-4 w-4" >+</div>
                      </Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>Create Category</DialogTitle>
                        <DialogDescription>Add a new category to organize your files.</DialogDescription>
                      </DialogHeader>
                      <div className="space-y-4 py-2">
                        <div className="space-y-2">
                          <label className="text-sm font-medium">Category Name</label>
                          <input
                            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                            value={newCategoryName}
                            onChange={(e) => setNewCategoryName(e.target.value)}
                            placeholder="e.g. Marketing, Products"
                          />
                        </div>
                        <Button onClick={handleCreateCategory} disabled={!newCategoryName.trim()}>Create</Button>
                      </div>
                    </DialogContent>
                  </Dialog>
                </div>

                <div className="space-y-1">
                  <Button
                    variant={selectedCategory === null ? "secondary" : "ghost"}
                    className="w-full justify-start font-normal"
                    onClick={() => setSelectedCategory(null)}
                  >
                    <FolderClosed className="w-4 h-4 mr-2" />
                    All Files
                  </Button>
                  {categories.map(cat => (
                    <Button
                      key={cat.id}
                      variant={selectedCategory === cat.id ? "secondary" : "ghost"}
                      className="w-full justify-start font-normal truncate"
                      onClick={() => setSelectedCategory(cat.id)}
                      title={cat.name}
                    >
                      <div className="w-4 h-4 mr-2 flex items-center justify-center">#</div>
                      <span className="truncate">{cat.name}</span>
                    </Button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Main Content Area */}
          <div className="flex-1 w-full bg-card rounded-xl border border-border shadow-sm overflow-hidden min-h-[500px]">
            <MediaLibrary
              refreshTrigger={refreshTrigger}
              isTrashView={showTrash}
              categoryId={selectedCategory}
            />
          </div>
        </div>
      </div>
    </AdminPageLayout>
  );
}

export default FilesManager;
