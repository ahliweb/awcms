import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/customSupabaseClient';
import { useToast } from '@/components/ui/use-toast';

export const useTemplates = () => {
    const { toast } = useToast();
    const [templates, setTemplates] = useState([]);
    const [templateParts, setTemplateParts] = useState([]);
    const [assignments, setAssignments] = useState([]);
    const [templateStrings, setTemplateStrings] = useState([]);
    const [loading, setLoading] = useState(true);

    const fetchData = useCallback(async () => {
        setLoading(true);
        try {
            // Fetch templates
            const { data: templatesData, error: templatesError } = await supabase
                .from('templates')
                .select('*')
                .order('is_active', { ascending: false })
                .order('created_at', { ascending: false })
                .is('deleted_at', null);

            if (templatesError) throw templatesError;

            // Fetch template parts
            const { data: partsData, error: partsError } = await supabase
                .from('template_parts')
                .select('*')
                .order('created_at', { ascending: false })
                .is('deleted_at', null);

            if (partsError) throw partsError;

            // Fetch template assignments
            const { data: assignmentsData, error: assignmentsError } = await supabase
                .from('template_assignments')
                .select('route_type, template_id, channel')
                .order('created_at', { ascending: false });

            if (assignmentsError) throw assignmentsError;

            // Fetch template strings
            const { data: stringsData, error: stringsError } = await supabase
                .from('template_strings')
                .select('*')
                .is('deleted_at', null)
                .order('key', { ascending: true });

            if (stringsError && stringsError.code !== '42P01') {
                console.warn("Error fetching template strings:", stringsError);
            }

            setTemplates(templatesData || []);
            setTemplateParts(partsData || []);
            setTemplateStrings(stringsData || []);
            setAssignments(assignmentsData || []);

        } catch (error) {
            console.error("Error fetching all data:", error);
            toast({ title: 'Error', description: 'Failed to fetch data', variant: 'destructive' });
        } finally {
            setLoading(false);
        }
    }, [toast]);

    // --- Template CRUD ---

    const createTemplate = async (templateData) => {
        try {
            const { data, error } = await supabase
                .from('templates')
                .insert([templateData])
                .select()
                .single();

            if (error) throw error;
            toast({ title: "Success", description: "Template created successfully." });
            fetchData();
            return data;
        } catch (error) {
            toast({ title: "Error", description: error.message, variant: "destructive" });
            throw error;
        }
    };

    const updateTemplate = async (id, updates) => {
        try {
            const { error } = await supabase
                .from('templates')
                .update(updates)
                .eq('id', id);

            if (error) throw error;
            toast({ title: "Success", description: "Template updated successfully." });
            fetchData();
        } catch (error) {
            toast({ title: "Error", description: error.message, variant: "destructive" });
            throw error;
        }
    };

    const deleteTemplate = async (id) => {
        try {
            const { error } = await supabase
                .from('templates')
                .update({ deleted_at: new Date().toISOString() })
                .eq('id', id);

            if (error) throw error;
            toast({ title: "Deleted", description: "Template removed." });
            fetchData();
        } catch (error) {
            toast({ title: "Error", description: error.message, variant: "destructive" });
        }
    };

    const duplicateTemplate = async (template) => {
        try {
            const { id, created_at, updated_at, ...rest } = template;
            const newTemplate = {
                ...rest,
                name: `${template.name} (Copy)`,
                slug: `${template.slug}-copy-${Date.now()}`,
                tenant_id: undefined // Let DB/RLS handle it or ensure it's copied if needed
            };

            const { error } = await supabase.from('templates').insert([newTemplate]);
            if (error) throw error;

            toast({ title: "Success", description: "Template duplicated." });
            fetchData();
        } catch (error) {
            toast({ title: "Error", description: error.message, variant: "destructive" });
        }
    };

    // --- Part CRUD ---

    const createTemplatePart = async (partData) => {
        try {
            const { data, error } = await supabase
                .from('template_parts')
                .insert([partData])
                .select()
                .single();

            if (error) throw error;
            toast({ title: "Success", description: "Part created." });
            fetchData();
            return data;
        } catch (error) {
            toast({ title: "Error", description: error.message, variant: "destructive" });
            throw error;
        }
    };

    const updateTemplatePart = async (id, updates) => {
        try {
            const { error } = await supabase
                .from('template_parts')
                .update(updates)
                .eq('id', id);

            if (error) throw error;
            toast({ title: "Success", description: "Part updated successfully." });
            fetchData();
        } catch (error) {
            toast({ title: "Error", description: error.message, variant: "destructive" });
            throw error;
        }
    };

    const deleteTemplatePart = async (id) => {
        try {
            const { error } = await supabase
                .from('template_parts')
                .update({ deleted_at: new Date().toISOString() })
                .eq('id', id);

            if (error) throw error;
            toast({ title: "Deleted", description: "Part removed." });
            fetchData();
        } catch (error) {
            toast({ title: "Error", description: error.message, variant: "destructive" });
        }
    };

    // --- Assignment CRUD ---

    const updateAssignment = async (type, templateId, channel = 'web') => {
        try {
            const { error } = await supabase
                .from('template_assignments')
                .upsert({
                    route_type: type,
                    template_id: templateId,
                    channel: channel,
                    updated_at: new Date().toISOString()
                }, { onConflict: 'tenant_id, channel, route_type' }); // Ensure DB constraint matches

            if (error) throw error;
            // Optimistic update
            setAssignments(prev => {
                const filtered = prev.filter(a => !(a.route_type === type && a.channel === channel));
                return [...filtered, { route_type: type, template_id: templateId, channel }];
            });
            // Background refresh
            fetchData();
            toast({ title: "Success", description: "Assignment updated" });
        } catch (error) {
            console.error("Error updating assignment:", error);
            toast({ title: "Error", description: "Failed to update assignment", variant: "destructive" });
        }
    };

    // --- Template String CRUD ---

    const updateTemplateString = async (stringId, updates) => {
        try {
            // If ID is 'new', it's an insert
            if (stringId === 'new') {
                const context = updates.context || 'default';
                const { data: existingRow, error: existingError } = await supabase
                    .from('template_strings')
                    .select('id')
                    .eq('key', updates.key)
                    .eq('locale', updates.locale)
                    .eq('context', context)
                    .maybeSingle();

                if (existingError) throw existingError;

                if (existingRow) {
                    const { error } = await supabase
                        .from('template_strings')
                        .update({ ...updates, context, deleted_at: null })
                        .eq('id', existingRow.id);
                    if (error) throw error;
                } else {
                    const { error } = await supabase
                        .from('template_strings')
                        .insert([{ ...updates, context, deleted_at: null }]);
                    if (error) throw error;
                }
            } else {
                const { error } = await supabase
                    .from('template_strings')
                    .update({ ...updates, deleted_at: null })
                    .eq('id', stringId);
                if (error) throw error;
            }
            await fetchData();
            toast({ title: "Saved", description: "Translation saved." });
            return true;
        } catch (error) {
            toast({ title: "Error", description: error.message, variant: "destructive" });
            return false;
        }
    };

    const deleteTemplateString = async (id) => {
        try {
            const { error } = await supabase
                .from('template_strings')
                .update({ deleted_at: new Date().toISOString() })
                .eq('id', id);

            if (error) throw error;
            await fetchData();
            toast({ title: "Deleted", description: "Translation removed." });
        } catch (error) {
            toast({ title: "Error", description: error.message, variant: "destructive" });
        }
    };


    useEffect(() => {
        fetchData();
    }, [fetchData]);

    return {
        templates,
        templateParts,
        assignments,
        templateStrings,
        loading,
        createTemplate,
        updateTemplate,
        deleteTemplate,
        duplicateTemplate,
        createTemplatePart,
        updateTemplatePart,
        deleteTemplatePart,
        updateAssignment,
        updateTemplateString,
        deleteTemplateString,
        refresh: fetchData
    };
};
