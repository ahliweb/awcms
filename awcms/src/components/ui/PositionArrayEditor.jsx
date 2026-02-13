import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { GripVertical, Trash2, Plus, ChevronDown, ChevronUp } from 'lucide-react';
import ImageUpload from '@/components/ui/ImageUpload';

/**
 * PositionArrayEditor - Manage an array of position objects with bilingual support
 * Used for organization structures (school, committee, OSIS, MPK)
 * 
 * Each item has: position (bilingual), name (string), optional photo, optional class
 */
export function PositionArrayEditor({
    value = [],
    onChange,
    label,
    showPhoto = false,
    showClass = false,
    className = ''
}) {
    const [expandedIndex, setExpandedIndex] = useState(null);

    const handleAdd = () => {
        const newItem = {
            position: { id: '', en: '' },
            name: '',
            ...(showPhoto && { photo: '' }),
            ...(showClass && { class: '' })
        };
        onChange([...value, newItem]);
        setExpandedIndex(value.length);
    };

    const handleRemove = (index) => {
        const updated = value.filter((_, i) => i !== index);
        onChange(updated);
        if (expandedIndex === index) setExpandedIndex(null);
    };

    const handleChange = (index, field, newValue) => {
        const updated = value.map((item, i) => {
            if (i !== index) return item;
            if (field === 'position_id' || field === 'position_en') {
                const lang = field.split('_')[1];
                return {
                    ...item,
                    position: { ...item.position, [lang]: newValue }
                };
            }
            return { ...item, [field]: newValue };
        });
        onChange(updated);
    };

    const moveItem = (index, direction) => {
        const newIndex = direction === 'up' ? index - 1 : index + 1;
        if (newIndex < 0 || newIndex >= value.length) return;
        const updated = [...value];
        [updated[index], updated[newIndex]] = [updated[newIndex], updated[index]];
        onChange(updated);
        setExpandedIndex(newIndex);
    };

    return (
        <div className={`space-y-3 ${className}`}>
            <div className="flex items-center justify-between">
                {label && <Label className="text-base font-medium">{label}</Label>}
                <Button type="button" variant="outline" size="sm" onClick={handleAdd}>
                    <Plus className="h-4 w-4 mr-1" />
                    Add Position
                </Button>
            </div>

            {value.length === 0 ? (
                <Card className="border-dashed">
                    <CardContent className="py-8 text-center text-muted-foreground">
                        No positions added yet. Click &quot;Add Position&quot; to add one.
                    </CardContent>
                </Card>
            ) : (
                <div className="space-y-2">
                    {value.map((item, index) => (
                        <Card key={index} className="overflow-hidden">
                            <div
                                className="flex items-center gap-2 p-3 cursor-pointer hover:bg-muted/50"
                                onClick={() => setExpandedIndex(expandedIndex === index ? null : index)}
                            >
                                <GripVertical className="h-4 w-4 text-muted-foreground" />
                                <div className="flex-1 min-w-0">
                                    <div className="font-medium truncate">
                                        {item.name || '(No name)'}
                                    </div>
                                    <div className="text-sm text-muted-foreground truncate">
                                        {item.position?.id || item.position?.en || '(No position)'}
                                    </div>
                                </div>
                                <div className="flex items-center gap-1">
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon"
                                        className="h-8 w-8"
                                        onClick={(e) => { e.stopPropagation(); moveItem(index, 'up'); }}
                                        disabled={index === 0}
                                    >
                                        <ChevronUp className="h-4 w-4" />
                                    </Button>
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon"
                                        className="h-8 w-8"
                                        onClick={(e) => { e.stopPropagation(); moveItem(index, 'down'); }}
                                        disabled={index === value.length - 1}
                                    >
                                        <ChevronDown className="h-4 w-4" />
                                    </Button>
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon"
                                        className="h-8 w-8 text-destructive hover:text-destructive"
                                        onClick={(e) => { e.stopPropagation(); handleRemove(index); }}
                                    >
                                        <Trash2 className="h-4 w-4" />
                                    </Button>
                                </div>
                            </div>

                            {expandedIndex === index && (
                                <CardContent className="border-t pt-4 space-y-4">
                                    <div>
                                        <Label>Name</Label>
                                        <Input
                                            value={item.name || ''}
                                            onChange={(e) => handleChange(index, 'name', e.target.value)}
                                            placeholder="Full name"
                                        />
                                    </div>

                                    <div>
                                        <Label>Position (Bilingual)</Label>
                                        <Tabs defaultValue="id" className="mt-1">
                                            <TabsList className="grid w-full grid-cols-2 h-8">
                                                <TabsTrigger value="id" className="text-xs">🇮🇩 Indonesia</TabsTrigger>
                                                <TabsTrigger value="en" className="text-xs">🇬🇧 English</TabsTrigger>
                                            </TabsList>
                                            <TabsContent value="id" className="mt-2">
                                                <Input
                                                    value={item.position?.id || ''}
                                                    onChange={(e) => handleChange(index, 'position_id', e.target.value)}
                                                    placeholder="Jabatan (Indonesia)"
                                                />
                                            </TabsContent>
                                            <TabsContent value="en" className="mt-2">
                                                <Input
                                                    value={item.position?.en || ''}
                                                    onChange={(e) => handleChange(index, 'position_en', e.target.value)}
                                                    placeholder="Position (English)"
                                                />
                                            </TabsContent>
                                        </Tabs>
                                    </div>

                                    {showClass && (
                                        <div>
                                            <Label>Class</Label>
                                            <Input
                                                value={item.class || ''}
                                                onChange={(e) => handleChange(index, 'class', e.target.value)}
                                                placeholder="e.g., XII MIPA 1"
                                            />
                                        </div>
                                    )}

                                    {showPhoto && (
                                        <ImageUpload
                                            label="Photo"
                                            value={item.photo}
                                            onChange={(v) => handleChange(index, 'photo', v)}
                                        />
                                    )}
                                </CardContent>
                            )}
                        </Card>
                    ))}
                </div>
            )}
        </div>
    );
}

/**
 * StaffArrayEditor - Manage an array of staff members
 * Used for teaching and administrative staff lists
 * 
 * Each item has: name, role (optional), subject (optional), photo
 */
export function StaffArrayEditor({
    value = [],
    onChange,
    label,
    showSubject = true,
    className = ''
}) {
    const [expandedIndex, setExpandedIndex] = useState(null);

    const handleAdd = () => {
        const newItem = {
            name: '',
            role: '',
            ...(showSubject && { subject: '' }),
            photo: ''
        };
        onChange([...value, newItem]);
        setExpandedIndex(value.length);
    };

    const handleRemove = (index) => {
        onChange(value.filter((_, i) => i !== index));
        if (expandedIndex === index) setExpandedIndex(null);
    };

    const handleChange = (index, field, newValue) => {
        const updated = value.map((item, i) =>
            i === index ? { ...item, [field]: newValue } : item
        );
        onChange(updated);
    };

    return (
        <div className={`space-y-3 ${className}`}>
            <div className="flex items-center justify-between">
                {label && <Label className="text-base font-medium">{label}</Label>}
                <Button type="button" variant="outline" size="sm" onClick={handleAdd}>
                    <Plus className="h-4 w-4 mr-1" />
                    Add Staff
                </Button>
            </div>

            {value.length === 0 ? (
                <Card className="border-dashed">
                    <CardContent className="py-8 text-center text-muted-foreground">
                        No staff members added yet.
                    </CardContent>
                </Card>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                    {value.map((item, index) => (
                        <Card key={index} className="overflow-hidden">
                            <div
                                className="p-3 cursor-pointer hover:bg-muted/50"
                                onClick={() => setExpandedIndex(expandedIndex === index ? null : index)}
                            >
                                <div className="flex items-start gap-3">
                                    <div className="w-12 h-12 bg-muted rounded-full flex items-center justify-center text-lg font-medium">
                                        {item.name?.charAt(0) || '?'}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <div className="font-medium truncate">{item.name || '(No name)'}</div>
                                        {item.role && <div className="text-sm text-primary truncate">{item.role}</div>}
                                        {showSubject && item.subject && (
                                            <div className="text-sm text-muted-foreground truncate">{item.subject}</div>
                                        )}
                                    </div>
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon"
                                        className="h-8 w-8 text-destructive hover:text-destructive"
                                        onClick={(e) => { e.stopPropagation(); handleRemove(index); }}
                                    >
                                        <Trash2 className="h-4 w-4" />
                                    </Button>
                                </div>
                            </div>

                            {expandedIndex === index && (
                                <CardContent className="border-t pt-4 space-y-3">
                                    <div>
                                        <Label>Name</Label>
                                        <Input
                                            value={item.name || ''}
                                            onChange={(e) => handleChange(index, 'name', e.target.value)}
                                        />
                                    </div>
                                    <div>
                                        <Label>Role/Position</Label>
                                        <Input
                                            value={item.role || ''}
                                            onChange={(e) => handleChange(index, 'role', e.target.value)}
                                            placeholder="e.g., Waka Kurikulum"
                                        />
                                    </div>
                                    {showSubject && (
                                        <div>
                                            <Label>Subject</Label>
                                            <Input
                                                value={item.subject || ''}
                                                onChange={(e) => handleChange(index, 'subject', e.target.value)}
                                                placeholder="e.g., Matematika"
                                            />
                                        </div>
                                    )}
                                    <ImageUpload
                                        label="Photo"
                                        value={item.photo}
                                        onChange={(v) => handleChange(index, 'photo', v)}
                                    />
                                </CardContent>
                            )}
                        </Card>
                    ))}
                </div>
            )}
        </div>
    );
}

export default PositionArrayEditor;
