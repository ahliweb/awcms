import { useEffect, useState } from 'react';
import { CheckCircle, ArrowRight, FileText } from 'lucide-react';
import { supabase } from '@/lib/customSupabaseClient';
import { usePermissions } from '@/contexts/PermissionContext';
import { Link, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { formatDistanceToNow } from 'date-fns';
import { useToast } from '@/components/ui/use-toast';
import { encodeRouteParam } from '@/lib/routeSecurity';

export function MyApprovals() {
    const { hasPermission } = usePermissions();
    const navigate = useNavigate();
    const { toast } = useToast();
    const [approvals, setApprovals] = useState([]);
    const [loading, setLoading] = useState(true);

    const canApprove = hasPermission('tenant.post.publish'); // Simpler check for now

    useEffect(() => {
        if (canApprove) {
            fetchPendingApprovals();
        } else {
            setLoading(false);
        }
    }, [canApprove]);

    const fetchPendingApprovals = async () => {
        try {
            // Fetch posts in 'reviewed' state
            const { data: posts, error } = await supabase
                .from('blogs') // Updated to 'blogs' table
                .select('id, title, updated_at, author:users!created_by(email)')
                .eq('workflow_state', 'reviewed')
                .limit(5);

            if (error) throw error;
            setApprovals(posts || []);
        } catch (err) {
            console.error('Error fetching approvals:', err);
        } finally {
            setLoading(false);
        }
    };

    if (!canApprove) return null;

    if (loading) return <div className="h-[200px] bg-slate-100/80 dark:bg-slate-800/70 animate-pulse rounded-2xl" />;

    return (
        <Card className="dashboard-surface dashboard-surface-hover flex flex-col">
            <CardHeader className="flex flex-row items-center justify-between border-b border-slate-100/80 pb-3 dark:border-slate-700/60">
                <CardTitle className="flex items-center gap-2 text-base font-semibold text-slate-800 dark:text-slate-100">
                    <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-100/70 text-blue-600 dark:bg-blue-500/20 dark:text-blue-200">
                        <CheckCircle className="w-4 h-4" />
                    </span>
                    Pending Approvals
                </CardTitle>
                {approvals.length > 0 && (
                    <Badge className="bg-blue-100 text-blue-700 hover:bg-blue-200 dark:bg-blue-900/40 dark:text-blue-200">
                        {approvals.length}
                    </Badge>
                )}
            </CardHeader>
            <CardContent className="flex-1 space-y-3 pt-4">
                {approvals.length > 0 ? (
                    approvals.map(item => (
                        <div key={item.id} className="rounded-xl border border-slate-200/70 bg-white/70 p-3.5 shadow-sm transition-colors hover:border-blue-200/80 hover:bg-white dark:border-slate-700/60 dark:bg-slate-800/40 dark:hover:border-blue-800/70">
                            <div className="flex justify-between items-start gap-2">
                                <h4 className="font-semibold text-slate-900 dark:text-white line-clamp-1">{item.title}</h4>
                                <span className="text-xs text-slate-400 whitespace-nowrap">
                                    {formatDistanceToNow(new Date(item.updated_at), { addSuffix: true })}
                                </span>
                            </div>
                            <div className="flex items-center justify-between mt-2">
                                    <span className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1">
                                        <FileText className="w-3 h-3" />
                                        by {item.author?.email || 'Unknown'}
                                    </span>
                                <Button
                                    size="sm"
                                    variant="ghost"
                                    className="h-7 rounded-md px-2 text-xs font-semibold text-blue-600 dark:text-blue-300 hover:text-blue-700 dark:hover:text-blue-200 hover:bg-blue-50/80 dark:hover:bg-blue-900/30"
                                    onClick={async () => {
                                        const routeId = await encodeRouteParam({ value: item.id, scope: 'blogs.edit' });
                                        if (!routeId) {
                                                toast({ variant: 'destructive', title: 'Error', description: 'Unable to open the review editor.' });
                                                return;
                                            }
                                            navigate(`/cmspanel/blogs/edit/${routeId}`);
                                        }}
                                    >
                                        Review
                                    </Button>
                                </div>
                            </div>
                        ))
                ) : (
                    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-200/70 bg-slate-50/60 px-6 py-10 text-slate-400 dark:border-slate-700/60 dark:bg-slate-800/40">
                        <CheckCircle className="w-8 h-8 mb-2 opacity-20" />
                        <p className="text-sm font-medium">No items waiting for review</p>
                    </div>
                )}
            </CardContent>

            <div className="border-t border-slate-100/80 px-6 py-3 dark:border-slate-700/60">
                <Link to="/cmspanel/blogs/queue" className="text-sm font-medium text-slate-500 dark:text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 flex items-center justify-center w-full">
                    View All Queue <ArrowRight className="w-4 h-4 ml-1" />
                </Link>
            </div>
        </Card>
    );
}
