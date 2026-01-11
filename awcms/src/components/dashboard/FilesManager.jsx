
import React, { useState } from 'react';
import { Helmet } from 'react-helmet';
import { Link } from 'react-router-dom';
import { ChevronRight, UploadCloud, Trash2, RefreshCw, FolderClosed } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import MediaLibrary from './media/MediaLibrary';
import { FileUploader } from './media/FileUploader';
import { FileStats } from './media/FileStats';
import { useToast } from '@/components/ui/use-toast';
import { useMedia } from '@/hooks/useMedia';

function FilesManager() {
  const [isUploadOpen, setIsUploadOpen] = useState(false);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [showTrash, setShowTrash] = useState(false);

  // Use new statsLoading prop
  const { uploadFile, uploading, syncFiles, syncing, stats, statsLoading } = useMedia();
  const { toast } = useToast();

  const handleUpload = async (acceptedFiles) => {
    let successCount = 0;
    for (const file of acceptedFiles) {
      try {
        await uploadFile(file);
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

  return (
    <div className="flex flex-col space-y-6 pb-8">
      <Helmet>
        <title>{showTrash ? 'Trash - Media Library' : 'Media Library - CMS'}</title>
      </Helmet>

      {/* Header Section */}
      <div className="flex flex-col space-y-4 md:flex-row md:items-center md:justify-between md:space-y-0 flex-shrink-0">
        <div className="flex flex-col space-y-1">
          <nav className="flex items-center text-sm mb-3">
            <Link to="/cmspanel" className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors font-medium">
              <FolderClosed className="w-4 h-4" />
              Dashboard
            </Link>
            <ChevronRight className="w-4 h-4 mx-2 text-muted" />
            <span
              className={`flex items-center gap-1.5 font-semibold ${showTrash ? 'text-muted-foreground hover:text-foreground cursor-pointer transition-colors' : 'text-primary'}`}
              onClick={() => setShowTrash(false)}
            >
              <UploadCloud className="w-4 h-4" />
              Media Library
            </span>
            {showTrash && (
              <>
                <ChevronRight className="w-4 h-4 mx-2 text-muted" />
                <span className="flex items-center gap-1.5 font-semibold text-destructive">
                  <Trash2 className="w-4 h-4" />
                  Trash
                </span>
              </>
            )}
          </nav>

          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            {showTrash ? 'Trash Bin' : 'Media Library'}
          </h1>
          <p className="text-muted-foreground">
            {showTrash
              ? 'Manage deleted files. You can restore them when needed.'
              : 'Manage and organize all your digital assets, images, and documents.'}
          </p>
        </div>

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
            onClick={() => setShowTrash(!showTrash)}
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
                  </DialogDescription>
                </DialogHeader>
                <div className="mt-4">
                  <FileUploader onUpload={handleUpload} uploading={uploading} />
                </div>
              </DialogContent>
            </Dialog>
          )}
        </div>
      </div>

      {/* Stats Cards (Only show in main view) */}
      {!showTrash && (
        <div className="flex-shrink-0">
          <FileStats stats={stats} loading={statsLoading} />
        </div>
      )}

      {/* Main Content Area */}
      <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
        <MediaLibrary
          refreshTrigger={refreshTrigger}
          isTrashView={showTrash}
        />
      </div>
    </div>
  );
}

export default FilesManager;
