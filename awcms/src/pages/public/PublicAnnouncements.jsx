
import React, { useEffect, useState } from 'react';
import { supabase } from '@/lib/customSupabaseClient';
import { motion } from 'framer-motion';
import { Helmet } from 'react-helmet-async';
import { Bell, Calendar, ArrowRight, AlertCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Link } from 'react-router-dom';
import { sanitizeHTML } from '@/utils/sanitize';

function PublicAnnouncements() {
    const [items, setItems] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        fetchAnnouncements();
    }, []);

    const fetchAnnouncements = async () => {
        setLoading(true);
        const { data } = await supabase
            .from('announcements')
            .select('*, categories(name)')
            .eq('status', 'published')
            .order('priority', { ascending: false }) // High priority first
            .order('published_at', { ascending: false });
        setItems(data || []);
        setLoading(false);
    };

    return (
        <div className="min-h-screen bg-background py-16">
            <Helmet>
                <title>Announcements - AWCMS</title>
            </Helmet>

            <div className="container mx-auto px-4 max-w-4xl">
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="text-center mb-12"
                >
                    <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-primary/10 text-primary mb-4">
                        <Bell className="w-6 h-6" />
                    </div>
                    <h1 className="text-3xl md:text-4xl font-bold text-foreground mb-3">Latest Announcements</h1>
                    <p className="text-muted-foreground">Stay updated with our latest blogs and updates.</p>
                </motion.div>

                {loading ? (
                    <div className="space-y-4">
                        {[1, 2, 3].map(i => (
                            <div key={i} className="h-32 rounded-xl bg-muted animate-pulse" />
                        ))}
                    </div>
                ) : (
                    <div className="space-y-6">
                        {items.map((item, i) => (
                            <motion.div
                                key={item.id}
                                initial={{ opacity: 0, x: -20 }}
                                whileInView={{ opacity: 1, x: 0 }}
                                viewport={{ once: true }}
                                transition={{ delay: i * 0.1 }}
                                className={`group bg-card p-6 rounded-2xl border transition-all hover:shadow-md ${item.priority === 'high' ? 'border-primary/50 shadow-sm' : 'border-border'
                                    }`}
                            >
                                <div className="flex flex-col sm:flex-row gap-6">
                                    <div className="flex-1">
                                        <div className="flex items-center gap-3 mb-3">
                                            {item.priority === 'high' && (
                                                <Badge variant="destructive" className="gap-1">
                                                    <AlertCircle className="w-3 h-3" /> Important
                                                </Badge>
                                            )}
                                            <Badge variant="outline" className="border-border text-muted-foreground">
                                                {item.categories?.name || 'General'}
                                            </Badge>
                                            <span className="text-xs text-muted-foreground flex items-center gap-1">
                                                <Calendar className="w-3 h-3" />
                                                {new Date(item.published_at).toLocaleDateString()}
                                            </span>
                                        </div>

                                        <h3 className="text-xl font-bold text-foreground mb-2 group-hover:text-primary transition-colors">
                                            {item.title}
                                        </h3>
                                        <div
                                            className="text-muted-foreground text-sm line-clamp-2 prose prose-sm prose-slate dark:prose-invert"
                                            dangerouslySetInnerHTML={sanitizeHTML(item.content)}
                                        />
                                    </div>

                                    <div className="flex items-center">
                                        <Link to={`/announcements/${item.id}`}>
                                            <Button variant="ghost" className="gap-2 text-primary hover:text-primary hover:bg-primary/5">
                                                Read More <ArrowRight className="w-4 h-4" />
                                            </Button>
                                        </Link>
                                    </div>
                                </div>
                            </motion.div>
                        ))}

                        {items.length === 0 && (
                            <div className="text-center py-20 bg-muted/30 rounded-2xl border border-dashed border-border">
                                <p className="text-muted-foreground">No announcements at this time.</p>
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}

export default PublicAnnouncements;
