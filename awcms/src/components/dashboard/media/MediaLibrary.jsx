
import React, { useState, useEffect, useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/use-toast';
import { Upload, File, Trash2, Copy, Search, Loader2, Grid, List, RefreshCw, Info, Link2, ChevronLeft, ChevronRight } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { usePermissions } from '@/contexts/PermissionContext';
import { useMedia } from '@/hooks/useMedia'; // Import useMedia
import { supabase } from '@/lib/customSupabaseClient'; // Keep for usage analysis only if needed, or move to hook

const formatFileSize = (bytes) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

const MediaLibrary = ({ onSelect, selectionMode = false, refreshTrigger = 0, isTrashView = false }) => {
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
    const [usageData, setUsageData] = useState({});
    const [deleteConfirm, setDeleteConfirm] = useState({ open: false, fileId: null, fileName: '', isBulk: false });
    const [selectedFiles, setSelectedFiles] = useState(new Set());

    // Pagination state
    const [currentPage, setCurrentPage] = useState(1);
    const [itemsPerPage, setItemsPerPage] = useState(12);
    const [totalItems, setTotalItems] = useState(0);
    const totalPages = Math.ceil(totalItems / itemsPerPage);

    const fetchFiles = useCallback(async () => {
        setLoading(true);
        try {
            const { data, count } = await hookFetchFiles({
                page: currentPage,
                limit: itemsPerPage,
                query,
                isTrash: isTrashView
            });
            
            setFiles(data);
            setTotalItems(count);

            // Fetch usage data for files (keep existing logic or move to hook later)
            if (!isTrashView && data?.length > 0) {
                fetchUsageData();
            }
        } catch (err) {
            console.error('Error fetching files:', err);
        } finally {
            setLoading(false);
        }
    }, [hookFetchFiles, query, isTrashView, currentPage, itemsPerPage]);

    const fetchUsageData = async () => {
        try {
            const { data: usage, error } = await supabase.rpc('analyze_file_usage');
            if (!error && usage) {
                const usageMap = {};
                usage.forEach(u => {
                    usageMap[u.file_path] = {
                        count: u.usage_count || 0,
                        modules: u.modules || [],
                        details: u.details || []
                    };
                });
                setUsageData(usageMap);
            }
        } catch (err) {
            console.warn('Usage analysis not available:', err);
        }
    };

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
                
                await uploadFile(file);
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
    }, [fetchFiles, toast, canUpload, uploadFile]);

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
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div className="flex items-center gap-2 w-full md:w-auto">
                    <div className="relative flex-1 md:w-64">
                        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
                        <Input
                            className="pl-9"
                            placeholder="Search files..."
                            value={query}
                            onChange={e => setQuery(e.target.value)}
                        />
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <Button variant={viewMode === 'grid' ? 'secondary' : 'ghost'} size="icon" onClick={() => setViewMode('grid')}>
                        <Grid className="w-4 h-4" />
                    </Button>
                    <Button variant={viewMode === 'list' ? 'secondary' : 'ghost'} size="icon" onClick={() => setViewMode('list')}>
                        <List className="w-4 h-4" />
                    </Button>
                </div>
            </div>

            {/* Selection Toolbar */}
            {!selectionMode && files.length > 0 && (
                <div className="flex items-center justify-between bg-slate-50 rounded-lg px-4 py-2 border border-slate-200">
                    <div className="flex items-center gap-3">
                        <Checkbox
                            checked={isAllSelected}
                            onCheckedChange={(checked) => checked ? selectAll() : clearSelection()}
                            id="select-all"
                        />
                        <label htmlFor="select-all" className="text-sm text-slate-600 cursor-pointer">
                            {isAllSelected ? 'Deselect All' : 'Select All'} ({files.length} files)
                        </label>
                        {hasSelection && (
                            <span className="text-sm font-medium text-blue-600">
                                {selectedFiles.size} selected
                            </span>
                        )}
                    </div>
                    {hasSelection && (
                        <div className="flex items-center gap-2">
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={clearSelection}
                                className="text-slate-500"
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
                <div {...getRootProps()} className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors ${isDragActive ? 'border-blue-500 bg-blue-50' : 'border-slate-300 hover:border-blue-400'} `}>
                    <input {...getInputProps()} />
                    {uploading ? (
                        <div className="flex flex-col items-center gap-2 text-blue-600">
                            <Loader2 className="w-8 h-8 animate-spin" />
                            <p>Uploading files...</p>
                        </div>
                    ) : (
                        <div className="flex flex-col items-center gap-2 text-slate-500">
                            <Upload className="w-8 h-8 text-slate-400" />
                            <p className="font-medium">Drag & drop files here, or click to select files</p>
                            <p className="text-sm text-slate-400">Supports images, documents, and videos</p>
                        </div>
                    )}
                </div>
            )}

            {loading ? (
                <div className="text-center py-12 text-slate-500">Loading library...</div>
            ) : files.length === 0 ? (
                <div className="text-center py-12 text-slate-400">
                    {isTrashView ? 'Trash is empty.' : 'No files found. Upload some!'}
                </div>
            ) : viewMode === 'grid' ? (
                <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
                    {files.map(file => (
                        <Card key={file.id} className={`overflow-hidden group relative hover:shadow-md transition-shadow ${selectedFiles.has(file.id) ? 'ring-2 ring-blue-500' : ''}`}>
                            {/* Selection Checkbox */}
                            {!selectionMode && (
                                <div className="absolute top-2 left-2 z-10">
                                    <Checkbox
                                        checked={selectedFiles.has(file.id)}
                                        onCheckedChange={() => toggleSelect(file.id)}
                                        className="bg-white/90 border-slate-300"
                                    />
                                </div>
                            )}
                            <div className="aspect-square bg-slate-100 flex items-center justify-center relative overflow-hidden">
                                {file.file_type.startsWith('image/') ? (
                                    <img src={getFileUrl(file)} alt={file.name} className="w-full h-full object-cover" />
                                ) : (
                                    <File className="w-10 h-10 text-slate-400" />
                                )}
                                <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
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
                                    <span className="text-[9px] font-medium text-slate-600 bg-slate-100 px-1.5 py-0.5 rounded mb-1 inline-block">
                                        {file.tenant?.name || '(Unknown)'}
                                    </span>
                                )}
                                <p className="text-xs font-medium truncate" title={file.name}>{file.name}</p>
                                <p className="text-[10px] text-slate-500">{formatFileSize(file.file_size)}</p>
                            </div>
                        </Card>
                    ))}
                </div>
            ) : (
                <div className="bg-white rounded-lg border border-slate-200">
                    {files.map(file => {
                        const usage = usageData[file.file_path] || usageData[getFileUrl(file)] || { count: 0, modules: [] };

                        return (
                            <div key={file.id} className={`flex items-center justify-between p-3 border-b border-slate-100 last:border-0 hover:bg-slate-50 ${selectedFiles.has(file.id) ? 'bg-blue-50' : ''}`}>
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
                                    <div className="w-10 h-10 rounded bg-slate-100 flex items-center justify-center flex-shrink-0 overflow-hidden">
                                        {file.file_type.startsWith('image/') ? (
                                            <img src={getFileUrl(file)} alt="" className="w-full h-full object-cover rounded" />
                                        ) : (
                                            <File className="w-5 h-5 text-slate-400" />
                                        )}
                                    </div>
                                    <div className="min-w-0 flex-1">
                                        <p className="text-sm font-medium truncate">{file.name}</p>
                                        <div className="flex items-center gap-2 text-xs text-slate-500">
                                            {isPlatformAdmin && (
                                                <>
                                                    <span className="text-[10px] font-medium text-slate-600 bg-slate-100 px-1.5 py-0.5 rounded">
                                                        {file.tenant?.name || '(Unknown)'}
                                                    </span>
                                                    <span>•</span>
                                                </>
                                            )}
                                            <span>{formatFileSize(file.file_size)}</span>
                                            <span>•</span>
                                            <span>{new Date(file.created_at).toLocaleDateString()}</span>
                                            {file.users && (
                                                <>
                                                    <span>•</span>
                                                    <span className="text-slate-400">by {file.users.full_name || file.users.email}</span>
                                                </>
                                            )}
                                        </div>
                                    </div>
                                    {/* Usage Badge */}
                                    {!isTrashView && (
                                        <TooltipProvider>
                                            <Tooltip>
                                                <TooltipTrigger asChild>
                                                    <div className={`flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${usage.count > 0
                                                        ? 'bg-green-100 text-green-700'
                                                        : 'bg-slate-100 text-slate-500'
                                                        }`}>
                                                        <Link2 className="w-3 h-3" />
                                                        <span>{usage.count || 0}</span>
                                                    </div>
                                                </TooltipTrigger>
                                                <TooltipContent>
                                                    <p>{usage.count > 0
                                                        ? `Used in ${usage.count} place(s): ${usage.modules.join(', ') || 'Unknown'}`
                                                        : 'Not used anywhere'}</p>
                                                </TooltipContent>
                                            </Tooltip>
                                        </TooltipProvider>
                                    )}
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
                                                <DialogContent className="max-w-md">
                                                    <DialogHeader>
                                                        <DialogTitle>File Details</DialogTitle>
                                                        <DialogDescription>Information about this file and where it's used.</DialogDescription>
                                                    </DialogHeader>
                                                    <div className="space-y-4 mt-4">
                                                        {/* Preview */}
                                                        <div className="aspect-video bg-slate-100 rounded-lg overflow-hidden flex items-center justify-center">
                                                            {file.file_type.startsWith('image/') ? (
                                                                <img src={getFileUrl(file)} alt={file.name} className="max-w-full max-h-full object-contain" />
                                                            ) : (
                                                                <File className="w-16 h-16 text-slate-300" />
                                                            )}
                                                        </div>
                                                        {/* Details */}
                                                        <div className="grid grid-cols-2 gap-3 text-sm">
                                                            <div>
                                                                <p className="text-slate-500">File Name</p>
                                                                <p className="font-medium truncate">{file.name}</p>
                                                            </div>
                                                            <div>
                                                                <p className="text-slate-500">Size</p>
                                                                <p className="font-medium">{formatFileSize(file.file_size)}</p>
                                                            </div>
                                                            <div>
                                                                <p className="text-slate-500">Type</p>
                                                                <p className="font-medium">{file.file_type}</p>
                                                            </div>
                                                            <div>
                                                                <p className="text-slate-500">Uploaded</p>
                                                                <p className="font-medium">{new Date(file.created_at).toLocaleDateString()}</p>
                                                            </div>
                                                            <div>
                                                                <p className="text-slate-500">Uploaded By</p>
                                                                <p className="font-medium">{file.users?.full_name || file.users?.email || 'Unknown'}</p>
                                                            </div>
                                                            <div>
                                                                <p className="text-slate-500">Usage Count</p>
                                                                <p className="font-medium">{usage.count || 0} location(s)</p>
                                                            </div>
                                                        </div>
                                                        {/* Usage Details */}
                                                        {usage.count > 0 && (
                                                            <div>
                                                                <p className="text-slate-500 text-sm mb-2">Used In:</p>
                                                                <div className="flex flex-wrap gap-2">
                                                                    {(usage.modules || []).map((mod, idx) => (
                                                                        <span key={idx} className="bg-blue-100 text-blue-700 px-2 py-1 rounded-full text-xs font-medium">
                                                                            {mod}
                                                                        </span>
                                                                    ))}
                                                                </div>
                                                            </div>
                                                        )}
                                                        {/* URL */}
                                                        <div>
                                                            <p className="text-slate-500 text-sm mb-1">Public URL</p>
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
                                                <Button size="icon" variant="ghost" className="text-green-600" onClick={() => handleRestore(file.id)} title="Restore">
                                                    <RefreshCw className="w-4 h-4" />
                                                </Button>
                                            )}
                                            {!isTrashView && canDelete && (
                                                <Button
                                                    type="button"
                                                    size="sm"
                                                    variant="ghost"
                                                    className="text-red-500 hover:text-red-700 hover:bg-red-50 gap-1"
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
                <div className="flex items-center justify-between px-4 py-3 border-t border-slate-200 bg-slate-50/50 mt-4 rounded-b-lg">
                    <div className="flex items-center gap-2 text-sm text-slate-600">
                        <span>Showing {Math.min(((currentPage - 1) * itemsPerPage) + 1, totalItems)} - {Math.min(currentPage * itemsPerPage, totalItems)} of {totalItems} files</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <select
                            value={itemsPerPage}
                            onChange={(e) => { setItemsPerPage(Number(e.target.value)); setCurrentPage(1); }}
                            className="h-9 rounded-md border border-slate-200 bg-white px-3 py-1 text-sm focus:ring-2 focus:ring-blue-500 outline-none dark:bg-slate-800 dark:text-slate-200 dark:border-slate-600"
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
                                className="h-9 w-9"
                            >
                                <ChevronLeft className="w-4 h-4" />
                            </Button>
                            <span className="px-3 py-1 text-sm font-medium text-slate-700">
                                {currentPage} / {totalPages || 1}
                            </span>
                            <Button
                                variant="outline"
                                size="icon"
                                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                                disabled={currentPage >= totalPages}
                                className="h-9 w-9"
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
