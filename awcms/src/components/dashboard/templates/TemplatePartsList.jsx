import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Edit, Trash2, MoreVertical, Puzzle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
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
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { usePermissions } from '@/contexts/PermissionContext';
import { useTemplates } from '@/hooks/useTemplates';

const TemplatePartsList = () => {
    const navigate = useNavigate();
    const { templateParts, loading, createPart, deletePart } = useTemplates();
    const [searchTerm, setSearchTerm] = useState('');
    const [partToDelete, setPartToDelete] = useState(null);
    const [isCreateOpen, setIsCreateOpen] = useState(false);
    const [newPartName, setNewPartName] = useState('');
    const [newPartType, setNewPartType] = useState('widget_area');
    const { hasPermission } = usePermissions();

    const handleCreate = async () => {
        if (!newPartName) return;

        try {
            const data = await createPart({
                name: newPartName,
                type: newPartType,
                is_active: true,
                content: { content: [], root: {} } // Empty puck content
            });
            setIsCreateOpen(false);
            setNewPartName('');
            setNewPartType('widget_area');

            // Navigate to Visual Editor with partId
            navigate(`/cmspanel/visual-editor?partId=${data.id}`);
        } catch (error) {
            console.error(error);
        }
    };

    const filteredParts = templateParts.filter(p =>
        p.name.toLowerCase().includes(searchTerm.toLowerCase())
    );

    const getIcon = (type) => {
        switch (type) {
            case 'header': return <div className="h-3 w-8 bg-indigo-200 border border-indigo-300 rounded-sm" />;
            case 'footer': return <div className="h-3 w-8 bg-slate-200 border border-slate-300 rounded-sm mt-auto" />;
            case 'sidebar': return <div className="h-8 w-3 bg-blue-200 border border-blue-300 rounded-sm" />;
            default: return <Puzzle className="w-5 h-5 text-slate-400" />;
        }
    };

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <div className="relative max-w-md w-full">
                    <Input
                        placeholder="Search parts..."
                        value={searchTerm}
                        onChange={e => setSearchTerm(e.target.value)}
                    />
                </div>

                {hasPermission('tenant.setting.update') && (
                    <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
                        <DialogTrigger asChild>
                            <Button className="bg-indigo-600 hover:bg-indigo-700">
                                <Plus className="w-4 h-4 mr-2" /> New Part
                            </Button>
                        </DialogTrigger>
                        <DialogContent>
                            <DialogHeader>
                                <DialogTitle>Create Template Part</DialogTitle>
                                <DialogDescription>
                                    Create a reusable header, footer, or sidebar.
                                </DialogDescription>
                            </DialogHeader>
                            <div className="grid gap-4 py-4">
                                <div className="grid grid-cols-4 items-center gap-4">
                                    <Label htmlFor="name" className="text-right">Name</Label>
                                    <Input id="name" value={newPartName} onChange={e => setNewPartName(e.target.value)} className="col-span-3" />
                                </div>
                                <div className="grid grid-cols-4 items-center gap-4">
                                    <Label htmlFor="type" className="text-right">Type</Label>
                                    <Select value={newPartType} onValueChange={setNewPartType}>
                                        <SelectTrigger className="col-span-3">
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="header">Header</SelectItem>
                                            <SelectItem value="footer">Footer</SelectItem>
                                            <SelectItem value="sidebar">Sidebar</SelectItem>
                                            <SelectItem value="widget_area">Widget Area</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                            </div>
                            <DialogFooter>
                                <Button onClick={handleCreate}>Create</Button>
                            </DialogFooter>
                        </DialogContent>
                    </Dialog>
                )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {loading ? (
                    <div className="col-span-full text-center text-slate-500">Loading parts...</div>
                ) : filteredParts.length === 0 ? (
                    <div className="col-span-full text-center py-20 border border-dashed rounded-lg bg-slate-50 text-slate-500">
                        No template parts found. Create one to get started.
                    </div>
                ) : (
                    filteredParts.map(part => (
                        <div key={part.id} className="bg-white p-4 rounded-lg border border-slate-200 flex items-center justify-between hover:shadow-sm transition-shadow">
                            <div className="flex items-center gap-4">
                                <div className="h-12 w-12 bg-slate-100 rounded-md flex items-center justify-center">
                                    {getIcon(part.type)}
                                </div>
                                <div>
                                    <h4 className="font-medium text-slate-900">{part.name}</h4>
                                    <span className="text-xs text-slate-500 uppercase tracking-wider">{part.type}</span>
                                </div>
                            </div>

                            <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                    <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                                        <MoreVertical className="w-4 h-4 text-slate-400" />
                                    </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                    <DropdownMenuItem onClick={() => navigate(`/cmspanel/visual-editor?partId=${part.id}`)}>
                                        <Edit className="w-4 h-4 mr-2" /> Edit Content
                                    </DropdownMenuItem>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem onClick={() => setPartToDelete(part.id)} className="text-red-600">
                                        <Trash2 className="w-4 h-4 mr-2" /> Delete
                                    </DropdownMenuItem>
                                </DropdownMenuContent>
                            </DropdownMenu>
                        </div>
                    ))
                )}
            </div>

            <AlertDialog open={!!partToDelete} onOpenChange={(open) => !open && setPartToDelete(null)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Delete Part?</AlertDialogTitle>
                        <AlertDialogDescription>This action cannot be undone.</AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={() => { deletePart(partToDelete); setPartToDelete(null); }} className="bg-red-600">Delete</AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
};

export default TemplatePartsList;
