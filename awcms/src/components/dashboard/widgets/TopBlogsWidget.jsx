import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ArrowRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Skeleton } from '@/components/ui/skeleton';

export function TopBlogsWidget({ data, loading }) {
    return (
        <Card className="dashboard-surface dashboard-surface-hover hover:shadow-lg">
            <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
                <CardTitle className="font-bold text-lg text-slate-800 dark:text-white flex items-center gap-2">
                    <span className="w-1 h-6 bg-gradient-to-b from-blue-500 to-indigo-600 rounded-full"></span>
                    Top Performing Blogs
                </CardTitle>
                <Link to="/cmspanel/blogs" className="text-sm text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 dark:hover:text-indigo-300 font-medium flex items-center gap-1 group px-3 py-1.5 rounded-lg hover:bg-indigo-50 dark:hover:bg-indigo-900/30 transition-colors">
                    View All <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-1" />
                </Link>
            </CardHeader>
            <CardContent className="space-y-3 pt-4">
                {loading ? (
                    [...Array(3)].map((_, i) => (
                        <div key={i} className="flex items-center justify-between p-4 bg-white/60 dark:bg-slate-800/50 rounded-xl border border-slate-200/60 dark:border-slate-700/60">
                            <div className="space-y-3 w-full">
                                <Skeleton className="h-4 w-3/4 bg-slate-200/60 dark:bg-slate-600/60" />
                                <Skeleton className="h-3 w-1/3 bg-slate-200/60 dark:bg-slate-600/60" />
                            </div>
                        </div>
                    ))
                ) : data && data.length > 0 ? (
                    data.map((blog, i) => (
                        <div key={i} className="group flex items-center justify-between p-4 bg-white/40 dark:bg-slate-700/40 rounded-xl border border-white/20 dark:border-slate-600/20 hover:bg-white/80 dark:hover:bg-slate-700/80 hover:border-indigo-100 dark:hover:border-indigo-800 transition-all duration-200">
                            <div className="flex flex-col gap-1">
                                <span className="font-semibold text-slate-800 dark:text-white truncate max-w-[180px] sm:max-w-md group-hover:text-indigo-700 dark:group-hover:text-indigo-400 transition-colors">
                                    {blog.title}
                                </span>
                                <span className="text-xs text-slate-500 dark:text-slate-400">Published in {blog.category || 'General'}</span>
                            </div>
                            <div className="flex items-center gap-4 text-sm">
                                <span className="text-slate-500 dark:text-slate-400 font-medium bg-slate-100/50 dark:bg-slate-600/50 px-2 py-1 rounded-md">{blog.views || 0} views</span>
                                <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wide border ${blog.status === 'published'
                                    ? 'bg-emerald-100/50 text-emerald-700 border-emerald-200'
                                    : 'bg-amber-100/50 text-amber-700 border-amber-200'
                                    }`}>
                                    {blog.status}
                                </span>
                            </div>
                        </div>
                    ))
                ) : (
                    <div className="text-center py-10 bg-slate-50/50 dark:bg-slate-800/50 rounded-xl border border-dashed border-slate-200 dark:border-slate-700">
                        <p className="text-slate-400 dark:text-slate-500">No blogs found.</p>
                    </div>
                )}
            </CardContent>
        </Card>
    );
}
