/**
 * SeoMetadataPanel - Reusable collapsible SEO metadata editing panel.
 * 
 * Provides fields for meta title, description, keywords, OG image, and canonical URL.
 * Used by both UnifiedContentEditor, PagesManager, and BlogEditor.
 */
import { useState } from 'react';
import { ChevronDown, ChevronUp, Globe, Share2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ImageUpload } from '@/components/ui/ImageUpload';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';

/**
 * SeoMetadataPanel Component
 * 
 * @param {Object} props
 * @param {Object} props.formData - Current form data with SEO fields
 * @param {Function} props.onChange - Callback when any field changes (receives partial update)
 * @param {boolean} props.defaultExpanded - Whether panel starts expanded
 */
function SeoMetadataPanel({ formData, onChange, defaultExpanded = true }) {
    const [expanded, setExpanded] = useState(defaultExpanded);

    const handleChange = (field, value) => {
        onChange({ [field]: value });
    };

    return (
        <div className="space-y-4">
            <button
                type="button"
                onClick={() => setExpanded(!expanded)}
                className="flex items-center justify-between w-full font-semibold text-slate-800 text-sm hover:text-indigo-600 transition-colors"
            >
                <span className="flex items-center gap-2">
                    <Globe className="w-4 h-4 text-emerald-500" />
                    SEO & Visibility
                </span>
                {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>

            {expanded && (
                <div className="space-y-6 bg-white/50 p-4 rounded-xl border border-white/60 shadow-sm animate-in slide-in-from-top-2 duration-200">
                    {/* Visibility Toggle */}
                    <div className="flex items-center justify-between">
                        <div className="space-y-0.5">
                            <Label className="text-sm">Publicly Visible</Label>
                            <p className="text-[10px] text-slate-500">Visible to all visitors</p>
                        </div>
                        <Switch
                            checked={formData.is_public}
                            onCheckedChange={(c) => handleChange('is_public', c)}
                        />
                    </div>

                    <Separator className="bg-slate-100" />

                    {/* Meta Title */}
                    <div className="space-y-2">
                        <Label className="text-xs text-slate-500">Meta Title</Label>
                        <Input
                            value={formData.meta_title || ''}
                            onChange={(e) => handleChange('meta_title', e.target.value)}
                            className="h-8 text-xs"
                            placeholder="SEO Title (60 characters recommended)"
                            maxLength={70}
                        />
                        <div className="text-[10px] text-slate-400 text-right">
                            {(formData.meta_title?.length || 0)}/70
                        </div>
                    </div>

                    {/* Meta Description */}
                    <div className="space-y-2">
                        <Label className="text-xs text-slate-500">Meta Description</Label>
                        <Textarea
                            value={formData.meta_description || ''}
                            onChange={(e) => handleChange('meta_description', e.target.value)}
                            className="min-h-[60px] text-xs resize-none"
                            placeholder="SEO Description (160 characters recommended)"
                            maxLength={200}
                        />
                        <div className="text-[10px] text-slate-400 text-right">
                            {(formData.meta_description?.length || 0)}/200
                        </div>
                    </div>

                    {/* Meta Keywords */}
                    <div className="space-y-2">
                        <Label className="text-xs text-slate-500">Meta Keywords</Label>
                        <Input
                            value={formData.meta_keywords || ''}
                            onChange={(e) => handleChange('meta_keywords', e.target.value)}
                            className="h-8 text-xs"
                            placeholder="keyword1, keyword2, keyword3"
                        />
                    </div>

                    {/* Canonical URL */}
                    <div className="space-y-2">
                        <Label className="text-xs text-slate-500">Canonical URL</Label>
                        <Input
                            value={formData.canonical_url || ''}
                            onChange={(e) => handleChange('canonical_url', e.target.value)}
                            className="h-8 text-xs"
                            placeholder="https://example.com/canonical-page"
                        />
                    </div>

                    <Separator className="bg-slate-100" />

                    {/* Social / OG Section */}
                    <div className="space-y-4">
                        <h5 className="flex items-center gap-2 font-medium text-slate-700 text-xs">
                            <Share2 className="w-3 h-3 text-sky-500" />
                            Social Preview
                        </h5>

                        {/* OG Image */}
                        <div className="space-y-2">
                            <Label className="text-xs text-slate-500">OG Image</Label>
                            <ImageUpload
                                value={formData.og_image || ''}
                                onChange={(url) => handleChange('og_image', url)}
                                className="h-24 w-full"
                            />
                            <p className="text-[10px] text-slate-400">Recommended: 1200x630px</p>
                        </div>

                        {/* OG Title - Falls back to meta_title */}
                        <div className="space-y-2">
                            <Label className="text-xs text-slate-500">OG Title (optional)</Label>
                            <Input
                                value={formData.og_title || ''}
                                onChange={(e) => handleChange('og_title', e.target.value)}
                                className="h-8 text-xs"
                                placeholder={formData.meta_title || 'Uses Meta Title if empty'}
                            />
                        </div>

                        {/* OG Description - Falls back to meta_description */}
                        <div className="space-y-2">
                            <Label className="text-xs text-slate-500">OG Description (optional)</Label>
                            <Textarea
                                value={formData.og_description || ''}
                                onChange={(e) => handleChange('og_description', e.target.value)}
                                className="min-h-[50px] text-xs resize-none"
                                placeholder={formData.meta_description || 'Uses Meta Description if empty'}
                            />
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

export default SeoMetadataPanel;
