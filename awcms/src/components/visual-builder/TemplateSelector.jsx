/**
 * Template Selector Component
 * Modal for selecting page templates when creating or editing pages
 */

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Check, Layout, Sparkles, Loader2, Blocks } from 'lucide-react';
import { supabase } from '@/lib/customSupabaseClient';

const TemplateSelector = ({ open, onOpenChange, onSelect }) => {
    const [selectedTemplate, setSelectedTemplate] = useState(null);
    const [selectedSection, setSelectedSection] = useState(null);
    const [templates, setTemplates] = useState([]);
    const [sections, setSections] = useState([]);
    const [activeSource, setActiveSource] = useState('templates');
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (open) {
            fetchTemplates();
        }
    }, [open]);

    const fetchTemplates = async () => {
        setLoading(true);
        try {
            const [{ data: templateData, error: templateError }, { data: sectionData, error: sectionError }] = await Promise.all([
                supabase
                    .from('templates')
                    .select('*')
                    .eq('is_active', true)
                    .order('created_at', { ascending: false }),
                supabase
                    .from('reusable_sections')
                    .select('*')
                    .eq('status', 'active')
                    .is('deleted_at', null)
                    .order('updated_at', { ascending: false }),
            ]);

            if (templateError) throw templateError;
            if (sectionError) throw sectionError;

            const referenceIds = (sectionData || [])
                .filter((section) => section.section_mode === 'template_part_reference' && section.template_part_id)
                .map((section) => section.template_part_id);

            let partMap = new Map();
            if (referenceIds.length > 0) {
                const { data: partRows, error: partError } = await supabase
                    .from('template_parts')
                    .select('id, content')
                    .in('id', referenceIds);

                if (partError) throw partError;
                partMap = new Map((partRows || []).map((part) => [part.id, part.content]));
            }

            setTemplates(templateData || []);
            setSections((sectionData || []).map((section) => ({
                ...section,
                resolved_content: section.section_mode === 'template_part_reference'
                    ? partMap.get(section.template_part_id) || section.content || { content: [], root: {} }
                    : section.content || { content: [], root: {} },
            })));
        } catch (error) {
            console.error('Error fetching templates:', error);
            // Fallback to empty or show error
        } finally {
            setLoading(false);
        }
    };

    // Get unique categories
    const categories = ['All', ...new Set(templates.map(t => t.category || 'General'))];

    const handleSelect = () => {
        if (activeSource === 'templates' && selectedTemplate) {
            onSelect(selectedTemplate.data);
            onOpenChange(false);
            setSelectedTemplate(null);
            setSelectedSection(null);
        }

        if (activeSource === 'sections' && selectedSection) {
            onSelect(selectedSection.resolved_content);
            onOpenChange(false);
            setSelectedTemplate(null);
            setSelectedSection(null);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-4xl max-h-[85vh] flex flex-col p-0">
                <DialogHeader className="px-6 py-4 border-b bg-gradient-to-r from-blue-600 to-purple-600">
                    <DialogTitle className="text-white flex items-center gap-2">
                        <Layout className="w-5 h-5" />
                        Choose a Template
                    </DialogTitle>
                    <DialogDescription className="text-blue-100">
                        Apply a pre-designed layout or insert a reusable section into the current visual canvas
                    </DialogDescription>
                </DialogHeader>

                {loading ? (
                    <div className="flex-1 flex items-center justify-center p-12">
                        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
                    </div>
                ) : (
                    <Tabs defaultValue="All" className="flex-1 flex flex-col overflow-hidden">
                        <div className="px-6 py-3 border-b bg-slate-50 space-y-3">
                            <div className="inline-flex rounded-xl border border-slate-200 bg-white p-1 shadow-sm">
                                <Button type="button" variant={activeSource === 'templates' ? 'default' : 'ghost'} size="sm" className="rounded-lg" onClick={() => setActiveSource('templates')}>
                                    <Layout className="mr-2 h-4 w-4" /> Templates
                                </Button>
                                <Button type="button" variant={activeSource === 'sections' ? 'default' : 'ghost'} size="sm" className="rounded-lg" onClick={() => setActiveSource('sections')}>
                                    <Blocks className="mr-2 h-4 w-4" /> Reusable Sections
                                </Button>
                            </div>

                            {activeSource === 'templates' ? (
                                <TabsList className="bg-white shadow-sm flex-wrap w-full md:w-auto h-auto">
                                    {categories.map(category => (
                                        <TabsTrigger
                                            key={category}
                                            value={category}
                                            className="px-4"
                                        >
                                            {category}
                                        </TabsTrigger>
                                    ))}
                                </TabsList>
                            ) : null}
                        </div>

                        <div className="flex-1 overflow-auto p-6">
                            {activeSource === 'templates' ? categories.map(category => (
                                <TabsContent key={category} value={category} className="m-0">
                                    <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                                        {templates
                                            .filter(t => category === 'All' || (t.category || 'General') === category)
                                            .map(template => (
                                                <motion.div
                                                    key={template.id}
                                                    whileHover={{ scale: 1.02 }}
                                                    whileTap={{ scale: 0.98 }}
                                                    className={`
                          relative cursor-pointer rounded-xl border-2 p-4 transition-all
                          ${selectedTemplate?.id === template.id
                                                            ? 'border-blue-500 bg-blue-50 shadow-lg'
                                                            : 'border-slate-200 hover:border-slate-300 hover:shadow-md bg-white'}
                        `}
                                                    onClick={() => setSelectedTemplate(template)}
                                                >
                                                    {/* Selected indicator */}
                                                    {selectedTemplate?.id === template.id && (
                                                        <div className="absolute top-2 right-2 w-6 h-6 rounded-full bg-blue-500 flex items-center justify-center">
                                                            <Check className="w-4 h-4 text-white" />
                                                        </div>
                                                    )}

                                                    {/* Template icon/thumbnail */}
                                                    <div className="text-4xl mb-3 flex items-center justify-center h-20 bg-slate-50 rounded">
                                                        {template.thumbnail ? (
                                                            <img src={template.thumbnail} alt={template.name} className="w-full h-full object-cover rounded" />
                                                        ) : (
                                                            <Layout className="w-8 h-8 text-slate-300" />
                                                        )}
                                                    </div>

                                                    {/* Template info */}
                                                    <h3 className="font-semibold text-slate-800 mb-1 truncate">
                                                        {template.name}
                                                    </h3>
                                                    <p className="text-sm text-slate-500 line-clamp-2">
                                                        {template.description || 'No description'}
                                                    </p>

                                                    {/* Category badge */}
                                                    <div className="mt-3">
                                                        <span className="inline-block px-2 py-0.5 text-xs font-medium rounded-full bg-slate-100 text-slate-600">
                                                            {template.category || 'General'}
                                                        </span>
                                                    </div>
                                                </motion.div>
                                            ))}
                                    </div>
                                </TabsContent>
                            )) : (
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    {sections.map(section => (
                                        <motion.div
                                            key={section.id}
                                            whileHover={{ scale: 1.02 }}
                                            whileTap={{ scale: 0.98 }}
                                            className={`relative cursor-pointer rounded-xl border-2 p-4 transition-all ${selectedSection?.id === section.id
                                                ? 'border-blue-500 bg-blue-50 shadow-lg'
                                                : 'border-slate-200 hover:border-slate-300 hover:shadow-md bg-white'}`}
                                            onClick={() => setSelectedSection(section)}
                                        >
                                            {selectedSection?.id === section.id && (
                                                <div className="absolute top-2 right-2 w-6 h-6 rounded-full bg-blue-500 flex items-center justify-center">
                                                    <Check className="w-4 h-4 text-white" />
                                                </div>
                                            )}

                                            <div className="text-4xl mb-3 flex items-center justify-center h-20 bg-slate-50 rounded">
                                                <Blocks className="w-8 h-8 text-slate-300" />
                                            </div>

                                            <h3 className="font-semibold text-slate-800 mb-1 truncate">{section.name}</h3>
                                            <p className="text-sm text-slate-500 line-clamp-2">{section.description || 'Reusable section'}</p>
                                            <div className="mt-3 flex flex-wrap gap-2">
                                                <span className="inline-block px-2 py-0.5 text-xs font-medium rounded-full bg-slate-100 text-slate-600">{section.section_mode}</span>
                                                <span className="inline-block px-2 py-0.5 text-xs font-medium rounded-full bg-slate-100 text-slate-600">{section.owner_tenant_id ? 'Tenant' : 'Platform'}</span>
                                            </div>
                                        </motion.div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </Tabs>
                )}

                {/* Footer */}
                    <div className="px-6 py-4 border-t bg-slate-50 flex items-center justify-between">
                        <p className="text-sm text-slate-500">
                            {activeSource === 'templates'
                                ? (selectedTemplate ? `Selected: ${selectedTemplate.name}` : 'Select a template to continue')
                                : (selectedSection ? `Selected: ${selectedSection.name}` : 'Select a reusable section to insert')}
                        </p>
                    <div className="flex gap-3">
                        <Button
                            variant="outline"
                            onClick={() => onOpenChange(false)}
                        >
                            Cancel
                        </Button>
                        <Button
                            onClick={handleSelect}
                            disabled={activeSource === 'templates' ? !selectedTemplate : !selectedSection}
                            className="bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700"
                        >
                            <Sparkles className="w-4 h-4 mr-2" />
                            {activeSource === 'templates' ? 'Use Template' : 'Insert Section'}
                        </Button>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
};

export default TemplateSelector;
