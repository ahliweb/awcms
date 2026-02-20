
import { useState, useEffect } from 'react';
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { udm } from '@/lib/data/UnifiedDataManager';
import { Loader2, Link as LinkIcon, ExternalLink } from 'lucide-react';

export const PageLinkField = ({ name, value, onChange, field }) => {
    const [activeTab, setActiveTab] = useState('internal');
    const [pages, setPages] = useState([]);
    const [loading, setLoading] = useState(false);
    const [customUrl, setCustomUrl] = useState('');

    // Initialize state based on incoming value
    useEffect(() => {
        if (value) {
            // Check if it looks like an internal link (starts with / and not //)
            const isInternal = value.startsWith('/') && !value.startsWith('//');

            if (isInternal) {
                setActiveTab('internal');
            } else {
                setActiveTab('custom');
                setCustomUrl(value);
            }
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []); // Only run on mount to set initial tab

    // Fetch available pages and blogs
    useEffect(() => {
        const fetchPages = async () => {
            setLoading(true);
            try {
                // Fetch Pages
                const { data: pagesData, error: pagesError } = await udm.from('pages')
                    .select('id, title, slug, page_type')
                    .eq('status', 'published');

                if (pagesError) console.error("Error fetching pages:", pagesError);

                // Fetch Blogs
                const { data: blogsData, error: blogsError } = await udm.from('blogs')
                    .select('id, title, slug')
                    .eq('status', 'published');

                if (blogsError) console.error("Error fetching blogs:", blogsError);

                const formattedPages = (pagesData || []).map(p => ({
                    label: p.title,
                    value: `/${p.slug}`,
                    type: 'Page'
                }));

                const formattedBlogs = (blogsData || []).map(b => ({
                    label: b.title,
                    value: `/blog/${b.slug}`,
                    type: 'Blog'
                }));

                const allLinks = [...formattedPages, ...formattedBlogs];
                setPages(allLinks);

            } catch (error) {
                console.error("Error fetching link options:", error);
            } finally {
                setLoading(false);
            }
        };

        fetchPages();
    }, []);

    const handleInternalChange = (val) => {
        onChange(val);
    };

    const handleCustomChange = (e) => {
        const val = e.target.value;
        setCustomUrl(val);
        onChange(val);
    };

    // Update custom URL input if user switches to custom tab and value is present
    const handleTabChange = (val) => {
        setActiveTab(val);
        if (val === 'custom' && value && !value.startsWith('/') && !value.startsWith('//')) {
            setCustomUrl(value);
        } else if (val === 'custom' && !customUrl && value) {
            // If switching to custom and we have a value that might be internal, keep it as custom input
            setCustomUrl(value);
        }
    };

    return (
        <div className="space-y-3">
            <Label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">{field.label || name}</Label>

            <Tabs value={activeTab} onValueChange={handleTabChange} className="w-full">
                <TabsList className="grid w-full grid-cols-2 h-8">
                    <TabsTrigger value="internal" className="text-xs">Internal Page</TabsTrigger>
                    <TabsTrigger value="custom" className="text-xs">Custom URL</TabsTrigger>
                </TabsList>

                <TabsContent value="internal" className="mt-2 space-y-2">
                    {loading ? (
                        <div className="flex items-center text-xs text-muted-foreground py-2">
                            <Loader2 className="mr-2 h-3 w-3 animate-spin" /> Loading pages...
                        </div>
                    ) : (
                        <Select value={activeTab === 'internal' && pages.some(p => p.value === value) ? value : ''} onValueChange={handleInternalChange}>
                            <SelectTrigger className="h-9 w-full">
                                <SelectValue placeholder="Select a page..." />
                            </SelectTrigger>
                            <SelectContent className="max-h-[200px]">
                                <SelectGroup>
                                    <SelectLabel>Pages</SelectLabel>
                                    {pages.filter(p => p.type === 'Page').map(p => (
                                        <SelectItem key={p.value} value={p.value}>
                                            <span className="truncate block max-w-[200px]">{p.label}</span>
                                        </SelectItem>
                                    ))}
                                </SelectGroup>
                                {pages.some(p => p.type === 'Blog') && (
                                    <SelectGroup>
                                        <SelectLabel>Blogs</SelectLabel>
                                        {pages.filter(p => p.type === 'Blog').map(p => (
                                            <SelectItem key={p.value} value={p.value}>
                                                <span className="truncate block max-w-[200px]">{p.label}</span>
                                            </SelectItem>
                                        ))}
                                    </SelectGroup>
                                )}
                            </SelectContent>
                        </Select>
                    )}
                    <div className="text-[10px] text-muted-foreground flex items-center bg-slate-50 dark:bg-slate-900 p-1.5 rounded border border-slate-100 dark:border-slate-800">
                        <LinkIcon className="w-3 h-3 mr-1.5 opacity-70" />
                        <span className="font-mono truncate">{value || '(empty)'}</span>
                    </div>
                </TabsContent>

                <TabsContent value="custom" className="mt-2">
                    <div className="relative">
                        <Input
                            placeholder="https://example.com or #section"
                            value={customUrl}
                            onChange={handleCustomChange}
                            className="h-9 text-sm pr-8"
                        />
                        <ExternalLink className="absolute right-3 top-2.5 h-4 w-4 text-slate-400" />
                    </div>
                    <div className="text-[10px] text-muted-foreground mt-1.5">
                        Enter full URL (https://...) or fragment (#section)
                    </div>
                </TabsContent>
            </Tabs>
        </div>
    );
};
