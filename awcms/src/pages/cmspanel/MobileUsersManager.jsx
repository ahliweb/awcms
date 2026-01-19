/**
 * MobileUsersManager Page
 * Manage registered mobile app users
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Smartphone, Apple, Search, Trash2, RefreshCw, Users } from 'lucide-react';
import { useMobileUsers } from '@/hooks/useMobileUsers';
import { usePermissions } from '@/contexts/PermissionContext';
import { Skeleton } from '@/components/ui/skeleton';
import { formatDistanceToNow } from 'date-fns';

function MobileUsersManager() {
    const { t } = useTranslation();
    const { users, loading, stats, fetchUsers, deleteUser } = useMobileUsers();
    const { hasPermission } = usePermissions();
    const [search, setSearch] = useState('');
    const [deleteTarget, setDeleteTarget] = useState(null);
    const [platformFilter, setPlatformFilter] = useState('all');

    const canManage = hasPermission('mobile.users.manage') || hasPermission('tenant.settings.update');

    // Filter users
    const filteredUsers = users.filter((u) => {
        const matchSearch =
            u.user?.full_name?.toLowerCase().includes(search.toLowerCase()) ||
            u.user?.email?.toLowerCase().includes(search.toLowerCase()) ||
            u.device_name?.toLowerCase().includes(search.toLowerCase());
        const matchPlatform = platformFilter === 'all' || u.device_type === platformFilter;
        return matchSearch && matchPlatform;
    });

    const handleDelete = async () => {
        if (!deleteTarget) return;
        await deleteUser(deleteTarget.id);
        setDeleteTarget(null);
    };

    return (
        <div className="space-y-6">
            {/* Header */}
            <div>
                <h1 className="text-2xl font-bold">{t('mobile_users.title')}</h1>
                <p className="text-muted-foreground">{t('mobile_users.subtitle')}</p>
            </div>

            {/* Stats */}
            <div className="grid gap-4 md:grid-cols-4">
                <Card>
                    <CardContent className="pt-6">
                        <div className="flex items-center gap-3">
                            <div className="p-2 bg-primary/10 rounded-full">
                                <Users className="h-5 w-5 text-primary" />
                            </div>
                            <div>
                                <p className="text-2xl font-bold">{stats.total}</p>
                                <p className="text-sm text-muted-foreground">{t('mobile_users.stat_total')}</p>
                            </div>
                        </div>
                    </CardContent>
                </Card>

                <Card>
                    <CardContent className="pt-6">
                        <div className="flex items-center gap-3">
                            <div className="p-2 bg-gray-100 dark:bg-gray-800 rounded-full">
                                <Apple className="h-5 w-5" />
                            </div>
                            <div>
                                <p className="text-2xl font-bold">{stats.ios}</p>
                                <p className="text-sm text-muted-foreground">iOS</p>
                            </div>
                        </div>
                    </CardContent>
                </Card>

                <Card>
                    <CardContent className="pt-6">
                        <div className="flex items-center gap-3">
                            <div className="p-2 bg-green-100 dark:bg-green-900/30 rounded-full">
                                <Smartphone className="h-5 w-5 text-green-600" />
                            </div>
                            <div>
                                <p className="text-2xl font-bold">{stats.android}</p>
                                <p className="text-sm text-muted-foreground">Android</p>
                            </div>
                        </div>
                    </CardContent>
                </Card>

                <Card>
                    <CardContent className="pt-6">
                        <div className="flex items-center gap-3">
                            <div className="p-2 bg-blue-100 dark:bg-blue-900/30 rounded-full">
                                <Users className="h-5 w-5 text-blue-600" />
                            </div>
                            <div>
                                <p className="text-2xl font-bold">{stats.active}</p>
                                <p className="text-sm text-muted-foreground">{t('mobile_users.stat_active')}</p>
                            </div>
                        </div>
                    </CardContent>
                </Card>
            </div>

            {/* Filters */}
            <div className="flex gap-4 flex-wrap">
                <div className="relative flex-1 min-w-64">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                        placeholder={t('mobile_users.search_placeholder')}
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        className="pl-10"
                    />
                </div>
                <div className="flex gap-2">
                    <Button variant={platformFilter === 'all' ? 'default' : 'outline'} size="sm" onClick={() => setPlatformFilter('all')}>{t('mobile_users.filter_all')}</Button>
                    <Button variant={platformFilter === 'ios' ? 'default' : 'outline'} size="sm" onClick={() => setPlatformFilter('ios')}>{t('mobile_users.filter_ios')}</Button>
                    <Button variant={platformFilter === 'android' ? 'default' : 'outline'} size="sm" onClick={() => setPlatformFilter('android')}>{t('mobile_users.filter_android')}</Button>
                </div>
                <Button variant="outline" onClick={fetchUsers}>
                    <RefreshCw className="h-4 w-4" />
                </Button>
            </div>

            {/* Table */}
            <Card>
                <CardContent className="p-0">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>{t('mobile_users.table_user')}</TableHead>
                                <TableHead>{t('mobile_users.table_device')}</TableHead>
                                <TableHead>{t('mobile_users.table_version')}</TableHead>
                                <TableHead>{t('mobile_users.table_last_active')}</TableHead>
                                <TableHead>{t('mobile_users.table_push')}</TableHead>
                                {canManage && <TableHead className="w-16"></TableHead>}
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {loading ? (
                                [...Array(3)].map((_, i) => (
                                    <TableRow key={i}>
                                        <TableCell><Skeleton className="h-4 w-32" /></TableCell>
                                        <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                                        <TableCell><Skeleton className="h-4 w-16" /></TableCell>
                                        <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                                        <TableCell><Skeleton className="h-4 w-12" /></TableCell>
                                    </TableRow>
                                ))
                            ) : filteredUsers.length === 0 ? (
                                <TableRow>
                                    <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                                        {t('mobile_users.no_users')}
                                    </TableCell>
                                </TableRow>
                            ) : (
                                filteredUsers.map((u) => (
                                    <TableRow key={u.id}>
                                        <TableCell>
                                            <div>
                                                <p className="font-medium">{u.user?.full_name || t('mobile_users.user_anonymous')}</p>
                                                <p className="text-sm text-muted-foreground">{u.user?.email}</p>
                                            </div>
                                        </TableCell>
                                        <TableCell>
                                            <div className="flex items-center gap-2">
                                                {u.device_type === 'ios' ? (
                                                    <Apple className="h-4 w-4" />
                                                ) : (
                                                    <Smartphone className="h-4 w-4 text-green-600" />
                                                )}
                                                <span>{u.device_name || u.device_type}</span>
                                            </div>
                                        </TableCell>
                                        <TableCell>
                                            <code className="text-xs">{u.app_version || '-'}</code>
                                        </TableCell>
                                        <TableCell>
                                            {u.last_active
                                                ? formatDistanceToNow(new Date(u.last_active), { addSuffix: true })
                                                : t('mobile_users.never')}
                                        </TableCell>
                                        <TableCell>
                                            <Badge variant={u.push_enabled ? 'default' : 'secondary'}>
                                                {u.push_enabled ? t('mobile_users.status_on') : t('mobile_users.status_off')}
                                            </Badge>
                                        </TableCell>
                                        {canManage && (
                                            <TableCell>
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    onClick={() => setDeleteTarget(u)}
                                                >
                                                    <Trash2 className="h-4 w-4 text-destructive" />
                                                </Button>
                                            </TableCell>
                                        )}
                                    </TableRow>
                                ))
                            )}
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>

            {/* Delete Confirmation */}
            <AlertDialog open={!!deleteTarget} onOpenChange={() => setDeleteTarget(null)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>{t('mobile_users.dialog_remove_title')}</AlertDialogTitle>
                        <AlertDialogDescription>
                            {t('mobile_users.dialog_remove_desc')}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>{t('mobile_users.cancel')}</AlertDialogCancel>
                        <AlertDialogAction onClick={handleDelete} className="bg-destructive">
                            {t('mobile_users.button_remove')}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
}

export default MobileUsersManager;
