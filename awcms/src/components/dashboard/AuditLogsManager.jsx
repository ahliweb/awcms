import React, { useState, useEffect } from 'react';
import { usePermissions } from '@/contexts/PermissionContext';
import { supabase } from '@/lib/customSupabaseClient';
import { format } from 'date-fns';
import { Search, Eye, Smartphone, Globe, Server, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Helmet } from 'react-helmet-async';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AdminPageLayout, PageHeader } from '@/templates/flowbite-admin';
import { ClipboardList } from 'lucide-react';
import { useTranslation } from 'react-i18next';

function AuditLogsManager() {
    const { t } = useTranslation();
    const { tenantId, hasPermission, isPlatformAdmin, isFullAccess } = usePermissions();
    const [logs, setLogs] = useState([]);
    const [loading, setLoading] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedLog, setSelectedLog] = useState(null);

    // Pagination
    const [page, setPage] = useState(1);
    const [limit, setLimit] = useState(50);
    const [totalCount, setTotalCount] = useState(0);

    const canView = hasPermission('tenant.audit.view') || isPlatformAdmin || isFullAccess;

    const fetchLogs = async () => {
        if (!canView) return;

        setLoading(true);
        try {
            const from = (page - 1) * limit;
            const to = from + limit - 1;

            let query = supabase
                .from('audit_logs')
                .select('*, user:users(email, full_name)', { count: 'exact' })
                .order('created_at', { ascending: false })
                .range(from, to);

            if (searchQuery) {
                query = query.or(`action.ilike.%${searchQuery}%,resource.ilike.%${searchQuery}%`);
            }

            const { data, count, error } = await query;

            if (error) throw error;

            setLogs(data || []);
            setTotalCount(count || 0);
        } catch (err) {
            console.error('Error fetching audit logs:', err);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (canView && (tenantId || isPlatformAdmin || isFullAccess)) {
            fetchLogs();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [tenantId, page, limit, searchQuery, canView, isPlatformAdmin, isFullAccess]);

    const getChannelIcon = (channel) => {
        switch (channel) {
            case 'mobile': return <Smartphone className="w-3 h-3" />;
            case 'api': return <Server className="w-3 h-3" />;
            default: return <Globe className="w-3 h-3" />;
        }
    };

    const getActionBadge = (action) => {
        const colors = {
            create: 'bg-green-100 text-green-800 border-green-200 dark:bg-green-900/30 dark:text-green-300',
            update: 'bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-900/30 dark:text-blue-300',
            delete: 'bg-destructive/10 text-destructive border-destructive/20',
            publish: 'bg-purple-100 text-purple-800 border-purple-200 dark:bg-purple-900/30 dark:text-purple-300',
            login: 'bg-cyan-100 text-cyan-800 border-cyan-200 dark:bg-cyan-900/30 dark:text-cyan-300'
        };

        const type = action?.split('.')[1] || action;
        const colorClass = colors[type] || 'bg-muted text-muted-foreground border-border';

        return (
            <Badge variant="outline" className={`${colorClass} font-mono text-[10px] uppercase`}>
                {action}
            </Badge>
        );
    };

    if (!canView) {
        return (
            <div className="p-8 text-center">
                <p className="text-muted-foreground">{t('audit.permission_denied')}</p>
            </div>
        );
    }

    return (
        <AdminPageLayout requiredPermission="tenant.audit.read">
            <Helmet>
                <title>{t('audit.page_title')}</title>
            </Helmet>

            <PageHeader
                title={t('audit.header_title')}
                description={t('audit.header_desc')}
                icon={ClipboardList}
                breadcrumbs={[{ label: t('audit.header_title'), icon: ClipboardList }]}
                actions={
                    <Button variant="outline" onClick={fetchLogs} disabled={loading}>
                        <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
                        {t('audit.refresh')}
                    </Button>
                }
            />

            <div className="bg-card rounded-lg border border-border shadow-sm p-4 flex items-center gap-4">
                <div className="relative flex-1 max-w-md">
                    <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input
                        placeholder={t('audit.search_placeholder')}
                        className="pl-9 bg-background border-input"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                    />
                </div>
            </div>

            <Card className="border-border">
                <CardHeader>
                    <CardTitle>{t('audit.activity_history')}</CardTitle>
                    <CardDescription>
                        {t('audit.activity_desc')}
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead className="bg-muted/50 border-b border-border">
                                <tr>
                                    <th className="px-4 py-3 text-left font-medium text-muted-foreground">{t('audit.table.timestamp')}</th>
                                    <th className="px-4 py-3 text-left font-medium text-muted-foreground">{t('audit.table.user')}</th>
                                    <th className="px-4 py-3 text-left font-medium text-muted-foreground">{t('audit.table.ip_address')}</th>
                                    <th className="px-4 py-3 text-left font-medium text-muted-foreground">{t('audit.table.action')}</th>
                                    <th className="px-4 py-3 text-left font-medium text-muted-foreground">{t('audit.table.resource')}</th>
                                    <th className="px-4 py-3 text-left font-medium text-muted-foreground">{t('audit.table.changes')}</th>
                                    <th className="px-4 py-3 text-center font-medium text-muted-foreground">{t('audit.table.channel')}</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-border">
                                {loading ? (
                                    <tr>
                                        <td colSpan="7" className="p-8 text-center text-muted-foreground">
                                            {t('audit.table.loading')}
                                        </td>
                                    </tr>
                                ) : logs.length === 0 ? (
                                    <tr>
                                        <td colSpan="7" className="p-8 text-center text-muted-foreground">
                                            {t('audit.table.no_logs')}
                                        </td>
                                    </tr>
                                ) : (
                                    logs.map((log) => (
                                        <tr key={log.id} className="hover:bg-muted/50 transition-colors">
                                            <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                                                {format(new Date(log.created_at), 'MMM dd, yyyy HH:mm:ss')}
                                            </td>
                                            <td className="px-4 py-3">
                                                <div className="font-medium text-foreground">
                                                    {log.user?.full_name || t('audit.table.unknown_user')}
                                                </div>
                                                <div className="text-xs text-muted-foreground">{log.user?.email}</div>
                                            </td>
                                            <td className="px-4 py-3">
                                                <span className="font-mono text-xs text-muted-foreground">{log.ip_address || '-'}</span>
                                            </td>
                                            <td className="px-4 py-3">{getActionBadge(log.action)}</td>
                                            <td className="px-4 py-3 text-muted-foreground">
                                                <div className="font-medium text-foreground">{log.resource}</div>
                                                {log.resource_id && (
                                                    <div className="text-xs text-muted-foreground">#{log.resource_id}</div>
                                                )}
                                            </td>
                                            <td className="px-4 py-3">
                                                {log.old_value || log.new_value ? (
                                                    <Button
                                                        variant="ghost"
                                                        size="sm"
                                                        onClick={() => setSelectedLog(log)}
                                                        className="h-7 px-2 text-xs text-primary hover:text-primary/80"
                                                    >
                                                        <Eye className="w-3 h-3 mr-1" /> {t('audit.table.view_diff')}
                                                    </Button>
                                                ) : (
                                                    <span className="text-muted-foreground text-xs italic">{t('audit.table.no_modifications')}</span>
                                                )}
                                            </td>
                                            <td className="px-4 py-3">
                                                <div
                                                    className="flex items-center justify-center gap-1 text-muted-foreground text-xs uppercase font-semibold"
                                                    title={log.user_agent}
                                                >
                                                    {getChannelIcon(log.channel)}
                                                    <span>{log.channel || 'web'}</span>
                                                </div>
                                            </td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>

                    {/* Pagination */}
                    {totalCount > 0 && (
                        <div className="flex flex-col sm:flex-row justify-between items-center gap-4 mt-4 pt-4 border-t border-border">
                            <div className="text-sm text-muted-foreground">
                                {t('audit.pagination.showing', {
                                    from: (page - 1) * limit + 1,
                                    to: Math.min(page * limit, totalCount),
                                    total: totalCount
                                })}
                            </div>
                            <div className="flex items-center gap-4">
                                <select
                                    value={limit}
                                    onChange={(e) => {
                                        setLimit(Number(e.target.value));
                                        setPage(1);
                                    }}
                                    className="border border-input rounded px-3 py-1.5 text-sm bg-white text-slate-900 dark:bg-slate-800 dark:text-slate-100 dark:border-slate-600"
                                >
                                    <option value={25}>25 {t('audit.pagination.per_page')}</option>
                                    <option value={50}>50 {t('audit.pagination.per_page')}</option>
                                    <option value={100}>100 {t('audit.pagination.per_page')}</option>
                                </select>
                                <div className="flex gap-1">
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => setPage(p => Math.max(1, p - 1))}
                                        disabled={page === 1}
                                    >
                                        {t('audit.pagination.previous')}
                                    </Button>
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => setPage(p => p + 1)}
                                        disabled={page * limit >= totalCount}
                                    >
                                        {t('audit.pagination.next')}
                                    </Button>
                                </div>
                            </div>
                        </div>
                    )}
                </CardContent>
            </Card>

            {/* Diff Viewer Dialog */}
            <Dialog open={!!selectedLog} onOpenChange={() => setSelectedLog(null)}>
                <DialogContent className="max-w-3xl max-h-[80vh] overflow-hidden flex flex-col">
                    <DialogHeader>
                        <DialogTitle>{t('audit.diff.title')}</DialogTitle>
                    </DialogHeader>
                    <div className="overflow-y-auto space-y-4 p-1">
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <h4 className="text-xs font-bold text-destructive uppercase tracking-wider">
                                    {t('audit.diff.old_value')}
                                </h4>
                                <pre className="bg-destructive/10 border border-destructive/20 p-3 rounded text-xs overflow-x-auto text-destructive min-h-[150px]">
                                    {selectedLog?.old_value
                                        ? JSON.stringify(JSON.parse(selectedLog.old_value), null, 2)
                                        : 'null'}
                                </pre>
                            </div>
                            <div className="space-y-2">
                                <h4 className="text-xs font-bold text-green-600 dark:text-green-400 uppercase tracking-wider">
                                    {t('audit.diff.new_value')}
                                </h4>
                                <pre className="bg-green-100 dark:bg-green-900/30 border border-green-200 dark:border-green-800 p-3 rounded text-xs overflow-x-auto text-green-800 dark:text-green-300 min-h-[150px]">
                                    {selectedLog?.new_value
                                        ? JSON.stringify(JSON.parse(selectedLog.new_value), null, 2)
                                        : 'null'}
                                </pre>
                            </div>
                        </div>
                        <div className="pt-4 border-t border-border space-y-2 text-sm">
                            <div className="flex justify-between">
                                <span className="text-muted-foreground">{t('audit.diff.action')}:</span>
                                <span className="font-medium text-foreground">{selectedLog?.action}</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-muted-foreground">{t('audit.diff.resource')}:</span>
                                <span className="font-medium text-foreground">{selectedLog?.resource}</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-muted-foreground">{t('audit.diff.ip_address')}:</span>
                                <span className="font-mono text-xs text-foreground">{selectedLog?.ip_address || 'N/A'}</span>
                            </div>
                        </div>
                    </div>
                </DialogContent>
            </Dialog>
        </AdminPageLayout>
    );
}

export default AuditLogsManager;
