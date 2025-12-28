import React, { useState, useEffect } from 'react';
import { useRegions } from '../../hooks/useRegions';
import { REGION_LEVELS } from '../../lib/regionUtils';
import ModuleHeader from '../../components/ModuleHeader';
import RegionBreadcrumb from '../../components/ui/RegionBreadcrumb';

/**
 * Regions Manager Module
 * Allows admins to manage administrative regions hierarchy
 */
const RegionsManager = () => {
    const { getRegions, createRegion, updateRegion, deleteRegion, loading } = useRegions();

    // State
    const [currentParent, setCurrentParent] = useState(null); // Current navigation root
    const [ancestors, setAncestors] = useState([]); // Path to current parent
    const [regions, setRegions] = useState([]);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingRegion, setEditingRegion] = useState(null);

    // Data Fetching
    useEffect(() => {
        loadRegions();
    }, [currentParent]);

    const loadRegions = async () => {
        // If no parent, we are at root (Negara level usually)
        const data = await getRegions({ parentId: currentParent?.id || null });
        setRegions(data || []);
    };

    // Navigation Logic
    const handleNavigateDown = (region) => {
        setAncestors([...ancestors, region]);
        setCurrentParent(region);
    };

    const handleNavigateUp = (index) => {
        // Navigate to specific ancestor
        if (index === -1) {
            // Root
            setAncestors([]);
            setCurrentParent(null);
        } else {
            const newAncestors = ancestors.slice(0, index + 1);
            setAncestors(newAncestors);
            setCurrentParent(newAncestors[newAncestors.length - 1]);
        }
    };

    // CRUD Handlers
    const handleSave = async (e) => {
        e.preventDefault();
        const formData = new FormData(e.target);
        const data = {
            name: formData.get('name'),
            code: formData.get('code'),
            // Determine level: if currentParent is null, assume root (level order 1)
            // If currentParent exists, find next level based on parent's level
        };

        // For now, let's just refresh.
        loadRegions();
        setIsModalOpen(false);
    };

    const handleDelete = async (id) => {
        if (confirm('Are you sure? This will delete all child regions as well (if using cascade).')) {
            await deleteRegion(id);
            loadRegions();
        }
    };

    return (
        <div className="p-6">
            <ModuleHeader
                title="Administrative Regions"
                description="Manage hierarchical regions (Negara -> ... -> RT/RW)"
            />

            <div className="flex justify-between items-center mb-6">
                {/* Breadcrumb Navigation */}
                <div className="breadcrumbs text-sm">
                    <ul>
                        <li><a onClick={() => handleNavigateUp(-1)}>Root</a></li>
                        {ancestors.map((region, idx) => (
                            <li key={region.id}>
                                <a onClick={() => handleNavigateUp(idx)}>{region.name}</a>
                            </li>
                        ))}
                    </ul>
                </div>

                <button className="btn btn-primary" onClick={() => { setEditingRegion(null); setIsModalOpen(true); }}>
                    Add Region
                </button>
            </div>

            <div className="overflow-x-auto bg-base-100 rounded-box shadow">
                <table className="table">
                    <thead>
                        <tr>
                            <th>Code</th>
                            <th>Name</th>
                            <th>Level</th>
                            <th>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {regions.length === 0 ? (
                            <tr><td colSpan="4" className="text-center">No regions found.</td></tr>
                        ) : (
                            regions.map(region => (
                                <tr key={region.id} className="hover">
                                    <td>{region.code || '-'}</td>
                                    <td className="font-medium cursor-pointer text-primary" onClick={() => handleNavigateDown(region)}>
                                        {region.name}
                                    </td>
                                    <td>{region.level?.name || 'Unknown'}</td>
                                    <td>
                                        <button className="btn btn-ghost btn-xs" onClick={() => { setEditingRegion(region); setIsModalOpen(true); }}>Edit</button>
                                        <button className="btn btn-ghost btn-xs text-error" onClick={() => handleDelete(region.id)}>Delete</button>
                                    </td>
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
            </div>

            {isModalOpen && (
                <div className="modal modal-open">
                    <div className="modal-box">
                        <h3 className="font-bold text-lg">{editingRegion ? 'Edit' : 'Add'} Region</h3>
                        <p className="py-4">Under Construction: Form logic requires sync with Level IDs.</p>
                        <div className="modal-action">
                            <button className="btn" onClick={() => setIsModalOpen(false)}>Close</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default RegionsManager;
