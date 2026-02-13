import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTemplates } from '@/hooks/useTemplates';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { ArrowLeft, Save, Eye } from 'lucide-react';

const TemplateEditor = () => {
    const { id } = useParams();
    const navigate = useNavigate();
    const { templates, templateParts, updateTemplate, loading } = useTemplates();

    const [formData, setFormData] = useState({
        name: '',
        slug: '',
        description: '',
        type: 'page',
        is_active: false,
        parts: {
            header: null,
            footer: null,
        }
    });

    // Load template data
    useEffect(() => {
        if (templates.length > 0 && id) {
            const template = templates.find(t => t.id === id);
            if (template) {
                // eslint-disable-next-line react-hooks/set-state-in-effect
                setFormData({
                    name: template.name || '',
                    slug: template.slug || '',
                    description: template.description || '',
                    type: template.type || 'page',
                    is_active: template.is_active || false,
                    parts: template.parts || { header: null, footer: null }
                });
            }
        }
    }, [templates, id]);

    const handleChange = (field, value) => {
        setFormData(prev => ({ ...prev, [field]: value }));
    };

    const handlePartChange = (partKey, value) => {
        setFormData(prev => ({
            ...prev,
            parts: { ...prev.parts, [partKey]: value === 'none' ? null : value }
        }));
    };

    const handleSave = async () => {
        await updateTemplate(id, formData);
        navigate('/cmspanel/templates');
    };

    // Filter parts by type
    const headers = templateParts.filter(p => p.type === 'header');
    const footers = templateParts.filter(p => p.type === 'footer');

    if (loading) return <div className="p-6">Loading...</div>;

    return (
        <div className="p-6 max-w-4xl mx-auto space-y-8">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                    <Button variant="ghost" onClick={() => navigate('/cmspanel/templates')}>
                        <ArrowLeft className="w-4 h-4 mr-2" /> Back
                    </Button>
                    <h1 className="text-2xl font-bold">Edit Template</h1>
                </div>
                <div className="flex gap-2">
                    <Button variant="outline" onClick={() => navigate(`/cmspanel/visual-editor?templateId=${id}`)}>
                        <Eye className="w-4 h-4 mr-2" /> Visual Editor
                    </Button>
                    <Button onClick={handleSave}>
                        <Save className="w-4 h-4 mr-2" /> Save
                    </Button>
                </div>
            </div>

            {/* Form */}
            <div className="grid gap-6 bg-white p-6 rounded-lg border shadow-sm">
                <div className="grid gap-2">
                    <Label>Template Name</Label>
                    <Input
                        value={formData.name}
                        onChange={e => handleChange('name', e.target.value)}
                        placeholder="e.g., Default Page Layout"
                    />
                </div>

                <div className="grid gap-2">
                    <Label>Slug</Label>
                    <Input
                        value={formData.slug}
                        onChange={e => handleChange('slug', e.target.value)}
                        placeholder="e.g., default-page"
                    />
                </div>

                <div className="grid gap-2">
                    <Label>Description</Label>
                    <Textarea
                        value={formData.description}
                        onChange={e => handleChange('description', e.target.value)}
                        placeholder="Brief description of the template..."
                        rows={3}
                    />
                </div>

                <div className="grid gap-2">
                    <Label>Type</Label>
                    <Select value={formData.type} onValueChange={v => handleChange('type', v)}>
                        <SelectTrigger className="w-[200px]">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="page">Page</SelectItem>
                            <SelectItem value="archive">Archive</SelectItem>
                            <SelectItem value="single">Single Post</SelectItem>
                            <SelectItem value="error">Error Page</SelectItem>
                        </SelectContent>
                    </Select>
                </div>

                <div className="flex items-center space-x-2">
                    <Switch
                        id="is_active"
                        checked={formData.is_active}
                        onCheckedChange={v => handleChange('is_active', v)}
                    />
                    <Label htmlFor="is_active">Active</Label>
                </div>
            </div>

            {/* Template Parts Assignment */}
            <div className="bg-white p-6 rounded-lg border shadow-sm space-y-4">
                <h2 className="text-lg font-semibold">Template Parts</h2>
                <p className="text-sm text-muted-foreground">
                    Assign reusable headers and footers to this template.
                </p>

                <div className="grid md:grid-cols-2 gap-6">
                    <div className="grid gap-2">
                        <Label>Header</Label>
                        <Select
                            value={formData.parts.header || 'none'}
                            onValueChange={v => handlePartChange('header', v)}
                        >
                            <SelectTrigger>
                                <SelectValue placeholder="Select header..." />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="none">No Header</SelectItem>
                                {headers.map(h => (
                                    <SelectItem key={h.id} value={h.id}>{h.name}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    <div className="grid gap-2">
                        <Label>Footer</Label>
                        <Select
                            value={formData.parts.footer || 'none'}
                            onValueChange={v => handlePartChange('footer', v)}
                        >
                            <SelectTrigger>
                                <SelectValue placeholder="Select footer..." />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="none">No Footer</SelectItem>
                                {footers.map(f => (
                                    <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default TemplateEditor;
