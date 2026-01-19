/**
 * DevicesManager Page
 * ESP32 IoT Devices Management
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from '@/components/ui/dialog';
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
import { Label } from '@/components/ui/label';
import { Plus, Search, Wifi, WifiOff, Cpu, RefreshCw } from 'lucide-react';
import { useDevices } from '@/hooks/useDevices';
import { usePermissions } from '@/contexts/PermissionContext';
import DeviceCard from '@/components/esp32/DeviceCard';
import { Skeleton } from '@/components/ui/skeleton';

function DevicesManager() {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const { devices, loading, onlineCount, totalCount, registerDevice, deleteDevice, fetchDevices } = useDevices();
    const { hasPermission } = usePermissions();

    const [search, setSearch] = useState('');
    const [showAddDialog, setShowAddDialog] = useState(false);
    const [deleteTarget, setDeleteTarget] = useState(null);
    const [newDevice, setNewDevice] = useState({ device_id: '', device_name: '' });

    const canManage = hasPermission('iot.device.manage') || hasPermission('tenant.settings.update');

    // Filter devices
    const filteredDevices = devices.filter((d) =>
        d.device_name?.toLowerCase().includes(search.toLowerCase()) ||
        d.device_id?.toLowerCase().includes(search.toLowerCase())
    );

    // Handle add device
    const handleAddDevice = async () => {
        if (!newDevice.device_id) return;

        try {
            await registerDevice(newDevice);
            setShowAddDialog(false);
            setNewDevice({ device_id: '', device_name: '' });
        } catch (err) {
            // Error handled in hook
        }
    };

    // Handle delete
    const handleDelete = async () => {
        if (!deleteTarget) return;

        await deleteDevice(deleteTarget.id);
        setDeleteTarget(null);
    };

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold">{t('devices.title')}</h1>
                    <p className="text-muted-foreground">{t('devices.subtitle')}</p>
                </div>

                {canManage && (
                    <Button onClick={() => setShowAddDialog(true)}>
                        <Plus className="mr-2 h-4 w-4" />
                        {t('devices.add_device')}
                    </Button>
                )}
            </div>

            {/* Stats */}
            <div className="grid gap-4 md:grid-cols-3">
                <Card>
                    <CardContent className="pt-6">
                        <div className="flex items-center gap-4">
                            <div className="p-3 bg-primary/10 rounded-full">
                                <Cpu className="h-6 w-6 text-primary" />
                            </div>
                            <div>
                                <p className="text-2xl font-bold">{totalCount}</p>
                                <p className="text-sm text-muted-foreground">{t('devices.total_devices')}</p>
                            </div>
                        </div>
                    </CardContent>
                </Card>

                <Card>
                    <CardContent className="pt-6">
                        <div className="flex items-center gap-4">
                            <div className="p-3 bg-green-500/10 rounded-full">
                                <Wifi className="h-6 w-6 text-green-500" />
                            </div>
                            <div>
                                <p className="text-2xl font-bold">{onlineCount}</p>
                                <p className="text-sm text-muted-foreground">{t('devices.online')}</p>
                            </div>
                        </div>
                    </CardContent>
                </Card>

                <Card>
                    <CardContent className="pt-6">
                        <div className="flex items-center gap-4">
                            <div className="p-3 bg-muted rounded-full">
                                <WifiOff className="h-6 w-6 text-muted-foreground" />
                            </div>
                            <div>
                                <p className="text-2xl font-bold">{totalCount - onlineCount}</p>
                                <p className="text-sm text-muted-foreground">{t('devices.offline')}</p>
                            </div>
                        </div>
                    </CardContent>
                </Card>
            </div>

            {/* Search & Refresh */}
            <div className="flex gap-4">
                <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                        placeholder={t('devices.search_placeholder')}
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        className="pl-10"
                    />
                </div>
                <Button variant="outline" onClick={fetchDevices}>
                    <RefreshCw className="h-4 w-4" />
                </Button>
            </div>

            {/* Device Grid */}
            {loading ? (
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                    {[1, 2, 3].map((i) => (
                        <Card key={i}>
                            <CardHeader>
                                <Skeleton className="h-6 w-32" />
                            </CardHeader>
                            <CardContent className="space-y-3">
                                <Skeleton className="h-4 w-full" />
                                <Skeleton className="h-4 w-2/3" />
                            </CardContent>
                        </Card>
                    ))}
                </div>
            ) : filteredDevices.length === 0 ? (
                <Card>
                    <CardContent className="py-12 text-center">
                        <Cpu className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
                        <h3 className="text-lg font-medium">{t('devices.no_devices')}</h3>
                        <p className="text-muted-foreground mb-4">
                            {search ? t('devices.try_different_search') : t('devices.add_first_device')}
                        </p>
                        {canManage && !search && (
                            <Button onClick={() => setShowAddDialog(true)}>
                                <Plus className="mr-2 h-4 w-4" />
                                {t('devices.add_device')}
                            </Button>
                        )}
                    </CardContent>
                </Card>
            ) : (
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                    {filteredDevices.map((device) => (
                        <DeviceCard
                            key={device.id}
                            device={device}
                            onView={(d) => navigate(`/admin/devices/${d.id}`)}
                            onEdit={(d) => navigate(`/admin/devices/${d.id}/settings`)}
                            onDelete={(d) => canManage && setDeleteTarget(d)}
                        />
                    ))}
                </div>
            )}

            {/* Add Device Dialog */}
            <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>{t('devices.dialog_add_title')}</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4">
                        <div>
                            <Label>{t('devices.label_device_id')}</Label>
                            <Input
                                placeholder={t('devices.placeholder_device_id')}
                                value={newDevice.device_id}
                                onChange={(e) => setNewDevice({ ...newDevice, device_id: e.target.value })}
                            />
                        </div>
                        <div>
                            <Label>{t('devices.label_device_name')}</Label>
                            <Input
                                placeholder={t('devices.placeholder_device_name')}
                                value={newDevice.device_name}
                                onChange={(e) => setNewDevice({ ...newDevice, device_name: e.target.value })}
                            />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setShowAddDialog(false)}>
                            {t('devices.cancel')}
                        </Button>
                        <Button onClick={handleAddDevice} disabled={!newDevice.device_id}>
                            {t('devices.add_device')}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Delete Confirmation */}
            <AlertDialog open={!!deleteTarget} onOpenChange={() => setDeleteTarget(null)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>{t('devices.delete_title')}</AlertDialogTitle>
                        <AlertDialogDescription>
                            {t('devices.delete_desc', { name: deleteTarget?.device_name || deleteTarget?.device_id })}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>{t('devices.cancel')}</AlertDialogCancel>
                        <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground">
                            {t('devices.delete_confirm')}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
}

export default DevicesManager;
