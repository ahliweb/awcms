
import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/use-toast';
import { udm } from '@/lib/data/UnifiedDataManager';
import { supabase } from '@/lib/customSupabaseClient'; // Keep for slug check if needed, or use udm
import { ArrowLeft, Loader2, Lock } from 'lucide-react';
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
import ResourceSelect from '@/components/dashboard/ResourceSelect'; // Assuming this exists or works
// Missing imports fixed
// ...

const GenericResourceEditor = ({
    tableName,
    resourceName,
    fields,
    initialData,
    onClose,
    onSuccess,
    permissionPrefix,
    createPermission,
    omitCreatedBy = false
}) => {
    const { user } = useAuth();
    const { toast } = useToast();
    const { currentTenant } = useTenant(); // Get Current Tenant
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

    // Initialize form data
    useEffect(() => {
        if (initialData) {
            setFormData(initialData);
        }
    }, [initialData]); // Removed fields from dependency to prevent reset if fields config reference changes


    const handleSubmit = async (e) => {
        e.preventDefault();
        setLoading(true);
        try {
            // Remove joined relationship objects that shouldn't be sent to the DB using destructuring
            const { owner, tenant, category, ...cleanPayload } = formData;
            const payload = { ...cleanPayload };

            // ... slug logic

            // Auto fields
            payload.updated_at = new Date().toISOString();
            if (!initialData) {
                if (!omitCreatedBy) {
                    payload.created_by = user.id;
                }

                // CRITICAL: Inject Tenant ID for new records
                if (currentTenant?.id) {
                    payload.tenant_id = currentTenant.id;
                } else {
                    throw new Error("Critical Error: No Tenant Context found. Cannot create record.");
                }
            }

            // Handle tags only if there's a tags field defined
            const hasTagsField = fields.some(f => f.key === 'tags' || f.type === 'tags');
            if (hasTagsField) {
                if (Array.isArray(payload.tags)) {
                    // Already an array, keep as is
                } else if (typeof payload.tags === 'string' && payload.tags.trim()) {
                    payload.tags = payload.tags.split(',').map(t => t.trim()).filter(Boolean);
                } else {
                    // Empty or undefined - set to empty array
                    payload.tags = [];
                }
            } else {
                // Remove tags from payload if field doesn't exist in form
                delete payload.tags;
            }

            // Clean up empty date fields - convert "" to null for database
            fields.forEach(field => {
                if ((field.type === 'date' || field.key.includes('_at') || field.key.includes('_date')) && payload[field.key] === '') {
                    payload[field.key] = null;
                }
                // Also convert empty strings for relation fields to null
                if ((field.type === 'relation' || field.type === 'resource_select') && !payload[field.key]) {
                    payload[field.key] = null;
                }
                // Handle boolean fields - ensure they are true/false, not empty string
                if (field.type === 'boolean' || field.type === 'checkbox') {
                    payload[field.key] = Boolean(payload[field.key]);
                }
            });

            // Check for slug uniqueness before save (for tables that have slug)
            if (payload.slug && fields.find(f => f.key === 'slug')) {
                let slugCheckQuery = supabase
                    .from(tableName)
                    .select('id, slug')
                    .eq('slug', payload.slug)
                    .is('deleted_at', null);

                // If editing, exclude current item from check
                if (initialData?.id) {
                    slugCheckQuery = slugCheckQuery.neq('id', initialData.id);
                }

                const { data: existingSlugs } = await slugCheckQuery.limit(1);

                if (existingSlugs && existingSlugs.length > 0) {
                    // Generate a unique slug by appending timestamp
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
                // Provide friendlier error messages for common constraints
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

    // Helper function to generate slug
    const generateSlug = (text) => {
        return text
            .toLowerCase()
            .trim()
            .replace(/[^a-z0-9\s-]/g, '') // Remove special chars except spaces and hyphens
            .replace(/\s+/g, '-')          // Replace spaces with hyphens
            .replace(/-+/g, '-')           // Replace multiple hyphens with single hyphen
            .replace(/^-|-$/g, '');        // Trim hyphens from start/end
    };

    const handleChange = (key, value) => {
        setFormData(prev => {
            const updated = { ...prev, [key]: value };

            // Auto-generate slug when title or name changes
            const hasSlugField = fields.some(f => f.key === 'slug');
            if (hasSlugField && (key === 'title' || key === 'name')) {
                // Auto-generate if slug is empty or matches previous auto-generated slug
                const oldSlug = prev.slug || '';
                const oldTitle = prev.title || prev.name || '';
                const wasAutoGenerated = !oldSlug || oldSlug === generateSlug(oldTitle);

                if (wasAutoGenerated) {
                    updated.slug = generateSlug(value);
                }
            }

            // Handle calculated fields
            fields.forEach(field => {
                if (field.calculate && typeof field.calculate === 'function') {
                    // Pass the updated data to the calculation function
                    const calculatedValue = field.calculate(updated);
                    // Only update if the value actually changed to avoid unnecessary renders
                    if (calculatedValue !== updated[field.key]) {
                        updated[field.key] = calculatedValue;
                    }
                }
            });

            return updated;
        });
    };

    return (
        <div className="bg-card rounded-xl border border-border shadow-sm p-6 max-w-3xl mx-auto">
            <div className="flex items-center justify-between mb-6 pb-4 border-b border-border">
                <div className="flex items-center gap-4">
                    <Button variant="ghost" size="icon" onClick={onClose} className="hover:bg-muted text-muted-foreground hover:text-foreground">
                        <ArrowLeft className="w-4 h-4" />
                    </Button>
                    <div>
                        <h2 className="text-xl font-bold text-foreground">
                            {initialData ? `Edit ${resourceName}` : `Create New ${resourceName}`}
                        </h2>
                        {initialData && (
                            <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                                <Lock className="w-3 h-3" /> Owner: {initialData.owner?.full_name || 'System'}
                            </p>
                        )}
                    </div>
                </div>
            </div>

            <form onSubmit={handleSubmit} className="space-y-6">
                <div className="grid grid-cols-1 gap-6">
                    {fields.map(field => {
                        // Handle conditional visibility
                        if (field.conditionalShow && typeof field.conditionalShow === 'function' && !field.conditionalShow(formData)) {
                            return null;
                        }

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
                        )
                    })}
                </div>

                <div className="flex justify-end pt-4 border-t border-border">
                    <Button type="button" variant="outline" onClick={onClose} className="mr-2">Cancel</Button>
                    <Button type="submit" disabled={loading} className="bg-primary text-primary-foreground hover:bg-primary/90">
                        {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                        Save {resourceName}
                    </Button>
                </div>
            </form>
        </div>
    );
};

export default GenericResourceEditor;
