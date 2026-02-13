import { useEffect, useState } from 'react';


/**
 * SitemapRedirect Component
 * 
 * This component fetches the dynamic sitemap from Supabase Edge Function
 * and renders it directly OR redirects to the Edge Function URL.
 * 
 * For SEO purposes, it's better to serve the XML directly or redirect to the Edge Function.
 */
const SitemapRedirect = () => {
    const [sitemapXml, setSitemapXml] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    useEffect(() => {
        const fetchSitemap = async () => {
            try {
                // Get current domain for the sitemap
                const domain = window.location.hostname;

                // Build Edge Function URL
                const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
                const supabaseAnonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
                const edgeFunctionUrl = `${supabaseUrl}/functions/v1/serve-sitemap?domain=${domain}`;

                const response = await fetch(edgeFunctionUrl, {
                    headers: {
                        'Authorization': `Bearer ${supabaseAnonKey}`,
                        'apikey': supabaseAnonKey,
                    }
                });

                if (!response.ok) {
                    throw new Error(`Failed to fetch sitemap: ${response.statusText}`);
                }

                const xml = await response.text();
                setSitemapXml(xml);
            } catch (err) {
                console.error('Sitemap fetch error:', err);
                setError(err.message);
            } finally {
                setLoading(false);
            }
        };

        fetchSitemap();
    }, []);

    // Show loading state
    if (loading) {
        return (
            <div className="flex items-center justify-center min-h-screen bg-slate-50">
                <div className="text-center">
                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
                    <p className="text-slate-600">Loading sitemap...</p>
                </div>
            </div>
        );
    }

    // Show error state
    if (error) {
        return (
            <div className="flex items-center justify-center min-h-screen bg-slate-50">
                <div className="text-center max-w-md mx-auto p-6">
                    <div className="text-red-500 text-4xl mb-4">⚠️</div>
                    <h1 className="text-xl font-bold text-slate-800 mb-2">Sitemap Error</h1>
                    <p className="text-slate-600 mb-4">{error}</p>
                    <a
                        href="/"
                        className="inline-block px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                    >
                        Return Home
                    </a>
                </div>
            </div>
        );
    }

    // Render the sitemap XML in a pre-formatted view
    // Note: For proper XML response, this should be handled server-side
    // This is a client-side fallback view
    return (
        <div className="min-h-screen bg-slate-50 p-8">
            <div className="max-w-6xl mx-auto">
                <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
                    <div className="flex items-center justify-between mb-6">
                        <h1 className="text-2xl font-bold text-slate-800">Sitemap</h1>
                        <div className="flex gap-2">
                            <button
                                onClick={() => {
                                    const blob = new Blob([sitemapXml], { type: 'application/xml' });
                                    const url = URL.createObjectURL(blob);
                                    const a = document.createElement('a');
                                    a.href = url;
                                    a.download = 'sitemap.xml';
                                    a.click();
                                    URL.revokeObjectURL(url);
                                }}
                                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm"
                            >
                                Download XML
                            </button>
                            <a
                                href="/"
                                className="px-4 py-2 bg-slate-100 text-slate-700 rounded-lg hover:bg-slate-200 transition-colors text-sm"
                            >
                                Return Home
                            </a>
                        </div>
                    </div>
                    <pre className="bg-slate-900 text-green-400 p-4 rounded-lg overflow-x-auto text-sm font-mono">
                        {sitemapXml}
                    </pre>
                    <p className="mt-4 text-sm text-slate-500">
                        This sitemap is dynamically generated from your published content.
                    </p>
                </div>
            </div>
        </div>
    );
};

export default SitemapRedirect;
