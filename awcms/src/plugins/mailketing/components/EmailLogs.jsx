import { useState, useEffect, useCallback } from 'react';
import { useTenant } from '@/contexts/TenantContext';
import { usePermissions } from '@/contexts/PermissionContext';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import {
    Mail,
    Search,
    RefreshCw,
    CheckCircle,
    XCircle,
    Eye,
    MousePointer,
    AlertTriangle,
    Download,
    ShieldAlert,
} from 'lucide-react';
import { getEmailLogs } from '../services/emailService';
import { format } from 'date-fns';

const EVENT_TYPE_CONFIG = {
    sent: { icon: CheckCircle, color: 'bg-green-100 text-green-700', label: 'Sent' },
    opened: { icon: Eye, color: 'bg-blue-100 text-blue-700', label: 'Opened' },
    clicked: { icon: MousePointer, color: 'bg-purple-100 text-purple-700', label: 'Clicked' },
    bounced: { icon: XCircle, color: 'bg-red-100 text-red-700', label: 'Bounced' },
    failed: { icon: AlertTriangle, color: 'bg-orange-100 text-orange-700', label: 'Failed' },
    subscribed: { icon: CheckCircle, color: 'bg-teal-100 text-teal-700', label: 'Subscribed' },
    unsubscribed: { icon: XCircle, color: 'bg-slate-100 text-slate-700', label: 'Unsubscribed' },
};

function EmailLogs() {
    const { currentTenant } = useTenant();
    const { hasPermission } = usePermissions();

    const [logs, setLogs] = useState([]);
    const [loading, setLoading] = useState(true);
    const [count, setCount] = useState(0);
    const [page, setPage] = useState(0);
    const [filters, setFilters] = useState({
        eventType: '',
        recipient: '',
    });

    const canViewLogs = hasPermission('tenant.setting.read');
    const limit = 20;

    const loadLogs = useCallback(async () => {
        setLoading(true);
        try {
            const { data, count: total } = await getEmailLogs(currentTenant.id, {
                limit,
                offset: page * limit,
                eventType: filters.eventType || undefined,
                recipient: filters.recipient || undefined,
            });
            setLogs(data || []);
            setCount(total || 0);
        } catch (error) {
            console.error('Failed to load email logs:', error);
        } finally {
            setLoading(false);
        }
    }, [currentTenant?.id, page, filters, limit]);

    useEffect(() => {
        if (currentTenant?.id && canViewLogs) {
            loadLogs();
        }
    }, [currentTenant?.id, page, filters, canViewLogs, loadLogs]);

    useEffect(() => {
        if (currentTenant?.id && canViewLogs) {
            loadLogs();
        }
    }, [currentTenant?.id, page, filters, canViewLogs, loadLogs]);


    const handleExport = () => {
        const csv = [
            ['Date', 'Event', 'Recipient', 'Subject'].join(','),
            ...logs.map((log) =>
                [
                    format(new Date(log.created_at), 'yyyy-MM-dd HH:mm:ss'),
                    log.event_type,
                    log.recipient,
                    log.subject || '',
                ].join(',')
            ),
        ].join('\n');

        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `email-logs-${format(new Date(), 'yyyy-MM-dd')}.csv`;
        a.click();
    };

    if (!canViewLogs) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[400px] bg-white rounded-xl border border-slate-200 p-12 text-center">
                <div className="p-4 bg-red-50 rounded-full mb-4">
                    <ShieldAlert className="w-12 h-12 text-red-500" />
                </div>
                <h3 className="text-xl font-bold text-slate-800">Access Denied</h3>
                <p className="text-slate-500 mt-2">You do not have permission to view email logs.</p>
            </div>
        );
    }

    return (
        <div className="space-y-6 p-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold flex items-center gap-2">
                        <Mail className="w-6 h-6" />
                        Email Logs
                    </h1>
                    <p className="text-slate-500 mt-1">
                        View email sending history and events
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <Button variant="outline" onClick={handleExport} disabled={logs.length === 0}>
                        <Download className="w-4 h-4 mr-2" />
                        Export CSV
                    </Button>
                    <Button variant="outline" onClick={loadLogs}>
                        <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
                        Refresh
                    </Button>
                </div>
            </div>

            {/* Filters */}
            <Card>
                <CardContent className="py-4">
                    <div className="flex items-center gap-4">
                        <div className="flex-1">
                            <div className="relative">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                                <Input
                                    placeholder="Search by recipient..."
                                    value={filters.recipient}
                                    onChange={(e) =>
                                        setFilters((prev) => ({ ...prev, recipient: e.target.value }))
                                    }
                                    className="pl-10"
                                />
                            </div>
                        </div>
                        <Select
                            value={filters.eventType || 'all'}
                            onValueChange={(value) =>
                                setFilters((prev) => ({ ...prev, eventType: value === 'all' ? '' : value }))
                            }
                        >
                            <SelectTrigger className="w-40">
                                <SelectValue placeholder="All Events" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">All Events</SelectItem>
                                <SelectItem value="sent">Sent</SelectItem>
                                <SelectItem value="opened">Opened</SelectItem>
                                <SelectItem value="clicked">Clicked</SelectItem>
                                <SelectItem value="bounced">Bounced</SelectItem>
                                <SelectItem value="failed">Failed</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                </CardContent>
            </Card>

            {/* Logs Table */}
            <Card>
                <CardContent className="p-0">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Date</TableHead>
                                <TableHead>Tenant</TableHead>
                                <TableHead>User</TableHead>
                                <TableHead>Role</TableHead>
                                <TableHead>IP Address</TableHead>
                                <TableHead>Event</TableHead>
                                <TableHead>Recipient</TableHead>
                                <TableHead>Subject</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {loading ? (
                                <TableRow>
                                    <TableCell colSpan={8} className="text-center py-8">
                                        <RefreshCw className="w-6 h-6 animate-spin mx-auto text-slate-400" />
                                    </TableCell>
                                </TableRow>
                            ) : logs.length === 0 ? (
                                <TableRow>
                                    <TableCell colSpan={8} className="text-center py-8 text-slate-500">
                                        No email logs found
                                    </TableCell>
                                </TableRow>
                            ) : (
                                logs.map((log) => {
                                    const typeConfig = EVENT_TYPE_CONFIG[log.event_type] || {};
                                    const Icon = typeConfig.icon || Mail;
                                    return (
                                        <TableRow key={log.id}>
                                            <TableCell className="text-sm text-slate-500">
                                                {format(new Date(log.created_at), 'MMM d, yyyy HH:mm:ss')}
                                            </TableCell>
                                            <TableCell className="text-sm">
                                                {log.tenant?.name || '-'}
                                            </TableCell>
                                            <TableCell className="text-sm">
                                                {log.user?.full_name || log.user?.email || '-'}
                                            </TableCell>
                                            <TableCell className="text-sm">
                                                {log.user?.role?.name || '-'}
                                            </TableCell>
                                            <TableCell className="text-xs font-mono text-slate-500">
                                                {log.ip_address || '-'}
                                            </TableCell>
                                            <TableCell>
                                                <Badge
                                                    variant="secondary"
                                                    className={`${typeConfig.color} gap-1`}
                                                >
                                                    <Icon className="w-3 h-3" />
                                                    {typeConfig.label || log.event_type}
                                                </Badge>
                                            </TableCell>
                                            <TableCell className="font-mono text-sm">
                                                {log.recipient}
                                            </TableCell>
                                            <TableCell className="max-w-xs truncate">
                                                {log.subject || '-'}
                                            </TableCell>
                                        </TableRow>
                                    );
                                })
                            )}
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>

            {/* Pagination */}
            {count > limit && (
                <div className="flex items-center justify-between">
                    <p className="text-sm text-slate-500">
                        Showing {page * limit + 1}-{Math.min((page + 1) * limit, count)} of {count}
                    </p>
                    <div className="flex items-center gap-2">
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setPage((p) => Math.max(0, p - 1))}
                            disabled={page === 0}
                        >
                            Previous
                        </Button>
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setPage((p) => p + 1)}
                            disabled={(page + 1) * limit >= count}
                        >
                            Next
                        </Button>
                    </div>
                </div>
            )}
        </div>
    );
}

export default EmailLogs;
