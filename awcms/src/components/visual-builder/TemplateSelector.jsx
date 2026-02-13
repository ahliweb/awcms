/**
 * Template Selector Component
 * Modal for selecting page templates when creating or editing pages
 */

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Check, Layout, Sparkles, Loader2 } from 'lucide-react';
import { supabase } from '@/lib/customSupabaseClient';

const TemplateSelector = ({ open, onOpenChange, onSelect }) => {
    const [selectedTemplate, setSelectedTemplate] = useState(null);
    const [templates, setTemplates] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (open) {
            fetchTemplates();
        }
    }, [open]);

    const fetchTemplates = async () => {
        setLoading(true);
        try {
            const { data, error } = await supabase
                .from('templates')
                .select('*')
                .eq('is_active', true)
                .order('created_at', { ascending: false });

            if (error) throw error;
            setTemplates(data || []);
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
        if (selectedTemplate) {
            onSelect(selectedTemplate.data);
            onOpenChange(false);
            setSelectedTemplate(null);
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
                        Start with a pre-designed layout or build from scratch
                    </DialogDescription>
                </DialogHeader>

                {loading ? (
                    <div className="flex-1 flex items-center justify-center p-12">
                        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
                    </div>
                ) : (
                    <Tabs defaultValue="All" className="flex-1 flex flex-col overflow-hidden">
                        <div className="px-6 py-3 border-b bg-slate-50">
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
                        </div>

                        <div className="flex-1 overflow-auto p-6">
                            {categories.map(category => (
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
                            ))}
                        </div>
                    </Tabs>
                )}

                {/* Footer */}
                <div className="px-6 py-4 border-t bg-slate-50 flex items-center justify-between">
                    <p className="text-sm text-slate-500">
                        {selectedTemplate
                            ? `Selected: ${selectedTemplate.name}`
                            : 'Select a template to continue'
                        }
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
                            disabled={!selectedTemplate}
                            className="bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700"
                        >
                            <Sparkles className="w-4 h-4 mr-2" />
                            Use Template
                        </Button>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
};

export default TemplateSelector;
