import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/use-toast';
import { udm } from '@/lib/data/UnifiedDataManager';
import { supabase } from '@/lib/customSupabaseClient';
import { Save, X, Lock, Layout, Settings } from 'lucide-react';
import { useTenant } from '@/contexts/TenantContext';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import SlugGenerator from '@/components/dashboard/slug/SlugGenerator';
import { ImageUpload } from '@/components/ui/ImageUpload';
import { MultiImageUpload } from '@/components/ui/MultiImageUpload';
import RichTextEditor from '@/components/ui/RichTextEditor';
import TagInput from '@/components/ui/TagInput';
import ResourceSelect from '@/components/dashboard/ResourceSelect';

const GenericResourceEditor = ({
    tableName,
    resourceName,
    fields,
    initialData,
    onClose,
    onSuccess,
    _permissionPrefix,
    _createPermission,
    omitCreatedBy = false
}) => {
    const { user } = useAuth();
    const { toast } = useToast();
    const { currentTenant } = useTenant();
    const [loading, setLoading] = useState(false);
    const [formData, setFormData] = useState(() => {
        if (initialData) return initialData;

        // Calculate defaults
        const defaults = {};
        if (fields) {
            fields.forEach(f => {
                if (f.defaultValue !== undefined) defaults[f.key] = f.defaultValue;
            });
        }
        return defaults;
    });

    useEffect(() => {
        if (initialData) {
            setFormData(initialData);
        }
    }, [initialData]);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setLoading(true);
        try {
            const { owner: _owner, tenant: _tenant, category: _category, ...cleanPayload } = formData;
            const payload = { ...cleanPayload };

            payload.updated_at = new Date().toISOString();
            if (!initialData) {
                if (!omitCreatedBy) {
                    payload.created_by = user.id;
                }
                if (currentTenant?.id) {
                    payload.tenant_id = currentTenant.id;
                } else {
                    throw new Error("Critical Error: No Tenant Context found. Cannot create record.");
                }
            }

            const hasTagsField = fields.some(f => f.key === 'tags' || f.type === 'tags');
            if (hasTagsField) {
                if (Array.isArray(payload.tags)) {
                    payload.tags = payload.tags.map(t => String(t).trim()).filter(Boolean);
                } else if (typeof payload.tags === 'string' && payload.tags.trim()) {
                    payload.tags = payload.tags.split(',').map(t => t.trim()).filter(Boolean);
                } else {
                    payload.tags = [];
                }
            } else {
                delete payload.tags;
            }

            fields.forEach(field => {
                if ((field.type === 'date' || field.key.includes('_at') || field.key.includes('_date')) && payload[field.key] === '') {
                    payload[field.key] = null;
                }
                if ((field.type === 'relation' || field.type === 'resource_select') && !payload[field.key]) {
                    payload[field.key] = null;
                }
                if (field.type === 'boolean' || field.type === 'checkbox') {
                    payload[field.key] = Boolean(payload[field.key]);
                }
            });

            if (payload.slug && fields.find(f => f.key === 'slug')) {
                let slugCheckQuery = supabase
                    .from(tableName)
                    .select('id, slug')
                    .eq('slug', payload.slug)
                    .is('deleted_at', null);

                if (initialData?.id) {
                    slugCheckQuery = slugCheckQuery.neq('id', initialData.id);
                }

                const { data: existingSlugs } = await slugCheckQuery.limit(1);

                if (existingSlugs && existingSlugs.length > 0) {
                    const uniqueSuffix = Date.now().toString(36);
                    const suggestedSlug = `${payload.slug}-${uniqueSuffix}`;
                    throw new Error(
                        `Slug "${payload.slug}" already exists. Try using "${suggestedSlug}" or choose a different slug.`
                    );
                }
            }

            let error;
            if (initialData) {
                const { error: updateError } = await udm
                    .from(tableName)
                    .update(payload)
                    .eq('id', initialData.id);
                error = updateError;
            } else {
                const { error: insertError } = await udm
                    .from(tableName)
                    .insert([payload]);
                error = insertError;
            }

            if (error) {
                if (error.message.includes('duplicate key') && error.message.includes('slug')) {
                    throw new Error(`Slug "${payload.slug}" is already in use. Please use a different slug.`);
                }
                throw error;
            }

            toast({ title: 'Success', description: `${resourceName} saved successfully` });
            onSuccess();
            onClose();

        } catch (err) {
            console.error(err);
            toast({ variant: 'destructive', title: 'Error', description: err.message });
        } finally {
            setLoading(false);
        }
    };

    const generateSlug = (text) => {
        return text
            .toLowerCase()
            .trim()
            .replace(/[^a-z0-9\s-]/g, '')
            .replace(/\s+/g, '-')
            .replace(/-+/g, '-')
            .replace(/^-|-$/g, '');
    };

    const handleChange = (key, value) => {
        setFormData(prev => {
            const updated = { ...prev, [key]: value };

            const hasSlugField = fields.some(f => f.key === 'slug');
            if (hasSlugField && (key === 'title' || key === 'name')) {
                const oldSlug = prev.slug || '';
                const oldTitle = prev.title || prev.name || '';
                const wasAutoGenerated = !oldSlug || oldSlug === generateSlug(oldTitle);

                if (wasAutoGenerated) {
                    updated.slug = generateSlug(value);
                }
            }

            fields.forEach(field => {
                if (field.calculate && typeof field.calculate === 'function') {
                    const calculatedValue = field.calculate(updated);
                    if (calculatedValue !== updated[field.key]) {
                        updated[field.key] = calculatedValue;
                    }
                }
            });

            return updated;
        });
    };

    const renderField = (field) => {
        return (
            <div key={field.key} className="space-y-2">
                <Label>
                    {field.label} {field.required && <span className="text-red-500">*</span>}
                </Label>

                {field.type === 'textarea' ? (
                    <Textarea
                        value={formData[field.key] || ''}
                        onChange={e => handleChange(field.key, e.target.value)}
                        rows={4}
                        required={field.required}
                    />
                ) : field.type === 'richtext' ? (
                    <RichTextEditor
                        value={formData[field.key] || ''}
                        onChange={val => handleChange(field.key, val)}
                        placeholder={field.description || 'Write content...'}
                    />
                ) : field.type === 'image' ? (
                    <ImageUpload
                        value={formData[field.key] || ''}
                        onChange={url => handleChange(field.key, url)}
                        className="h-48"
                    />
                ) : field.type === 'images' ? (
                    <MultiImageUpload
                        value={formData[field.key] || []}
                        onChange={images => handleChange(field.key, images)}
                        maxImages={field.maxImages || 10}
                    />
                ) : field.type === 'tags' ? (
                    <TagInput
                        value={Array.isArray(formData[field.key]) ? formData[field.key] : (formData[field.key] || '').split(',').filter(Boolean).map(t => t.trim())}
                        onChange={tags => handleChange(field.key, tags)}
                        placeholder="Add tags..."
                    />
                ) : field.type === 'select' ? (
                    <Select
                        value={formData[field.key] || field.defaultValue || ''}
                        onValueChange={val => handleChange(field.key, val)}
                        required={field.required}
                    >
                        <SelectTrigger className="w-full">
                            <SelectValue placeholder={field.description || "Select an option"} />
                        </SelectTrigger>
                        <SelectContent>
                            {field.options.map(opt => (
                                <SelectItem key={opt.value} value={opt.value}>
                                    {opt.label}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                ) : field.type === 'resource_select' || field.type === 'relation' ? (
                    <ResourceSelect
                        table={field.resourceTable || field.table}
                        labelKey={field.relationLabel || 'name'}
                        valueKey={field.relationValue || 'id'}
                        value={formData[field.key]}
                        onChange={val => handleChange(field.key, val)}
                        placeholder={`Select ${field.label}...`}
                        filter={field.filter}
                    />
                ) : field.type === 'boolean' || field.type === 'checkbox' ? (
                    <div className="flex items-center space-x-2">
                        <Checkbox
                            id={field.key}
                            checked={!!formData[field.key]}
                            onCheckedChange={(checked) => handleChange(field.key, checked)}
                        />
                        <label
                            htmlFor={field.key}
                            className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 text-foreground"
                        >
                            {field.placeholder || "Enable"}
                        </label>
                    </div>
                ) : field.type === 'date' ? (
                    <Input
                        type="date"
                        value={formData[field.key] ? formData[field.key].substring(0, 10) : ''}
                        onChange={e => handleChange(field.key, e.target.value ? new Date(e.target.value).toISOString() : '')}
                        required={field.required}
                    />
                ) : field.type === 'datetime' ? (
                    <Input
                        type="datetime-local"
                        value={formData[field.key] ? new Date(formData[field.key]).toISOString().slice(0, 16) : ''}
                        onChange={e => handleChange(field.key, e.target.value ? new Date(e.target.value).toISOString() : null)}
                        required={field.required}
                        className="block"
                    />
                ) : field.key === 'slug' ? (
                    <SlugGenerator
                        initialSlug={formData.slug || ''}
                        titleValue={formData.title || formData.name || ''}
                        tableName={tableName}
                        recordId={initialData?.id}
                        onSlugChange={(newSlug) => handleChange('slug', newSlug)}
                    />
                ) : (
                    <Input
                        type={field.type || 'text'}
                        value={formData[field.key] || ''}
                        onChange={e => handleChange(field.key, e.target.value)}
                        required={field.required}
                        placeholder={field.description}
                    />
                )}
                {field.description && <p className="text-[10px] text-muted-foreground">{field.description}</p>}
            </div>
        );
    };

    // Calculate layout groups
    const visibleFields = fields.filter(field => {
        if (field.conditionalShow && typeof field.conditionalShow === 'function' && !field.conditionalShow(formData)) {
            return false;
        }
        return true;
    });

    const mainFields = visibleFields.filter(f => 
        ['textarea', 'richtext', 'image', 'images'].includes(f.type) ||
        ['title', 'name', 'slug', 'description', 'excerpt', 'content'].includes(f.key) ||
        f.layout === 'main'
    );

    const sidebarFields = visibleFields.filter(f => !mainFields.includes(f));

    return (
        <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-white rounded-xl shadow-md p-0 flex flex-col h-full overflow-hidden max-w-6xl mx-auto"
        >
            <div className="flex justify-between items-center px-6 py-4 border-b border-slate-100 bg-slate-50/50">
                <div>
                    <h3 className="text-xl font-bold text-slate-800 flex items-center gap-2">
                        {initialData ? `Edit ${resourceName}` : `Create New ${resourceName}`}
                        {initialData?.status === 'published' && <span className="bg-green-100 text-green-700 text-xs px-2 py-0.5 rounded-full border border-green-200">Live</span>}
                    </h3>
                    <div className="text-xs text-slate-500 mt-1 flex items-center gap-3">
                        {initialData?.created_by ? (
                            <span className="flex items-center gap-1"><Lock className="w-3 h-3" /> Owner: {user?.id === initialData.created_by ? 'You' : initialData.owner?.full_name || 'Others'}</span>
                        ) : (
                            <span>Author: You</span>
                        )}
                    </div>
                </div>

                <div className="flex gap-2">
                    <Button type="button" onClick={handleSubmit} disabled={loading} className="bg-slate-900 hover:bg-slate-800 text-white">
                        <Save className="w-4 h-4 mr-2" />
                        {loading ? 'Saving...' : `Save ${resourceName}`}
                    </Button>
                    <Button variant="ghost" size="icon" onClick={onClose}>
                        <X className="w-5 h-5" />
                    </Button>
                </div>
            </div>

            <form onSubmit={handleSubmit} className="flex-1 overflow-hidden flex flex-col">
                <div className="flex-1 overflow-y-auto p-6 bg-slate-50/30">
                    <div className="flex flex-col lg:flex-row gap-6">
                        {/* Main Content Area */}
                        <div className="flex-1 space-y-6">
                            <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm space-y-6">
                                <h4 className="font-semibold text-slate-800 flex items-center gap-2 text-base border-b border-slate-100 pb-3">
                                    <Layout className="w-4 h-4 text-blue-600" /> Content
                                </h4>
                                <div className="space-y-6">
                                    {mainFields.length > 0 ? (
                                        mainFields.map(renderField)
                                    ) : (
                                        <div className="text-sm text-muted-foreground italic">No main content fields found.</div>
                                    )}
                                </div>
                            </div>
                        </div>

                        {/* Sidebar Area */}
                        {sidebarFields.length > 0 && (
                            <div className="w-full lg:w-96 space-y-6 shrink-0">
                                <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm space-y-6">
                                    <h4 className="font-semibold text-slate-800 flex items-center gap-2 text-base border-b border-slate-100 pb-3">
                                        <Settings className="w-4 h-4 text-blue-600" /> Settings
                                    </h4>
                                    <div className="space-y-6">
                                        {sidebarFields.map(renderField)}
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </form>
        </motion.div>
    );
};

export default GenericResourceEditor;
