import { useState } from 'react';
// import { useTranslation } from 'react-i18next';
import { Plus, Search, Trash2, Save } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from '@/components/ui/label';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { useTemplates } from '@/hooks/useTemplates';

const TemplateLanguageManager = () => {
    const { templateStrings, updateTemplateString, deleteTemplateString } = useTemplates();
    const [searchQuery, setSearchQuery] = useState('');
    const [isAddOpen, setIsAddOpen] = useState(false);

    // Filters
    const filteredStrings = templateStrings.filter(s =>
        s.key.toLowerCase().includes(searchQuery.toLowerCase()) ||
        s.value?.toLowerCase().includes(searchQuery.toLowerCase())
    );

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <div>
                    <h3 className="text-lg font-medium">Template Translations</h3>
                    <p className="text-sm text-muted-foreground">Manage text strings used in templates.</p>
                </div>
                <div className="flex gap-2">
                    <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
                        <DialogTrigger asChild>
                            <Button>
                                <Plus className="w-4 h-4 mr-2" /> Add Translation
                            </Button>
                        </DialogTrigger>
                        <DialogContent>
                            <AddTranslationForm onClose={() => setIsAddOpen(false)} onSave={updateTemplateString} />
                        </DialogContent>
                    </Dialog>
                </div>
            </div>

            <div className="flex items-center gap-2">
                <div className="relative flex-1 max-w-sm">
                    <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input
                        placeholder="Search keys..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="pl-8"
                    />
                </div>
            </div>

            <div className="border rounded-md">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>Key</TableHead>
                            <TableHead>Locale</TableHead>
                            <TableHead>Value</TableHead>
                            <TableHead className="w-[100px]">Actions</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {filteredStrings.length === 0 ? (
                            <TableRow>
                                <TableCell colSpan={4} className="text-center py-8 text-muted-foreground">
                                    No translations found.
                                </TableCell>
                            </TableRow>
                        ) : (
                            filteredStrings.map((item) => (
                                <TranslationRow
                                    key={item.id}
                                    item={item}
                                    onUpdate={updateTemplateString}
                                    onDelete={deleteTemplateString}
                                />
                            ))
                        )}
                    </TableBody>
                </Table>
            </div>
        </div>
    );
};

const TranslationRow = ({ item, onUpdate, onDelete }) => {
    const [isEditing, setIsEditing] = useState(false);
    const [value, setValue] = useState(item.value || '');

    const handleSave = async () => {
        await onUpdate(item.id, { value });
        setIsEditing(false);
    };

    return (
        <TableRow>
            <TableCell className="font-mono text-xs">{item.key}</TableCell>
            <TableCell>
                <span className={`px-2 py-1 rounded text-xs font-medium ${item.locale === 'en' ? 'bg-blue-100 text-blue-800' : 'bg-green-100 text-green-800'}`}>
                    {item.locale?.toUpperCase()}
                </span>
            </TableCell>
            <TableCell>
                {isEditing ? (
                    <div className="flex gap-2">
                        <Input
                            value={value}
                            onChange={e => setValue(e.target.value)}
                            className="h-8"
                        />
                        <Button size="sm" onClick={handleSave}><Save className="w-4 h-4" /></Button>
                    </div>
                ) : (
                    <div className="cursor-pointer hover:bg-slate-50 p-1 rounded" onClick={() => setIsEditing(true)}>
                        {item.value || <span className="text-muted-foreground italic">Empty</span>}
                    </div>
                )}
            </TableCell>
            <TableCell>
                <Button variant="ghost" size="sm" className="text-red-500 hover:text-red-700" onClick={() => onDelete(item.id)}>
                    <Trash2 className="w-4 h-4" />
                </Button>
            </TableCell>
        </TableRow>
    );
};

const AddTranslationForm = ({ onClose, onSave }) => {
    const [key, setKey] = useState('');
    const [locale, setLocale] = useState('en');
    const [value, setValue] = useState('');

    const handleSubmit = async (e) => {
        e.preventDefault();
        await onSave('new', { key, locale, value });
        onClose();
    };

    return (
        <form onSubmit={handleSubmit} className="space-y-4">
            <DialogHeader>
                <DialogTitle>Add Translation</DialogTitle>
            </DialogHeader>
            <div className="space-y-2">
                <Label>Key</Label>
                <Input
                    placeholder="e.g., home.welcome_message"
                    value={key}
                    onChange={e => setKey(e.target.value)}
                    required
                />
            </div>
            <div className="space-y-2">
                <Label>Locale</Label>
                <Select value={locale} onValueChange={setLocale}>
                    <SelectTrigger>
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="en">English (en)</SelectItem>
                        <SelectItem value="id">Indonesian (id)</SelectItem>
                    </SelectContent>
                </Select>
            </div>
            <div className="space-y-2">
                <Label>Value</Label>
                <Input
                    placeholder="Translated text..."
                    value={value}
                    onChange={e => setValue(e.target.value)}
                    required
                />
            </div>
            <div className="pt-4 flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
                <Button type="submit">Save</Button>
            </div>
        </form>
    );
};

export default TemplateLanguageManager;
