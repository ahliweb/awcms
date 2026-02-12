import React, { useState, useEffect, useCallback } from 'react';
import { useRegions } from '../../hooks/useRegions';
import { usePermissions } from '@/contexts/PermissionContext';
import { Button } from '@/components/ui/button';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbSeparator } from '@/components/ui/breadcrumb';
import { ShieldAlert, FolderTree, ChevronRight, ChevronLeft, Edit, Trash2, Plus, Search } from 'lucide-react';

/**
 * RegionsManager
 * Manages administrative regions hierarchy
 */
const RegionsManager = () => {
    const { getRegions, deleteRegion, createRegion, updateRegion, loading } = useRegions();
    const { hasPermission } = usePermissions();

    // State
    const [currentParent, setCurrentParent] = useState(null);
    const [ancestors, setAncestors] = useState([]);
    const [regions, setRegions] = useState([]);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingRegion, setEditingRegion] = useState(null);

    // Pagination & Search State
    const [page, setPage] = useState(1);
    const [pageSize] = useState(10);
    const [totalItems, setTotalItems] = useState(0);
    const [searchQuery, setSearchQuery] = useState('');
    const [debouncedSearch, setDebouncedSearch] = useState('');

    // Form State
    const [formData, setFormData] = useState({ name: '', code: '' });

    // Reset form when modal opens or editingRegion changes
    // useEffect removed to avoid set-state-in-effect error. 
    // State is now updated in the handlers that open the modal.

    const canRead = hasPermission('tenant.region.read');
    const canCreate = hasPermission('tenant.region.create');
    const canUpdate = hasPermission('tenant.region.update');
    const canDelete = hasPermission('tenant.region.delete');

    // Debounce Search
    useEffect(() => {
        const timer = setTimeout(() => {
            setDebouncedSearch(searchQuery);
            setPage(1); // Reset page on new search
        }, 500);
        return () => clearTimeout(timer);
    }, [searchQuery]);

    const loadRegions = useCallback(async () => {
        const { data, count } = await getRegions({
            parentId: currentParent?.id || null,
            page,
            pageSize,
            searchQuery: debouncedSearch
        });
        setRegions(data || []);
        setTotalItems(count || 0);
    }, [currentParent, getRegions, page, pageSize, debouncedSearch]);

    // Data Fetching
    useEffect(() => {
        if (canRead) {
            loadRegions();
        }
    }, [canRead, loadRegions]); // loadRegions depends on page/search/parent

    // Navigation
    const handleNavigateDown = (region) => {
        setAncestors([...ancestors, region]);
        setCurrentParent(region);
        setSearchQuery(''); // Clear search on navigation
        setPage(1);
    };

    const handleNavigateUp = (index) => {
        if (index === -1) {
            setAncestors([]);
            setCurrentParent(null);
        } else {
            const newAncestors = ancestors.slice(0, index + 1);
            setAncestors(newAncestors);
            setCurrentParent(newAncestors[newAncestors.length - 1]);
        }
        setSearchQuery('');
        setPage(1);
    };

    const totalPages = Math.ceil(totalItems / pageSize);

    const handleSave = async () => {
        // Validation
        if (!formData.name || !formData.code) {
            return;
        }

        try {
            if (editingRegion) {
                await updateRegion(editingRegion.id, {
                    name: formData.name,
                    code: formData.code
                });
            } else {
                const nextLevelId = currentParent ? (currentParent.level_id + 1) : 1;

                await createRegion({
                    name: formData.name,
                    code: formData.code,
                    parent_id: currentParent?.id || null,
                    level_id: nextLevelId
                });
            }
            setIsModalOpen(false);
            loadRegions();
        } catch (error) {
            console.error('Failed to save', error);
        }
    };

    if (!canRead) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[400px] bg-white rounded-xl border border-slate-200 p-12 text-center">
                <div className="p-4 bg-red-50 rounded-full mb-4">
                    <ShieldAlert className="w-12 h-12 text-red-500" />
                </div>
                <h3 className="text-xl font-bold text-slate-800">Access Denied</h3>
                <p className="text-slate-500 mt-2">You do not have permission to manage regions.</p>
            </div>
        );
    }



    return (
        <div className="p-8 space-y-6">
            <div className="flex justify-between items-center">
                <div>
                    <h1 className="text-2xl font-bold flex items-center gap-2">
                        <FolderTree className="w-6 h-6" />
                        Administrative Regions
                    </h1>
                    <p className="text-slate-500">Manage hierarchical regions</p>
                </div>
                {canCreate && (
                    <Button onClick={() => {
                        setEditingRegion(null);
                        setFormData({ name: '', code: '' });
                        setIsModalOpen(true);
                    }}>
                        <Plus className="w-4 h-4 mr-2" /> Add Region
                    </Button>
                )}
            </div>

            {/* Controls */}
            <div className="flex justify-between items-center gap-4">
                <div className="flex-1 max-w-sm relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <Input
                        placeholder="Search regions..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="pl-9"
                    />
                </div>
                {/* Breadcrumbs (only show if not searching or if explicitly navigating) */}
                {!searchQuery && (
                    <div className="flex-1 overflow-x-auto">
                        <Breadcrumb>
                            <BreadcrumbList>
                                <BreadcrumbItem>
                                    <BreadcrumbLink onClick={() => handleNavigateUp(-1)} className="cursor-pointer font-medium hover:text-blue-600">
                                        Root
                                    </BreadcrumbLink>
                                </BreadcrumbItem>
                                {ancestors.map((region, idx) => (
                                    <React.Fragment key={region.id}>
                                        <BreadcrumbSeparator><ChevronRight className="w-4 h-4" /></BreadcrumbSeparator>
                                        <BreadcrumbItem>
                                            <BreadcrumbLink onClick={() => handleNavigateUp(idx)} className="cursor-pointer font-medium hover:text-blue-600 whitespace-nowrap">
                                                {region.name}
                                            </BreadcrumbLink>
                                        </BreadcrumbItem>
                                    </React.Fragment>
                                ))}
                            </BreadcrumbList>
                        </Breadcrumb>
                    </div>
                )}
            </div>

            {/* Table */}
            <div className="border rounded-lg bg-white overflow-hidden shadow-sm">
                <Table>
                    <TableHeader>
                        <TableRow className="bg-slate-50">
                            <TableHead>Code</TableHead>
                            <TableHead>Name</TableHead>
                            <TableHead>Level</TableHead>
                            <TableHead className="text-right">Actions</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {regions.length === 0 ? (
                            <TableRow>
                                <TableCell colSpan={4} className="text-center py-8 text-slate-500">
                                    {loading ? 'Loading...' : 'No regions found.'}
                                </TableCell>
                            </TableRow>
                        ) : (
                            regions.map(region => (
                                <TableRow key={region.id}>
                                    <TableCell className="font-mono text-xs">{region.code || '-'}</TableCell>
                                    <TableCell>
                                        <div
                                            className="font-medium cursor-pointer text-blue-600 hover:underline flex items-center gap-2"
                                            onClick={() => handleNavigateDown(region)}
                                        >
                                            <FolderTree className="w-4 h-4 text-slate-400" />
                                            {region.name}
                                        </div>
                                    </TableCell>
                                    <TableCell>
                                        <span className="inline-flex items-center px-2 py-1 rounded text-xs font-medium bg-slate-100 text-slate-800">
                                            {region.level?.name || 'Unknown'}
                                        </span>
                                    </TableCell>
                                    <TableCell className="text-right space-x-2">
                                        {canUpdate && (
                                            <Button variant="ghost" size="sm" onClick={() => {
                                                setEditingRegion(region);
                                                setFormData({ name: region.name, code: region.code });
                                                setIsModalOpen(true);
                                            }}>
                                                <Edit className="w-4 h-4" />
                                            </Button>
                                        )}
                                        {canDelete && (
                                            <Button variant="ghost" size="sm" className="text-red-500 hover:text-red-600" onClick={() => deleteRegion(region.id)}>
                                                <Trash2 className="w-4 h-4" />
                                            </Button>
                                        )}
                                    </TableCell>
                                </TableRow>
                            ))
                        )}
                    </TableBody>
                </Table>
            </div>

            {/* Pagination */}
            {totalItems > 0 && (
                <div className="flex items-center justify-between">
                    <p className="text-sm text-slate-500">
                        Showing {((page - 1) * pageSize) + 1} to {Math.min(page * pageSize, totalItems)} of {totalItems} results
                    </p>
                    <div className="flex gap-2">
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setPage(p => Math.max(1, p - 1))}
                            disabled={page === 1}
                        >
                            <ChevronLeft className="w-4 h-4 mr-1" /> Previous
                        </Button>
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                            disabled={page >= totalPages}
                        >
                            Next <ChevronRight className="w-4 h-4 ml-1" />
                        </Button>
                    </div>
                </div>
            )}

            {/* Modal */}
            <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>{editingRegion ? 'Edit' : 'Add'} Region</DialogTitle>
                    </DialogHeader>
                    <div className="py-4">
                        <p className="text-sm text-slate-500 mb-4">
                            Parent: <strong>{currentParent ? currentParent.name : 'Root'}</strong>
                        </p>
                        <div className="space-y-4">
                            <div className="space-y-2">
                                <Label htmlFor="name">Region Name</Label>
                                <Input
                                    id="name"
                                    placeholder="e.g. Jawa Tengah"
                                    value={formData.name}
                                    onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                                />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="code">Region Code</Label>
                                <Input
                                    id="code"
                                    placeholder="e.g. 33"
                                    value={formData.code}
                                    onChange={(e) => setFormData(prev => ({ ...prev, code: e.target.value }))}
                                />
                            </div>
                        </div>
                    </div>
                    <div className="flex justify-end gap-2 mt-4">
                        <Button variant="outline" onClick={() => setIsModalOpen(false)}>Cancel</Button>
                        <Button onClick={handleSave} disabled={loading}>
                            {loading ? 'Saving...' : 'Save Changes'}
                        </Button>
                    </div>
                </DialogContent>
            </Dialog>
        </div>
    );
};

export default RegionsManager;
