import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Loader2, Save } from 'lucide-react';

/**
 * Renders a form based on a JSON schema.
 * 
 * Schema Format:
 * {
 *   "fields": [
 *     { "name": "title", "label": "Title", "type": "text", "required": true },
 *     { "name": "description", "label": "Description", "type": "textarea" },
 *     { "name": "category", "label": "Category", "type": "select", "options": [{"value": "a", "label": "A"}] }
 *   ]
 * }
 */
const SchemaForm = ({ schema, initialData = {}, onSubmit, loading = false }) => {
    const [formData, setFormData] = useState({});

    useEffect(() => {
        if (initialData) {
            setFormData(initialData);
        }
    }, [initialData]);

    const handleChange = (name, value) => {
        setFormData(prev => ({ ...prev, [name]: value }));
    };

    const handleSubmit = (e) => {
        e.preventDefault();
        onSubmit(formData);
    };

    if (!schema?.fields) return <div>Invalid Schema</div>;

    return (
        <form onSubmit={handleSubmit} className="space-y-6">
            <Card>
                <CardContent className="flex flex-col gap-4 p-6">
                    {schema.fields.map((field) => {
                        const value = formData[field.name];
                        const inputValue = value ?? '';

                        return (
                            <div key={field.name}>
                                <div className="mb-2 flex items-center gap-1">
                                    <Label htmlFor={field.name}>{field.label}</Label>
                                    {field.required && <span className="text-destructive">*</span>}
                                </div>

                                {/* TEXT INPUT */}
                                {field.type === 'text' && (
                                    <Input
                                        id={field.name}
                                        type="text"
                                        placeholder={field.placeholder}
                                        required={field.required}
                                        value={inputValue}
                                        onChange={(e) => handleChange(field.name, e.target.value)}
                                    />
                                )}

                                {/* NUMBER INPUT */}
                                {field.type === 'number' && (
                                    <Input
                                        id={field.name}
                                        type="number"
                                        placeholder={field.placeholder}
                                        required={field.required}
                                        value={inputValue}
                                        onChange={(e) => handleChange(field.name, e.target.value)}
                                    />
                                )}

                                {/* TEXTAREA */}
                                {field.type === 'textarea' && (
                                    <Textarea
                                        id={field.name}
                                        placeholder={field.placeholder}
                                        required={field.required}
                                        rows={4}
                                        value={inputValue}
                                        onChange={(e) => handleChange(field.name, e.target.value)}
                                    />
                                )}

                                {/* SELECT */}
                                {field.type === 'select' && (
                                    <Select
                                        value={value || undefined}
                                        onValueChange={(selected) => handleChange(field.name, selected)}
                                    >
                                        <SelectTrigger id={field.name}>
                                            <SelectValue placeholder="Select an option..." />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {field.options?.map((opt) => (
                                                <SelectItem key={opt.value} value={opt.value}>
                                                    {opt.label}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                )}

                                {/* BOOLEAN / CHECKBOX */}
                                {field.type === 'boolean' && (
                                    <div className="flex items-center gap-2">
                                        <Checkbox
                                            id={field.name}
                                            checked={!!value}
                                            onCheckedChange={(checked) => handleChange(field.name, Boolean(checked))}
                                        />
                                        <Label htmlFor={field.name}>{field.helpText || 'Enabled'}</Label>
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </CardContent>
            </Card>

            <div className="flex justify-end">
                <Button type="submit" disabled={loading}>
                    {loading ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                        <Save className="mr-2 h-4 w-4" />
                    )}
                    {loading ? 'Saving...' : 'Save Changes'}
                </Button>
            </div>
        </form>
    );
};

export default SchemaForm;
