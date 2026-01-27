
import React, { useMemo, useState } from 'react';
import {
    Check, X, Search, Filter, ChevronDown, ChevronRight,
    Eye, Edit, Trash2, RotateCcw, CheckSquare, Square
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

// Defined Resource Categories for better organization
const RESOURCE_CATEGORIES = {
    'Content': [
        'blogs', 'pages', 'visual_pages', 'portfolio', 'testimonies',
        'announcements', 'promotions', 'products', 'product_types',
        'themes', 'widgets', 'templates', 'contact_messages'
    ],
    'Media': [
        'photo_gallery', 'photo_galleries', 'video_gallery', 'video_galleries',
        'files', 'media', 'galleries'
    ],
    'Commerce': [
        'orders', 'products', 'product_types'
    ],
    'System': [
        'users', 'roles', 'permissions', 'policies', 'settings', 'audit', 'backups',
        'extensions', 'languages', 'seo', 'sso', 'admin_menu',
        'sidebar_manager', 'system'
    ],
    'Navigation': [
        'menus', 'categories', 'tags', 'navigation', 'admin_navigation'
    ],
    'Communication': [
        'contacts', 'contact_messages', 'notifications', 'messages', 'email'
    ],
    'Platform': [
        'tenant', 'tenants', 'platform', 'dashboard', '2fa', 'content', 'tenant.region'
    ],
    'Plugins': [
        'regions', 'mailketing', 'analytics'
    ],
    'Mobile & IoT': [
        'mobile', 'iot'
    ]
};



const ACTIONS = [
    { key: 'create', label: 'C', fullLabel: 'Create', icon: Edit, color: 'text-green-500', bg: 'bg-green-50', desc: 'Can create new items' },
    { key: 'read', label: 'R', fullLabel: 'Read', icon: Eye, color: 'text-blue-500', bg: 'bg-blue-50', desc: 'Can view list and details' },
    { key: 'update', label: 'U', fullLabel: 'Update', icon: Edit, color: 'text-amber-500', bg: 'bg-amber-50', desc: 'Can edit items (All or Own based on role)' },
    { key: 'publish', label: 'P', fullLabel: 'Publish', icon: Check, color: 'text-indigo-500', bg: 'bg-indigo-50', desc: 'Can publish content live' },
    { key: 'soft_delete', label: 'SD', fullLabel: 'Soft Delete', icon: Trash2, color: 'text-orange-500', bg: 'bg-orange-50', desc: 'Can move items to trash' },
    { key: 'restore', label: 'RS', fullLabel: 'Restore', icon: RotateCcw, color: 'text-cyan-500', bg: 'bg-cyan-50', desc: 'Can restore items from trash' },
    { key: 'delete_permanent', label: 'DP', fullLabel: 'Delete Permanent', icon: X, color: 'text-rose-600', bg: 'bg-rose-50', desc: 'Can permanently delete (irreversible)' }
];

// Map UI keys to potential legacy DB action names for backwards compatibility
const ACTION_ALIASES = {
    'create': ['create'],
    'read': ['read', 'view'],
    'update': ['update', 'edit'],
    'publish': ['publish'],
    'soft_delete': ['soft_delete', 'delete'],
    'restore': ['restore'],
    'delete_permanent': ['delete_permanent', 'permanent_delete']
};

const getPermissionId = (map, resource, actionKey) => {
    if (!map[resource]) return null;

    // Check aliases
    const aliases = ACTION_ALIASES[actionKey] || [actionKey];
    for (const alias of aliases) {
        if (map[resource][alias]) return map[resource][alias];
    }
    return null;
};

const PermissionMatrix = ({ permissions = [], selectedPermissions = new Set(), onToggle, readOnly = false }) => {
    const [searchTerm, setSearchTerm] = useState('');
    const [filterCategory, setFilterCategory] = useState('All');
    const [collapsedCategories, setCollapsedCategories] = useState({});

    // 1. Group Permissions by Resource for easy lookup
    // Map: resource -> action -> permissionId
    const permissionMap = useMemo(() => {
        const map = {};
        permissions.forEach(p => {
            if (!map[p.resource]) map[p.resource] = {};
            map[p.resource][p.action] = p.id;
        });
        return map;
    }, [permissions]);

    // 2. Identify all unique resources from permissions list
    const allResources = useMemo(() => Object.keys(permissionMap).sort(), [permissionMap]);

    // 3. Filter and Group Resources
    const filteredResources = useMemo(() => {
        let resources = allResources;

        if (searchTerm) {
            resources = resources.filter(r => r.toLowerCase().includes(searchTerm.toLowerCase()));
        }

        const grouped = {};
        const uncategorized = [];

        resources.forEach(res => {
            let found = false;
            for (const [cat, items] of Object.entries(RESOURCE_CATEGORIES)) {
                if (items.includes(res)) {
                    if (!grouped[cat]) grouped[cat] = [];
                    grouped[cat].push(res);
                    found = true;
                    break;
                }
            }
            if (!found) uncategorized.push(res);
        });

        if (uncategorized.length > 0) grouped['Other'] = uncategorized;

        // Apply category filter
        if (filterCategory !== 'All') {
            return { [filterCategory]: grouped[filterCategory] || [] };
        }

        return grouped;
    }, [allResources, searchTerm, filterCategory]);

    const toggleCategory = (cat) => {
        setCollapsedCategories(prev => ({ ...prev, [cat]: !prev[cat] }));
    };

    const handleBulkToggle = (resource, shouldSelect) => {
        if (readOnly) return;
        const permissionIds = [];
        ACTIONS.forEach(action => {
            const pid = getPermissionId(permissionMap, resource, action.key);
            if (pid) permissionIds.push(pid);
        });

        // We need to pass individual IDs to parent
        permissionIds.forEach(pid => {
            if (selectedPermissions.has(pid) !== shouldSelect) {
                onToggle(pid);
            }
        });
    };

    // Calculate row stats
    const getRowStats = (resource) => {
        let total = 0;
        let selected = 0;
        ACTIONS.forEach(action => {
            const pid = getPermissionId(permissionMap, resource, action.key);
            if (pid) {
                total++;
                if (selectedPermissions.has(pid)) selected++;
            }
        });
        return { total, selected, all: total > 0 && total === selected };
    };

    return (
        <div className="space-y-4">
            {/* Toolbar */}
            <div className="flex flex-col sm:flex-row gap-4 justify-between items-start sm:items-center bg-slate-50 p-3 rounded-lg border border-slate-200">
                <div className="flex items-center gap-2 w-full sm:w-auto">
                    <div className="relative w-full sm:w-64">
                        <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                        <Input
                            placeholder="Search modules..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="pl-9 bg-white"
                        />
                    </div>
                </div>
                <div className="flex items-center gap-2 overflow-x-auto w-full sm:w-auto pb-2 sm:pb-0">
                    <Filter className="w-4 h-4 text-slate-400" />
                    <div className="flex gap-1">
                        <button
                            type="button"
                            onClick={() => setFilterCategory('All')}
                            className={`px-3 py-1 rounded-full text-xs font-medium transition-colors whitespace-nowrap ${filterCategory === 'All' ? 'bg-slate-800 text-white' : 'bg-white border text-slate-600 hover:bg-slate-100'}`}
                        >
                            All
                        </button>
                        {Object.keys(RESOURCE_CATEGORIES).map(cat => (
                            <button
                                type="button"
                                key={cat}
                                onClick={() => setFilterCategory(cat)}
                                className={`px-3 py-1 rounded-full text-xs font-medium transition-colors whitespace-nowrap ${filterCategory === cat ? 'bg-slate-800 text-white' : 'bg-white border text-slate-600 hover:bg-slate-100'}`}
                            >
                                {cat}
                            </button>
                        ))}
                    </div>
                </div>
            </div>

            {/* Matrix Grid */}
            <div className="border rounded-lg overflow-hidden bg-white dark:bg-slate-900 shadow-sm ring-1 ring-slate-200 dark:ring-slate-700">
                <div className="overflow-x-auto custom-scrollbar">
                    <table className="w-full text-sm min-w-[800px]">
                        <thead className="sticky top-0 z-30">
                            <tr className="bg-slate-50/95 dark:bg-slate-800/95 border-b border-slate-200 dark:border-slate-700 backdrop-blur-sm">
                                <th className="p-3 text-left font-bold text-slate-700 dark:text-slate-200 w-48 min-w-[180px] sticky left-0 bg-slate-50/95 dark:bg-slate-800/95 z-30 shadow-[2px_0_8px_-2px_rgba(0,0,0,0.1)] dark:shadow-[2px_0_8px_-2px_rgba(0,0,0,0.3)]">
                                    Module / Resource
                                </th>
                                {ACTIONS.map(action => (
                                    <th key={action.key} className="p-2 text-center font-semibold text-slate-600 dark:text-slate-300 w-[70px]">
                                        <TooltipProvider>
                                            <Tooltip>
                                                <TooltipTrigger className="flex flex-col items-center justify-center gap-0.5 cursor-help group w-full">
                                                    <div className={`p-1 rounded-md ${action.bg} dark:opacity-90 ${action.color} group-hover:scale-110 transition-transform`}>
                                                        <action.icon className="w-3.5 h-3.5" />
                                                    </div>
                                                    <span className="text-[10px] font-medium">{action.label}</span>
                                                </TooltipTrigger>
                                                <TooltipContent className="dark:bg-slate-800 dark:text-slate-200">
                                                    <p>{action.desc}</p>
                                                </TooltipContent>
                                            </Tooltip>
                                        </TooltipProvider>
                                    </th>
                                ))}
                                <th className="p-2 text-center font-semibold text-slate-600 dark:text-slate-300 w-14 sticky right-0 bg-slate-50/95 dark:bg-slate-800/95 z-30 shadow-[-2px_0_8px_-2px_rgba(0,0,0,0.1)] dark:shadow-[-2px_0_8px_-2px_rgba(0,0,0,0.3)]">
                                    <span className="text-[10px]">All</span>
                                </th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                            {Object.entries(filteredResources).map(([category, resources]) => {
                                if (resources.length === 0) return null;
                                const isCollapsed = collapsedCategories[category];

                                return (
                                    <React.Fragment key={category}>
                                        {/* Category Header */}
                                        <tr className="bg-slate-100/70 dark:bg-slate-800/70 hover:bg-slate-100 dark:hover:bg-slate-700 cursor-pointer" onClick={() => toggleCategory(category)}>
                                            <td colSpan={ACTIONS.length + 2} className="px-3 py-2 font-semibold text-xs text-slate-500 dark:text-slate-400 uppercase tracking-wider sticky left-0 z-10 bg-slate-100/70 dark:bg-slate-800/70">
                                                <div className="flex items-center gap-2">
                                                    {isCollapsed ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                                                    {category} <span className="bg-slate-200 dark:bg-slate-600 text-slate-600 dark:text-slate-200 px-1.5 py-0.5 rounded-full text-[10px]">{resources.length}</span>
                                                </div>
                                            </td>
                                        </tr>

                                        {/* Resources */}
                                        {!isCollapsed && resources.map((resource) => {
                                            const stats = getRowStats(resource);

                                            return (
                                                <tr key={resource} className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors group">
                                                    <td className="p-3 font-medium text-slate-800 dark:text-slate-200 bg-white dark:bg-slate-900 sticky left-0 z-10 shadow-[2px_0_8px_-2px_rgba(0,0,0,0.08)] dark:shadow-[2px_0_8px_-2px_rgba(0,0,0,0.25)] capitalize border-r border-slate-100 dark:border-slate-700 group-hover:bg-slate-50 dark:group-hover:bg-slate-800/50 transition-colors">
                                                        <div className="flex items-center gap-2">
                                                            {resource.replace(/_/g, ' ')}
                                                        </div>
                                                    </td>
                                                    {ACTIONS.map(action => {
                                                        const permId = getPermissionId(permissionMap, resource, action.key);

                                                        // If permission doesn't exist for this resource
                                                        if (!permId) {
                                                            return <td key={action.key} className="p-1.5 text-center bg-slate-50/30 dark:bg-slate-800/30">
                                                                <div className="w-1.5 h-1.5 rounded-full bg-slate-200 dark:bg-slate-600 mx-auto" />
                                                            </td>;
                                                        }

                                                        const isSelected = selectedPermissions.has(permId);

                                                        return (
                                                            <td key={action.key} className="p-1.5 text-center">
                                                                <button
                                                                    type="button"
                                                                    disabled={readOnly}
                                                                    onClick={() => onToggle(permId)}
                                                                    className={`
                                                                        w-8 h-8 rounded-lg flex items-center justify-center transition-all mx-auto duration-200
                                                                        ${isSelected
                                                                            ? `${action.bg} dark:opacity-90 ${action.color} shadow-sm ring-1 ring-inset ring-black/5 dark:ring-white/10 scale-100`
                                                                            : 'bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-600 text-slate-300 dark:text-slate-500 hover:border-slate-300 dark:hover:border-slate-500 hover:text-slate-400 scale-95 hover:scale-100'
                                                                        }
                                                                        ${readOnly ? 'cursor-default opacity-80' : 'cursor-pointer'}
                                                                    `}
                                                                    title={isSelected ? 'Granted' : 'Denied'}
                                                                >
                                                                    {isSelected ? <Check className="w-4 h-4" strokeWidth={3} /> : <X className="w-3.5 h-3.5" />}
                                                                </button>
                                                            </td>
                                                        );
                                                    })}
                                                    {/* Bulk Action Column */}
                                                    <td className="p-1.5 text-center sticky right-0 bg-white dark:bg-slate-900 group-hover:bg-slate-50 dark:group-hover:bg-slate-800/50 z-10 shadow-[-2px_0_8px_-2px_rgba(0,0,0,0.08)] dark:shadow-[-2px_0_8px_-2px_rgba(0,0,0,0.25)] border-l border-slate-100 dark:border-slate-700">
                                                        <button
                                                            type="button"
                                                            disabled={readOnly}
                                                            onClick={() => handleBulkToggle(resource, !stats.all)}
                                                            className={`
                                                                w-7 h-7 rounded-md flex items-center justify-center transition-all mx-auto
                                                                ${stats.all
                                                                    ? 'text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/40 hover:bg-blue-100 dark:hover:bg-blue-900/60'
                                                                    : 'text-slate-400 dark:text-slate-500 hover:text-blue-500 hover:bg-slate-100 dark:hover:bg-slate-700'
                                                                }
                                                            `}
                                                            title={stats.all ? 'Deselect All' : 'Select All'}
                                                        >
                                                            {stats.all ? <CheckSquare className="w-3.5 h-3.5" /> : <Square className="w-3.5 h-3.5" />}
                                                        </button>
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </React.Fragment>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-800/50 p-4 rounded-lg border border-slate-200 dark:border-slate-700">
                <div>
                    <h4 className="font-bold text-slate-700 dark:text-slate-200 mb-2">Legend</h4>
                    <div className="flex flex-wrap gap-2">
                        {ACTIONS.map(a => (
                            <div key={a.key} className="flex items-center gap-1.5">
                                <div className={`w-3 h-3 rounded-full ${a.bg} border ${a.color.replace('text', 'border')}`}></div>
                                <span><strong>{a.label}</strong>: {a.fullLabel}</span>
                            </div>
                        ))}
                    </div>
                </div>
                <div>
                    <h4 className="font-bold text-slate-700 dark:text-slate-200 mb-2">Permission Logic</h4>
                    <ul className="list-disc list-inside space-y-1 text-slate-600 dark:text-slate-400">
                        <li><strong>U (Update)</strong>: Authors can only edit <strong>their own</strong> content.</li>
                        <li><strong>RS (Restore)</strong>: Allows bringing items back from Trash.</li>
                        <li><strong>DP (Delete Permanent)</strong>: Irreversible. Reserved for platform admin roles.</li>
                    </ul>
                </div>
            </div>
        </div >
    );
};

export default PermissionMatrix;
