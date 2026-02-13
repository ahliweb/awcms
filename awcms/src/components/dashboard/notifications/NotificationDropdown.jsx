
import { Bell, Check, Info, CheckCircle, AlertTriangle, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useNotifications } from '@/hooks/useNotifications';
import { formatDistanceToNow } from 'date-fns';
import { cn } from '@/lib/utils';
import { useNavigate } from 'react-router-dom';

const getIcon = (type) => {
    switch (type) {
        case 'success': return <CheckCircle className="w-4 h-4 text-green-500" />;
        case 'warning': return <AlertTriangle className="w-4 h-4 text-yellow-500" />;
        case 'error': return <XCircle className="w-4 h-4 text-red-500" />;
        default: return <Info className="w-4 h-4 text-blue-500" />;
    }
};

export function NotificationDropdown() {
    const { notifications, unreadCount, markAsRead, markAllAsRead } = useNotifications();
    const navigate = useNavigate();

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200 relative">
                    <Bell className="w-5 h-5" />
                    {unreadCount > 0 && (
                        <span className="absolute top-2 right-2 w-2.5 h-2.5 bg-red-500 rounded-full border-2 border-white dark:border-slate-900 flex items-center justify-center">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                        </span>
                    )}
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-80 sm:w-96 bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 shadow-xl z-[100]">
                <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 dark:border-slate-800">
                    <DropdownMenuLabel className="p-0 text-slate-900 dark:text-slate-100 font-semibold">Notifications ({unreadCount})</DropdownMenuLabel>
                    {unreadCount > 0 && (
                        <Button
                            variant="ghost"
                            size="sm"
                            className="h-auto text-xs text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 p-0 hover:bg-transparent"
                            onClick={() => markAllAsRead()}
                        >
                            Mark all as read
                        </Button>
                    )}
                </div>

                <ScrollArea className="h-[400px]">
                    {notifications.length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-40 text-slate-500 dark:text-slate-400">
                            <Bell className="w-8 h-8 mb-2 opacity-20" />
                            <span className="text-sm">No notifications yet</span>
                        </div>
                    ) : (
                        <div className="flex flex-col py-1">
                            {notifications.map((notification) => (
                                <DropdownMenuItem
                                    key={notification.id}
                                    className={cn(
                                        "flex items-start gap-3 p-4 cursor-default focus:bg-slate-50 dark:focus:bg-slate-800 relative group border-b border-slate-50 dark:border-slate-800/50 last:border-0",
                                        !notification.is_read ? "bg-blue-50/50 dark:bg-blue-900/10" : "dark:hover:bg-slate-800/50"
                                    )}
                                >
                                    <div className="mt-1 flex-shrink-0">
                                        {getIcon(notification.type)}
                                    </div>
                                    <div className="flex-1 space-y-1 w-full min-w-0">
                                        <div className="flex justify-between items-start">
                                            <p className={cn("text-sm font-medium truncate pr-2", !notification.is_read ? "text-slate-900 dark:text-slate-100" : "text-slate-600 dark:text-slate-300")}>
                                                {notification.title}
                                            </p>
                                            <span className="text-[10px] text-slate-400 dark:text-slate-500 whitespace-nowrap ml-1 flex-shrink-0">
                                                {formatDistanceToNow(new Date(notification.created_at), { addSuffix: true })}
                                            </span>
                                        </div>
                                        <p className="text-xs text-slate-500 dark:text-slate-400 line-clamp-2 break-words">
                                            {notification.message}
                                        </p>
                                        <div className="flex gap-2 pt-1">
                                            {notification.link && (
                                                <Button
                                                    variant="link"
                                                    className="h-auto p-0 text-xs text-blue-600 dark:text-blue-400"
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        markAsRead(notification.id);
                                                        navigate(notification.link);
                                                    }}
                                                >
                                                    Open Link
                                                </Button>
                                            )}
                                            <Button
                                                variant="link"
                                                className="h-auto p-0 text-xs text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
                                                onClick={(e) => {
                                                    e.preventDefault();
                                                    navigate(`/cmspanel/notifications/${notification.id}`);
                                                }}
                                            >
                                                View Details
                                            </Button>
                                        </div>
                                    </div>
                                    {!notification.is_read && (
                                        <div className="absolute right-2 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity">
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                className="h-8 w-8 text-blue-500 bg-white/80 dark:bg-slate-900/80 backdrop-blur-sm shadow-sm hover:bg-white dark:hover:bg-slate-800"
                                                title="Mark as read"
                                                onClick={(e) => {
                                                    e.preventDefault();
                                                    markAsRead(notification.id);
                                                }}
                                            >
                                                <Check className="w-4 h-4" />
                                            </Button>
                                        </div>
                                    )}
                                </DropdownMenuItem>
                            ))}
                        </div>
                    )}
                </ScrollArea>

                <div className="p-2 border-t border-slate-100 dark:border-slate-800">
                    <Button
                        variant="outline"
                        className="w-full text-xs h-8 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 dark:hover:bg-slate-800"
                        onClick={() => navigate('/cmspanel/notifications')}
                    >
                        View All Notifications
                    </Button>
                </div>
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
