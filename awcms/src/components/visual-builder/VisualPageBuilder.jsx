import { useState, useCallback, useEffect, useRef } from 'react';
import { useSearchParams, useNavigate, useParams } from 'react-router-dom';
import { Puck, Render } from '@puckeditor/core';
import '@puckeditor/core/puck.css';
import './puck-theme.css';
import { Save, Eye, EyeOff, ArrowLeft, Upload, Monitor, Tablet, Smartphone, Undo2, Redo2, Loader2, WifiOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';
import { udm } from '@/lib/data/UnifiedDataManager';
import { supabase } from '@/lib/customSupabaseClient';
import { puckConfig as editorConfig } from './config';
import TemplateSelector from './TemplateSelector';
import { useHistory } from './hooks/useHistory';
import SlugGenerator from '@/components/dashboard/slug/SlugGenerator';
import ResourceSelect from '@/components/dashboard/ResourceSelect';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from "@/components/ui/dialog";
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { Settings } from 'lucide-react';

import { usePermissions } from '@/contexts/PermissionContext';
import { useTenant } from '@/contexts/TenantContext'; // Added TenantContext
import { encodeRouteParam } from '@/lib/routeSecurity';
import useSecureRouteParam from '@/hooks/useSecureRouteParam';
import { VisualContentProvider } from './VisualContentContext';
import { createVisualContentResource } from './visualContentUtils';

const VisualPageBuilder = ({ page: initialPage, mode: initialMode, onClose, onSuccess: _onSuccess }) => {
    const defaultContentLocale = 'id';
    // Permission Hook
    const { hasPermission, checkAccess, isPlatformAdmin } = usePermissions();
    const { currentTenant } = useTenant(); // Get current tenant
    const { toast } = useToast();
    const [searchParams] = useSearchParams();
    const navigate = useNavigate();
    const { mode: modeParam, id: idParam } = useParams();
    const normalizedMode = modeParam ? modeParam.toLowerCase() : null;
    const allowedModes = ['template', 'part', 'page'];
    const isAllowedMode = normalizedMode ? allowedModes.includes(normalizedMode) : false;
    const routeScope = isAllowedMode ? `visual-editor.${normalizedMode}` : 'visual-editor';
    const {
        value: secureRouteId,
        loading: routeLoading,
        isLegacy: isLegacyRouteId,
    } = useSecureRouteParam(idParam, routeScope);
    const legacyTemplateId = !normalizedMode ? searchParams.get('templateId') : null;
    const legacyPartId = !normalizedMode ? searchParams.get('partId') : null;
    const legacyPageId = !normalizedMode ? searchParams.get('pageId') : null;

    // Determine mode and IDs
    const resolvedRouteId = routeLoading ? null : secureRouteId;
    const templateId = normalizedMode === 'template' && isAllowedMode ? resolvedRouteId : legacyTemplateId;
    const partId = normalizedMode === 'part' && isAllowedMode ? resolvedRouteId : legacyPartId;
    const pageId = normalizedMode === 'page' && isAllowedMode ? resolvedRouteId : legacyPageId;
    const mode = initialMode || normalizedMode || (partId ? 'part' : (templateId ? 'template' : 'page'));

    useEffect(() => {
        if (!normalizedMode || !idParam || routeLoading) return;
        if (!isAllowedMode) {
            navigate('/cmspanel/visual-editor');
            return;
        }
        if (!secureRouteId) {
            navigate('/cmspanel/visual-editor');
            return;
        }
        if (!isLegacyRouteId) return;
        const redirectLegacy = async () => {
            const signedId = await encodeRouteParam({ value: secureRouteId, scope: routeScope });
            if (!signedId || signedId === idParam) return;
            navigate(`/cmspanel/visual-editor/${normalizedMode}/${signedId}`, { replace: true });
        };
        redirectLegacy();
    }, [normalizedMode, idParam, routeLoading, secureRouteId, isLegacyRouteId, routeScope, navigate, isAllowedMode]);

    useEffect(() => {
        if (normalizedMode) return;
        const redirectLegacy = async () => {
            if (legacyTemplateId) {
                const signedId = await encodeRouteParam({ value: legacyTemplateId, scope: 'visual-editor.template' });
                if (!signedId || signedId === legacyTemplateId) return;
                navigate(`/cmspanel/visual-editor/template/${signedId}`, { replace: true });
            } else if (legacyPartId) {
                const signedId = await encodeRouteParam({ value: legacyPartId, scope: 'visual-editor.part' });
                if (!signedId || signedId === legacyPartId) return;
                navigate(`/cmspanel/visual-editor/part/${signedId}`, { replace: true });
            } else if (legacyPageId) {
                const signedId = await encodeRouteParam({ value: legacyPageId, scope: 'visual-editor.page' });
                if (!signedId || signedId === legacyPageId) return;
                navigate(`/cmspanel/visual-editor/page/${signedId}`, { replace: true });
            }
        };
        redirectLegacy();
    }, [normalizedMode, legacyTemplateId, legacyPartId, legacyPageId, navigate]);

    // State
    const [page, setPage] = useState(initialPage || null);
    const [translationSlugCheckKey, setTranslationSlugCheckKey] = useState(0);

    // Initial data setup
    const initialData = initialPage?.content_draft || { content: [], root: { props: { title: '' } } };

    // Use History Hook for Data Management
    const {
        state: data,
        setState: setData,
        undo,
        redo,
        canUndo,
        canRedo,
        resetHistory
    } = useHistory(initialData);

    // Use ref to keep latest data reference for closures (save handlers)
    const dataRef = useRef(data);
    useEffect(() => {
        dataRef.current = data;
    }, [data]);


    // Page Metadata State
    const [pageMetadata, setPageMetadata] = useState({
        title: initialPage?.title || '',
        slug: initialPage?.slug || '',
        meta_description: initialPage?.meta_description || '',
        category_id: initialPage?.category_id || null, // Added category_id
        locale: defaultContentLocale,
        status: initialPage?.status || 'draft',
        published_at: initialPage?.published_at ? new Date(initialPage.published_at).toISOString().slice(0, 16) : ''
    });


    const isEditorEnabled = (mode === 'template' || mode === 'part') ? hasPermission('tenant.theme.update') : checkAccess('update', 'pages', page);
    const canEdit = isEditorEnabled; // Alias for readability
    const canPublish = (mode === 'template' || mode === 'part') ? false : checkAccess('publish', 'pages', page);
    const requiresBaseLocaleFirst = mode === 'page' && !page?.id;
    const [isSaving, setIsSaving] = useState(false);
    const [isPublishing, setIsPublishing] = useState(false);
    const [previewMode, setPreviewMode] = useState(false);
    const [viewport] = useState('desktop');
    const [editorKey, setEditorKey] = useState(0);
    const [templateSelectorOpen, setTemplateSelectorOpen] = useState(false);
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
    const [lastSavedAt, setLastSavedAt] = useState(null);
    const [isOffline, setIsOffline] = useState(!navigator.onLine);

    // History aliases for UI to minimize code changes
    const historyCanUndo = canUndo;
    const historyCanRedo = canRedo;

    // Monitor Online Status
    useEffect(() => {
        const handleStatusChange = () => setIsOffline(!navigator.onLine);
        window.addEventListener('online', handleStatusChange);
        window.addEventListener('offline', handleStatusChange);
        return () => {
            window.removeEventListener('online', handleStatusChange);
            window.removeEventListener('offline', handleStatusChange);
        };
    }, []);

    // Fetch data if needed
    useEffect(() => {
        const loadData = async () => {
            if (initialPage) return; // Already have data from props

            if (initialPage && (initialPage.id || initialPage.editor_type === 'visual')) return;
            try {
                let fetchedData = null;
                // CHANGED: Added tenant isolation to queries
                // If not platform admin, enforce tenant_id

                const applyTenantFilter = (q) => {
                    if (!isPlatformAdmin && currentTenant?.id) {
                        return q.eq('tenant_id', currentTenant.id);
                    }
                    return q;
                };

                if (mode === 'template' && templateId) {
                    let q = udm.from('templates').select('*').eq('id', templateId);
                    q = applyTenantFilter(q);
                    const { data: tpl, error } = await q.single();
                    if (error) throw error;

                    fetchedData = {
                        id: tpl.id,
                        ...tpl,
                        content_draft: tpl.data || { content: [], root: { props: { title: tpl.name } } }
                    };
                    setPageMetadata({
                        title: tpl.name,
                        slug: tpl.slug,
                        meta_description: tpl.description,
                        category_id: tpl.category_id || null,
                        status: tpl.is_active ? 'published' : 'draft',
                        locale: 'en', // Templates usually specific locale or neutral?
                        published_at: ''
                    });

                } else if (mode === 'part' && partId) {
                    let q = udm.from('template_parts').select('*').eq('id', partId);
                    q = applyTenantFilter(q);
                    const { data: part, error } = await q.single();
                    if (error) throw error;

                    fetchedData = {
                        id: part.id,
                        ...part,
                        content_draft: part.content || { content: [], root: { props: { title: part.name } } }
                    };
                    setPageMetadata({
                        title: part.name,
                        slug: part.type,
                        meta_description: part.type,
                        category_id: part.category_id || null,
                        status: part.is_active ? 'published' : 'draft',
                        locale: 'en',
                        published_at: ''
                    });

                } else if (mode === 'page' && pageId) {
                    let q = udm.from('pages').select('*').eq('id', pageId);
                    q = applyTenantFilter(q);
                    const { data: pg, error } = await q.single();
                    if (error) throw error;
                    fetchedData = pg;
                    setPageMetadata({
                        title: pg.title,
                        slug: pg.slug,
                        meta_description: pg.meta_description,
                        category_id: pg.category_id || null,
                        status: pg.status,
                        locale: defaultContentLocale,
                        published_at: pg.published_at ? new Date(pg.published_at).toISOString().slice(0, 16) : ''
                    });
                }

                if (fetchedData) {
                    setPage(fetchedData);
                    const initialContent = fetchedData.content_draft ||
                        (typeof fetchedData.content === 'object' ? fetchedData.content : null) ||
                        fetchedData.data ||
                        { content: [], root: { props: { title: fetchedData.title || fetchedData.name } } };

                    resetHistory(initialContent);
                }
            } catch (error) {
                console.error("Error loading visual builder data:", error);
                toast({ title: "Error", description: error.message || "Failed to load content, or access denied.", variant: "destructive" });

                if (error.code === 'PGRST116' || error.message?.includes('not found')) {
                    setTimeout(() => handleClose(), 2000);
                }
            } finally {
                // Done
            }
        };

        // Only run if we have currentTenant (or are global/platform admin)
        if (currentTenant?.id || isPlatformAdmin) {
            loadData();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [templateId, pageId, initialPage, mode, currentTenant?.id, isPlatformAdmin]);

    useEffect(() => {
        let cancelled = false;

        const loadTranslationOverlay = async () => {
            if (mode !== 'page' || !page?.id || !currentTenant?.id) return;

            const translationContentType = 'page';
            const fallbackLocale = defaultContentLocale;
            const baseContent = page?.content_draft || page?.content_published || (typeof page?.content === 'object' ? page.content : null) || { content: [], root: { props: { title: page?.title || '' } } };

            if (pageMetadata.locale === fallbackLocale) {
                if (!cancelled) {
                    setPageMetadata(prev => ({
                        ...prev,
                        title: page.title || '',
                        slug: page.slug || '',
                        meta_description: page.meta_description || '',
                    }));
                    resetHistory(baseContent);
                    setEditorKey(prev => prev + 1);
                }
                return;
            }

            const { data: translation, error } = await supabase
                .from('content_translations')
                .select('*')
                .eq('tenant_id', currentTenant.id)
                .eq('content_type', translationContentType)
                .eq('content_id', page.id)
                .eq('locale', pageMetadata.locale)
                .maybeSingle();

            if (error) {
                    console.error('Error loading page translation:', error);
                return;
            }

            if (cancelled) return;

            let translatedVisualContent = baseContent;
            if (translation?.content) {
                try {
                    translatedVisualContent = JSON.parse(translation.content);
                } catch (parseError) {
                    console.warn('Failed to parse translated page visual content, using default locale content:', parseError);
                }
            }

            setPageMetadata(prev => ({
                ...prev,
                title: translation?.title || page.title || '',
                slug: translation?.slug || page.slug || '',
                meta_description: translation?.meta_description || page.meta_description || '',
            }));
            resetHistory(translatedVisualContent);
            setEditorKey(prev => prev + 1);
        };

        loadTranslationOverlay();

        return () => {
            cancelled = true;
        };
    }, [mode, page?.id, currentTenant?.id, pageMetadata.locale, page, resetHistory]);


    const handleClose = () => {
        if (onClose) onClose();
        else navigate(-1); // Go back if no prop handler
    };


    // Apply template
    const handleApplyTemplate = (templateData) => {
        resetHistory(templateData);
        setHasUnsavedChanges(true); // Template application counts as a change
        setEditorKey(prev => prev + 1); // Force remount to show new template
        toast({
            title: 'Template applied',
            description: 'The template has been applied.'
        });
    };

    // Sanitize data (remove orphaned zones)
    const cleanPuckData = useCallback((currentData) => {
        if (!currentData || !currentData.zones) return currentData;
        const validIds = new Set();
        const collectIds = (items) => {
            if (!items) return;
            items.forEach(item => {
                if (item.props && item.props.id) {
                    validIds.add(item.props.id);
                }
            });
        };
        collectIds(currentData.content);
        const reachableIds = new Set();
        const traverse = (items) => {
            if (!items) return;
            items.forEach(item => {
                if (item.props && item.props.id) {
                    reachableIds.add(item.props.id);
                    Object.keys(currentData.zones).forEach(zoneKey => {
                        if (zoneKey.startsWith(`${item.props.id}:`)) {
                            traverse(currentData.zones[zoneKey]);
                        }
                    });
                }
            });
        };
        traverse(currentData.content);
        const newZones = {};
        let hasChanges = false;
        Object.keys(currentData.zones).forEach(zoneKey => {
            const [componentId] = zoneKey.split(':');
            if (reachableIds.has(componentId)) {
                newZones[zoneKey] = currentData.zones[zoneKey];
            } else {
                hasChanges = true;
            }
        });
        if (!hasChanges) return currentData;
        return { ...currentData, zones: newZones };
    }, []);

    // Handle Puck data change
    const handleChange = useCallback((newData) => {
        const cleanedData = cleanPuckData(newData);
        if (cleanedData) {
            setData(cleanedData);
            setHasUnsavedChanges(true);
        } else {
            console.error('handleChange received invalid data!', newData);
        }
    }, [setData, cleanPuckData]);

    // Save Content Function
    const saveContent = useCallback(async (contentData, isAutoSave = false) => {
        if (mode === 'template' && !templateId) {
            if (!isAutoSave) toast({ variant: 'destructive', title: 'Error', description: 'Template ID is missing. Cannot save.' });
            return;
        } else if (mode !== 'template' && (!page || !page.id)) {
            if (!isAutoSave) toast({ variant: 'destructive', title: 'Error', description: 'Page data is missing. Cannot save.' });
            return;
        }

        setIsSaving(true);
        try {
            let error = null;

            const timestamp = new Date().toISOString();

            // applyTenantFilter logic for update is handled by .eq('id', ...) RLS, 
            // but for offline safety we could check tenant match if we had full object. 
            // Assuming loaded 'page' object has tenant_id correct from loadData.

            if (mode === 'template') {
                console.log('Saving template:', templateId);
                const { error: err } = await udm
                    .from('templates')
                    .update({
                        data: contentData,
                        updated_at: timestamp,
                        name: pageMetadata.title,
                        slug: pageMetadata.slug,
                        description: pageMetadata.meta_description,
                        category_id: pageMetadata.category_id,
                        is_active: pageMetadata.status === 'published'
                    })
                    .eq('id', templateId);
                error = err;
            } else if (mode === 'part') {
                console.log('Saving part:', partId);
                const { error: err } = await udm
                    .from('template_parts')
                    .update({
                        content: contentData,
                        updated_at: timestamp,
                        name: pageMetadata.title,
                        type: pageMetadata.slug,
                        category_id: pageMetadata.category_id,
                        is_active: pageMetadata.status === 'published'
                    })
                    .eq('id', partId);
                error = err;
            } else {
                console.log('Saving page:', page.id);
                if (pageMetadata.locale === defaultContentLocale) {
                    const { error: err } = await udm
                        .from('pages')
                        .update({
                            content_draft: contentData,
                            updated_at: timestamp,
                            title: pageMetadata.title,
                            slug: pageMetadata.slug,
                            meta_description: pageMetadata.meta_description,
                            category_id: pageMetadata.category_id,
                            status: pageMetadata.status,
                            published_at: pageMetadata.published_at || null
                        })
                        .eq('id', page.id);
                    error = err;
                } else {
                    if (pageMetadata.slug) {
                        const { data: existingTranslationSlug, error: translationSlugError } = await supabase
                            .from('content_translations')
                            .select('id')
                            .eq('tenant_id', currentTenant?.id)
                            .eq('content_type', 'page')
                            .eq('locale', pageMetadata.locale)
                            .eq('slug', pageMetadata.slug)
                            .neq('content_id', page.id)
                            .limit(1);

                        if (translationSlugError) {
                            throw translationSlugError;
                        }

                        if (existingTranslationSlug && existingTranslationSlug.length > 0) {
                            const uniqueSuffix = Date.now().toString(36);
                            throw new Error(`Slug "${pageMetadata.slug}" is already in use for ${pageMetadata.locale.toUpperCase()}. Try "${pageMetadata.slug}-${uniqueSuffix}" instead.`);
                        }
                    }

                    const translationPayload = {
                        tenant_id: currentTenant?.id,
                        content_type: 'page',
                        content_id: page.id,
                        locale: pageMetadata.locale,
                        title: pageMetadata.title || null,
                        slug: pageMetadata.slug || null,
                        meta_description: pageMetadata.meta_description || null,
                        content: JSON.stringify(contentData),
                    };

                    const hasTranslationContent = [
                        translationPayload.title,
                        translationPayload.slug,
                        translationPayload.meta_description,
                        translationPayload.content,
                    ].some((value) => typeof value === 'string' && value.trim().length > 0);

                    if (hasTranslationContent) {
                        const { error: err } = await supabase
                            .from('content_translations')
                            .upsert(translationPayload, {
                                onConflict: 'content_type,content_id,locale,tenant_id'
                            });
                        error = err;
                    } else {
                        const { error: err } = await supabase
                            .from('content_translations')
                            .delete()
                            .eq('tenant_id', currentTenant?.id)
                            .eq('content_type', 'page')
                            .eq('content_id', page.id)
                            .eq('locale', pageMetadata.locale);
                        error = err;
                    }
                }
            }

            if (error) throw error;

            console.log('✅ Save successful');
            setLastSavedAt(new Date());
            setHasUnsavedChanges(false);

            if (!isAutoSave) {
                const entityName = mode === 'template' ? 'Template' : (mode === 'part' ? 'Part' : 'Page');
                toast({
                    title: isOffline ? 'Saved Offline' : 'Saved',
                    description: isOffline ? `${entityName} saved to local device. Will sync when online.` : `${entityName} saved successfully.`
                });
            }
        } catch (err) {
            console.error('Save error:', err);
            toast({ variant: 'destructive', title: 'Error', description: err.message || 'Failed to save changes.' });
        } finally {
            setIsSaving(false);
        }
    }, [mode, templateId, partId, page, toast, pageMetadata, isOffline, currentTenant?.id]);

    // undo/redo wrappers
    const handleUndo = useCallback(() => {
        if (canUndo && historyCanUndo) {
            undo();
            setEditorKey(prev => prev + 1);
        }
    }, [canUndo, historyCanUndo, undo]);

    const handleRedo = useCallback(() => {
        if (canRedo && historyCanRedo) {
            redo();
            setEditorKey(prev => prev + 1);
        }
    }, [canRedo, historyCanRedo, redo]);

    // Keyboard shortcuts for undo/redo
    useEffect(() => {
        const handleKeyDown = (e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
                e.preventDefault();
                handleUndo();
            }
            if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
                e.preventDefault();
                handleRedo();
            }
            if ((e.ctrlKey || e.metaKey) && e.key === 's') {
                e.preventDefault();
                if (dataRef.current) {
                    saveContent(dataRef.current, false);
                }
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [canUndo, canRedo, undo, redo, data, handleUndo, handleRedo, saveContent]);

    // Handle manual save
    const handleManualSave = async () => {
        if (!canEdit) {
            toast({ variant: 'destructive', title: 'Action Denied', description: 'You do not have permission to save changes.' });
            return;
        }
        const currentData = dataRef.current;
        if (!currentData) {
            toast({ variant: 'destructive', title: 'Error', description: 'No content data available to save.' });
            return;
        }

        await saveContent(currentData, false);
    };

    // Auto-save effect
    useEffect(() => {
        if (hasUnsavedChanges && !isSaving && canEdit) {
            const timer = setTimeout(() => {
                if (dataRef.current) {
                    saveContent(dataRef.current, true);
                }
            }, 30000); // Auto-save every 30s
            return () => clearTimeout(timer);
        }
    }, [hasUnsavedChanges, isSaving, data, canEdit, saveContent]);

    // Publish page
    const handlePublish = async () => {
        if (!canPublish) {
            toast({ variant: 'destructive', title: 'Action Denied', description: 'You do not have permission to publish pages.' });
            return;
        }
        if (!page || !page.id) {
            toast({ variant: 'destructive', title: 'Error', description: 'Page data is missing. Please save before publishing.' });
            return;
        }
        setIsPublishing(true);
        try {
            await saveContent(data, false);

            const publishedAt = new Date().toISOString();
            let error = null;

            if (mode === 'page' && pageMetadata.locale !== defaultContentLocale) {
                const translationPayload = {
                    tenant_id: currentTenant?.id,
                    content_type: 'page',
                    content_id: page.id,
                    locale: pageMetadata.locale,
                    title: pageMetadata.title || null,
                    slug: pageMetadata.slug || null,
                    meta_description: pageMetadata.meta_description || null,
                    content: JSON.stringify(data),
                    updated_at: publishedAt,
                };

                const { error: translationError } = await supabase
                    .from('content_translations')
                    .upsert(translationPayload, {
                        onConflict: 'content_type,content_id,locale,tenant_id'
                    });

                error = translationError;
            } else {
                const publishPayload = {
                    status: 'published',
                    content_published: data,
                    published_at: publishedAt
                };

                const { error: publishError } = await udm
                    .from('pages')
                    .update(publishPayload)
                    .eq('id', page.id);

                error = publishError;
            }

            if (error) throw error;

            setPageMetadata(prev => ({ ...prev, status: 'published' }));

                toast({
                    title: isOffline ? "Published Offline" : "Published Successfully",
                    description: isOffline ? 'Changes saved locally. Status will update when online.' : 'Your page is now live.',
                });
        } catch (error) {
            console.error('Error publishing page:', error);
            toast({
                title: "Publish Failed",
                description: error.message,
                variant: "destructive",
            });
        } finally {
            setIsPublishing(false);
        }
    };

    // Prepare config for Puck
    const puckConfig = useState(() => ({
        components: editorConfig.components,
        categories: editorConfig.categories,
        root: {
            render: ({ children }) => {
                return (
                    <div className="min-h-screen bg-white">
                        {children}
                    </div>
                );
            }
        }
    }))[0];

    // Viewport classes
    const viewportClasses = {
        desktop: 'w-full',
        tablet: 'max-w-[768px] mx-auto',
        mobile: 'max-w-[375px] mx-auto'
    };

    // Format time for Last Saved display
    const formatTime = (date) => {
        return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    };

    // Stable handler for metadata updates
    const handleMetadataChange = useCallback((key, value) => {
        setPageMetadata(prev => {
            if (prev[key] === value) return prev;
            // Deep check for objects if necessary, but here we deal with primitives
            return { ...prev, [key]: value };
        });
    }, []);

    const handleSlugChange = useCallback((newSlug) => {
        handleMetadataChange('slug', newSlug);
    }, [handleMetadataChange]);

    const handleLocaleChange = useCallback((nextLocale) => {
        if (requiresBaseLocaleFirst && nextLocale !== defaultContentLocale) {
            toast({
                title: 'Save base content first',
                description: 'Create the base page in Indonesia before editing English translations.',
            });
            setPageMetadata(prev => ({ ...prev, locale: defaultContentLocale }));
            return;
        }

        setTranslationSlugCheckKey(prev => prev + 1);
        setPageMetadata(prev => ({ ...prev, locale: nextLocale }));
    }, [defaultContentLocale, requiresBaseLocaleFirst, toast]);

    const pagePreviewResource = createVisualContentResource(page, {
            title: pageMetadata.title,
            excerpt: pageMetadata.meta_description,
            categoryName: page?.category?.name || page?.categories?.name || '',
            featuredImage: page?.featured_image || '',
            publishedAt: pageMetadata.published_at || page?.published_at || page?.created_at || null,
            tags: page?.tags || [],
            authorName: page?.owner?.full_name || page?.users?.full_name || '',
        });
    const blogPreviewResource = createVisualContentResource(null, {
            title: 'Sample Blog Post',
            excerpt: 'Use this sample content to preview how single-post templates present blog entries inside the Pages-owned visual layout system.',
            htmlContent: '<p>This is sample blog body content for the Visual Builder preview. Replace the surrounding layout with your own containers, heroes, sidebars, and metadata blocks.</p><p>Published blogs will inject their real content at runtime.</p>',
            featuredImage: page?.featured_image || '',
            publishedAt: pageMetadata.published_at || new Date().toISOString(),
            categoryName: 'Blog',
            tags: ['sample', 'preview'],
            authorName: 'Sample Author',
        });
    const visualContentValue = {
        page: page?.page_type === 'single_post' ? blogPreviewResource : pagePreviewResource,
        blog: blogPreviewResource,
    };

    // --- RENDER ---
    return (
        <div className="fixed inset-0 z-[100] flex flex-col bg-slate-50">
            {/* Header / Toolbar */}
            {/* Header / Toolbar */}
            {/* Header / Toolbar */}
            <header className="border-b bg-white h-16 flex items-center justify-between px-6 shrink-0 gap-6 z-50 shadow-sm transition-all duration-300">
                <div className="flex items-center gap-4">
                    <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => {
                            if (hasUnsavedChanges) {
                                if (window.confirm('You have unsaved changes. Are you sure you want to leave?')) {
                                    handleClose();
                                }
                            } else {
                                handleClose();
                            }
                        }}
                        className="rounded-full hover:bg-slate-100/50"
                    >
                        <ArrowLeft className="w-5 h-5 text-slate-700" />
                    </Button>
                    <div className="flex flex-col">
                        <div className="flex items-center gap-2">
                            <h1 className="text-lg font-bold text-foreground tracking-tight leading-none bg-gradient-to-r from-foreground to-muted-foreground bg-clip-text text-transparent">
                                {pageMetadata.title || 'Untitled Page'}
                            </h1>
                            <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border ${pageMetadata.status === 'published'
                                ? 'bg-emerald-50 text-emerald-600 border-emerald-100'
                                : 'bg-amber-50 text-amber-600 border-amber-100'
                                }`}>
                                {pageMetadata.status}
                            </span>
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border bg-slate-50 text-slate-600 border-slate-100">
                                {pageMetadata.locale}
                            </span>
                        </div>
                        <span className="text-xs text-slate-400 font-medium tracking-wide font-mono">/{pageMetadata.slug}</span>
                    </div>
                </div>

                <div className="flex items-center gap-3">
                    {/* Offline Indicator */}
                    {isOffline && (
                        <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-rose-50 text-rose-600 border border-rose-100 mr-2 shadow-sm animate-pulse" title="You are offline. Changes will be saved locally.">
                            <WifiOff className="w-3.5 h-3.5" />
                            <span className="text-[10px] font-bold uppercase tracking-widest">OFFLINE</span>
                        </div>
                    )}

                    <div className="flex items-center gap-1 mr-2 p-1 bg-slate-100/50 rounded-lg border border-slate-200/60">
                        <Button variant="ghost" size="icon" onClick={handleUndo} disabled={!canUndo} className="h-7 w-7 rounded-md hover:bg-white hover:shadow-sm transition-all">
                            <Undo2 className="w-3.5 h-3.5 text-slate-600" />
                        </Button>
                        <Button variant="ghost" size="icon" onClick={handleRedo} disabled={!canRedo} className="h-7 w-7 rounded-md hover:bg-white hover:shadow-sm transition-all">
                            <Redo2 className="w-3.5 h-3.5 text-slate-600" />
                        </Button>
                    </div>

                    <div className="h-6 w-px bg-slate-200 mx-1" />

                    <div className="flex items-center gap-2">
                        <span className="text-xs text-slate-400 mr-2 flex items-center gap-1.5 font-medium">
                            {isSaving ? (
                                <>
                                    <Loader2 className="w-3 h-3 animate-spin text-indigo-500" />
                                    <span className="text-indigo-600">Saving...</span>
                                </>
                            ) : hasUnsavedChanges ? (
                                <span className="text-amber-500 flex items-center gap-1">
                                    <span className="w-1.5 h-1.5 rounded-full bg-amber-500 block"></span>
                                    Unsaved
                                </span>
                            ) : lastSavedAt ? (
                                <span className="text-slate-400 flex items-center gap-1">
                                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 block"></span>
                                    Saved {formatTime(lastSavedAt)}
                                </span>
                            ) : 'Saved'}
                        </span>

                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setSettingsOpen(true)}
                            className="h-9 px-4 border-slate-200 text-slate-600 hover:text-slate-900 hover:bg-slate-50 hover:border-slate-300 transition-all shadow-sm"
                        >
                            <Settings className="w-3.5 h-3.5 mr-2" />
                            Settings
                        </Button>

                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setPreviewMode(!previewMode)}
                            className={`h-9 px-4 border-slate-200 transition-all shadow-sm ${previewMode ? 'bg-indigo-50 text-indigo-600 border-indigo-200' : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'}`}
                        >
                            {previewMode ? <EyeOff className="w-3.5 h-3.5 mr-2" /> : <Eye className="w-3.5 h-3.5 mr-2" />}
                            {previewMode ? 'Exit' : 'Preview'}
                        </Button>

                        <div className="flex items-center gap-1 ml-1">
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                    if (hasUnsavedChanges) {
                                        if (window.confirm('You have unsaved changes. Are you sure you want to leave?')) {
                                            handleClose();
                                        }
                                    } else {
                                        handleClose();
                                    }
                                }}
                                className="h-9 px-4 text-slate-500 hover:text-slate-700 hover:bg-slate-100 ring-0 focus:ring-0"
                            >
                                Cancel
                            </Button>
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={handleManualSave}
                                disabled={isSaving || !canEdit}
                                className="h-9 px-4 text-slate-600 hover:text-slate-900 hover:bg-slate-100 font-medium"
                            >
                                <Save className="w-4 h-4 mr-2" />
                                Save
                            </Button>
                            <Button
                                size="sm"
                                onClick={handlePublish}
                                disabled={isPublishing || !canPublish}
                                className="h-9 px-6 bg-gradient-to-r from-indigo-600 to-indigo-500 hover:from-indigo-700 hover:to-indigo-600 text-white shadow-md hover:shadow-lg transition-all transform hover:-translate-y-0.5 active:translate-y-0"
                            >
                                {isPublishing ? (
                                    <>
                                        <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" />
                                        Publishing...
                                    </>
                                ) : (
                                    <>
                                        <Upload className="w-3.5 h-3.5 mr-2" />
                                        Publish
                                    </>
                                )}
                            </Button>
                        </div>
                    </div>
                </div>
            </header>

            {/* Main Editor Area */}
            <VisualContentProvider value={visualContentValue}>
                <div className={`flex-1 overflow-hidden relative ${previewMode ? 'bg-background' : 'bg-muted/30'}`}>
                    {previewMode ? (
                        <div className={`w-full h-full overflow-y-auto ${viewportClasses[viewport] || 'w-full'} transition-all mx-auto bg-white shadow-sm my-4 border min-h-screen`}>
                            <div className="min-h-full">
                                <Render config={puckConfig} data={data} key={`render-${editorKey}`} />
                            </div>
                        </div>
                    ) : (
                        <Puck
                            key={`puck-${editorKey}`}
                            config={puckConfig}
                            data={data || { content: [], root: { props: { title: page?.title || '' } } }}
                            onChange={handleChange}
                            headerPath={page?.slug || '/'}
                            overrides={{
                                header: () => null,
                            }}
                            viewports={[
                                { width: 1280, height: 'auto', label: 'Desktop', icon: <Monitor />, id: 'desktop' },
                                { width: 768, height: 'auto', label: 'Tablet', icon: <Tablet />, id: 'tablet' },
                                { width: 375, height: 'auto', label: 'Mobile', icon: <Smartphone />, id: 'mobile' },
                            ]}
                        />
                    )}
                </div>
            </VisualContentProvider>

            <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
                <DialogContent className="sm:max-w-[500px] shadow-2xl">
                    <DialogHeader className="pb-4 border-b border-border">
                        <DialogTitle className="text-xl font-bold text-foreground tracking-tight">
                            Page Settings
                        </DialogTitle>
                        <DialogDescription className="text-muted-foreground">
                            Configure page properties, SEO metadata, and publication status.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="grid gap-6 py-6">
                        <div className="space-y-4">
                            <h3 className="text-sm font-semibold text-foreground uppercase tracking-wider flex items-center gap-2">
                                <span className="w-1 h-4 bg-indigo-500 rounded-full"></span>
                                General Information
                            </h3>
                            <div className="grid gap-3">
                                {mode === 'page' && (
                                    <>
                                        <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Locale</Label>
                                        <Select value={pageMetadata.locale} onValueChange={handleLocaleChange}>
                                            <SelectTrigger className="bg-muted/50 border-input focus:border-indigo-500 transition-colors" disabled={requiresBaseLocaleFirst}>
                                                <SelectValue placeholder="Select locale" />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="id">Indonesia (default)</SelectItem>
                                                <SelectItem value="en">English</SelectItem>
                                            </SelectContent>
                                        </Select>
                                        {requiresBaseLocaleFirst && (
                                            <p className="text-xs text-muted-foreground">
                                                Save this page once to enable English translation editing.
                                            </p>
                                        )}
                                    </>
                                )}
                            </div>

                            <div className="grid gap-3">
                                <Label htmlFor="title" className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                                    Page Title
                                </Label>
                                <Input
                                    id="title"
                                    value={pageMetadata.title}
                                    onChange={(e) => handleMetadataChange('title', e.target.value)}
                                    className="bg-muted/50 border-input focus:border-indigo-500 transition-colors"
                                    placeholder="e.g. Landing Page"
                                />
                            </div>

                            <div className="grid gap-3">
                                <Label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">URL Slug</Label>
                                <SlugGenerator
                                    key={`${page?.id || 'new'}-${pageMetadata.locale}-${translationSlugCheckKey}`}
                                    initialSlug={pageMetadata.slug}
                                    titleValue={pageMetadata.title}
                                    tableName={pageMetadata.locale === defaultContentLocale ? 'pages' : 'content_translations'}
                                    recordId={page?.id}
                                    tenantId={currentTenant?.id}
                                    excludeField={pageMetadata.locale === defaultContentLocale ? 'id' : 'content_id'}
                                    extraFilters={pageMetadata.locale === defaultContentLocale ? null : {
                                        content_type: 'page',
                                        locale: pageMetadata.locale,
                                    }}
                                    onSlugChange={handleSlugChange}
                                />
                            </div>

                            <div className="grid gap-3">
                                <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Category</Label>
                                <ResourceSelect
                                    table="categories"
                                    value={pageMetadata.category_id}
                                    onChange={(val) => handleMetadataChange('category_id', val)}
                                    labelKey="name"
                                    valueKey="id"
                                    filter={{ type: ['page', 'pages', 'content'] }}
                                    placeholder="No Category"
                                />
                            </div>
                        </div>

                        <div className="space-y-4">
                            <h3 className="text-sm font-semibold text-foreground uppercase tracking-wider flex items-center gap-2">
                                <span className="w-1 h-4 bg-purple-500 rounded-full"></span>
                                SEO & Metadata
                            </h3>
                            <div className="grid gap-3">
                                <Label htmlFor="meta_description" className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Description</Label>
                                <Textarea
                                    id="meta_description"
                                    value={pageMetadata.meta_description}
                                    onChange={(e) => handleMetadataChange('meta_description', e.target.value)}
                                    placeholder="Brief description for search engines and social media..."
                                    className="bg-muted/50 border-input focus:border-purple-500 transition-colors resize-none min-h-[80px]"
                                />
                            </div>
                        </div>

                        <div className="space-y-4">
                            <h3 className="text-sm font-semibold text-foreground uppercase tracking-wider flex items-center gap-2">
                                <span className="w-1 h-4 bg-emerald-500 rounded-full"></span>
                                Publication
                            </h3>
                            <div className="flex items-center justify-between rounded-xl border border-border p-4 bg-muted/30 hover:bg-muted/50 transition-colors">
                                <div className="space-y-1">
                                    <Label className="text-base font-semibold text-foreground">Publish Status</Label>
                                    <p className="text-xs text-muted-foreground font-medium">
                                        {pageMetadata.status === 'published'
                                            ? 'Page is live and visible to visitors.'
                                            : 'Page is hidden and only visible to editors.'}
                                    </p>
                                </div>
                                <div className="flex items-center gap-3">
                                    <span className={`px-2.5 py-1 rounded-md text-[10px] font-bold uppercase tracking-widest border ${pageMetadata.status === 'published'
                                        ? 'bg-emerald-100 text-emerald-700 border-emerald-200'
                                        : 'bg-amber-100 text-amber-700 border-amber-200'
                                        }`}>
                                        {pageMetadata.status === 'published' ? 'Live' : 'Draft'}
                                    </span>
                                    <Switch
                                        checked={pageMetadata.status === 'published'}
                                        onCheckedChange={(checked) => setPageMetadata({ ...pageMetadata, status: checked ? 'published' : 'draft' })}
                                    />
                                </div>
                            </div>

                            <div className="grid gap-3">
                                <Label htmlFor="published_at" className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Publish Date</Label>
                                <Input
                                    type="datetime-local"
                                    id="published_at"
                                    value={pageMetadata.published_at || ''}
                                    onChange={(e) => setPageMetadata({ ...pageMetadata, published_at: e.target.value })}
                                    className="bg-muted/50 border-input focus:border-emerald-500 transition-colors"
                                />
                            </div>
                        </div>
                    </div>
                    <DialogFooter className="border-t border-border pt-4">
                        <Button variant="ghost" onClick={() => setSettingsOpen(false)} className="hover:bg-muted text-muted-foreground">Cancel</Button>
                        <Button onClick={() => {
                            setHasUnsavedChanges(true);
                            setSettingsOpen(false);
                            toast({ title: "Settings Updated", description: "Don't forget to save your changes to apply them." });
                        }} className="bg-primary text-primary-foreground hover:bg-primary/90 shadow-sm">
                            Apply Changes
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <TemplateSelector
                open={templateSelectorOpen}
                onOpenChange={setTemplateSelectorOpen}
                onSelect={handleApplyTemplate}
            />
        </div >
    );
};

export default VisualPageBuilder;
