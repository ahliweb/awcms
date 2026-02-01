import React, { useState, useEffect, useCallback } from 'react';
import { useTenant } from '@/contexts/TenantContext';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/components/ui/use-toast';
import { AdminPageLayout, PageHeader } from '@/templates/flowbite-admin';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import ImageUpload from '@/components/ui/ImageUpload';
import LocalizedInput from '@/components/ui/LocalizedInput';
import {
    Image as ImageIcon,
    Save,
    RefreshCw,
    Loader2,
    Plus,
    Trash2,
    GripVertical,
    ChevronDown,
    ChevronUp
} from 'lucide-react';

const SETTINGS_KEY = 'site_images';

function SiteImagesManager() {
    const { currentTenant } = useTenant();
    const { toast } = useToast();
    const [activeTab, setActiveTab] = useState('hero');
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [data, setData] = useState({});
    const [hasChanges, setHasChanges] = useState(false);

    const tenantId = currentTenant?.id;

    const loadData = useCallback(async () => {
        if (!tenantId) return;
        setLoading(true);
        try {
            const { data: settings, error } = await supabase
                .from('settings')
                .select('value')
                .eq('tenant_id', tenantId)
                .eq('key', SETTINGS_KEY)
                .single();

            if (error && error.code !== 'PGRST116') throw error;

            const parsed = settings?.value
                ? (typeof settings.value === 'string' ? JSON.parse(settings.value) : settings.value)
                : {};
            setData(parsed);
        } catch (err) {
            console.error('Error loading site images:', err);
            toast({ title: 'Error', description: 'Failed to load data', variant: 'destructive' });
        } finally {
            setLoading(false);
        }
    }, [tenantId, toast]);

    useEffect(() => {
        loadData();
    }, [loadData]);

    const handleSave = async () => {
        if (!tenantId) return;
        setSaving(true);
        try {
            const { error } = await supabase
                .from('settings')
                .upsert({
                    tenant_id: tenantId,
                    key: SETTINGS_KEY,
                    value: JSON.stringify(data),
                    type: 'json'
                }, { onConflict: 'tenant_id,key' });

            if (error) throw error;

            toast({ title: 'Saved', description: 'Site images saved successfully' });
            setHasChanges(false);
        } catch (err) {
            console.error('Error saving:', err);
            toast({ title: 'Error', description: 'Failed to save data', variant: 'destructive' });
        } finally {
            setSaving(false);
        }
    };

    const updateSection = (section, value) => {
        setData(prev => ({
            ...prev,
            [section]: value
        }));
        setHasChanges(true);
    };

    const tabs = [
        { id: 'hero', label: 'Hero Images' },
        { id: 'sections', label: 'Section Images' },
        { id: 'gallery', label: 'Gallery Collections' }
    ];

    if (loading) {
        return (
            <AdminPageLayout requiredPermission="tenant.school_pages.read">
                <PageHeader
                    title="Site Images"
                    description="Manage hero images, section images, and gallery collections"
                    icon={ImageIcon}
                    breadcrumbs={[{ label: 'Site Images', icon: ImageIcon }]}
                />
                <div className="space-y-4 p-6">
                    <Skeleton className="h-10 w-full" />
                    <Skeleton className="h-64 w-full" />
                </div>
            </AdminPageLayout>
        );
    }

    return (
        <AdminPageLayout requiredPermission="tenant.school_pages.read">
            <PageHeader
                title="Site Images"
                description="Manage hero images, section images, and gallery collections"
                icon={ImageIcon}
                breadcrumbs={[{ label: 'Site Images', icon: ImageIcon }]}
                actions={[
                    <Button
                        key="refresh"
                        variant="outline"
                        size="sm"
                        onClick={loadData}
                        disabled={loading}
                    >
                        <RefreshCw className="h-4 w-4 mr-2" />
                        Refresh
                    </Button>,
                    <Button
                        key="save"
                        size="sm"
                        onClick={handleSave}
                        disabled={saving || !hasChanges}
                    >
                        {saving ? (
                            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        ) : (
                            <Save className="h-4 w-4 mr-2" />
                        )}
                        Save Changes
                    </Button>
                ]}
            />

            <div className="p-6">
                <Tabs value={activeTab} onValueChange={setActiveTab}>
                    <TabsList className="grid grid-cols-3 w-[400px]">
                        {tabs.map((tab) => (
                            <TabsTrigger key={tab.id} value={tab.id}>
                                {tab.label}
                            </TabsTrigger>
                        ))}
                    </TabsList>

                    <TabsContent value="hero" className="mt-6">
                        <HeroImagesEditor
                            data={data.hero || {}}
                            onChange={(v) => updateSection('hero', v)}
                        />
                    </TabsContent>

                    <TabsContent value="sections" className="mt-6">
                        <SectionImagesEditor
                            data={data.sections || {}}
                            onChange={(v) => updateSection('sections', v)}
                        />
                    </TabsContent>

                    <TabsContent value="gallery" className="mt-6">
                        <GalleryCollectionsEditor
                            data={data.collections || []}
                            onChange={(v) => updateSection('collections', v)}
                        />
                    </TabsContent>
                </Tabs>
            </div>
        </AdminPageLayout>
    );
}

// ============ SUB-EDITORS ============

function HeroImagesEditor({ data = {}, onChange }) {
    const updateField = (field, value) => {
        onChange({ ...data, [field]: value });
    };

    return (
        <div className="grid gap-6">
            <Card>
                <CardHeader>
                    <CardTitle className="text-lg">Homepage Hero</CardTitle>
                    <CardDescription>Main hero image for the homepage</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <ImageUpload
                        label="Hero Image"
                        value={data.main}
                        onChange={(v) => updateField('main', v)}
                    />
                    <LocalizedInput
                        label="Hero Title"
                        value={data.mainTitle}
                        onChange={(v) => updateField('mainTitle', v)}
                    />
                    <LocalizedInput
                        label="Hero Subtitle"
                        type="textarea"
                        value={data.mainSubtitle}
                        onChange={(v) => updateField('mainSubtitle', v)}
                    />
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle className="text-lg">About Page Hero</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                    <ImageUpload
                        label="About Hero Image"
                        value={data.about}
                        onChange={(v) => updateField('about', v)}
                    />
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle className="text-lg">Contact Page Hero</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                    <ImageUpload
                        label="Contact Hero Image"
                        value={data.contact}
                        onChange={(v) => updateField('contact', v)}
                    />
                </CardContent>
            </Card>
        </div>
    );
}

function SectionImagesEditor({ data = {}, onChange }) {
    const sections = [
        { key: 'classroom', label: 'Classroom', description: 'KBM / Teaching activities' },
        { key: 'laboratory', label: 'Laboratory', description: 'Science labs' },
        { key: 'library', label: 'Library', description: 'Library and reading areas' },
        { key: 'sports', label: 'Sports', description: 'Sports facilities and activities' },
        { key: 'extracurricular', label: 'Extracurricular', description: 'Clubs and activities' },
        { key: 'ceremony', label: 'Ceremony', description: 'Flag ceremonies and events' },
        { key: 'graduation', label: 'Graduation', description: 'Graduation ceremonies' }
    ];

    const updateField = (field, value) => {
        onChange({ ...data, [field]: value });
    };

    return (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {sections.map((section) => (
                <Card key={section.key}>
                    <CardHeader className="pb-2">
                        <CardTitle className="text-base">{section.label}</CardTitle>
                        <CardDescription className="text-xs">{section.description}</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <ImageUpload
                            value={data[section.key]}
                            onChange={(v) => updateField(section.key, v)}
                            compact
                        />
                    </CardContent>
                </Card>
            ))}
        </div>
    );
}

function GalleryCollectionsEditor({ data = [], onChange }) {
    const [expandedIndex, setExpandedIndex] = useState(null);

    const addCollection = () => {
        onChange([...data, {
            id: `collection-${Date.now()}`,
            name: { id: '', en: '' },
            description: { id: '', en: '' },
            category: '',
            images: []
        }]);
    };

    const updateCollection = (index, field, value) => {
        const updated = data.map((item, i) =>
            i === index ? { ...item, [field]: value } : item
        );
        onChange(updated);
    };

    const removeCollection = (index) => {
        onChange(data.filter((_, i) => i !== index));
        if (expandedIndex === index) setExpandedIndex(null);
    };

    const addImageToCollection = (index, imageUrl) => {
        const collection = data[index];
        const updatedImages = [...(collection.images || []), imageUrl];
        updateCollection(index, 'images', updatedImages);
    };

    const removeImageFromCollection = (collectionIndex, imageIndex) => {
        const collection = data[collectionIndex];
        const updatedImages = collection.images.filter((_, i) => i !== imageIndex);
        updateCollection(collectionIndex, 'images', updatedImages);
    };

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <div>
                    <h3 className="text-lg font-medium">Gallery Collections</h3>
                    <p className="text-sm text-muted-foreground">Organize images into themed collections</p>
                </div>
                <Button onClick={addCollection} variant="outline" size="sm">
                    <Plus className="h-4 w-4 mr-1" /> Add Collection
                </Button>
            </div>

            {data.length === 0 ? (
                <Card className="border-dashed">
                    <CardContent className="py-8 text-center text-muted-foreground">
                        No collections created yet. Click "Add Collection" to create one.
                    </CardContent>
                </Card>
            ) : (
                <div className="space-y-3">
                    {data.map((collection, index) => (
                        <Card key={collection.id || index}>
                            <div
                                className="flex items-center gap-3 p-4 cursor-pointer hover:bg-muted/50"
                                onClick={() => setExpandedIndex(expandedIndex === index ? null : index)}
                            >
                                <GripVertical className="h-4 w-4 text-muted-foreground" />
                                <div className="flex-1">
                                    <div className="font-medium">
                                        {collection.name?.id || collection.name?.en || `Collection ${index + 1}`}
                                    </div>
                                    <div className="text-sm text-muted-foreground">
                                        {collection.images?.length || 0} images • {collection.category || 'No category'}
                                    </div>
                                </div>
                                <div className="flex items-center gap-1">
                                    {expandedIndex === index ? (
                                        <ChevronUp className="h-4 w-4" />
                                    ) : (
                                        <ChevronDown className="h-4 w-4" />
                                    )}
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-8 w-8 text-destructive"
                                        onClick={(e) => { e.stopPropagation(); removeCollection(index); }}
                                    >
                                        <Trash2 className="h-4 w-4" />
                                    </Button>
                                </div>
                            </div>

                            {expandedIndex === index && (
                                <CardContent className="border-t pt-4 space-y-4">
                                    <LocalizedInput
                                        label="Collection Name"
                                        value={collection.name}
                                        onChange={(v) => updateCollection(index, 'name', v)}
                                    />
                                    <LocalizedInput
                                        label="Description"
                                        type="textarea"
                                        value={collection.description}
                                        onChange={(v) => updateCollection(index, 'description', v)}
                                    />
                                    <div>
                                        <Label>Category</Label>
                                        <Input
                                            value={collection.category || ''}
                                            onChange={(e) => updateCollection(index, 'category', e.target.value)}
                                            placeholder="e.g., KBM, Ekskul, Upacara"
                                        />
                                    </div>

                                    <div className="space-y-2">
                                        <div className="flex items-center justify-between">
                                            <Label>Images ({collection.images?.length || 0})</Label>
                                            <ImageUpload
                                                buttonOnly
                                                onUpload={(url) => addImageToCollection(index, url)}
                                            />
                                        </div>
                                        {collection.images?.length > 0 && (
                                            <div className="grid grid-cols-4 gap-2">
                                                {collection.images.map((img, imgIndex) => (
                                                    <div key={imgIndex} className="relative group">
                                                        <img
                                                            src={img}
                                                            alt=""
                                                            className="w-full h-20 object-cover rounded border"
                                                        />
                                                        <Button
                                                            variant="destructive"
                                                            size="icon"
                                                            className="absolute top-1 right-1 h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                                                            onClick={() => removeImageFromCollection(index, imgIndex)}
                                                        >
                                                            <Trash2 className="h-3 w-3" />
                                                        </Button>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                </CardContent>
                            )}
                        </Card>
                    ))}
                </div>
            )}
        </div>
    );
}

export default SiteImagesManager;
