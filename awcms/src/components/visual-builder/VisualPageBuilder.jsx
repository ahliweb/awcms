import React, { useState, useCallback, useEffect, useRef } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { Puck, Render } from '@measured/puck';
import '@measured/puck/puck.css';
import './puck-theme.css';
import { motion } from 'framer-motion';
import { Save, Eye, EyeOff, ArrowLeft, Upload, Monitor, Tablet, Smartphone, Layout, Undo2, Redo2, Cloud, Loader2, WifiOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useToast } from '@/components/ui/use-toast';
import { udm } from '@/lib/data/UnifiedDataManager';
import editorConfig from './config';
import TemplateSelector from './TemplateSelector';
import { useHistory } from './hooks/useHistory';
import SlugGenerator from '@/components/dashboard/slug/SlugGenerator';
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
import { Settings } from 'lucide-react';

import { usePermissions } from '@/contexts/PermissionContext';
import { useTenant } from '@/contexts/TenantContext'; // Added TenantContext

const VisualPageBuilder = ({ page: initialPage, onClose, onSuccess }) => {
    // Permission Hook
    const { hasPermission, checkAccess, isPlatformAdmin } = usePermissions();
    const { currentTenant } = useTenant(); // Get current tenant
    const { toast } = useToast();
    const [searchParams] = useSearchParams();
    const navigate = useNavigate();

    // Determine mode and IDs
    const templateId = searchParams.get('templateId');
    const partId = searchParams.get('partId');
    const pageId = searchParams.get('pageId'); // Optional, to support deep linking 
    const mode = partId ? 'part' : (templateId ? 'template' : 'page');

    // State
    const [page, setPage] = useState(initialPage || null);

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

    const [loading, setLoading] = useState(!initialPage);

    // Page Metadata State
    const [pageMetadata, setPageMetadata] = useState({
        title: initialPage?.title || '',
        slug: initialPage?.slug || '',
        meta_description: initialPage?.meta_description || '',
        status: initialPage?.status || 'draft',
        published_at: initialPage?.published_at ? new Date(initialPage.published_at).toISOString().slice(0, 16) : ''
    });

    const isEditorEnabled = (mode === 'template' || mode === 'part') ? hasPermission('tenant.theme.update') : checkAccess('edit', 'pages', page);
    const canEdit = isEditorEnabled; // Alias for readability
    const canPublish = (mode === 'template' || mode === 'part') ? false : checkAccess('publish', 'pages', page);

    const [isSaving, setIsSaving] = useState(false);
    const [isPublishing, setIsPublishing] = useState(false);
    const [previewMode, setPreviewMode] = useState(false);
    const [viewport, setViewport] = useState('desktop');
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

            setLoading(true);
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
                        status: tpl.is_active ? 'published' : 'draft',
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
                        status: part.is_active ? 'published' : 'draft',
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
                        status: pg.status,
                        published_at: pg.published_at ? new Date(pg.published_at).toISOString().slice(0, 16) : ''
                    });
                }

                if (fetchedData) {
                    setPage(fetchedData);
                    resetHistory(fetchedData.content_draft || fetchedData.data || { content: [], root: { props: { title: fetchedData.title || fetchedData.name } } });
                }
            } catch (error) {
                console.error("Error loading visual builder data:", error);
                toast({ title: "Error", description: error.message || "Failed to load content, or access denied.", variant: "destructive" });

                if (error.code === 'PGRST116' || error.message?.includes('not found')) {
                    setTimeout(() => handleClose(), 2000);
                }
            } finally {
                setLoading(false);
            }
        };

        // Only run if we have currentTenant (or are global/platform admin)
        if (currentTenant?.id || isPlatformAdmin) {
            loadData();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [templateId, pageId, initialPage, mode, currentTenant?.id, isPlatformAdmin]);


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
    const saveContent = async (contentData, isAutoSave = false) => {
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
            let resultData = null; // Can be payload (optimistic) or row array

            const timestamp = new Date().toISOString();

            // applyTenantFilter logic for update is handled by .eq('id', ...) RLS, 
            // but for offline safety we could check tenant match if we had full object. 
            // Assuming loaded 'page' object has tenant_id correct from loadData.

            if (mode === 'template') {
                console.log('Saving template:', templateId);
                const { data: res, error: err } = await udm
                    .from('templates')
                    .update({
                        data: contentData,
                        updated_at: timestamp,
                        name: pageMetadata.title,
                        slug: pageMetadata.slug,
                        description: pageMetadata.meta_description,
                        is_active: pageMetadata.status === 'published'
                    })
                    .eq('id', templateId);
                error = err;
                resultData = res;
            } else if (mode === 'part') {
                console.log('Saving part:', partId);
                const { data: res, error: err } = await udm
                    .from('template_parts')
                    .update({
                        content: contentData,
                        updated_at: timestamp,
                        name: pageMetadata.title,
                        type: pageMetadata.slug,
                        is_active: pageMetadata.status === 'published'
                    })
                    .eq('id', partId);
                error = err;
                resultData = res;
            } else {
                console.log('Saving page:', page.id);
                const { data: res, error: err } = await udm
                    .from('pages')
                    .update({
                        content_draft: contentData,
                        updated_at: timestamp,
                        title: pageMetadata.title,
                        slug: pageMetadata.slug,
                        meta_description: pageMetadata.meta_description,
                        status: pageMetadata.status,
                        published_at: pageMetadata.published_at || null
                    })
                    .eq('id', page.id);
                error = err;
                resultData = res;
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
    };

    // undo/redo wrappers
    const handleUndo = () => {
        if (canUndo && historyCanUndo) {
            undo();
            setEditorKey(prev => prev + 1);
        }
    };

    const handleRedo = () => {
        if (canRedo && historyCanRedo) {
            redo();
            setEditorKey(prev => prev + 1);
        }
    };

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
    }, [canUndo, canRedo, undo, redo, data]);

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
    }, [hasUnsavedChanges, isSaving, data, canEdit]);

    // Publish page
    const handlePublish = async () => {
        if (!canPublish) {
            toast({ variant: 'destructive', title: 'Action Denied', description: 'You do not have permission to publish pages.' });
            return;
        }
        if (!page || !page.id) {
            toast({ variant: 'destructive', title: 'Error', description: 'Page data is missing. Please reload the editor.' });
            return;
        }
        setIsPublishing(true);
        try {
            await saveContent(data, false);

            const { error } = await udm
                .from('pages')
                .update({
                    status: 'published',
                    content_published: data,
                    published_at: new Date().toISOString()
                })
                .eq('id', page.id);

            if (error) throw error;

            setPageMetadata(prev => ({ ...prev, status: 'published' }));

            toast({
                title: isOffline ? "Published Offline" : "Published Successfully",
                description: isOffline ? "Changes saved locally. Status will update when online." : "Your page is now live.",
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
    const puckConfig = React.useMemo(() => ({
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
    }), []);

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

    // --- RENDER ---
    return (
        <div className="fixed inset-0 z-50 flex flex-col bg-background">
            {/* Header / Toolbar */}
            <header className="border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 h-16 flex items-center justify-between px-4 shrink-0 gap-4">
                <div className="flex items-center gap-4">
                    <Button variant="ghost" size="icon" onClick={() => {
                        if (hasUnsavedChanges) {
                            if (window.confirm('You have unsaved changes. Are you sure you want to leave?')) {
                                handleClose();
                            }
                        } else {
                            handleClose();
                        }
                    }}>
                        <ArrowLeft className="w-5 h-5" />
                    </Button>
                    <div className="flex flex-col">
                        <h1 className="text-lg font-semibold leading-none">{pageMetadata.title || 'Untitled Page'}</h1>
                        <span className="text-sm text-muted-foreground font-mono">/{pageMetadata.slug}</span>
                    </div>
                </div>

                <div className="flex items-center gap-2">
                    {/* Offline Indicator */}
                    {isOffline && (
                        <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-amber-100 text-amber-700 mr-2" title="You are offline. Changes will be saved locally.">
                            <WifiOff className="w-4 h-4" />
                            <span className="text-xs font-bold">OFFLINE</span>
                        </div>
                    )}

                    <div className="flex items-center gap-1 mr-4 border-r pr-4">
                        <Button variant="ghost" size="icon" onClick={handleUndo} disabled={!canUndo}>
                            <Undo2 className="w-4 h-4" />
                        </Button>
                        <Button variant="ghost" size="icon" onClick={handleRedo} disabled={!canRedo}>
                            <Redo2 className="w-4 h-4" />
                        </Button>
                    </div>

                    <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground mr-2 flex items-center gap-1">
                            {isSaving ? (
                                <>
                                    <Loader2 className="w-3 h-3 animate-spin" /> Saving...
                                </>
                            ) : hasUnsavedChanges ? (
                                'Unsaved changes'
                            ) : lastSavedAt ? (
                                <>
                                    Saved {formatTime(lastSavedAt)}
                                </>
                            ) : 'Saved'}
                        </span>

                        <Button variant="outline" size="sm" onClick={() => setSettingsOpen(true)}>
                            <Settings className="w-4 h-4 mr-2" />
                            Settings
                        </Button>

                        <Button variant="outline" size="sm" onClick={() => setPreviewMode(!previewMode)}>
                            {previewMode ? <EyeOff className="w-4 h-4 mr-2" /> : <Eye className="w-4 h-4 mr-2" />}
                            {previewMode ? 'Exit Preview' : 'Preview'}
                        </Button>

                        <Button variant="secondary" size="sm" onClick={handleManualSave} disabled={isSaving || !canEdit}>
                            <Save className="w-4 h-4 mr-2" />
                            Save
                        </Button>
                        <Button size="sm" onClick={handlePublish} disabled={isPublishing || !canPublish}>
                            <Upload className="w-4 h-4 mr-2" />
                            {isPublishing ? 'Publishing...' : 'Publish'}
                        </Button>
                    </div>
                </div>
            </header>

            {/* Main Editor Area */}
            <div className={`flex-1 overflow-hidden relative ${previewMode ? 'bg-background' : 'bg-slate-50'}`}>
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
                        renderHeader={() => null} // Hide default header to avoid duplication
                        viewports={[
                            { width: 1280, height: 'auto', label: 'Desktop', icon: <Monitor />, id: 'desktop' },
                            { width: 768, height: 'auto', label: 'Tablet', icon: <Tablet />, id: 'tablet' },
                            { width: 375, height: 'auto', label: 'Mobile', icon: <Smartphone />, id: 'mobile' },
                        ]}
                    />
                )}
            </div>

            <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
                <DialogContent className="sm:max-w-[500px]">
                    <DialogHeader>
                        <DialogTitle>Page Settings</DialogTitle>
                        <DialogDescription>
                            Configure page URL, SEO details, and publishing status.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="grid gap-4 py-4">
                        <div className="grid gap-2">
                            <Label htmlFor="title">Page Title</Label>
                            <Input
                                id="title"
                                value={pageMetadata.title}
                                onChange={(e) => setPageMetadata({ ...pageMetadata, title: e.target.value })}
                            />
                        </div>

                        <SlugGenerator
                            initialSlug={pageMetadata.slug}
                            titleValue={pageMetadata.title}
                            tableName="pages"
                            recordId={page?.id}
                            tenantId={currentTenant?.id} // CHANGED: Pass tenantId
                            onSlugChange={(newSlug) => setPageMetadata({ ...pageMetadata, slug: newSlug })}
                        />

                        <div className="grid gap-2">
                            <Label htmlFor="meta_description">SEO Description</Label>
                            <Textarea
                                id="meta_description"
                                value={pageMetadata.meta_description}
                                onChange={(e) => setPageMetadata({ ...pageMetadata, meta_description: e.target.value })}
                                placeholder="Brief description for search engines..."
                            />
                        </div>

                        <div className="flex items-center justify-between rounded-lg border p-3 shadow-sm">
                            <div className="space-y-0.5">
                                <Label>Publish Status</Label>
                                <p className="text-xs text-muted-foreground">
                                    {pageMetadata.status === 'published' ? 'Page is live and visible.' : 'Page is hidden (Draft).'}
                                </p>
                            </div>
                            <div className="flex items-center gap-2">
                                <span className={`text-xs font-medium ${pageMetadata.status === 'published' ? 'text-green-600' : 'text-amber-600'}`}>
                                    {pageMetadata.status === 'published' ? 'Published' : 'Draft'}
                                </span>
                                <Switch
                                    checked={pageMetadata.status === 'published'}
                                    onCheckedChange={(checked) => setPageMetadata({ ...pageMetadata, status: checked ? 'published' : 'draft' })}
                                />
                            </div>
                        </div>

                        <div className="grid gap-2">
                            <Label htmlFor="published_at">Publish Date</Label>
                            <Input
                                type="datetime-local"
                                id="published_at"
                                value={pageMetadata.published_at}
                                onChange={(e) => setPageMetadata({ ...pageMetadata, published_at: e.target.value })}
                            />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setSettingsOpen(false)}>Cancel</Button>
                        <Button onClick={() => {
                            setHasUnsavedChanges(true);
                            setSettingsOpen(false);
                            toast({ title: "Settings Updated", description: "Don't forget to save your changes." });
                        }}>
                            Update Settings
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
