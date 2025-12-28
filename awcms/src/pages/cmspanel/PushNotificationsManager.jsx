/**
 * PushNotificationsManager Page
 * Send and manage push notifications
 */

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from '@/components/ui/dialog';
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
import { Bell, Plus, Send, Trash2, RefreshCw } from 'lucide-react';
import { usePushNotifications } from '@/hooks/usePushNotifications';
import { usePermission } from '@/contexts/PermissionContext';
import { Skeleton } from '@/components/ui/skeleton';
import { format } from 'date-fns';

function PushNotificationsManager() {
    const { notifications, loading, createNotification, sendNotification, deleteNotification, fetchNotifications } = usePushNotifications();
    const { hasPermission } = usePermission();

    const [showCreateDialog, setShowCreateDialog] = useState(false);
    const [newNotification, setNewNotification] = useState({
        title: '',
        body: '',
        target_type: 'all',
    });

    const canManage = hasPermission('mobile.push.manage') || hasPermission('tenant.settings.update');

    const handleCreate = async () => {
        if (!newNotification.title) return;

        try {
            await createNotification(newNotification);
            setShowCreateDialog(false);
            setNewNotification({ title: '', body: '', target_type: 'all' });
        } catch (err) {
            // Error handled in hook
        }
    };

    const getStatusColor = (status) => {
        switch (status) {
            case 'sent':
                return 'default';
            case 'draft':
                return 'secondary';
            case 'scheduled':
                return 'outline';
            case 'failed':
                return 'destructive';
            default:
                return 'secondary';
        }
    };

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold">Push Notifications</h1>
                    <p className="text-muted-foreground">Send notifications to mobile app users</p>
                </div>

                {canManage && (
                    <Button onClick={() => setShowCreateDialog(true)}>
                        <Plus className="mr-2 h-4 w-4" />
                        New Notification
                    </Button>
                )}
            </div>

            {/* Stats */}
            <div className="grid gap-4 md:grid-cols-3">
                <Card>
                    <CardContent className="pt-6">
                        <div className="flex items-center gap-3">
                            <div className="p-2 bg-primary/10 rounded-full">
                                <Bell className="h-5 w-5 text-primary" />
                            </div>
                            <div>
                                <p className="text-2xl font-bold">{notifications.length}</p>
                                <p className="text-sm text-muted-foreground">Total</p>
                            </div>
                        </div>
                    </CardContent>
                </Card>

                <Card>
                    <CardContent className="pt-6">
                        <div className="flex items-center gap-3">
                            <div className="p-2 bg-green-100 dark:bg-green-900/30 rounded-full">
                                <Send className="h-5 w-5 text-green-600" />
                            </div>
                            <div>
                                <p className="text-2xl font-bold">
                                    {notifications.filter((n) => n.status === 'sent').length}
                                </p>
                                <p className="text-sm text-muted-foreground">Sent</p>
                            </div>
                        </div>
                    </CardContent>
                </Card>

                <Card>
                    <CardContent className="pt-6">
                        <div className="flex items-center gap-3">
                            <div className="p-2 bg-muted rounded-full">
                                <Bell className="h-5 w-5 text-muted-foreground" />
                            </div>
                            <div>
                                <p className="text-2xl font-bold">
                                    {notifications.filter((n) => n.status === 'draft').length}
                                </p>
                                <p className="text-sm text-muted-foreground">Drafts</p>
                            </div>
                        </div>
                    </CardContent>
                </Card>
            </div>

            {/* Table */}
            <Card>
                <CardHeader className="flex-row items-center justify-between">
                    <CardTitle>Notification History</CardTitle>
                    <Button variant="outline" size="sm" onClick={fetchNotifications}>
                        <RefreshCw className="h-4 w-4" />
                    </Button>
                </CardHeader>
                <CardContent className="p-0">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Title</TableHead>
                                <TableHead>Target</TableHead>
                                <TableHead>Status</TableHead>
                                <TableHead>Sent</TableHead>
                                {canManage && <TableHead className="w-24"></TableHead>}
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {loading ? (
                                [...Array(3)].map((_, i) => (
                                    <TableRow key={i}>
                                        <TableCell><Skeleton className="h-4 w-32" /></TableCell>
                                        <TableCell><Skeleton className="h-4 w-16" /></TableCell>
                                        <TableCell><Skeleton className="h-4 w-16" /></TableCell>
                                        <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                                    </TableRow>
                                ))
                            ) : notifications.length === 0 ? (
                                <TableRow>
                                    <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                                        No notifications yet
                                    </TableCell>
                                </TableRow>
                            ) : (
                                notifications.map((n) => (
                                    <TableRow key={n.id}>
                                        <TableCell>
                                            <div>
                                                <p className="font-medium">{n.title}</p>
                                                <p className="text-sm text-muted-foreground line-clamp-1">{n.body}</p>
                                            </div>
                                        </TableCell>
                                        <TableCell>
                                            <Badge variant="outline">{n.target_type}</Badge>
                                        </TableCell>
                                        <TableCell>
                                            <Badge variant={getStatusColor(n.status)}>{n.status}</Badge>
                                        </TableCell>
                                        <TableCell>
                                            {n.sent_at ? format(new Date(n.sent_at), 'MMM d, HH:mm') : '-'}
                                        </TableCell>
                                        {canManage && (
                                            <TableCell>
                                                <div className="flex gap-1">
                                                    {n.status === 'draft' && (
                                                        <Button
                                                            variant="ghost"
                                                            size="icon"
                                                            onClick={() => sendNotification(n.id)}
                                                        >
                                                            <Send className="h-4 w-4" />
                                                        </Button>
                                                    )}
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        onClick={() => deleteNotification(n.id)}
                                                    >
                                                        <Trash2 className="h-4 w-4 text-destructive" />
                                                    </Button>
                                                </div>
                                            </TableCell>
                                        )}
                                    </TableRow>
                                ))
                            )}
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>

            {/* Create Dialog */}
            <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>New Push Notification</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4">
                        <div>
                            <Label>Title</Label>
                            <Input
                                placeholder="Notification title"
                                value={newNotification.title}
                                onChange={(e) => setNewNotification({ ...newNotification, title: e.target.value })}
                            />
                        </div>
                        <div>
                            <Label>Body</Label>
                            <Textarea
                                placeholder="Notification message..."
                                value={newNotification.body}
                                onChange={(e) => setNewNotification({ ...newNotification, body: e.target.value })}
                            />
                        </div>
                        <div>
                            <Label>Target</Label>
                            <Select
                                value={newNotification.target_type}
                                onValueChange={(v) => setNewNotification({ ...newNotification, target_type: v })}
                            >
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">All Users</SelectItem>
                                    <SelectItem value="topic">Topic</SelectItem>
                                    <SelectItem value="segment">Segment</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setShowCreateDialog(false)}>
                            Cancel
                        </Button>
                        <Button onClick={handleCreate} disabled={!newNotification.title}>
                            Create Draft
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}

export default PushNotificationsManager;
