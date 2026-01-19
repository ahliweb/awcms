/**
 * DeviceDetail Page
 * View ESP32 device details and sensor data
 */

import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
    ArrowLeft,
    Wifi,
    WifiOff,
    RefreshCw,
    Settings,
    Camera,
    Thermometer,
    Droplets,
    Wind,
} from 'lucide-react';
import { supabase } from '@/lib/customSupabaseClient';
import { useSensorData } from '@/hooks/useSensorData';
import { usePermissions } from '@/contexts/PermissionContext';
import SensorChart from '@/components/esp32/SensorChart';
import { Skeleton } from '@/components/ui/skeleton';
import { formatDistanceToNow } from 'date-fns';

function DeviceDetail() {
    const { t } = useTranslation();
    const { id } = useParams();
    const navigate = useNavigate();
    const { tenantId } = usePermissions();
    const [device, setDevice] = useState(null);
    const [loading, setLoading] = useState(true);

    const { chartData, latestReading } = useSensorData(
        device?.device_id,
        { limit: 100 }
    );

    // Fetch device
    useEffect(() => {
        const fetchDevice = async () => {
            if (!id || !tenantId) return;

            const { data, error } = await supabase
                .from('devices')
                .select('*')
                .eq('id', id)
                .eq('tenant_id', tenantId)
                .single();

            if (error) {
                console.error('Failed to fetch device:', error);
                navigate('/admin/devices');
                return;
            }

            setDevice(data);
            setLoading(false);
        };

        fetchDevice();

        // Realtime subscription for device status
        const channel = supabase
            .channel(`device-${id}`)
            .on(
                'postgres_changes',
                {
                    event: 'UPDATE',
                    schema: 'public',
                    table: 'devices',
                    filter: `id=eq.${id}`,
                },
                (payload) => {
                    setDevice(payload.new);
                }
            )
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, [id, tenantId, navigate]);

    if (loading) {
        return (
            <div className="space-y-6">
                <Skeleton className="h-8 w-64" />
                <div className="grid gap-4 md:grid-cols-4">
                    {[1, 2, 3, 4].map((i) => (
                        <Skeleton key={i} className="h-24" />
                    ))}
                </div>
                <Skeleton className="h-80" />
            </div>
        );
    }

    if (!device) {
        return null;
    }

    const isOnline = device.is_online;
    const lastSeen = device.last_seen
        ? formatDistanceToNow(new Date(device.last_seen), { addSuffix: true })
        : t('devices.detail_page.never');

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                    <Button variant="ghost" size="icon" onClick={() => navigate('/admin/devices')}>
                        <ArrowLeft className="h-4 w-4" />
                    </Button>
                    <div>
                        <h1 className="text-2xl font-bold flex items-center gap-3">
                            {device.device_name || device.device_id}
                            <Badge variant={isOnline ? 'default' : 'secondary'}>
                                {isOnline ? (
                                    <><Wifi className="mr-1 h-3 w-3" /> {t('devices.online')}</>
                                ) : (
                                    <><WifiOff className="mr-1 h-3 w-3" /> {t('devices.offline')}</>
                                )}
                            </Badge>
                        </h1>
                        <p className="text-muted-foreground">
                            {device.device_id} • {t('devices.detail_page.last_seen')} {lastSeen}
                        </p>
                    </div>
                </div>

                <div className="flex gap-2">
                    <Button variant="outline" onClick={() => { }}>
                        <RefreshCw className="mr-2 h-4 w-4" />
                        {t('devices.detail_page.refresh')}
                    </Button>
                    <Button variant="outline" onClick={() => navigate(`/admin/devices/${id}/settings`)}>
                        <Settings className="mr-2 h-4 w-4" />
                        {t('devices.detail_page.settings')}
                    </Button>
                </div>
            </div>

            {/* Stats Cards */}
            <div className="grid gap-4 md:grid-cols-4">
                <Card>
                    <CardContent className="pt-6">
                        <div className="flex items-center gap-3">
                            <div className="p-2 bg-red-500/10 rounded-full">
                                <Wind className="h-5 w-5 text-red-500" />
                            </div>
                            <div>
                                <p className="text-2xl font-bold">
                                    {latestReading?.gas_ppm?.toFixed(1) || '--'}
                                </p>
                                <p className="text-sm text-muted-foreground">{t('devices.detail_page.gas_ppm')}</p>
                            </div>
                        </div>
                    </CardContent>
                </Card>

                <Card>
                    <CardContent className="pt-6">
                        <div className="flex items-center gap-3">
                            <div className="p-2 bg-orange-500/10 rounded-full">
                                <Thermometer className="h-5 w-5 text-orange-500" />
                            </div>
                            <div>
                                <p className="text-2xl font-bold">
                                    {latestReading?.temperature?.toFixed(1) || '--'}°C
                                </p>
                                <p className="text-sm text-muted-foreground">{t('devices.detail_page.temperature')}</p>
                            </div>
                        </div>
                    </CardContent>
                </Card>

                <Card>
                    <CardContent className="pt-6">
                        <div className="flex items-center gap-3">
                            <div className="p-2 bg-blue-500/10 rounded-full">
                                <Droplets className="h-5 w-5 text-blue-500" />
                            </div>
                            <div>
                                <p className="text-2xl font-bold">
                                    {latestReading?.humidity?.toFixed(1) || '--'}%
                                </p>
                                <p className="text-sm text-muted-foreground">{t('devices.detail_page.humidity')}</p>
                            </div>
                        </div>
                    </CardContent>
                </Card>

                <Card>
                    <CardContent className="pt-6">
                        <div className="flex items-center gap-3">
                            <div className="p-2 bg-purple-500/10 rounded-full">
                                <Camera className="h-5 w-5 text-purple-500" />
                            </div>
                            <div>
                                <p className="text-2xl font-bold">
                                    {device.config?.camera_enabled ? t('devices.detail_page.active') : t('devices.detail_page.na')}
                                </p>
                                <p className="text-sm text-muted-foreground">{t('devices.detail_page.camera')}</p>
                            </div>
                        </div>
                    </CardContent>
                </Card>
            </div>

            {/* Charts */}
            <Tabs defaultValue="all" className="w-full">
                <TabsList>
                    <TabsTrigger value="all">{t('devices.detail_page.tabs.all')}</TabsTrigger>
                    <TabsTrigger value="gas">{t('devices.detail_page.tabs.gas')}</TabsTrigger>
                    <TabsTrigger value="temperature">{t('devices.detail_page.tabs.temperature')}</TabsTrigger>
                    <TabsTrigger value="humidity">{t('devices.detail_page.tabs.humidity')}</TabsTrigger>
                </TabsList>

                <TabsContent value="all" className="mt-4">
                    <SensorChart data={chartData} title={t('devices.detail_page.tabs.all')} type="all" />
                </TabsContent>

                <TabsContent value="gas" className="mt-4">
                    <SensorChart data={chartData} title={t('devices.detail_page.tabs.gas')} type="gas" />
                </TabsContent>

                <TabsContent value="temperature" className="mt-4">
                    <SensorChart data={chartData} title={t('devices.detail_page.tabs.temperature')} type="temperature" />
                </TabsContent>

                <TabsContent value="humidity" className="mt-4">
                    <SensorChart data={chartData} title={t('devices.detail_page.tabs.humidity')} type="humidity" />
                </TabsContent>
            </Tabs>

            {/* Device Info */}
            <Card>
                <CardHeader>
                    <CardTitle>{t('devices.detail_page.info_card_title')}</CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="grid gap-4 md:grid-cols-2">
                        <div>
                            <p className="text-sm text-muted-foreground">{t('devices.detail_page.label_device_id')}</p>
                            <p className="font-mono">{device.device_id}</p>
                        </div>
                        <div>
                            <p className="text-sm text-muted-foreground">{t('devices.detail_page.ip_address')}</p>
                            <p className="font-mono">{device.ip_address || t('devices.detail_page.unknown')}</p>
                        </div>
                        <div>
                            <p className="text-sm text-muted-foreground">{t('devices.detail_page.mac_address')}</p>
                            <p className="font-mono">{device.mac_address || t('devices.detail_page.unknown')}</p>
                        </div>
                        <div>
                            <p className="text-sm text-muted-foreground">{t('devices.detail_page.firmware')}</p>
                            <p>v{device.firmware_version || '1.0.0'}</p>
                        </div>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}

export default DeviceDetail;
