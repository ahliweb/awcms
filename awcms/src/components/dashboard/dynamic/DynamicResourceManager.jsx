import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '@/lib/customSupabaseClient';
import AdminPageLayout from '@/templates/flowbite-admin/layouts/AdminPageLayout';
import { PageHeader } from '@/templates/flowbite-admin';
import SchemaForm from './SchemaForm';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import * as Icons from 'lucide-react';

const DynamicResourceManager = () => {
    const { resourceKey } = useParams();
    const [resource, setResource] = useState(null);
    const [schema, setSchema] = useState(null);
    const [data, setData] = useState({});
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState(null);
    const [success, setSuccess] = useState(null);

    const fetchResourceAndSchema = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            // 1. Fetch Resource Definition
            const { data: resData, error: resError } = await supabase
                .from('resources_registry')
                .select('*')
                .eq('key', resourceKey)
                .single();

            if (resError) throw new Error(`Resource '${resourceKey}' not found: ${resError.message}`);
            setResource(resData);

            // 2. Fetch UI Schema (default form)
            const { data: schemaData, error: schemaError } = await supabase
                .from('ui_configs')
                .select('schema')
                .eq('resource_key', resourceKey)
                .eq('type', 'form')
                .limit(1)
                .maybeSingle();

            if (schemaError) console.warn('Schema fetch error:', schemaError);

            if (schemaData) {
                setSchema(schemaData.schema);
            } else {
                // Fallback or empty schema
                setSchema({ fields: [] });
            }

            // 3. Fetch Data (Strategy depends on resource type)
            if (resData.type === 'settings') {
                const { data: settingsData } = await supabase
                    .from('settings')
                    .select('value')
                    .eq('key', resourceKey)
                    .maybeSingle();

                if (settingsData?.value) {
                    setData(settingsData.value);
                }
            } else {
                // For entities, we might show a table first, but if this is an 'edit' route...
                // For now, let's assume this Dynamic Manager handles 'settings' primarily.
            }

        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    }, [resourceKey]);

    useEffect(() => {
        fetchResourceAndSchema();
    }, [fetchResourceAndSchema]);

    const handleSave = async (formData) => {
        setSaving(true);
        setSuccess(null);
        setError(null);

        try {
            if (resource.type === 'settings') {
                const { error: saveError } = await supabase
                    .from('settings')
                    .upsert({
                        key: resourceKey,
                        value: formData,
                        group: resourceKey, // often the group is same as key for simple modules
                        updated_at: new Date()
                    });

                if (saveError) throw saveError;
                setSuccess('Settings saved successfully!');
            } else {
                throw new Error('Saving non-settings resources not yet implemented in generic handler');
            }
        } catch (err) {
            setError('Failed to save: ' + err.message);
        } finally {
            setSaving(false);
        }
    };

    if (loading) {
        return (
            <AdminPageLayout>
                <div className="flex justify-center p-12">
                    <Icons.Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
            </AdminPageLayout>
        );
    }

    if (error && !resource) {
        return (
            <AdminPageLayout>
                <Alert variant="destructive">
                    <AlertTitle>Failed to load resource</AlertTitle>
                    <AlertDescription>{error}</AlertDescription>
                </Alert>
            </AdminPageLayout>
        );
    }

    // Dynamic Icon
    const IconComponent = Icons[resource?.icon] || Icons.Box;
    const permissionPrefix = resource?.permission_prefix || `${resource.scope}.${resource.key}`;

    return (
        <AdminPageLayout requiredPermission={`${permissionPrefix}.read`}>
            <PageHeader
                title={resource.label}
                description={`Manage ${resource.label}`}
                icon={IconComponent}
                breadcrumbs={[{ label: resource.label, icon: IconComponent }]}
            />

            {error && (
                <div className="mb-4">
                    <Alert variant="destructive">
                        <AlertTitle>Action failed</AlertTitle>
                        <AlertDescription>{error}</AlertDescription>
                    </Alert>
                </div>
            )}
            {success && (
                <div className="mb-4">
                    <Alert className="border-emerald-200 bg-emerald-50 text-emerald-700">
                        <AlertTitle>Saved</AlertTitle>
                        <AlertDescription>{success}</AlertDescription>
                    </Alert>
                </div>
            )}

            {schema && schema.fields?.length > 0 ? (
                <SchemaForm
                    schema={schema}
                    initialData={data}
                    onSubmit={handleSave}
                    loading={saving}
                />
            ) : (
                <Alert className="border-amber-200 bg-amber-50 text-amber-700">
                    <AlertTitle>Schema missing</AlertTitle>
                    <AlertDescription>
                        No UI Schema defined for this resource. Please ask an admin to configure the <code>ui_configs</code> table.
                    </AlertDescription>
                </Alert>
            )}
        </AdminPageLayout>
    );
};

export default DynamicResourceManager;
