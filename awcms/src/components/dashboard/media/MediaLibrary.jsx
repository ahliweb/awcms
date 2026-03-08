
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useDropzone } from 'react-dropzone';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/use-toast';
import { Upload, File, Trash2, Copy, Search, Loader2, Grid, List, RefreshCw, Info, Link2, ChevronLeft, ChevronRight } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { usePermissions } from '@/contexts/PermissionContext';
import { useMedia } from '@/hooks/useMedia'; // Import useMedia
import { cn } from '@/lib/utils';

const formatFileSize = (bytes) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

const MediaLibrary = ({ onSelect, selectionMode = false, refreshTrigger = 0, isTrashView = false, categoryId = null }) => {
    const { toast } = useToast();
    const { checkAccess, isPlatformAdmin } = usePermissions();

    // Use the hook
    const {
        fetchFiles: hookFetchFiles,
        uploadFile,
        softDeleteFile,
        bulkSoftDelete,
        restoreFile,
        getFileUrl,
        uploading: hookUploading
    } = useMedia();

    const canUpload = checkAccess('create', 'files');
    const canDelete = checkAccess('delete', 'files');

    const [files, setFiles] = useState([]);
    const [loading, setLoading] = useState(true);
    const [query, setQuery] = useState('');
    const [viewMode, setViewMode] = useState('grid');
    const [deleteConfirm, setDeleteConfirm] = useState({ open: false, fileId: null, fileName: '', isBulk: false });
    const [selectedFiles, setSelectedFiles] = useState(new Set());

    // Pagination state
    const [currentPage, setCurrentPage] = useState(1);
    const [itemsPerPage, setItemsPerPage] = useState(12);
    const [totalItems, setTotalItems] = useState(0);
    const totalPages = Math.ceil(totalItems / itemsPerPage);

    const hasQuery = query.trim().length > 0;
    const selectedCount = selectedFiles.size;
    const pageImageCount = useMemo(
        () => files.filter((file) => file.file_type?.startsWith('image/')).length,
        [files]
    );
    const pageVideoCount = useMemo(
        () => files.filter((file) => file.file_type?.startsWith('video/')).length,
        [files]
    );
    const pageDocumentCount = useMemo(
        () => files.filter((file) => !file.file_type?.startsWith('image/') && !file.file_type?.startsWith('video/')).length,
        [files]
    );

    const fetchFiles = useCallback(async () => {
        setLoading(true);
        try {
            const { data, count } = await hookFetchFiles({
                page: currentPage,
                limit: itemsPerPage,
                query,
                isTrash: isTrashView,
                categoryId // Pass categoryId to hook
            });

            setFiles(data);
            setTotalItems(count);
        } catch (err) {
            console.error('Error fetching files:', err);
        } finally {
            setLoading(false);
        }
    }, [hookFetchFiles, query, isTrashView, currentPage, itemsPerPage, categoryId]);

    useEffect(() => {
        fetchFiles();
    }, [fetchFiles, refreshTrigger]);

    const onDrop = useCallback(async (acceptedFiles, fileRejections) => {
        // Handle rejections
        if (fileRejections?.length > 0) {
            fileRejections.forEach(({ file, errors }) => {
                errors.forEach(e => {
                    if (e.code === 'file-too-large') {
                        toast({ variant: 'destructive', title: 'File Too Large', description: `${file.name} exceeds the 50MB limit.` });
                    } else if (e.code === 'file-invalid-type') {
                        toast({ variant: 'destructive', title: 'Invalid File Type', description: `${file.name} is not supported.` });
                    } else {
                        toast({ variant: 'destructive', title: 'Upload Failed', description: `${file.name}: ${e.message}` });
                    }
                });
            });
        }

        if (acceptedFiles.length === 0) return;

        let successCount = 0;

        for (const file of acceptedFiles) {
            try {
                if (!canUpload) {
                    throw new Error('Permission denied: Cannot upload files.');
                }

                await uploadFile(file, '', categoryId);
                successCount++;
            } catch (err) {
                console.error(`Failed to upload ${file.name}: `, err);
                toast({ variant: 'destructive', title: 'Upload Failed', description: `Could not upload ${file.name} ` });
            }
        }

        if (successCount > 0) {
            toast({ title: 'Upload Complete', description: `${successCount} files uploaded successfully.` });
            fetchFiles();
        }
    }, [categoryId, fetchFiles, toast, canUpload, uploadFile]);

    // ... dropzone ...
    const { getRootProps, getInputProps, isDragActive } = useDropzone({
        onDrop,
        noClick: selectionMode,
        maxSize: 50 * 1024 * 1024, // 50MB
        accept: {
            'image/*': [],
            'video/*': [],
            'application/pdf': []
        }
    });

    // Open delete confirmation dialog
    const handleDelete = (id, fileName = 'this file') => {
        setDeleteConfirm({ open: true, fileId: id, fileName });
    };

    // Perform actual delete after confirmation
    const confirmDelete = async () => {
        if (!canDelete) {
            toast({ variant: 'destructive', title: 'Permission Denied', description: 'You do not have permission to delete files.' });
            return;
        }
        if (isTrashView) {
            toast({ variant: 'destructive', title: 'Action Disabled', description: 'Permanent delete is disabled. Restore files instead.' });
            return;
        }
        const id = deleteConfirm.fileId;
        if (!id) return;

        setDeleteConfirm({ open: false, fileId: null, fileName: '' });

        const success = await softDeleteFile(id);
        if (success) {
            fetchFiles();
            setSelectedFiles(new Set());
        }
    };

    // ... selection helpers ...
    const toggleSelect = (fileId) => {
        setSelectedFiles(prev => {
            const newSet = new Set(prev);
            if (newSet.has(fileId)) {
                newSet.delete(fileId);
            } else {
                newSet.add(fileId);
            }
            return newSet;
        });
    };

    const selectAll = () => {
        setSelectedFiles(new Set(files.map(f => f.id)));
    };

    const clearSelection = () => {
        setSelectedFiles(new Set());
    };

    const isAllSelected = files.length > 0 && selectedFiles.size === files.length;
    const hasSelection = selectedFiles.size > 0;

    // Bulk delete handler
    const handleBulkDelete = () => {
        if (isTrashView) {
            toast({ variant: 'destructive', title: 'Action Disabled', description: 'Permanent delete is disabled. Restore files instead.' });
            return;
        }
        const count = selectedFiles.size;
        setDeleteConfirm({
            open: true,
            fileId: null,
            fileName: `${count} file${count > 1 ? 's' : ''}`,
            isBulk: true
        });
    };

    // Bulk delete confirmation
    const confirmBulkDelete = async () => {
        if (!canDelete) {
            toast({ variant: 'destructive', title: 'Permission Denied', description: 'You do not have permission to delete files.' });
            return;
        }

        const ids = Array.from(selectedFiles);
        setDeleteConfirm({ open: false, fileId: null, fileName: '', isBulk: false });

        const { success } = await bulkSoftDelete(ids);

        if (success > 0) {
            setSelectedFiles(new Set());
            fetchFiles();
        }
    };

    const handleRestore = async (id) => {
        const success = await restoreFile(id);
        if (success) fetchFiles();
    };

    const copyToClipboard = (url) => {
        navigator.clipboard.writeText(url);
        toast({ title: 'Copied', description: 'URL copied to clipboard' });
    };

    // Pass uploading state from hook
    const uploading = hookUploading;

    return (
        <div className="space-y-6 p-4">
            <div className="rounded-2xl border border-border/60 bg-card/65 p-4 shadow-sm backdrop-blur-sm">
                <div className="grid gap-3 lg:grid-cols-[minmax(260px,420px)_1fr_auto] lg:items-center">
                    <div className="relative max-w-xl">
                        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                        <Input
                            className="h-10 rounded-xl border-border/70 bg-background pl-9"
                            placeholder="Search files..."
                            value={query}
                            onChange={e => setQuery(e.target.value)}
                        />
                    </div>

                    <div className="flex flex-wrap items-center gap-2 text-xs sm:text-sm">
                        <span className="inline-flex items-center rounded-full border border-border/70 bg-background/70 px-3 py-1.5 text-muted-foreground">
                            Total: <span className="ml-1 font-semibold text-foreground">{totalItems}</span>
                        </span>
                        <span className="inline-flex items-center rounded-full border border-border/70 bg-background/70 px-3 py-1.5 text-muted-foreground">
                            View: <span className="ml-1 font-semibold capitalize text-foreground">{viewMode}</span>
                        </span>
                        {hasQuery ? (
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setQuery('')}
                                className="h-8 rounded-full border border-border/70 px-3 text-muted-foreground hover:bg-accent/60 hover:text-foreground"
                            >
                                Clear Search
                            </Button>
                        ) : null}
                    </div>

                    <div className="flex items-center justify-end gap-2">
                        <div className="inline-flex items-center rounded-xl border border-border/70 bg-background/75 p-1">
                            <Button
                                variant="ghost"
                                size="icon"
                                className={cn('h-8 w-8 rounded-lg', viewMode === 'grid' && 'bg-primary/10 text-primary')}
                                onClick={() => setViewMode('grid')}
                                title="Grid View"
                            >
                                <Grid className="h-4 w-4" />
                            </Button>
                            <Button
                                variant="ghost"
                                size="icon"
                                className={cn('h-8 w-8 rounded-lg', viewMode === 'list' && 'bg-primary/10 text-primary')}
                                onClick={() => setViewMode('list')}
                                title="List View"
                            >
                                <List className="h-4 w-4" />
                            </Button>
                        </div>
                        <Button
                            variant="outline"
                            onClick={fetchFiles}
                            disabled={loading}
                            className="h-10 rounded-xl border-border/70 bg-background/75 px-3 text-muted-foreground hover:bg-accent/70 hover:text-foreground"
                        >
                            <RefreshCw className={cn('mr-1.5 h-4 w-4', loading && 'animate-spin')} />
                            Refresh
                        </Button>
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-2xl border border-border/60 bg-card/65 p-4 shadow-sm backdrop-blur-sm">
                    <div className="flex items-start justify-between gap-3">
                        <div>
                            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Visible</p>
                            <p className="mt-1 text-2xl font-semibold tracking-tight text-foreground">{files.length}</p>
                            <p className="text-xs text-muted-foreground">Current page</p>
                        </div>
                        <span className="rounded-xl border border-border/70 bg-background/70 p-2 text-primary">
                            <File className="h-4 w-4" />
                        </span>
                    </div>
                </div>

                <div className="rounded-2xl border border-border/60 bg-card/65 p-4 shadow-sm backdrop-blur-sm">
                    <div className="flex items-start justify-between gap-3">
                        <div>
                            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Selected</p>
                            <p className="mt-1 text-2xl font-semibold tracking-tight text-foreground">{selectedCount}</p>
                            <p className="text-xs text-muted-foreground">Batch actions</p>
                        </div>
                        <span className="rounded-xl border border-primary/25 bg-primary/10 p-2 text-primary">
                            <Link2 className="h-4 w-4" />
                        </span>
                    </div>
                </div>

                <div className="rounded-2xl border border-border/60 bg-card/65 p-4 shadow-sm backdrop-blur-sm">
                    <div className="flex items-start justify-between gap-3">
                        <div>
                            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Images</p>
                            <p className="mt-1 text-2xl font-semibold tracking-tight text-foreground">{pageImageCount}</p>
                            <p className="text-xs text-muted-foreground">On this page</p>
                        </div>
                        <span className="rounded-xl border border-border/70 bg-background/70 p-2 text-primary">
                            <Grid className="h-4 w-4" />
                        </span>
                    </div>
                </div>

                <div className="rounded-2xl border border-border/60 bg-card/65 p-4 shadow-sm backdrop-blur-sm">
                    <div className="flex items-start justify-between gap-3">
                        <div>
                            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Other Files</p>
                            <p className="mt-1 text-2xl font-semibold tracking-tight text-foreground">{pageVideoCount + pageDocumentCount}</p>
                            <p className="text-xs text-muted-foreground">Video + documents</p>
                        </div>
                        <span className="rounded-xl border border-border/70 bg-background/70 p-2 text-primary">
                            <List className="h-4 w-4" />
                        </span>
                    </div>
                </div>
            </div>

            {/* Selection Toolbar */}
            {!selectionMode && files.length > 0 && (
                <div className="flex flex-col gap-3 rounded-2xl border border-border/60 bg-card/65 px-4 py-3 shadow-sm backdrop-blur-sm md:flex-row md:items-center md:justify-between">
                    <div className="flex items-center gap-3">
                        <Checkbox
                            checked={isAllSelected}
                            onCheckedChange={(checked) => checked ? selectAll() : clearSelection()}
                            id="select-all"
                        />
                        <label htmlFor="select-all" className="cursor-pointer text-sm text-muted-foreground">
                            {isAllSelected ? 'Deselect All' : 'Select All'} ({files.length} files)
                        </label>
                        {hasSelection && (
                            <span className="text-sm font-medium text-primary">
                                {selectedCount} selected
                            </span>
                        )}
                    </div>
                    {hasSelection && (
                        <div className="flex items-center gap-2">
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={clearSelection}
                                className="text-muted-foreground"
                            >
                                Clear Selection
                            </Button>
                            {!isTrashView && canDelete && (
                                <Button
                                    variant="destructive"
                                    size="sm"
                                    onClick={handleBulkDelete}
                                    className="gap-1"
                                >
                                    <Trash2 className="w-4 h-4" />
                                    Delete Selected ({selectedFiles.size})
                                </Button>
                            )}
                        </div>
                    )}
                </div>
            )}



            {!selectionMode && !isTrashView && canUpload && (
                <div
                    {...getRootProps()}
                    className={cn(
                        'cursor-pointer rounded-2xl border-2 border-dashed p-8 text-center transition-colors',
                        isDragActive
                            ? 'border-primary/50 bg-primary/10'
                            : 'border-border/70 bg-card/60 hover:border-primary/40 hover:bg-card/80'
                    )}
                >
                    <input {...getInputProps()} />
                    {uploading ? (
                        <div className="flex flex-col items-center gap-2 text-primary">
                            <Loader2 className="w-8 h-8 animate-spin" />
                            <p>Uploading files...</p>
                        </div>
                    ) : (
                        <div className="flex flex-col items-center gap-2 text-muted-foreground">
                            <Upload className="h-8 w-8 text-muted-foreground" />
                            <p className="font-medium">Drag & drop files here, or click to select files</p>
                            <p className="text-sm text-muted-foreground">Supports images, documents, and videos</p>
                        </div>
                    )}
                </div>
            )}

            {loading ? (
                <div className="rounded-2xl border border-border/60 bg-card/60 py-14 text-center text-muted-foreground">Loading library...</div>
            ) : files.length === 0 ? (
                <div className="rounded-2xl border border-border/60 bg-card/60 py-14 text-center text-muted-foreground">
                    {isTrashView ? 'Trash is empty.' : 'No files found. Upload some!'}
                </div>
            ) : viewMode === 'grid' ? (
                <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
                    {files.map(file => (
                        <Card key={file.id} className={cn('group relative overflow-hidden border-border/60 bg-card/80 transition-shadow hover:shadow-md', selectedFiles.has(file.id) ? 'ring-2 ring-primary/70' : '')}>
                            {/* Selection Checkbox */}
                            {!selectionMode && (
                                <div className="absolute top-2 left-2 z-10">
                                    <Checkbox
                                        checked={selectedFiles.has(file.id)}
                                        onCheckedChange={() => toggleSelect(file.id)}
                                        className="border-border bg-background/90"
                                    />
                                </div>
                            )}
                            <div className="relative flex aspect-square items-center justify-center overflow-hidden bg-muted/60">
                                {file.file_type?.startsWith('image/') ? (
                                    <img src={getFileUrl(file)} alt={file.name} className="w-full h-full object-cover" />
                                ) : (
                                    <File className="h-10 w-10 text-muted-foreground" />
                                )}
                                <div className="absolute inset-0 flex items-center justify-center gap-2 bg-black/50 opacity-0 transition-opacity group-hover:opacity-100">
                                    {!selectionMode && (
                                        <>
                                            <Button size="icon" variant="secondary" className="h-8 w-8" onClick={() => copyToClipboard(getFileUrl(file))} title="Copy URL">
                                                <Copy className="w-4 h-4" />
                                            </Button>
                                            {isTrashView ? (
                                                <Button size="icon" variant="secondary" className="h-8 w-8 text-green-600" onClick={() => handleRestore(file.id)} title="Restore">
                                                    <RefreshCw className="w-4 h-4" />
                                                </Button>
                                            ) : null}
                                            {!isTrashView && canDelete && (
                                                <Button
                                                    type="button"
                                                    size="icon"
                                                    variant="destructive"
                                                    className="h-8 w-8"
                                                    onClick={(e) => {
                                                        e.preventDefault();
                                                        e.stopPropagation();
                                                        handleDelete(file.id, file.name);
                                                    }}
                                                    title="Move to Trash"
                                                >
                                                    <Trash2 className="w-4 h-4" />
                                                </Button>
                                            )}
                                        </>
                                    )}
                                    {selectionMode && (
                                        <Button size="sm" onClick={() => onSelect(file)}>Select</Button>
                                    )}
                                </div>
                            </div>
                            <div className="p-2">
                                {isPlatformAdmin && (
                                    <span className="mb-1 inline-block rounded-full border border-border/70 bg-background/80 px-2 py-0.5 text-[9px] font-medium text-muted-foreground">
                                        {file.tenant?.name || '(Unknown)'}
                                    </span>
                                )}
                                <p className="truncate text-xs font-medium text-foreground" title={file.name}>{file.name}</p>
                                <p className="text-[10px] text-muted-foreground">{formatFileSize(file.file_size)}</p>
                            </div>
                        </Card>
                    ))}
                </div>
            ) : (
                <div className="rounded-xl border border-border/60 bg-card/75">
                    {files.map(file => {
                        return (
                            <div key={file.id} className={cn('flex items-center justify-between border-b border-border/50 p-3 last:border-0 hover:bg-muted/40', selectedFiles.has(file.id) ? 'bg-primary/10' : '')}>
                                {/* Selection Checkbox */}
                                {!selectionMode && (
                                    <div className="flex-shrink-0 mr-3">
                                        <Checkbox
                                            checked={selectedFiles.has(file.id)}
                                            onCheckedChange={() => toggleSelect(file.id)}
                                        />
                                    </div>
                                )}
                                <div className="flex items-center gap-3 overflow-hidden flex-1">
                                    <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center overflow-hidden rounded bg-muted/60">
                                        {file.file_type?.startsWith('image/') ? (
                                            <img src={getFileUrl(file)} alt="" className="w-full h-full object-cover rounded" />
                                        ) : (
                                            <File className="h-5 w-5 text-muted-foreground" />
                                        )}
                                    </div>
                                    <div className="min-w-0 flex-1">
                                        <p className="truncate text-sm font-medium text-foreground">{file.name}</p>
                                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                            {isPlatformAdmin && (
                                                <>
                                                    <span className="rounded-full border border-border/70 bg-background/80 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                                                        {file.tenant?.name || '(Unknown)'}
                                                    </span>
                                                    <span>•</span>
                                                </>
                                            )}
                                            <span>{formatFileSize(file.file_size)}</span>
                                            <span>•</span>
                                            <span>{new Date(file.created_at).toLocaleDateString()}</span>
                                            {file.uploader && (
                                                <>
                                                    <span>•</span>
                                                    <span className="text-muted-foreground">by {file.uploader.full_name || file.uploader.email}</span>
                                                </>
                                            )}
                                        </div>
                                    </div>
                                </div>
                                <div className="flex items-center gap-2 ml-2">
                                    {!selectionMode && (
                                        <>
                                            {/* Details Button */}
                                            <Dialog>
                                                <DialogTrigger asChild>
                                                    <Button size="icon" variant="ghost" className="h-8 w-8" title="View Details">
                                                        <Info className="w-4 h-4" />
                                                    </Button>
                                                </DialogTrigger>
                                                <DialogContent className="max-w-md border-border/60 bg-background/95">
                                                    <DialogHeader>
                                                        <DialogTitle>File Details</DialogTitle>
                                                        <DialogDescription>Information about this file and where it&apos;s used.</DialogDescription>
                                                    </DialogHeader>
                                                    <div className="space-y-4 mt-4">
                                                        {/* Preview */}
                                                        <div className="flex aspect-video items-center justify-center overflow-hidden rounded-lg bg-muted/60">
                                                            {file.file_type?.startsWith('image/') ? (
                                                                <img src={getFileUrl(file)} alt={file.name} className="max-w-full max-h-full object-contain" />
                                                            ) : (
                                                                <File className="h-16 w-16 text-muted-foreground" />
                                                            )}
                                                        </div>
                                                        {/* Details */}
                                                        <div className="grid grid-cols-2 gap-3 text-sm">
                                                            <div>
                                                                <p className="text-muted-foreground">File Name</p>
                                                                <p className="truncate font-medium text-foreground">{file.name}</p>
                                                            </div>
                                                            <div>
                                                                <p className="text-muted-foreground">Size</p>
                                                                <p className="font-medium text-foreground">{formatFileSize(file.file_size)}</p>
                                                            </div>
                                                            <div>
                                                                <p className="text-muted-foreground">Type</p>
                                                                <p className="font-medium text-foreground">{file.file_type}</p>
                                                            </div>
                                                            <div>
                                                                <p className="text-muted-foreground">Uploaded</p>
                                                                <p className="font-medium text-foreground">{new Date(file.created_at).toLocaleDateString()}</p>
                                                            </div>
                                                            <div>
                                                                <p className="text-muted-foreground">Uploaded By</p>
                                                                <p className="font-medium text-foreground">{file.uploader?.full_name || file.uploader?.email || 'Unknown'}</p>
                                                            </div>
                                                        </div>
                                                        {/* URL */}
                                                        <div>
                                                            <p className="mb-1 text-sm text-muted-foreground">Public URL</p>
                                                            <div className="flex gap-2">
                                                                <Input value={getFileUrl(file)} readOnly className="text-xs" />
                                                                <Button size="sm" onClick={() => copyToClipboard(getFileUrl(file))}>
                                                                    <Copy className="w-3 h-3" />
                                                                </Button>
                                                            </div>
                                                        </div>
                                                    </div>
                                                </DialogContent>
                                            </Dialog>
                                            <Button size="sm" variant="ghost" onClick={() => copyToClipboard(getFileUrl(file))}>Copy URL</Button>
                                            {isTrashView && (
                                                <Button size="icon" variant="ghost" className="text-emerald-600 hover:bg-emerald-500/10" onClick={() => handleRestore(file.id)} title="Restore">
                                                    <RefreshCw className="w-4 h-4" />
                                                </Button>
                                            )}
                                            {!isTrashView && canDelete && (
                                                <Button
                                                    type="button"
                                                    size="sm"
                                                    variant="ghost"
                                                    className="gap-1 text-destructive hover:bg-destructive/10 hover:text-destructive"
                                                    onClick={(e) => {
                                                        e.preventDefault();
                                                        e.stopPropagation();
                                                        handleDelete(file.id, file.name);
                                                    }}
                                                >
                                                    <Trash2 className="w-4 h-4" />
                                                    Delete
                                                </Button>
                                            )}
                                        </>
                                    )}
                                    {selectionMode && (
                                        <Button size="sm" onClick={() => onSelect(file)}>Select</Button>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            {/* Pagination Controls */}
            {files.length > 0 && (
                <div className="mt-4 flex flex-col gap-3 rounded-2xl border border-border/60 bg-card/65 px-4 py-3 shadow-sm backdrop-blur-sm md:flex-row md:items-center md:justify-between">
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <span>Showing {Math.min(((currentPage - 1) * itemsPerPage) + 1, totalItems)} - {Math.min(currentPage * itemsPerPage, totalItems)} of {totalItems} files</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <select
                            value={itemsPerPage}
                            onChange={(e) => { setItemsPerPage(Number(e.target.value)); setCurrentPage(1); }}
                            className="h-9 rounded-lg border border-border/70 bg-background px-3 py-1 text-sm text-foreground outline-none focus:ring-2 focus:ring-primary/30"
                        >
                            <option value={12}>12 / page</option>
                            <option value={24}>24 / page</option>
                            <option value={48}>48 / page</option>
                            <option value={96}>96 / page</option>
                        </select>
                        <div className="flex items-center gap-1">
                            <Button
                                variant="outline"
                                size="icon"
                                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                                disabled={currentPage === 1}
                                className="h-9 w-9 border-border/70 bg-background/80"
                            >
                                <ChevronLeft className="w-4 h-4" />
                            </Button>
                            <span className="px-3 py-1 text-sm font-medium text-foreground">
                                {currentPage} / {totalPages || 1}
                            </span>
                            <Button
                                variant="outline"
                                size="icon"
                                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                                disabled={currentPage >= totalPages}
                                className="h-9 w-9 border-border/70 bg-background/80"
                            >
                                <ChevronRight className="w-4 h-4" />
                            </Button>
                        </div>
                    </div>
                </div>
            )}

            {/* Delete Confirmation Dialog */}
            <AlertDialog open={deleteConfirm.open} onOpenChange={(open) => !open && setDeleteConfirm({ open: false, fileId: null, fileName: '', isBulk: false })}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>
                            Move to Trash?
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                            {deleteConfirm.isBulk
                                ? `This will move ${deleteConfirm.fileName} to the trash bin. You can restore them later.`
                                : `This will move "${deleteConfirm.fileName}" to the trash bin. You can restore it later.`
                            }
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={deleteConfirm.isBulk ? confirmBulkDelete : confirmDelete}
                        >
                            Move to Trash
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
};

export default MediaLibrary;
