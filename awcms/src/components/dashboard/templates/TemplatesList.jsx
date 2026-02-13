import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { LayoutTemplate, Plus, Edit, Trash2, Copy, Search, MoreVertical } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { usePermissions } from '@/contexts/PermissionContext';
import { useTemplates } from '@/hooks/useTemplates';

const TemplatesList = () => {
    const navigate = useNavigate();
    const { templates, loading, createTemplate, deleteTemplate, duplicateTemplate } = useTemplates();
    const [searchTerm, setSearchTerm] = useState('');
    const [templateToDelete, setTemplateToDelete] = useState(null);
    const { hasPermission } = usePermissions();

    const handleCreate = async () => {
        const fallbackId = crypto.randomUUID();
        const defaultTemplate = {
            id: fallbackId,
            name: "New Template",
            slug: "template-" + Date.now(),
            description: "A new blank template.",
            is_active: true,
            type: 'page',
            parts: {},
            data: {
                content: [],
                root: { props: { title: 'New Template' } }
            }
        };

        try {
            const newTemplateData = await createTemplate(defaultTemplate);
            // Navigate to Visual Editor
            navigate(`/cmspanel/visual-editor?templateId=${newTemplateData?.id || fallbackId}`);
        } catch (error) {
            console.error("Failed to create template", error);
        }
    };

    const filteredTemplates = templates.filter(t =>
        t.name.toLowerCase().includes(searchTerm.toLowerCase())
    );

    return (
        <div className="space-y-6">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <div className="relative max-w-md w-full">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <Input
                        placeholder="Search templates..."
                        className="pl-9"
                        value={searchTerm}
                        onChange={e => setSearchTerm(e.target.value)}
                    />
                </div>

                {hasPermission('tenant.setting.update') && (
                    <Button onClick={handleCreate} className="bg-indigo-600 hover:bg-indigo-700 w-full sm:w-auto">
                        <Plus className="w-4 h-4 mr-2" /> New Template
                    </Button>
                )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                {loading ? (
                    [...Array(4)].map((_, i) => (
                        <div key={i} className="h-48 bg-slate-100 rounded-xl animate-pulse"></div>
                    ))
                ) : filteredTemplates.length === 0 ? (
                    <div className="col-span-full py-20 text-center text-slate-500 bg-white rounded-xl border border-dashed border-slate-300">
                        <LayoutTemplate className="w-12 h-12 mx-auto mb-4 opacity-20" />
                        <p>No templates found.</p>
                    </div>
                ) : (
                    filteredTemplates.map(template => (
                        <div key={template.id} className="group bg-white rounded-xl border border-slate-200 hover:border-slate-300 hover:shadow-lg transition-all duration-200 overflow-hidden flex flex-col">
                            <div className="h-32 bg-slate-50 border-b border-slate-100 flex items-center justify-center relative">
                                {template.thumbnail ? (
                                    <img src={template.thumbnail} alt={template.name} className="w-full h-full object-cover" />
                                ) : (
                                    <LayoutTemplate className="w-10 h-10 text-slate-300" />
                                )}
                                <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                    <Button size="icon" variant="secondary" className="h-8 w-8 rounded-full shadow-sm" onClick={() => navigate(`/cmspanel/visual-editor?templateId=${template.id}`)}>
                                        <Edit className="w-4 h-4 text-slate-700" />
                                    </Button>
                                </div>
                            </div>

                            <div className="p-4 flex-1 flex flex-col">
                                <div className="flex justify-between items-start mb-2">
                                    <div>
                                        <h3 className="font-semibold text-slate-900 truncate pr-2" title={template.name}>{template.name}</h3>
                                        <div className="flex items-center gap-2 mt-1">
                                            <span className="text-xs bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded capitalize">{template.type || 'page'}</span>
                                            {template.is_active && <span className="text-xs bg-green-100 text-green-600 px-1.5 py-0.5 rounded">Active</span>}
                                        </div>
                                    </div>

                                    <DropdownMenu>
                                        <DropdownMenuTrigger asChild>
                                            <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                                                <MoreVertical className="w-4 h-4 text-slate-400" />
                                            </Button>
                                        </DropdownMenuTrigger>
                                        <DropdownMenuContent align="end">
                                            <DropdownMenuLabel>Actions</DropdownMenuLabel>
                                            <DropdownMenuSeparator />
                                            <DropdownMenuItem onClick={() => duplicateTemplate(template)}>
                                                <Copy className="w-4 h-4 mr-2" /> Duplicate
                                            </DropdownMenuItem>
                                            <DropdownMenuSeparator />
                                            <DropdownMenuItem
                                                onClick={() => setTemplateToDelete(template.id)}
                                                className="text-red-600 focus:text-red-700 focus:bg-red-50"
                                            >
                                                <Trash2 className="w-4 h-4 mr-2" /> Delete
                                            </DropdownMenuItem>
                                        </DropdownMenuContent>
                                    </DropdownMenu>
                                </div>
                            </div>
                        </div>
                    ))
                )}
            </div>

            <AlertDialog open={!!templateToDelete} onOpenChange={(open) => !open && setTemplateToDelete(null)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Delete Template?</AlertDialogTitle>
                        <AlertDialogDescription>
                            This will move the template to trash.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={() => { deleteTemplate(templateToDelete); setTemplateToDelete(null); }} className="bg-red-600 hover:bg-red-700">Delete</AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
};

export default TemplatesList;
