import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { udm } from '@/lib/data/UnifiedDataManager'; // CHANGED: Replaced supabase with udm
import { Loader2, Check, X, RefreshCw } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';

const SlugGenerator = ({
    initialSlug = '',
    titleValue = '',
    tableName = 'pages',
    recordId = null,
    tenantId = null,
    onSlugChange
}) => {
    const { toast } = useToast();
    const [slug, setSlug] = useState(initialSlug);
    const [format, setFormat] = useState('title'); // title, date-title, custom
    const [isChecking, setIsChecking] = useState(false);
    const [isAvailable, setIsAvailable] = useState(null); // true, false, null (unchecked)
    const [manualEdit, setManualEdit] = useState(false);

    // Sanitize slug function
    const sanitizeSlug = (text) => {
        return text
            .toString()
            .toLowerCase()
            .trim()
            .replace(/[\s\W-]+/g, '-') // Replace spaces and non-word chars with -
            .replace(/^-+|-+$/g, '');  // Remove leading/trailing -
    };

    // Generate slug based on format
    const generateSlug = (fmt = format, baseTitle = titleValue) => {
        if (!baseTitle && fmt !== 'custom') return '';

        let newSlug = '';
        const date = new Date();
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        const cleanTitle = sanitizeSlug(baseTitle);

        switch (fmt) {
            case 'date-title':
                newSlug = `${year}/${month}/${cleanTitle}`;
                break;
            case 'custom':
                // Don't auto-change custom
                return slug;
            case 'title':
            default:
                newSlug = cleanTitle;
                break;
        }
        return newSlug;
    };

    // Auto-update slug if user hasn't manually edited and not in custom mode
    useEffect(() => {
        if (!manualEdit && format !== 'custom' && titleValue) {
            const newSlug = generateSlug(format, titleValue);
            setSlug(newSlug);
            setIsAvailable(null); // Reset availability status on change
            onSlugChange?.(newSlug);
        }
    }, [titleValue, format, manualEdit]);

    // Handle Format Change
    const handleFormatChange = (value) => {
        setFormat(value);
        if (value === 'custom') {
            setManualEdit(true);
        } else {
            setManualEdit(false);
            const newSlug = generateSlug(value, titleValue);
            setSlug(newSlug);
            onSlugChange?.(newSlug);
        }
    };

    // Check Availability against Database (Offline-Ready)
    const checkAvailability = async () => {
        if (!slug) return;
        setIsChecking(true);
        try {
            // CHANGED: Use UnifiedDataManager
            // Note: udm query builder syntax: .select(...).eq(...)
            let query = udm
                .from(tableName)
                .select('id')
                .eq('slug', slug);

            // Scope by Tenant ID if provided (Critical for Multi-Tenancy)
            if (tenantId) {
                query = query.eq('tenant_id', tenantId);
            }

            if (recordId) {
                query = query.neq('id', recordId);
            }

            const { data, error } = await query; // Executes remote or local automatically

            if (error) throw error;

            if (data && data.length > 0) {
                setIsAvailable(false);
                toast({
                    variant: 'destructive',
                    title: 'Slug Unavailable',
                    description: `The slug "${slug}" is already taken.`
                });
            } else {
                setIsAvailable(true);
                toast({
                    title: 'Slug Available',
                    description: `The slug "${slug}" is free to use.`,
                    className: 'bg-green-50 border-green-200 text-green-800'
                });
            }
        } catch (error) {
            console.error(error);
            toast({
                variant: 'destructive',
                title: 'Error',
                description: 'Failed to check slug availability.'
            });
        } finally {
            setIsChecking(false);
        }
    };

    return (
        <div className="space-y-3 p-4 bg-slate-50 rounded-lg border border-slate-200">
            <div className="flex items-center justify-between">
                <Label className="text-sm font-medium text-slate-700">URL Slug Configuration</Label>
                <Select value={format} onValueChange={handleFormatChange}>
                    <SelectTrigger className="w-[140px] h-8 text-xs">
                        <SelectValue placeholder="Format" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="title">Title Based</SelectItem>
                        <SelectItem value="date-title">Date + Title</SelectItem>
                        <SelectItem value="custom">Custom</SelectItem>
                    </SelectContent>
                </Select>
            </div>

            <div className="flex gap-2">
                <div className="relative flex-1">
                    <Input
                        value={slug}
                        onChange={(e) => {
                            setSlug(e.target.value);
                            setManualEdit(true);
                            setIsAvailable(null);
                            onSlugChange?.(e.target.value);
                            if (format !== 'custom') setFormat('custom');
                        }}
                        className={`pr-10 ${isAvailable === true ? 'border-green-500 focus-visible:ring-green-500' :
                            isAvailable === false ? 'border-red-500 focus-visible:ring-red-500' : ''
                            }`}
                        placeholder="my-page-slug"
                    />
                    <div className="absolute right-3 top-2.5">
                        {isChecking ? (
                            <Loader2 className="w-4 h-4 animate-spin text-slate-400" />
                        ) : isAvailable === true ? (
                            <Check className="w-4 h-4 text-green-500" />
                        ) : isAvailable === false ? (
                            <X className="w-4 h-4 text-red-500" />
                        ) : null}
                    </div>
                </div>
                <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    onClick={checkAvailability}
                    title="Check Availability"
                    disabled={!slug || isChecking}
                >
                    <RefreshCw className={`w-4 h-4 ${isChecking ? 'animate-spin' : ''}`} />
                </Button>
            </div>

            <div className="flex items-center gap-1 text-xs text-slate-500">
                Preview: <span className="font-mono bg-slate-200 px-1 rounded text-slate-700">/{slug}</span>
            </div>
        </div>
    );
};

export default SlugGenerator;
