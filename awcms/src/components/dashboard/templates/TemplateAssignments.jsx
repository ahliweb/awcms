import { useState, useMemo } from 'react';
import { useTemplates } from '@/hooks/useTemplates';
import { usePermissions } from '@/contexts/PermissionContext';
import { hooks } from '@/lib/hooks';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Monitor, Smartphone, Cpu } from 'lucide-react';

const BASE_ROUTES = [
    { type: 'home', label: 'Home Page' },
    { type: 'search', label: 'Search Results' },
    { type: 'archive', label: 'Archive (Default)' },
    { type: 'single', label: 'Single Post (Default)' },
    { type: '404', label: '404 Not Found' },
    { type: 'maintenance', label: 'Maintenance Mode' },
];

const CHANNELS = [
    { value: 'web', label: 'Web (SSR/SSG)', icon: Monitor },
    { value: 'mobile', label: 'Mobile App', icon: Smartphone },
    { value: 'esp32', label: 'IoT (ESP32)', icon: Cpu },
];

const TemplateAssignments = () => {
    const { assignments, templates, updateAssignment, loading } = useTemplates();
    const { hasPermission } = usePermissions();
    const [selectedChannel, setSelectedChannel] = useState('web');

    // Merge base routes with extension-registered page types
    const SYSTEM_ROUTES = useMemo(() => {
        return hooks.applyFilters('template_assignment_routes', [...BASE_ROUTES]);
    }, []);

    const getAssignedTemplateId = (routeType) => {
        // assignments is now an array
        const assignment = assignments.find(a => a.route_type === routeType && a.channel === selectedChannel);
        return assignment?.template_id || 'default';
    };

    const handleAssignmentChange = async (routeType, value) => {
        if (!hasPermission('tenant.setting.update')) return;
        // If value is default, we could delete? Or just set to null/default key? Use 'default' string for now.
        await updateAssignment(routeType, value, selectedChannel);
    };

    if (loading) return <div>Loading assignments...</div>;

    const pageTemplates = templates.filter(t => t.type === 'page' || !t.type);

    return (
        <div className="space-y-6 max-w-3xl">
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-sm text-blue-800">
                Define default templates for system routes per channel.
                Individual pages can override the &apos;Single Post&apos; assignment via their own settings.
            </div>

            {/* Channel Selector */}
            <div className="flex gap-4 border-b pb-6">
                {CHANNELS.map(channel => (
                    <button
                        key={channel.value}
                        onClick={() => setSelectedChannel(channel.value)}
                        className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-colors border ${selectedChannel === channel.value
                            ? 'bg-indigo-50 border-indigo-200 text-indigo-700 font-medium'
                            : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                            }`}
                    >
                        <channel.icon className="w-4 h-4" />
                        {channel.label}
                    </button>
                ))}
            </div>

            <div className="grid gap-4">
                {SYSTEM_ROUTES.map(route => {
                    const assignedId = getAssignedTemplateId(route.type);

                    return (
                        <div key={route.type} className="flex items-center justify-between p-4 bg-white border border-slate-200 rounded-lg shadow-sm">
                            <div>
                                <h4 className="font-medium text-slate-900">{route.label}</h4>
                                <p className="text-xs text-slate-500 font-mono mt-1">Route: {route.type}</p>
                            </div>

                            <div className="w-64">
                                <Select
                                    value={assignedId || ''}
                                    onValueChange={(val) => handleAssignmentChange(route.type, val)}
                                    disabled={!hasPermission('tenant.setting.update')}
                                >
                                    <SelectTrigger>
                                        <SelectValue placeholder="Select a template" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="default">
                                            <span className="text-slate-400 italic">System Default</span>
                                        </SelectItem>
                                        {pageTemplates.map(t => (
                                            <SelectItem key={t.id} value={t.id}>
                                                {t.name}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

export default TemplateAssignments;
