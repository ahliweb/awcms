import React, { useState, useEffect, useCallback } from 'react';
import { useRegions } from '../../hooks/useRegions';
import { REGION_LEVELS } from '../../lib/regionUtils'; // Fallback levels


/**
 * Region Picker Component
 * Cascading dropdowns for selecting regions down to a specific level
 */
const RegionPicker = ({
    value,
    onChange,
    maxLevel = 10,
    className = ''
}) => {
    // value is the leaf region ID selected
    const [selections, setSelections] = useState({});
    const [levelsData, setLevelsData] = useState({});
    const { getRegions, getLevels } = useRegions();
    const [allLevels, setAllLevels] = useState([]);
    const [activeLevels, setActiveLevels] = useState([]);
    const [loadingLevels, setLoadingLevels] = useState(true);

    // Initial load of levels structure from DB
    useEffect(() => {
        const fetchLevels = async () => {
            setLoadingLevels(true);
            const levels = await getLevels();
            if (levels && levels.length > 0) {
                // Map DB level_order to standard order property if needed, or just use level_order
                // Assuming DB has 'key', 'name', 'level_order', 'id'
                const normalizedLevels = levels.map(l => ({
                    ...l,
                    order: l.level_order || l.order // Handle both cases
                }));
                setAllLevels(normalizedLevels);
            } else {
                // Fallback to static if fetch fails/empty (optional, but good for safety)
                setAllLevels(REGION_LEVELS);
            }
            setLoadingLevels(false);
        };
        fetchLevels();
    }, [getLevels]);

    // Filter levels by maxLevel whenever allLevels changes or maxLevel changes
    useEffect(() => {
        if (allLevels.length > 0) {
            const filtered = allLevels.filter(l => l.order <= maxLevel);
            setActiveLevels(filtered);
        }
    }, [allLevels, maxLevel]);

    const loadRegionsForLevel = useCallback(async (levelKey, parentId) => {
        // Find level object in our dynamic state
        const levelObj = allLevels.find(l => l.key === levelKey);
        if (!levelObj) return;

        const regions = await getRegions({
            levelId: levelObj.id, // Use the UUID from the DB
            parentId: parentId
        });

        setLevelsData(prev => ({
            ...prev,
            [levelKey]: regions.data || regions // Handle {data, count} or plain array return from hook
        }));
    }, [getRegions, allLevels]);

    // Load root level once levels are loaded
    useEffect(() => {
        if (allLevels.length > 0 && activeLevels.length > 0) {
            // Root level is the one with the lowest order
            const rootLevel = activeLevels.reduce((prev, curr) => (prev.order < curr.order ? prev : curr));
            loadRegionsForLevel(rootLevel.key, null);
        }
    }, [allLevels, activeLevels, loadRegionsForLevel]);

    const handleSelection = async (levelKey, regionId) => {
        const region = levelsData[levelKey]?.find(r => r.id === regionId);

        const newSelections = { ...selections, [levelKey]: region };

        // Clear lower levels
        // We need to find the index in activeLevels
        const levelIndex = activeLevels.findIndex(l => l.key === levelKey);

        // Clear subsequent selections in state
        for (let i = levelIndex + 1; i < activeLevels.length; i++) {
            delete newSelections[activeLevels[i].key];
            // Also optionally clear the data for lower levels to force re-fetch? 
            // Or just keep it but it won't be shown/valid. 
            // Resetting UI is handled by rendering logic based on isVisible.
        }

        setSelections(newSelections);

        // Notify parent
        if (onChange) {
            // Pass the most specific selected region
            onChange(regionId ? region : (selections[activeLevels[levelIndex - 1]?.key] || null));
        }

        if (regionId) {
            // Load next level
            const nextLevelIndex = levelIndex + 1;
            if (nextLevelIndex < activeLevels.length) {
                const nextLevel = activeLevels[nextLevelIndex];
                await loadRegionsForLevel(nextLevel.key, regionId);
            }
        }
    };

    if (loadingLevels) {
        return <div className="text-sm text-gray-500 animate-pulse">Loading region levels...</div>;
    }

    return (
        <div className={`space-y-3 ${className}`}>
            {activeLevels.map((level, index) => {
                // Show level if it's the first one OR if the previous level has a selection
                const prevLevel = index > 0 ? activeLevels[index - 1] : null;
                const isVisible = !prevLevel || selections[prevLevel.key];

                if (!isVisible) return null;

                const options = levelsData[level.key] || [];

                return (
                    <div key={level.key} className="form-control w-full">
                        <label className="label">
                            <span className="label-text">{level.name}</span>
                        </label>
                        <select
                            className="select select-bordered w-full dark:bg-slate-800 dark:text-slate-200 dark:border-slate-600"
                            value={selections[level.key]?.id || ''}
                            onChange={(e) => handleSelection(level.key, e.target.value)}
                        >
                            <option value="">Pilih {level.name}</option>
                            {options.map((option) => (
                                <option key={option.id} value={option.id}>
                                    {option.name}
                                </option>
                            ))}
                        </select>
                    </div>
                );
            })}
        </div>
    );
};

export default RegionPicker;
