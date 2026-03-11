/**
 * Custom hook for media library operations
 * Provides upload, sync, and stats functionality for the FilesManager
 */
import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/customSupabaseClient';
import { useToast } from '@/components/ui/use-toast';
import { useTenant } from '@/contexts/TenantContext';
import { usePermissions } from '@/contexts/PermissionContext';
import {
    buildMediaAccessApiUrl,
    buildMediaPublicUrl,
    createEdgeApiUnavailableError,
    fetchEdgeApi,
    getEdgeBaseUrl,
    getLocalEdgeStartupHint,
    getSecureMediaSessionMaxAgeSeconds,
    isLocalEdgeRuntime,
    normalizeMediaKind,
} from '@/lib/media';
import { getCategoryTypesForModule } from '@/lib/taxonomy';

const EDGE_URL = getEdgeBaseUrl();

export function useMedia() {
    const { toast } = useToast();
    const { currentTenant } = useTenant();
    const tenantId = currentTenant?.id;
    const { isPlatformAdmin, isFullAccess, hasPermission } = usePermissions();

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
    const [edgeApiAvailable, setEdgeApiAvailable] = useState(true);
    const [edgeApiMessage, setEdgeApiMessage] = useState('');

    // Helper: Map old 'files' format to 'media_objects' where needed for components
    const formatMediaObject = (mo) => {
        if (!mo) return null;

        const publicUrl = buildMediaPublicUrl(mo.storage_key);
        const sessionBoundAccess = Boolean(mo.session_bound_access);

        return {
            ...mo,
            // Map to old property names just in case some components rely on them
            id: mo.id,
            name: mo.title || mo.original_name || mo.file_name,
            file_name: mo.original_name || mo.file_name,
            file_path: mo.storage_key,
            file_size: mo.size_bytes,
            file_type: mo.mime_type,
            uploaded_by: mo.uploader_id,
            created_at: mo.created_at,
            deleted_at: mo.deleted_at,
            public_url: sessionBoundAccess ? '' : publicUrl,
            url: sessionBoundAccess ? '' : publicUrl,
            users: mo.uploader || null,
            uploader: mo.uploader || null,
            category: mo.category || null,
            media_kind: mo.media_kind || normalizeMediaKind(mo.mime_type),
            session_bound_access: sessionBoundAccess,
        };
    };

    // Fetch Files (Search/List)
    const fetchFiles = useCallback(async ({
        page = 1,
        limit = 12,
        query = '',
        isTrash = false,
        typeFilter = null,
        categoryId = null
    } = {}) => {
        if (!tenantId && !isPlatformAdmin) return { data: [], count: 0 };

        setLoading(true);
        try {
            let dbQuery = supabase
                .from('media_objects')
                .select(`
                    *,
                    tenant:tenants(name),
                    uploader:users!media_objects_uploader_id_fkey(id, email, full_name, avatar_url),
                    category:categories(id, name, slug, type)
                `, { count: 'exact' })
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
                dbQuery = dbQuery.ilike('original_name', `%${query}%`);
            }

            // Type Filter
            if (typeFilter) {
                dbQuery = typeFilter.includes('/')
                    ? dbQuery.eq('mime_type', typeFilter)
                    : dbQuery.eq('media_kind', typeFilter);
            }

            if (categoryId) {
                dbQuery = dbQuery.eq('category_id', categoryId);
            }

            // Pagination
            const from = (page - 1) * limit;
            const to = from + limit - 1;
            dbQuery = dbQuery.range(from, to);

            const { data, count, error } = await dbQuery;
            if (error) throw error;

            return { data: (data || []).map(formatMediaObject), count: count || 0 };
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
                .rpc('soft_delete_media_object', { p_media_id: id });

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
            const { data, error } = await supabase
                .rpc('bulk_soft_delete_media_objects', { p_media_ids: ids });

            if (error) throw error;

            const successCount = Number(data || 0);
            toast({ title: 'Files Moved to Trash', description: `${successCount} files moved to trash bin.` });
            return { success: successCount, error: Math.max(0, ids.length - successCount) };
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
                .rpc('restore_media_object', { p_media_id: id });

            if (error) throw error;

            toast({ title: 'File Restored', description: 'File restored to library.' });
            return true;
        } catch (err) {
            console.error('Restore failed:', err);
            toast({ variant: 'destructive', title: 'Restore Failed', description: err.message });
            return false;
        }
    }, [toast]);

    // Fetch Categories
    const fetchCategories = useCallback(async () => {
        if (!tenantId && !isPlatformAdmin) return [];

        try {
            let query = supabase
                .from('categories')
                .select('*')
                .in('type', getCategoryTypesForModule('media'))
                .order('name');

            if (!isPlatformAdmin && tenantId) {
                query = query.eq('tenant_id', tenantId);
            }

            const { data, error } = await query;
            if (error) throw error;
            return data || [];
        } catch (err) {
            console.error('Error fetching categories:', err);
            return [];
        }
    }, [tenantId, isPlatformAdmin]);

    // Create Category
    const createCategory = useCallback(async (name) => {
        if (!name) return null;
        try {
            const { data: userData } = await supabase.auth.getUser();
            const { data, error } = await supabase
                .from('categories')
                .insert({
                    name,
                    slug: name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, ''),
                    type: 'media',
                    tenant_id: tenantId,
                    created_by: userData.user?.id
                })
                .select()
                .single();

            if (error) throw error;

            toast({ title: 'Category Created', description: `Category "${name}" created.` });
            return data;
        } catch (err) {
            console.error('Error creating category:', err);
            toast({ variant: 'destructive', title: 'Error', description: err.message });
            return null;
        }
    }, [tenantId, toast]);

    // Helper: Get Public URL
    const getFileUrl = useCallback((file) => {
        if (!file) return '';
        if (file.session_bound_access) return '';
        return buildMediaPublicUrl(file.file_path || file.storage_key || (typeof file === 'string' ? file : ''));
    }, []);

    const getProtectedFileAccessUrl = useCallback(async (fileOrId) => {
        const mediaId = typeof fileOrId === 'string' ? fileOrId : fileOrId?.id;
        if (!mediaId) {
            throw new Error('Missing file identifier');
        }

        const { data: { session } } = await supabase.auth.getSession();
        if (!session?.access_token) {
            throw new Error('Session expired');
        }

        const response = await fetch(`${buildMediaAccessApiUrl(mediaId)}?maxAgeSeconds=${getSecureMediaSessionMaxAgeSeconds()}`, {
            method: 'GET',
            headers: {
                Authorization: `Bearer ${session.access_token}`,
                ...(tenantId ? { 'x-tenant-id': tenantId } : {}),
            },
        });

        const result = await response.json();
        if (!response.ok) {
            throw new Error(result.error || 'Unable to resolve secure file access');
        }

        return result;
    }, [tenantId]);

    // Fetch file stats
    const fetchStats = useCallback(async () => {
        setStatsLoading(true);
        try {
            let query = supabase
                .from('media_objects')
                .select('size_bytes, mime_type, media_kind')
                .is('deleted_at', null);

            if (!isPlatformAdmin && !isFullAccess && tenantId) {
                query = query.eq('tenant_id', tenantId);
            }

            const { data, error } = await query;

            if (error) throw error;

            const statsData = {
                total_files: data.length,
                total_size: data.reduce((acc, f) => acc + (f.size_bytes || 0), 0),
                image_count: data.filter(f => (f.media_kind || normalizeMediaKind(f.mime_type)) === 'image').length,
                doc_count: data.filter(f => (f.media_kind || normalizeMediaKind(f.mime_type)) === 'document').length,
                video_count: data.filter(f => (f.media_kind || normalizeMediaKind(f.mime_type)) === 'video').length,
                other_count: 0
            };
            statsData.other_count = statsData.total_files - statsData.image_count - statsData.doc_count - statsData.video_count;

            setStats(statsData);
        } catch (err) {
            console.error('Error fetching stats:', err);
        } finally {
            setStatsLoading(false);
        }
    }, [isFullAccess, isPlatformAdmin, tenantId]);

    // Initial fetch
    useEffect(() => {
        fetchStats();
    }, [fetchStats]);

    const checkEdgeApiHealth = useCallback(async () => {
        try {
            const response = await fetchEdgeApi('/health', { method: 'GET' });
            if (!response.ok) {
                throw createEdgeApiUnavailableError('Media edge health check');
            }
            setEdgeApiAvailable(true);
            setEdgeApiMessage('');
            return true;
        } catch (error) {
            const message = isLocalEdgeRuntime()
                ? getLocalEdgeStartupHint()
                : (error.message || 'Cloudflare Edge API is unavailable.');
            setEdgeApiAvailable(false);
            setEdgeApiMessage(message);
            return false;
        }
    }, []);

    useEffect(() => {
        checkEdgeApiHealth();
    }, [checkEdgeApiHealth]);

    // Upload a single file via Edge API
    const uploadFile = useCallback(async (file, folder = '', categoryId = null, uploadOptions = {}) => {
        setUploading(true);
        try {
            const { data: { session } } = await supabase.auth.getSession();
            if (!session) throw new Error("Not authenticated");
            if (!tenantId && !isPlatformAdmin && !isFullAccess) {
                throw new Error('Missing tenant context');
            }
            if (!(hasPermission('tenant.files.create') || hasPermission('tenant.files.manage') || isPlatformAdmin || isFullAccess)) {
                throw new Error('Permission denied: Cannot upload files.');
            }

            const sessionBoundAccess = Boolean(uploadOptions.sessionBoundAccess);

            // 1. Request Upload Session
            const sessionRes = await fetchEdgeApi('/api/media/upload-session', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${session.access_token}`,
                    ...(tenantId ? { 'x-tenant-id': tenantId } : {})
                },
                body: JSON.stringify({
                    fileName: file.name,
                    mimeType: file.type,
                    sizeBytes: file.size,
                    accessControl: sessionBoundAccess ? 'private' : 'public',
                    sessionBoundAccess,
                    folder: folder,
                    categoryId: categoryId || null
                })
            });

            if (!sessionRes.ok) throw new Error("Failed to initialize upload session");
            const sessionData = await sessionRes.json();
            const { sessionId, uploadUrl, finalizeUrl } = sessionData;

            // 2. Upload file directly to signed R2 URL
            const uploadRes = await fetch(uploadUrl, {
                method: 'PUT',
                headers: {
                    'Content-Type': file.type || 'application/octet-stream'
                },
                body: file
            });

            if (!uploadRes.ok) throw new Error("File upload failed");

            // 3. Finalize upload and create canonical media_objects record
            const finalizeRes = await fetch(finalizeUrl || `${EDGE_URL}/api/media/upload/${sessionId}/finalize`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${session.access_token}`,
                    ...(tenantId ? { 'x-tenant-id': tenantId } : {})
                },
                body: JSON.stringify({ sessionId })
            });

            if (!finalizeRes.ok) throw new Error('Failed to finalize upload');
            const uploadResult = await finalizeRes.json();

            // Refresh stats after upload
            await fetchStats();
            setEdgeApiAvailable(true);
            setEdgeApiMessage('');

            return { 
                success: true, 
                url: uploadResult.mediaObject?.session_bound_access ? '' : buildMediaPublicUrl(uploadResult.mediaObject.storage_key),
                mediaObject: formatMediaObject(uploadResult.mediaObject),
            };
        } catch (err) {
            console.error('Upload error:', err);
            if (err?.name === 'EdgeApiUnavailableError') {
                setEdgeApiAvailable(false);
                setEdgeApiMessage(err.message);
            }
            throw err;
        } finally {
            setUploading(false);
        }
    }, [fetchStats, hasPermission, isFullAccess, isPlatformAdmin, tenantId]);

    const updateFileMetadata = useCallback(async (fileId, updates) => {
        const payload = {
            title: updates.title ?? null,
            alt_text: updates.alt_text ?? null,
            description: updates.description ?? null,
            session_bound_access: Boolean(updates.session_bound_access),
            access_control: updates.session_bound_access ? 'private' : 'public',
            updated_at: new Date().toISOString(),
        };

        const { data, error } = await supabase
            .from('media_objects')
            .update(payload)
            .eq('id', fileId)
            .select(`
                *,
                tenant:tenants(name),
                uploader:users!media_objects_uploader_id_fkey(id, email, full_name, avatar_url),
                category:categories(id, name, slug, type)
            `)
            .single();

        if (error) throw error;
        return formatMediaObject(data);
    }, []);

    // Sync files from storage bucket to database
    const syncFiles = useCallback(async () => {
        setSyncing(true);
        try {
            // Disabled temporarily during cutover to Cloudflare architecture.
            // Edge Worker doesn't expose a sync API yet.
            toast({
                title: 'Sync Disabled',
                description: 'Syncing from external source is temporarily disabled on the new media system.'
            });
            return true;
        } catch (err) {
            console.error('Sync error:', err);
            return false;
        } finally {
            setSyncing(false);
        }
    }, [toast]);

    return {
        uploadFile,
        uploading,
        edgeApiAvailable,
        edgeApiMessage,
        refreshEdgeApiHealth: checkEdgeApiHealth,
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
        getProtectedFileAccessUrl,
        updateFileMetadata,
        loading,
        fetchCategories,
        createCategory
    };
}

export default useMedia;
