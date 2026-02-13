import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTemplates } from '@/hooks/useTemplates';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { ArrowLeft, Save, Paintbrush } from 'lucide-react';

const PART_TYPES = [
    { value: 'header', label: 'Header' },
    { value: 'footer', label: 'Footer' },
    { value: 'sidebar', label: 'Sidebar' },
    { value: 'widget_area', label: 'Widget Area' },
];

const TemplatePartEditor = () => {
    const { id } = useParams();
    const navigate = useNavigate();
    const { templateParts, updateTemplatePart, loading } = useTemplates();

    const [formData, setFormData] = useState({
        name: '',
        type: 'header',
    });

    // Load part data
    useEffect(() => {
        if (templateParts.length > 0 && id) {
            const part = templateParts.find(p => p.id === id);
            if (part) {
                // eslint-disable-next-line react-hooks/set-state-in-effect
                setFormData({
                    name: part.name || '',
                    type: part.type || 'header',
                });
            }
        }
    }, [templateParts, id]);

    const handleChange = (field, value) => {
        setFormData(prev => ({ ...prev, [field]: value }));
    };

    const handleSave = async () => {
        await updateTemplatePart(id, formData);
        navigate('/cmspanel/templates');
    };

    if (loading) return <div className="p-6">Loading...</div>;

    return (
        <div className="p-6 max-w-2xl mx-auto space-y-8">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                    <Button variant="ghost" onClick={() => navigate('/cmspanel/templates')}>
                        <ArrowLeft className="w-4 h-4 mr-2" /> Back
                    </Button>
                    <h1 className="text-2xl font-bold">Edit Template Part</h1>
                </div>
                <div className="flex gap-2">
                    <Button variant="outline" onClick={() => navigate(`/cmspanel/visual-editor?partId=${id}`)}>
                        <Paintbrush className="w-4 h-4 mr-2" /> Design Content
                    </Button>
                    <Button onClick={handleSave}>
                        <Save className="w-4 h-4 mr-2" /> Save
                    </Button>
                </div>
            </div>

            {/* Form */}
            <div className="grid gap-6 bg-white p-6 rounded-lg border shadow-sm">
                <div className="grid gap-2">
                    <Label>Part Name</Label>
                    <Input
                        value={formData.name}
                        onChange={e => handleChange('name', e.target.value)}
                        placeholder="e.g., Main Header"
                    />
                </div>

                <div className="grid gap-2">
                    <Label>Type</Label>
                    <Select value={formData.type} onValueChange={v => handleChange('type', v)}>
                        <SelectTrigger className="w-[200px]">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            {PART_TYPES.map(t => (
                                <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>
            </div>
        </div>
    );
};

export default TemplatePartEditor;
