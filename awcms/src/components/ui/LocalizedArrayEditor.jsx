import React from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Plus, Trash2, GripVertical, Languages, ChevronUp, ChevronDown } from 'lucide-react';

/**
 * LocalizedArrayEditor - Editor for bilingual string arrays
 * 
 * @param {Object} props
 * @param {Object} props.value - { id: string[], en: string[] }
 * @param {Function} props.onChange - Called with updated { id, en } arrays
 * @param {string} props.label - Field label
 * @param {string} props.itemLabel - Label for each item (e.g., "Mission", "Goal")
 * @param {string} props.addLabel - Label for add button
 */
export function LocalizedArrayEditor({
    value = { id: [], en: [] },
    onChange,
    label,
    itemLabel = 'Item',
    addLabel = 'Add Item',
    className = ''
}) {
    const [activeTab, setActiveTab] = React.useState('id');

    const handleAdd = () => {
        onChange({
            id: [...(value.id || []), ''],
            en: [...(value.en || []), '']
        });
    };

    const handleRemove = (index) => {
        onChange({
            id: (value.id || []).filter((_, i) => i !== index),
            en: (value.en || []).filter((_, i) => i !== index)
        });
    };

    const handleChange = (lang, index, newValue) => {
        const updated = [...(value[lang] || [])];
        updated[index] = newValue;
        onChange({
            ...value,
            [lang]: updated
        });
    };

    const handleMove = (index, direction) => {
        const newIndex = direction === 'up' ? index - 1 : index + 1;
        const currentId = value.id || [];
        const currentEn = value.en || [];
        
        if (newIndex < 0 || newIndex >= currentId.length) return;
        
        const newId = [...currentId];
        const newEn = [...currentEn];
        
        [newId[index], newId[newIndex]] = [newId[newIndex], newId[index]];
        [newEn[index], newEn[newIndex]] = [newEn[newIndex], newEn[index]];
        
        onChange({
            id: newId,
            en: newEn
        });
    };

    const items = value?.id || [];
    const itemCount = items.length;

    return (
        <div className={`space-y-3 ${className}`}>
            {label && (
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <Label className="text-sm font-medium">{label}</Label>
                        <Languages className="h-3.5 w-3.5 text-muted-foreground" />
                        <span className="text-xs text-muted-foreground">({itemCount} items)</span>
                    </div>
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={handleAdd}
                        className="h-7 text-xs"
                    >
                        <Plus className="h-3 w-3 mr-1" />
                        {addLabel}
                    </Button>
                </div>
            )}

            <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
                <TabsList className="grid w-full grid-cols-2 h-8">
                    <TabsTrigger value="id" className="text-xs">
                        🇮🇩 Indonesia
                    </TabsTrigger>
                    <TabsTrigger value="en" className="text-xs">
                        🇬🇧 English
                    </TabsTrigger>
                </TabsList>

                {['id', 'en'].map((lang) => (
                    <TabsContent key={lang} value={lang} className="mt-2 space-y-2">
                        {items.map((_, index) => (
                            <div key={index} className="flex items-center gap-2">
                                <GripVertical className="h-4 w-4 text-muted-foreground/50 cursor-grab shrink-0" />
                                <span className="text-xs text-muted-foreground w-6 shrink-0">{index + 1}.</span>
                                <Input
                                    value={value[lang]?.[index] || ''}
                                    onChange={(e) => handleChange(lang, index, e.target.value)}
                                    placeholder={`${itemLabel} ${index + 1}`}
                                    className="flex-1 min-w-0"
                                />
                                <div className="flex items-center gap-1 shrink-0">
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon"
                                        className="h-8 w-8"
                                        onClick={() => handleMove(index, 'up')}
                                        disabled={index === 0}
                                    >
                                        <ChevronUp className="h-4 w-4" />
                                    </Button>
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon"
                                        className="h-8 w-8"
                                        onClick={() => handleMove(index, 'down')}
                                        disabled={index === itemCount - 1}
                                    >
                                        <ChevronDown className="h-4 w-4" />
                                    </Button>
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon"
                                        onClick={() => handleRemove(index)}
                                        className="h-8 w-8 text-destructive hover:text-destructive"
                                    >
                                        <Trash2 className="h-4 w-4" />
                                    </Button>
                                </div>
                            </div>
                        ))}
                        {itemCount === 0 && (
                            <Card className="border-dashed">
                                <CardContent className="py-6 text-center text-muted-foreground text-sm">
                                    No items yet. Click &quot;{addLabel}&quot; to add one.
                                </CardContent>
                            </Card>
                        )}
                    </TabsContent>
                ))}
            </Tabs>
        </div>
    );
}

export default LocalizedArrayEditor;
