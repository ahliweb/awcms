
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
        'articles', 'pages', 'portfolio', 'testimonies',
        'announcements', 'promotions', 'products', 'product_types',
        'themes', 'inbox', 'contact_messages'
    ],
    'Media': [
        'photo_gallery', 'photo_galleries', 'video_gallery', 'video_galleries',
        'files', 'media', 'gallery'
    ],
    'System': [
        'users', 'roles', 'permissions', 'settings', 'logs', 'backup',
        'extensions', 'languages', 'seo', 'sso', 'admin_menu',
        'sidebar_manager', 'system'
    ],
    'Navigation': [
        'menus', 'categories', 'tags', 'navigation', 'admin_navigation'
    ],
    'Interaction': [
        'contacts', 'contact_messages', 'notifications', 'messages'
    ]
};

const ACTIONS = [
    { key: 'view', label: 'View', icon: Eye, color: 'text-blue-500', bg: 'bg-blue-50', desc: 'Can view list and details' },
    { key: 'create', label: 'Create', icon: Edit, color: 'text-green-500', bg: 'bg-green-50', desc: 'Can create new items' },
    { key: 'edit', label: 'Edit (All)', icon: Edit, color: 'text-amber-500', bg: 'bg-amber-50', desc: 'Can edit ANY item (Admin level)' },
    { key: 'delete', label: 'Delete (All)', icon: Trash2, color: 'text-red-500', bg: 'bg-red-50', desc: 'Can delete ANY item (Admin level)' },
    { key: 'publish', label: 'Publish', icon: Check, color: 'text-indigo-500', bg: 'bg-indigo-50', desc: 'Can publish content live' },
    { key: 'restore', label: 'Restore', icon: RotateCcw, color: 'text-cyan-500', bg: 'bg-cyan-50', desc: 'Can restore from trash' },
    { key: 'permanent_delete', label: 'Perm Delete (Disabled)', icon: X, color: 'text-rose-600', bg: 'bg-rose-50', desc: 'Reserved. Permanent delete is disabled.' }
];

// Map UI keys to potential DB action names
const ACTION_ALIASES = {
    'view': ['view', 'read'],
    'edit': ['edit', 'update'],
    'delete': ['delete', 'remove']
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
            <div className="border rounded-lg overflow-hidden bg-white shadow-sm ring-1 ring-slate-200">
                <div className="overflow-x-auto custom-scrollbar">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="bg-slate-50/80 border-b border-slate-200">
                                <th className="p-4 text-left font-bold text-slate-700 w-64 min-w-[200px] sticky left-0 bg-slate-50 z-20 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.05)] backdrop-blur-sm">
                                    Module / Resource
                                </th>
                                {ACTIONS.map(action => (
                                    <th key={action.key} className="p-3 text-center font-semibold text-slate-600 min-w-[90px]">
                                        <TooltipProvider>
                                            <Tooltip>
                                                <TooltipTrigger className="flex flex-col items-center justify-center gap-1 cursor-help group w-full">
                                                    <div className={`p-1.5 rounded-md ${action.bg} ${action.color} mb-1 group-hover:scale-110 transition-transform`}>
                                                        <action.icon className="w-4 h-4" />
                                                    </div>
                                                    <span className="text-xs">{action.label}</span>
                                                </TooltipTrigger>
                                                <TooltipContent>
                                                    <p>{action.desc}</p>
                                                </TooltipContent>
                                            </Tooltip>
                                        </TooltipProvider>
                                    </th>
                                ))}
                                <th className="p-3 text-center font-semibold text-slate-600 w-16 sticky right-0 bg-slate-50 z-10 shadow-[-2px_0_5px_-2px_rgba(0,0,0,0.05)]">
                                    All
                                </th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {Object.entries(filteredResources).map(([category, resources]) => {
                                if (resources.length === 0) return null;
                                const isCollapsed = collapsedCategories[category];

                                return (
                                    <React.Fragment key={category}>
                                        {/* Category Header */}
                                        <tr className="bg-slate-100/50 hover:bg-slate-100 cursor-pointer" onClick={() => toggleCategory(category)}>
                                            <td colSpan={ACTIONS.length + 2} className="px-4 py-2 font-semibold text-xs text-slate-500 uppercase tracking-wider sticky left-0 z-10">
                                                <div className="flex items-center gap-2">
                                                    {isCollapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                                                    {category} <span className="bg-slate-200 text-slate-600 px-1.5 py-0.5 rounded-full text-[10px]">{resources.length}</span>
                                                </div>
                                            </td>
                                        </tr>

                                        {/* Resources */}
                                        {!isCollapsed && resources.map((resource) => {
                                            const stats = getRowStats(resource);

                                            return (
                                                <tr key={resource} className="hover:bg-slate-50 transition-colors group">
                                                    <td className="p-4 font-medium text-slate-800 bg-white sticky left-0 z-10 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.05)] capitalize border-r border-slate-100 group-hover:bg-slate-50 transition-colors">
                                                        <div className="flex items-center gap-2">
                                                            {resource.replace(/_/g, ' ')}
                                                        </div>
                                                    </td>
                                                    {ACTIONS.map(action => {
                                                        const permId = getPermissionId(permissionMap, resource, action.key);

                                                        // If permission doesn't exist for this resource
                                                        if (!permId) {
                                                            return <td key={action.key} className="p-2 text-center bg-slate-50/30">
                                                                <div className="w-1.5 h-1.5 rounded-full bg-slate-200 mx-auto" />
                                                            </td>;
                                                        }

                                                        const isSelected = selectedPermissions.has(permId);

                                                        return (
                                                            <td key={action.key} className="p-2 text-center">
                                                                <button
                                                                    type="button"
                                                                    disabled={readOnly}
                                                                    onClick={() => onToggle(permId)}
                                                                    className={`
                                                                        w-9 h-9 rounded-lg flex items-center justify-center transition-all mx-auto duration-200
                                                                        ${isSelected
                                                                            ? `${action.bg} ${action.color} shadow-sm ring-1 ring-inset ring-black/5 scale-100`
                                                                            : 'bg-white border border-slate-200 text-slate-300 hover:border-slate-300 hover:text-slate-400 scale-95 hover:scale-100'
                                                                        }
                                                                        ${readOnly ? 'cursor-default opacity-80' : 'cursor-pointer'}
                                                                    `}
                                                                    title={isSelected ? 'Granted' : 'Denied'}
                                                                >
                                                                    {isSelected ? <Check className="w-5 h-5" strokeWidth={3} /> : <X className="w-4 h-4" />}
                                                                </button>
                                                            </td>
                                                        );
                                                    })}
                                                    {/* Bulk Action Column */}
                                                    <td className="p-2 text-center sticky right-0 bg-white group-hover:bg-slate-50 z-10 shadow-[-2px_0_5px_-2px_rgba(0,0,0,0.05)] border-l border-slate-100">
                                                        <button
                                                            type="button"
                                                            disabled={readOnly}
                                                            onClick={() => handleBulkToggle(resource, !stats.all)}
                                                            className={`
                                                                w-8 h-8 rounded-md flex items-center justify-center transition-all mx-auto
                                                                ${stats.all
                                                                    ? 'text-blue-600 bg-blue-50 hover:bg-blue-100'
                                                                    : 'text-slate-400 hover:text-blue-500 hover:bg-slate-100'
                                                                }
                                                            `}
                                                            title={stats.all ? 'Deselect All' : 'Select All'}
                                                        >
                                                            {stats.all ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4" />}
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

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs text-slate-500 bg-slate-50 p-4 rounded-lg border border-slate-200">
                <div>
                    <h4 className="font-bold text-slate-700 mb-2">Legend</h4>
                    <div className="flex flex-wrap gap-3">
                        {ACTIONS.slice(0, 4).map(a => (
                            <div key={a.key} className="flex items-center gap-1.5">
                                <div className={`w-3 h-3 rounded-full ${a.bg} border ${a.color.replace('text', 'border')}`}></div>
                                <span>{a.label}</span>
                            </div>
                        ))}
                    </div>
                </div>
                <div>
                    <h4 className="font-bold text-slate-700 mb-2">Permission Logic</h4>
                    <ul className="list-disc list-inside space-y-1">
                        <li><strong>Edit (All)</strong> overrides ownership checks. Without this, users can only edit <strong>their own</strong> content.</li>
                        <li><strong>Restore</strong> allows bringing items back from the Trash bin.</li>
                        <li><strong>Permanent Delete</strong> allows completely removing items from the database (irreversible).</li>
                    </ul>
                </div>
            </div>
        </div>
    );
};

export default PermissionMatrix;
