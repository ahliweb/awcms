/**
 * Custom hook for media library operations
 * Provides upload, sync, and stats functionality for the FilesManager
 */
import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/customSupabaseClient';
import { useToast } from '@/components/ui/use-toast';
import { useTenant } from '@/contexts/TenantContext'; 
import { usePermissions } from '@/contexts/PermissionContext';

export function useMedia() {
    const { toast } = useToast();
    const { currentTenant } = useTenant(); 
    const tenantId = currentTenant?.id;
    const { isPlatformAdmin } = usePermissions();

    const [uploading, setUploading] = useState(false);
    const [syncing, setSyncing] = useState(false);
    const [loading, setLoading] = useState(false);
    
    // Stats state
    const [stats, setStats] = useState({
        total_files: 0,
        total_size: 0,
        image_count: 0,
        doc_count: 0,
        video_count: 0,
        other_count: 0
    });
    const [statsLoading, setStatsLoading] = useState(true);

    // Fetch Files (Search/List)
    const fetchFiles = useCallback(async ({ 
        page = 1, 
        limit = 12, 
        query = '', 
        isTrash = false, 
        typeFilter = null 
    } = {}) => {
        if (!tenantId && !isPlatformAdmin) return { data: [], count: 0 };

        setLoading(true);
        try {
            let dbQuery = supabase
                .from('files')
                .select('*, users:uploaded_by(email, full_name), tenant:tenants(name)', { count: 'exact' })
                .order('created_at', { ascending: false });

            // Platform admins see all files, others are tenant-scoped
            if (!isPlatformAdmin && tenantId) {
                dbQuery = dbQuery.eq('tenant_id', tenantId);
            }

            // Trash View Logic
            if (isTrash) {
                dbQuery = dbQuery.not('deleted_at', 'is', null);
            } else {
                dbQuery = dbQuery.is('deleted_at', null);
            }

            // Search Logic
            if (query) {
                dbQuery = dbQuery.ilike('name', `%${query}%`);
            }

            // Type Filter
            if (typeFilter) {
                dbQuery = dbQuery.ilike('file_type', `${typeFilter}%`);
            }

            // Pagination
            const from = (page - 1) * limit;
            const to = from + limit - 1;
            dbQuery = dbQuery.range(from, to);

            const { data, count, error } = await dbQuery;
            if (error) throw error;

            return { data: data || [], count: count || 0 };
        } catch (err) {
            console.error('Error fetching files:', err);
            toast({ variant: 'destructive', title: 'Error', description: 'Failed to load files.' });
            return { data: [], count: 0 };
        } finally {
            setLoading(false);
        }
    }, [tenantId, isPlatformAdmin, toast]);

    // Soft Delete File
    const softDeleteFile = useCallback(async (id) => {
        try {
            const { error } = await supabase
                .from('files')
                .update({ deleted_at: new Date().toISOString() })
                .eq('id', id);

            if (error) throw error;
            
            toast({ title: 'File Moved to Trash', description: 'File moved to trash bin.' });
            return true;
        } catch (err) {
            console.error('Delete failed:', err);
            toast({ variant: 'destructive', title: 'Delete Failed', description: err.message });
            return false;
        }
    }, [toast]);

    // Bulk Soft Delete
    const bulkSoftDelete = useCallback(async (ids) => {
        if (!ids || ids.length === 0) return { success: 0, error: 0 };
        try {
            const { error, count } = await supabase
                .from('files')
                .update({ deleted_at: new Date().toISOString() })
                .in('id', ids)
                .select('id', { count: 'exact' });

            if (error) throw error;

            toast({ title: 'Files Moved to Trash', description: `${ids.length} files moved to trash bin.` });
            return { success: ids.length, error: 0 };
        } catch (err) {
            console.error('Bulk delete failed:', err);
            toast({ variant: 'destructive', title: 'Bulk Delete Failed', description: err.message });
            return { success: 0, error: ids.length };
        }
    }, [toast]);

    // Restore File
    const restoreFile = useCallback(async (id) => {
        try {
            const { error } = await supabase
                .from('files')
                .update({ deleted_at: null })
                .eq('id', id);

            if (error) throw error;

            toast({ title: 'File Restored', description: 'File restored to library.' });
            return true;
        } catch (err) {
            console.error('Restore failed:', err);
            toast({ variant: 'destructive', title: 'Restore Failed', description: err.message });
            return false;
        }
    }, [toast]);

    // Helper: Get Public URL
    const getFileUrl = useCallback((file) => {
        if (!file) return '';
        if (file.file_path?.startsWith('http')) return file.file_path;
        
        const bucketName = file.bucket_name || 'cms-uploads';
        const { data } = supabase.storage.from(bucketName).getPublicUrl(file.file_path);
        return data?.publicUrl || file.file_path;
    }, []);

    // Fetch file stats
    const fetchStats = useCallback(async () => {
        setStatsLoading(true);
        try {
            // Stats should implicitly filter by RLS, but we can rely on that.
            const { data, error } = await supabase
                .from('files')
                .select('file_size, file_type')
                .is('deleted_at', null);

            if (error) throw error;

            const statsData = {
                total_files: data.length,
                total_size: data.reduce((acc, f) => acc + (f.file_size || 0), 0),
                image_count: data.filter(f => f.file_type?.startsWith('image/')).length,
                doc_count: data.filter(f =>
                    f.file_type?.includes('pdf') ||
                    f.file_type?.includes('document') ||
                    f.file_type?.includes('text')
                ).length,
                video_count: data.filter(f => f.file_type?.startsWith('video/')).length,
                other_count: 0
            };
            statsData.other_count = statsData.total_files - statsData.image_count - statsData.doc_count - statsData.video_count;

            setStats(statsData);
        } catch (err) {
            console.error('Error fetching stats:', err);
        } finally {
            setStatsLoading(false);
        }
    }, []);

    // Initial fetch
    useEffect(() => {
        fetchStats();
    }, [fetchStats]);

    // Upload a single file
    const uploadFile = useCallback(async (file, folder = '') => {
        setUploading(true);
        try {
            const fileExt = file.name.split('.').pop();
            const fileName = `${Date.now()}-${Math.random().toString(36).substring(7)}.${fileExt}`;

            // Construct path with tenant isolation
            // If tenantId is present, prefix with it. Default to 'public' or root if none (legacy)
            const tenantPrefix = tenantId ? `${tenantId}/` : '';
            const filePath = `${tenantPrefix}${folder ? folder + '/' : ''}${fileName}`;

            // 1. Upload to Storage
            const { error: uploadError } = await supabase.storage
                .from('cms-uploads')
                .upload(filePath, file);

            if (uploadError) throw uploadError;

            // 2. Get Public URL
            const { data: { publicUrl } } = supabase.storage
                .from('cms-uploads')
                .getPublicUrl(filePath);

            // 3. Save to DB
            const { data: userData } = await supabase.auth.getUser();
            const { error: dbError } = await supabase.from('files').insert({
                name: file.name,
                file_path: publicUrl,
                file_size: file.size,
                file_type: file.type,
                bucket_name: 'cms-uploads',
                uploaded_by: userData.user?.id,
                tenant_id: tenantId // Explicitly add tenant_id
            });

            if (dbError) throw dbError;

            // Refresh stats after upload
            await fetchStats();

            return { success: true, url: publicUrl };
        } catch (err) {
            console.error('Upload error:', err);
            throw err;
        } finally {
            setUploading(false);
        }
    }, [fetchStats, tenantId]);

    // Sync files from storage bucket to database
    // Updated to support tenant folders
    const syncFiles = useCallback(async () => {
        setSyncing(true);
        try {
            // List files in storage bucket (scoped to tenant folder)
            const searchFolder = tenantId ? `${tenantId}` : '';
            const { data: storageFiles, error: listError } = await supabase.storage
                .from('cms-uploads')
                .list(searchFolder, { limit: 1000, offset: 0 });

            if (listError) throw listError;

            // Get existing files in DB
            const { data: dbFiles, error: dbError } = await supabase
                .from('files')
                .select('file_path')
                .is('deleted_at', null);

            if (dbError) throw dbError;

            // Normalize check derived from filename
            const existingFilenames = new Set(dbFiles.map(f => {
                // Public URL: .../cms-uploads/tenant-id/filename.ext
                // We want just 'filename.ext' for comparison if we are searching inside 'tenant-id/'
                return f.file_path.split('/').pop();
            }));

            const newFiles = storageFiles.filter(sf =>
                !sf.id?.includes('/') && // Skip folders (though list shouldn't return subfolders in non-recursive mode usually)
                sf.name &&
                sf.name !== '.emptyFolderPlaceholder' &&
                !existingFilenames.has(sf.name)
            );

            if (newFiles.length === 0) {
                toast({ title: 'Sync Complete', description: 'No new files found in storage.' });
                return true;
            }

            // Insert missing files to DB
            const { data: userData } = await supabase.auth.getUser();
            let syncedCount = 0;

            for (const sf of newFiles) {
                // Reconstruct full path for Public URL generation
                const fullPath = searchFolder ? `${searchFolder}/${sf.name}` : sf.name;

                const { data: { publicUrl } } = supabase.storage
                    .from('cms-uploads')
                    .getPublicUrl(fullPath);

                const { error: insertError } = await supabase.from('files').insert({
                    name: sf.name,
                    file_path: publicUrl,
                    file_size: sf.metadata?.size || 0,
                    file_type: sf.metadata?.mimetype || 'application/octet-stream',
                    bucket_name: 'cms-uploads',
                    uploaded_by: userData.user?.id,
                    tenant_id: tenantId
                });

                if (!insertError) syncedCount++;
            }

            toast({
                title: 'Sync Complete',
                description: `${syncedCount} new files synced from storage.`
            });

            // Refresh stats after sync
            await fetchStats();

            return true;
        } catch (err) {
            console.error('Sync error:', err);
            toast({
                variant: 'destructive',
                title: 'Sync Failed',
                description: err.message
            });
            return false;
        } finally {
            setSyncing(false);
        }
    }, [toast, fetchStats, tenantId]);

    return {
        uploadFile,
        uploading,
        syncFiles,
        syncing,
        stats,
        statsLoading,
        refreshStats: fetchStats,
        fetchFiles,
        softDeleteFile,
        bulkSoftDelete,
        restoreFile,
        getFileUrl,
        loading
    };
}

export default useMedia;
