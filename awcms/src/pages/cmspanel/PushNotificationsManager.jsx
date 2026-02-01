/**
 * PushNotificationsManager Page
 * Send and manage push notifications
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
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
import { Bell, Plus, Send, Trash2, RefreshCw, ShieldAlert } from 'lucide-react';
import { usePushNotifications } from '@/hooks/usePushNotifications';
import { usePermissions } from '@/contexts/PermissionContext';
import { Skeleton } from '@/components/ui/skeleton';
import { format } from 'date-fns';

function PushNotificationsManager() {
    const { t } = useTranslation();
    const { notifications, loading, stats, createNotification, sendNotification, deleteNotification, fetchNotifications } = usePushNotifications();
    const { hasPermission } = usePermissions();

    const [createDialog, setCreateDialog] = useState(false);
    const [newNotification, setNewNotification] = useState({
        title: '',
        message: '',
        target_type: 'all',
    });

    const canManage = hasPermission('tenant.push_notifications.create')
        || hasPermission('tenant.push_notifications.update')
        || hasPermission('tenant.push_notifications.delete');
    const canRead = hasPermission('tenant.push_notifications.read') || canManage;

    if (!canRead) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[400px] bg-white rounded-xl border border-slate-200 p-12 text-center">
                <div className="p-4 bg-red-50 rounded-full mb-4">
                    <ShieldAlert className="w-12 h-12 text-red-500" />
                </div>
                <h3 className="text-xl font-bold text-slate-800">Access Denied</h3>
                <p className="text-slate-500 mt-2">You do not have permission to view push notifications.</p>
            </div>
        );
    }

    const handleCreate = async (isDraft = true) => {
        if (!newNotification.title) return;

        try {
            await createNotification(newNotification, isDraft);
            setCreateDialog(false);
            setNewNotification({ title: '', message: '', target_type: 'all' });
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
                    <h1 className="text-2xl font-bold">{t('push_notifications.title')}</h1>
                    <p className="text-muted-foreground">{t('push_notifications.subtitle')}</p>
                </div>

                {canManage && (
                    <Button onClick={() => setCreateDialog(true)}>
                        <Plus className="mr-2 h-4 w-4" />
                        {t('push_notifications.button_new')}
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
                                <p className="text-2xl font-bold">{stats?.total || 0}</p>
                                <p className="text-sm text-muted-foreground">{t('push_notifications.stat_total')}</p>
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
                                    {stats?.sent || 0}
                                </p>
                                <p className="text-sm text-muted-foreground">{t('push_notifications.stat_sent')}</p>
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
                                    {stats?.drafts || 0}
                                </p>
                                <p className="text-sm text-muted-foreground">{t('push_notifications.stat_drafts')}</p>
                            </div>
                        </div>
                    </CardContent>
                </Card>
            </div>

            {/* Table */}
            <Card>
                <CardHeader className="flex-row items-center justify-between">
                    <CardTitle>{t('push_notifications.history_title')}</CardTitle>
                    <Button variant="outline" size="sm" onClick={fetchNotifications}>
                        <RefreshCw className="h-4 w-4" />
                    </Button>
                </CardHeader>
                <CardContent className="p-0">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>{t('push_notifications.table_title')}</TableHead>
                                <TableHead>{t('push_notifications.table_target')}</TableHead>
                                <TableHead>{t('push_notifications.table_status')}</TableHead>
                                <TableHead>{t('push_notifications.table_sent')}</TableHead>
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
                                        {canManage && <TableCell><Skeleton className="h-4 w-16" /></TableCell>}
                                    </TableRow>
                                ))
                            ) : notifications.length === 0 ? (
                                <TableRow>
                                    <TableCell colSpan={canManage ? 5 : 4} className="text-center py-8 text-muted-foreground">
                                        {t('push_notifications.no_notifications')}
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
            <Dialog open={createDialog} onOpenChange={setCreateDialog}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>{t('push_notifications.dialog_create_title')}</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4">
                        <div>
                            <Label>{t('push_notifications.label_title')}</Label>
                            <Input
                                placeholder={t('push_notifications.placeholder_title')}
                                value={newNotification.title}
                                onChange={(e) => setNewNotification({ ...newNotification, title: e.target.value })}
                            />
                        </div>
                        <div>
                            <Label>{t('push_notifications.label_message')}</Label>
                            <Textarea
                                placeholder={t('push_notifications.placeholder_message')}
                                value={newNotification.message}
                                onChange={(e) => setNewNotification({ ...newNotification, message: e.target.value })}
                            />
                        </div>
                        <div>
                            <Label>{t('push_notifications.label_target')}</Label>
                            <Select
                                value={newNotification.target_type}
                                onValueChange={(v) => setNewNotification({ ...newNotification, target_type: v })}
                            >
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">{t('push_notifications.target_all')}</SelectItem>
                                    <SelectItem value="topic">{t('push_notifications.target_topic')}</SelectItem>
                                    <SelectItem value="segment">{t('push_notifications.target_segment')}</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => handleCreate(true)} disabled={!newNotification.title}>
                            {t('push_notifications.button_draft')}
                        </Button>
                        <Button onClick={() => handleCreate(false)} disabled={!newNotification.title}>
                            <Send className="mr-2 h-4 w-4" />
                            {t('push_notifications.button_send')}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}

export default PushNotificationsManager;
