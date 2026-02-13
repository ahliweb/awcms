import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import RichTextEditor from '@/components/ui/RichTextEditor';
import { Languages } from 'lucide-react';

/**
 * LocalizedInput - Bilingual text input component for id/en fields
 * 
 * @param {Object} props
 * @param {Object} props.value - { id: string, en: string }
 * @param {Function} props.onChange - Called with updated { id, en } object
 * @param {string} props.label - Field label
 * @param {string} props.type - 'text' | 'textarea' | 'richtext'
 * @param {string} props.placeholder - Placeholder text
 * @param {boolean} props.required - Whether field is required
 * @param {string} props.className - Additional className for wrapper
 */
export function LocalizedInput({
    value = { id: '', en: '' },
    onChange,
    label,
    type = 'text',
    placeholder = '',
    required = false,
    className = '',
    description = ''
}) {
    const [activeTab, setActiveTab] = useState('id');

    const handleChange = (lang, newValue) => {
        onChange({
            ...value,
            [lang]: newValue
        });
    };

    const renderInput = (lang) => {
        const currentValue = value?.[lang] || '';
        const langPlaceholder = lang === 'id' ? `${placeholder} (Indonesia)` : `${placeholder} (English)`;

        if (type === 'richtext') {
            return (
                <RichTextEditor
                    value={currentValue}
                    onChange={(content) => handleChange(lang, content)}
                    placeholder={langPlaceholder}
                />
            );
        }

        if (type === 'textarea') {
            return (
                <Textarea
                    value={currentValue}
                    onChange={(e) => handleChange(lang, e.target.value)}
                    placeholder={langPlaceholder}
                    rows={4}
                    className="min-h-[100px]"
                />
            );
        }

        return (
            <Input
                value={currentValue}
                onChange={(e) => handleChange(lang, e.target.value)}
                placeholder={langPlaceholder}
                required={required && lang === 'id'}
            />
        );
    };

    return (
        <div className={`space-y-2 ${className}`}>
            {label && (
                <div className="flex items-center gap-2">
                    <Label className="text-sm font-medium">
                        {label}
                        {required && <span className="text-destructive ml-1">*</span>}
                    </Label>
                    <Languages className="h-3.5 w-3.5 text-muted-foreground" />
                </div>
            )}
            {description && (
                <p className="text-xs text-muted-foreground">{description}</p>
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
                <TabsContent value="id" className="mt-2">
                    {renderInput('id')}
                </TabsContent>
                <TabsContent value="en" className="mt-2">
                    {renderInput('en')}
                </TabsContent>
            </Tabs>
        </div>
    );
}

export default LocalizedInput;
