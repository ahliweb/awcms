import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { FileUploader } from '@/components/dashboard/media/FileUploader';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { AlertCircle, FolderClosed, RefreshCw, Trash2, UploadCloud } from 'lucide-react';
import { cn } from '@/lib/utils';
import { getSecureMediaSessionMaxAgeSeconds } from '@/lib/media';

function FilesHeaderActions({
  showTrash,
  selectedCategoryName,
  handleSync,
  syncing,
  edgeApiAvailable,
  edgeApiMessage,
  refreshEdgeApiHealth,
  navigate,
  basePath,
  isUploadOpen,
  setIsUploadOpen,
  uploadSessionBoundAccess,
  setUploadSessionBoundAccess,
  handleUpload,
  uploading,
}) {
  const secureWindowMinutes = Math.ceil(getSecureMediaSessionMaxAgeSeconds() / 60);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="inline-flex items-center rounded-full border border-primary/25 bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary">
        {selectedCategoryName || 'All Files'}
      </span>

      {!showTrash && (
        <Button
          variant="outline"
          onClick={handleSync}
          disabled={syncing}
          title="Sync files from Storage Bucket if missing in DB"
          className="h-10 rounded-xl border-border/70 bg-background/80 px-3 text-muted-foreground shadow-sm hover:bg-accent/70 hover:text-foreground"
        >
          <RefreshCw className={cn('mr-2 h-4 w-4', syncing && 'animate-spin')} />
          {syncing ? 'Syncing...' : 'Sync Storage'}
        </Button>
      )}

      {!showTrash && !edgeApiAvailable && (
        <Button
          type="button"
          variant="outline"
          onClick={refreshEdgeApiHealth}
          className="h-10 rounded-xl border-amber-300 bg-amber-50 px-3 text-amber-900 shadow-sm hover:bg-amber-100"
          title={edgeApiMessage || 'Cloudflare Edge API is unavailable'}
        >
          <AlertCircle className="mr-2 h-4 w-4" />
          Check Edge API
        </Button>
      )}

      <Button
        variant="outline"
        onClick={() => {
          navigate(showTrash ? basePath : `${basePath}/trash`);
        }}
        className={cn(
          'h-10 rounded-xl border-border/70 px-3 shadow-sm',
          showTrash
            ? 'bg-primary text-primary-foreground hover:opacity-95'
            : 'bg-background/80 text-muted-foreground hover:bg-accent/70 hover:text-foreground'
        )}
      >
        {showTrash ? (
          <>
            <FolderClosed className="mr-2 h-4 w-4" />
            Back to Library
          </>
        ) : (
          <>
            <Trash2 className="mr-2 h-4 w-4 text-destructive" />
            Trash Bin
          </>
        )}
      </Button>

      {!showTrash && (
        <Dialog open={isUploadOpen} onOpenChange={setIsUploadOpen}>
          <DialogTrigger asChild>
            <Button
              className="h-10 rounded-xl bg-primary px-4 text-primary-foreground shadow-sm hover:opacity-95"
              disabled={!edgeApiAvailable}
              title={!edgeApiAvailable ? edgeApiMessage : undefined}
            >
              <UploadCloud className="mr-2 h-4 w-4" />
              Upload Files
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-xl border-border/60">
            <DialogHeader>
              <DialogTitle>Upload Files</DialogTitle>
              <DialogDescription>
                Drag and drop files here to upload directly to your media library. Supported formats include images, videos, and PDF documents.
                {selectedCategoryName && (
                  <span className="mt-2 block font-medium text-primary">
                    Uploading to category: {selectedCategoryName}
                  </span>
                )}
              </DialogDescription>
            </DialogHeader>
            <div className="mt-4 space-y-4">
              {!edgeApiAvailable && (
                <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
                  <p className="font-medium">Cloudflare Edge API unavailable</p>
                  <p className="mt-1">{edgeApiMessage}</p>
                </div>
              )}
              <div className="rounded-xl border border-border/70 bg-muted/30 p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-1">
                    <Label htmlFor="upload-session-bound-access" className="text-sm font-semibold text-foreground">
                      Protect with session-bound access
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      New uploads use an encrypted filename prefix, switch to private delivery, and stay accessible for up to {secureWindowMinutes} minutes from the current login session.
                    </p>
                  </div>
                  <Switch
                    id="upload-session-bound-access"
                    checked={uploadSessionBoundAccess}
                    onCheckedChange={setUploadSessionBoundAccess}
                  />
                </div>
              </div>
              <FileUploader onUpload={handleUpload} uploading={uploading || !edgeApiAvailable} />
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

export default FilesHeaderActions;
