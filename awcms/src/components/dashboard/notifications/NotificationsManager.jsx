
import React, { useState, useEffect } from 'react';
import { useNotifications } from '@/hooks/useNotifications';
import { supabase } from '@/lib/customSupabaseClient';
import { Button } from '@/components/ui/button';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogTrigger
} from '@/components/ui/alert-dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Send, Users, User, CheckCircle2, Search, Filter, CheckCheck } from 'lucide-react';
import ContentTable from '@/components/dashboard/ContentTable';
import { useToast } from '@/components/ui/use-toast';
import { Helmet } from 'react-helmet-async';
import { useNavigate } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { usePermissions } from '@/contexts/PermissionContext';

function NotificationsManager() {
    // Hooks
    const {
        notifications,
        totalCount,
        loading,
        deleteNotification,
        sendNotification,
        fetchNotifications,
        markAllAsRead,
        markAsRead
    } = useNotifications();
    const { hasPermission, tenantId, isPlatformAdmin, isFullAccess } = usePermissions();
    const { toast } = useToast();
    const navigate = useNavigate();

    // State
    const [isOpen, setIsOpen] = useState(false);
    const [markAllOpen, setMarkAllOpen] = useState(false);
    const [users, setUsers] = useState([]);
    const [sending, setSending] = useState(false);

    // Pagination & Filters State
    const [page, setPage] = useState(1);
    const [limit, setLimit] = useState(10);
    const [filterQuery, setFilterQuery] = useState('');
    const [filterType, setFilterType] = useState('all');

    // NOTE: 'unread'/'read' status filtering requires client-side Logic 
    // OR deeper query changes if we want server-side filtering.
    // For now we'll fetch then filter IF status is selected, 
    // but better to fetch all and filter locally or improve API if needed. 
    // Given the current hook implementation, it fetches strict range.
    // Let's keep status filtering client-side for the current page for simplicity,
    // or we'd need to update the hook to support filtering by status (which is complex due to join).
    const [filterStatus, setFilterStatus] = useState('all');

    const [formData, setFormData] = useState({
        title: '',
        message: '',
        type: 'info',
        priority: 'normal',
        category: 'general',
        target: 'all',
        link: ''
    });

    const canCreate = hasPermission('tenant.notification.create') || isPlatformAdmin || isFullAccess;
    const canDelete = hasPermission('tenant.notification.delete') || isPlatformAdmin || isFullAccess;

    // Initial Fetch & Refetch on filters change
    useEffect(() => {
        fetchNotifications({
            page,
            limit,
            filters: {
                search: filterQuery,
                type: filterType
            }
        });
    }, [page, limit, filterQuery, filterType, fetchNotifications]);

    // Fetch users for target selection
    useEffect(() => {
        if (canCreate && isOpen && users.length === 0) {
            const fetchUsers = async () => {
                // If tenant admin, only fetch tenant users
                let query = supabase.from('users').select('id, full_name, email, tenant:tenants(name)');

                // If not platform admin, restricting to own tenant users usually happens via RLS
                // but explicit filter is good practice if RLS is permissive on read.
                if (tenantId && !isPlatformAdmin && !isFullAccess) {
                    // query = query.eq('tenant_id', tenantId); // Assuming users table has tenant_id or relying on RLS
                }

                const { data } = await query;
                if (data) setUsers(data);
            };
            fetchUsers();
        }
    }, [canCreate, isOpen, users.length, tenantId, isPlatformAdmin, isFullAccess]);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setSending(true);
        try {
            await sendNotification({
                userId: formData.target === 'all' ? null : formData.target,
                title: formData.title,
                message: formData.message,
                type: formData.type,
                priority: formData.priority,
                category: formData.category,
                link: formData.link,
                tenantId: tenantId
            });

            toast({ title: 'Success', description: 'Notification sent successfully' });
            setIsOpen(false);
            setFormData({ title: '', message: '', type: 'info', priority: 'normal', category: 'general', target: 'all', link: '' });
            fetchNotifications({ page, limit }); // Refresh
        } catch (err) {
            toast({ variant: 'destructive', title: 'Error', description: err.message });
        } finally {
            setSending(false);
        }
    };

    const handleMarkAllRead = async () => {
        await markAllAsRead();
        setMarkAllOpen(false);
    };

    // Client-side filtering for status ONLY (since we assume we fetched mixed status)
    // If user wants to see ONLY unread, using limit/range on server is tricky without advanced query
    // So we apply it to the result. 
    // This is a trade-off: The total count might be off for the status filter.
    const displayedNotifications = notifications.filter(n => {
        if (filterStatus === 'all') return true;
        if (filterStatus === 'read') return n.is_read;
        if (filterStatus === 'unread') return !n.is_read;
        return true;
    });

    const columns = [
        { key: 'title', label: 'Title', className: 'w-1/4' },
        ...((isPlatformAdmin || isFullAccess) ? [{
            key: 'tenant',
            label: 'Tenant',
            render: (_, item) => item.tenant?.name ? (
                <Badge variant="secondary" className="text-[10px] whitespace-nowrap">
                    {item.tenant.name}
                </Badge>
            ) : <span className="text-slate-400 text-xs">-</span>
        }] : []),
        {
            key: 'priority',
            label: 'Priority',
            render: (p) => {
                const colors = { high: 'bg-red-100 text-red-800', normal: 'bg-slate-100 text-slate-800', low: 'bg-green-100 text-green-800' };
                return <span className={`px-2 py-0.5 rounded text-[10px] uppercase font-bold ${colors[p] || colors.normal}`}>{p || 'normal'}</span>;
            }
        },
        { key: 'message', label: 'Message', className: 'w-1/3', render: (text) => <span className="truncate block max-w-xs text-slate-600">{text}</span> },
        {
            key: 'type',
            label: 'Type',
            render: (type) => (
                <Badge variant="outline" className={`capitalize
                ${type === 'error' ? 'border-red-200 text-red-700 bg-red-50' :
                        type === 'warning' ? 'border-yellow-200 text-yellow-700 bg-yellow-50' :
                            type === 'success' ? 'border-green-200 text-green-700 bg-green-50' : 'border-blue-200 text-blue-700 bg-blue-50'}`}>
                    {type}
                </Badge>
            )
        },
        {
            key: 'is_read',
            label: 'Status',
            render: (read) => read ?
                <span className="text-green-600 flex items-center text-xs font-medium"><CheckCircle2 className="w-3 h-3 mr-1" /> Read</span> :
                <span className="text-blue-600 flex items-center text-xs font-medium"><div className="w-2 h-2 rounded-full bg-blue-500 mr-2"></div> Unread</span>
        },
        { key: 'created_at', label: 'Date', type: 'date' }
    ];

    const extraActions = (item) => (
        !item.is_read && (
            <Button
                variant="ghost"
                size="icon"
                onClick={() => markAsRead(item.id)}
                className="h-8 w-8 text-blue-500 hover:text-blue-700 hover:bg-blue-50"
                title="Mark as read"
            >
                <CheckCheck className="w-4 h-4" />
            </Button>
        )
    );

    return (
        <div className="space-y-6">
            <Helmet>
                <title>Notifications - CMS</title>
            </Helmet>

            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Notifications</h1>
                    <p className="text-slate-500">View and manage system notifications.</p>
                </div>

                <div className="flex gap-2">
                    <AlertDialog open={markAllOpen} onOpenChange={setMarkAllOpen}>
                        <AlertDialogTrigger asChild>
                            <Button variant="outline" className="border-slate-200/70 bg-white/70 hover:bg-white">
                                <CheckCheck className="w-4 h-4 mr-2" />
                                Mark All Read
                            </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                            <AlertDialogHeader>
                                <AlertDialogTitle>Mark all notifications as read?</AlertDialogTitle>
                                <AlertDialogDescription>
                                    This will mark all notifications in your inbox as read. You can still filter for unread notifications later.
                                </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                <AlertDialogAction onClick={handleMarkAllRead} className="bg-indigo-600 hover:bg-indigo-700">
                                    Mark All Read
                                </AlertDialogAction>
                            </AlertDialogFooter>
                        </AlertDialogContent>
                    </AlertDialog>

                    {canCreate && (
                        <Dialog open={isOpen} onOpenChange={setIsOpen}>
                            <DialogTrigger asChild>
                                <Button className="bg-indigo-600 hover:bg-indigo-700">
                                    <Send className="w-4 h-4 mr-2" />
                                    Send Notification
                                </Button>
                            </DialogTrigger>
                            <DialogContent className="sm:max-w-lg">
                                <DialogHeader>
                                    <DialogTitle>Send Notification</DialogTitle>
                                    <DialogDescription>Send a new notification to a specific user or all users.</DialogDescription>
                                </DialogHeader>
                                <form onSubmit={handleSubmit} className="space-y-4 py-4">
                                    <div className="space-y-2">
                                        <Label>Target Audience</Label>
                                        <Select
                                            value={formData.target}
                                            onValueChange={(val) => setFormData({ ...formData, target: val })}
                                        >
                                            <SelectTrigger className="h-11 rounded-xl border-slate-200/70 bg-white/90 shadow-sm focus:border-indigo-500/60 focus:ring-indigo-500/30">
                                                <SelectValue placeholder="Select target" />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="all">
                                                    <div className="flex items-center"><Users className="w-4 h-4 mr-2" /> All Users (Broadcast)</div>
                                                </SelectItem>
                                                {users.map(u => (
                                                    <SelectItem key={u.id} value={u.id}>
                                                        <div className="flex items-center">
                                                            <User className="w-4 h-4 mr-2" />
                                                            <span>{u.full_name || u.email}</span>
                                                            {u.tenant?.name && (
                                                                <Badge variant="outline" className="ml-2 text-[10px] h-5">
                                                                    {u.tenant.name}
                                                                </Badge>
                                                            )}
                                                        </div>
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    </div>

                                    <div className="grid grid-cols-2 gap-4">
                                        <div className="space-y-2">
                                            <Label>Type</Label>
                                            <Select
                                                value={formData.type}
                                                onValueChange={(val) => setFormData({ ...formData, type: val })}
                                            >
                                                <SelectTrigger className="h-11 rounded-xl border-slate-200/70 bg-white/90 shadow-sm focus:border-indigo-500/60 focus:ring-indigo-500/30">
                                                    <SelectValue />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    <SelectItem value="info">Info</SelectItem>
                                                    <SelectItem value="success">Success</SelectItem>
                                                    <SelectItem value="warning">Warning</SelectItem>
                                                    <SelectItem value="error">Error</SelectItem>
                                                </SelectContent>
                                            </Select>
                                        </div>
                                        <div className="space-y-2">
                                            <Label>Priority</Label>
                                            <Select
                                                value={formData.priority}
                                                onValueChange={(val) => setFormData({ ...formData, priority: val })}
                                            >
                                                <SelectTrigger className="h-11 rounded-xl border-slate-200/70 bg-white/90 shadow-sm focus:border-indigo-500/60 focus:ring-indigo-500/30">
                                                    <SelectValue />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    <SelectItem value="low">Low</SelectItem>
                                                    <SelectItem value="normal">Normal</SelectItem>
                                                    <SelectItem value="high">High</SelectItem>
                                                </SelectContent>
                                            </Select>
                                        </div>
                                    </div>

                                    <div className="space-y-2">
                                        <Label>Title</Label>
                                        <Input
                                            required
                                            placeholder="Notification Title"
                                            value={formData.title}
                                            onChange={e => setFormData({ ...formData, title: e.target.value })}
                                            className="h-11 rounded-xl border-slate-200/70 bg-white/90 shadow-sm focus:border-indigo-500/60 focus:ring-indigo-500/30"
                                        />
                                    </div>

                                    <div className="space-y-2">
                                        <Label>Message</Label>
                                        <Textarea
                                            required
                                            placeholder="Type your message here..."
                                            rows={3}
                                            value={formData.message}
                                            onChange={e => setFormData({ ...formData, message: e.target.value })}
                                            className="rounded-xl border-slate-200/70 bg-white/90 shadow-sm focus:border-indigo-500/60 focus:ring-indigo-500/30"
                                        />
                                    </div>

                                    <div className="space-y-2">
                                        <Label>Link (Optional)</Label>
                                        <Input
                                            placeholder="/cmspanel/blogs/123"
                                            value={formData.link}
                                            onChange={e => setFormData({ ...formData, link: e.target.value })}
                                            className="h-11 rounded-xl border-slate-200/70 bg-white/90 shadow-sm focus:border-indigo-500/60 focus:ring-indigo-500/30"
                                        />
                                    </div>

                                    <div className="flex justify-end gap-3 mt-4">
                                        <Button type="button" variant="outline" onClick={() => setIsOpen(false)}>Cancel</Button>
                                        <Button type="submit" disabled={sending} className="bg-indigo-600 hover:bg-indigo-700">
                                            {sending ? 'Sending...' : 'Send Notification'}
                                        </Button>
                                    </div>
                                </form>
                            </DialogContent>
                        </Dialog>
                    )}
                </div>
            </div>

            <div className="dashboard-surface dashboard-surface-hover flex flex-wrap gap-4 items-center p-4">
                <div className="relative flex-1 min-w-[200px]">
                    <Search className="absolute left-3 top-3 h-4 w-4 text-slate-400" />
                    <Input
                        placeholder="Search notifications..."
                        className="h-11 rounded-xl border-slate-200/70 bg-white/90 pl-9 shadow-sm focus:border-indigo-500/60 focus:ring-indigo-500/30"
                        value={filterQuery}
                        onChange={e => setFilterQuery(e.target.value)}
                    />
                </div>
                <div className="flex gap-2 w-full sm:w-auto">
                    <Select value={filterType} onValueChange={setFilterType}>
                        <SelectTrigger className="w-[150px] h-11 rounded-xl border-slate-200/70 bg-white/90 shadow-sm">
                            <div className="flex items-center gap-2 text-slate-600">
                                <Filter className="w-4 h-4" />
                                <SelectValue placeholder="Type" />
                            </div>
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">All Types</SelectItem>
                            <SelectItem value="info">Info</SelectItem>
                            <SelectItem value="success">Success</SelectItem>
                            <SelectItem value="warning">Warning</SelectItem>
                            <SelectItem value="error">Error</SelectItem>
                        </SelectContent>
                    </Select>

                    <Select value={filterStatus} onValueChange={setFilterStatus}>
                        <SelectTrigger className="w-[150px] h-11 rounded-xl border-slate-200/70 bg-white/90 shadow-sm">
                            <SelectValue placeholder="Status" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">All Status</SelectItem>
                            <SelectItem value="read">Read</SelectItem>
                            <SelectItem value="unread">Unread</SelectItem>
                        </SelectContent>
                    </Select>
                </div>
            </div>

            <Card className="dashboard-surface dashboard-surface-hover overflow-hidden">
                <CardHeader className="border-b border-slate-200/60 bg-slate-50/70">
                    <CardTitle>Inbox</CardTitle>
                    <CardDescription>Your notifications history.</CardDescription>
                </CardHeader>
                <CardContent>
                    <ContentTable
                        data={displayedNotifications}
                        columns={columns}
                        loading={loading}
                        onDelete={canDelete ? deleteNotification : null}
                        onView={(item) => item.id && navigate(`/cmspanel/notifications/${item.id}`)}
                        extraActions={extraActions}
                        pagination={{
                            currentPage: page,
                            totalPages: Math.ceil(totalCount / limit),
                            itemsPerPage: limit,
                            totalItems: totalCount,
                            onPageChange: setPage,
                            onLimitChange: setLimit
                        }}
                    />
                </CardContent>
            </Card>
        </div>
    );
}

export default NotificationsManager;
