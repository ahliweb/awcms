
import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/customSupabaseClient';
import { ArrowLeft, CheckCircle, Clock, Info, Users, AlertTriangle, XCircle, Trash2, Mail } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useNotifications } from '@/hooks/useNotifications';
import { usePermissions } from '@/contexts/PermissionContext';
import { format } from 'date-fns';
import { useToast } from '@/components/ui/use-toast';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
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

function NotificationDetail({ id: propId }) {
    const { id: paramId } = useParams();
    const navigate = useNavigate();
    const { markAsRead, deleteNotification } = useNotifications();
    const { hasPermission, isPlatformAdmin, isFullAccess } = usePermissions();
    const [notification, setNotification] = useState(null);
    const [readers, setReaders] = useState([]);
    const [loading, setLoading] = useState(true);
    const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
    const { toast } = useToast();

    // Prioritize propId (passed from Dashboard) over paramId (from Router)
    const id = propId || paramId;

    const isSuperAdmin = isPlatformAdmin || isFullAccess;
    const canViewReaders = isSuperAdmin || hasPermission('tenant.notification.read');
    const canDelete = isSuperAdmin || hasPermission('tenant.notification.delete');

    useEffect(() => {
        if (!id || id === 'undefined') {
            navigate('/cmspanel/notifications');
            return;
        }

        const fetchDetail = async () => {
            try {
                // Fetch Notification
                // Use maybeSingle() to avoid PGRST116 if notification doesn't exist
                const { data, error } = await supabase
                    .from('notifications')
                    .select('*, sender:created_by(full_name, email)')
                    .eq('id', id)
                    .is('deleted_at', null)
                    .maybeSingle();

                if (error) throw error;

                if (!data) {
                    toast({ variant: 'destructive', title: 'Error', description: 'Notification not found' });
                    navigate('/cmspanel/notifications');
                    return;
                }

                setNotification(data);

                // Mark as read immediately
                markAsRead(id);

                // Fetch Readers (if permitted)
                if (canViewReaders) {
                    const { data: readersData, error: readersError } = await supabase
                        .from('notification_readers')
                        .select('read_at, user:user_id(full_name, email, avatar_url)')
                        .eq('notification_id', id)
                        .order('read_at', { ascending: false });

                    if (!readersError) {
                        setReaders(readersData);
                    }
                }
            } catch (err) {
                console.error(err);
                toast({ variant: 'destructive', title: 'Error', description: 'Failed to load notification details' });
                navigate('/cmspanel/notifications');
            } finally {
                setLoading(false);
            }
        };

        fetchDetail();
    }, [id, navigate, markAsRead, canViewReaders, toast]);

    if (loading) {
        return <div className="p-8 space-y-4">
            <Skeleton className="h-8 w-1/3" />
            <Skeleton className="h-32 w-full" />
        </div>;
    }

    if (!notification) return null;

    const getIcon = (type) => {
        switch (type) {
            case 'success': return <CheckCircle className="w-6 h-6 text-green-500" />;
            case 'warning': return <AlertTriangle className="w-6 h-6 text-yellow-500" />;
            case 'error': return <XCircle className="w-6 h-6 text-red-500" />;
            default: return <Info className="w-6 h-6 text-blue-500" />;
        }
    };

    const handleDelete = async () => {
        await deleteNotification(id);
        navigate('/cmspanel/notifications');
    };

    return (
        <div className="max-w-4xl mx-auto space-y-6 pb-12">
            <div className="flex items-center gap-4 mb-6">
                <Button variant="outline" onClick={() => navigate(-1)} className="border-slate-200/70 bg-white/70 hover:bg-white">
                    <ArrowLeft className="w-4 h-4 mr-2" /> Back
                </Button>
                <div className="flex-1"></div>
                {canDelete && (
                    <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
                        <AlertDialogTrigger asChild>
                            <Button variant="destructive" size="sm">
                                <Trash2 className="w-4 h-4 mr-2" /> Delete
                            </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                            <AlertDialogHeader>
                                <AlertDialogTitle>Delete this notification?</AlertDialogTitle>
                                <AlertDialogDescription>
                                    This action will remove the notification from the inbox. This cannot be undone.
                                </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                <AlertDialogAction onClick={handleDelete} className="bg-red-600 hover:bg-red-700">
                                    Delete Notification
                                </AlertDialogAction>
                            </AlertDialogFooter>
                        </AlertDialogContent>
                    </AlertDialog>
                )}
            </div>

            <Card className="dashboard-surface dashboard-surface-hover border-t-4 border-t-blue-500">
                <CardHeader className="pb-4">
                    <div className="flex items-start justify-between">
                        <div className="space-y-1">
                            <div className="flex items-center gap-3 mb-2">
                                {getIcon(notification.type)}
                                <Badge variant="outline" className="uppercase text-[10px] tracking-wide">
                                    {notification.priority || 'Normal'} Priority
                                </Badge>
                                <Badge className="bg-slate-100 text-slate-600 hover:bg-slate-200 border-0">
                                    {notification.category || 'General'}
                                </Badge>
                            </div>
                            <CardTitle className="text-2xl font-bold text-slate-900">
                                {notification.title}
                            </CardTitle>
                        </div>
                    </div>
                </CardHeader>
                <CardContent className="space-y-6">
                    <div className="prose prose-slate max-w-none bg-slate-50/70 p-6 rounded-xl border border-slate-200/70">
                        <p className="text-slate-700 whitespace-pre-wrap leading-relaxed">{notification.message}</p>
                        {notification.link && (
                            <div className="mt-4 pt-4 border-t border-slate-200">
                                <Button onClick={() => navigate(notification.link)} variant="outline" className="text-indigo-600 border-slate-200/70 bg-white/70 hover:bg-white">
                                    Open Related Link
                                </Button>
                            </div>
                        )}
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-sm">
                        <div className="space-y-3">
                            <h4 className="font-semibold text-slate-900 flex items-center gap-2">
                                <Info className="w-4 h-4 text-slate-500" /> Metadata
                            </h4>
                            <div className="grid grid-cols-2 gap-2 text-slate-600">
                                <span>Sent By:</span>
                                <span className="font-medium text-slate-900">{notification.sender?.full_name || 'System'}</span>
                                <span>Date:</span>
                                <span className="font-medium text-slate-900">{format(new Date(notification.created_at), 'PPP p')}</span>
                                <span>Target:</span>
                                <span className="font-medium text-slate-900">{notification.user_id ? 'Private' : 'Broadcast'}</span>
                            </div>
                        </div>

                        {canViewReaders && (
                            <div className="space-y-3">
                                <h4 className="font-semibold text-slate-900 flex items-center gap-2">
                                    <Users className="w-4 h-4 text-slate-500" /> Read Statistics
                                </h4>
                                <div className="bg-white border border-slate-200/70 rounded-xl p-3">
                                    <div className="flex justify-between items-center mb-2">
                                        <span className="text-slate-500">Read Count</span>
                                        <Badge variant="secondary">{readers.length}</Badge>
                                    </div>
                                    <p className="text-xs text-slate-400">
                                        Total users who have opened this notification.
                                    </p>
                                </div>
                            </div>
                        )}
                    </div>

                    {canViewReaders && readers.length > 0 && (
                        <div className="pt-6 border-t border-slate-200">
                            <h4 className="font-semibold text-slate-900 mb-4 flex items-center gap-2">
                                <Users className="w-4 h-4" /> Read By ({readers.length})
                            </h4>
                            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                                {readers.map((reader, idx) => (
                                    <div key={idx} className="flex items-center gap-3 p-3 rounded-xl bg-white border border-slate-200/70 shadow-sm hover:shadow-md transition-all">
                                        <Avatar className="h-8 w-8">
                                            <AvatarImage src={reader.user?.avatar_url} />
                                            <AvatarFallback className="bg-blue-100 text-blue-600 text-xs font-bold">
                                                {reader.user?.full_name?.charAt(0) || 'U'}
                                            </AvatarFallback>
                                        </Avatar>
                                        <div className="flex flex-col overflow-hidden">
                                            <span className="font-medium text-slate-900 truncate text-sm">
                                                {reader.user?.full_name || 'Unknown User'}
                                            </span>
                                            <span className="text-[10px] text-slate-500 flex items-center gap-1 truncate">
                                                <Mail className="w-3 h-3" />
                                                {reader.user?.email}
                                            </span>
                                            <span className="text-[10px] text-slate-400 flex items-center gap-1 mt-1">
                                                <Clock className="w-3 h-3" />
                                                {format(new Date(reader.read_at), 'MMM d, HH:mm')}
                                            </span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}

export default NotificationDetail;
