import React, { useState, useEffect } from 'react';
import { useRegions } from '../../hooks/useRegions';
import { REGION_LEVELS, getNextLevel } from '../../lib/regionUtils';

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
    const [activeLevels, setActiveLevels] = useState([]);

    // Initial load of levels structure
    useEffect(() => {
        // In a real app we might fetch dynamic levels from DB, for now using static constant
        // filtered by maxLevel
        const levels = REGION_LEVELS.filter(l => l.order <= maxLevel);
        setActiveLevels(levels);
    }, [maxLevel]);

    // Load root level (Negara usually, or level 1)
    useEffect(() => {
        loadRegionsForLevel(REGION_LEVELS[0].key, null);
    }, []);

    const loadRegionsForLevel = async (levelKey, parentId) => {
        const levelObj = REGION_LEVELS.find(l => l.key === levelKey);
        if (!levelObj) return;

        // TODO: Need actual level IDs from DB in a real dynamic implementation
        // For now assuming we query by level_key if we updated the hook, but the hook uses level_id UUID.
        // We strictly need fetching the level ID first or modifying useRegions to support key.
        // Let's modify logic to fetch levels mapping first or just fallback to generic filter in hook if possible.
        // BUT since we can't easily change hook contract blindly, let's assume we fetch level UUIDs first.

        // Actually, simpler approach for this MVP:
        // Just fetch regions by parent_id. For root, parent_id is null.
        // Filter by level on client or trust the hierarchy.

        const regions = await getRegions({
            // levelId: ... we'd need to lookup ID
            parentId: parentId
        });

        setLevelsData(prev => ({
            ...prev,
            [levelKey]: regions
        }));
    };

    const handleSelection = async (levelKey, regionId) => {
        const region = levelsData[levelKey]?.find(r => r.id === regionId);

        const newSelections = { ...selections, [levelKey]: region };

        // Clear lower levels
        const levelIndex = activeLevels.findIndex(l => l.key === levelKey);
        for (let i = levelIndex + 1; i < activeLevels.length; i++) {
            delete newSelections[activeLevels[i].key];
        }

        setSelections(newSelections);

        // Notify parent
        if (onChange) {
            onChange(regionId ? region : (selections[activeLevels[levelIndex - 1]?.key] || null));
        }

        if (regionId) {
            // Load next level
            const nextLevel = getNextLevel(levelKey);
            if (nextLevel && nextLevel.order <= maxLevel) {
                await loadRegionsForLevel(nextLevel.key, regionId);
            }
        }
    };

    return (
        <div className={`space-y-3 ${className}`}>
            {activeLevels.map((level) => {
                // Show level if it's the first one OR if the previous level has a selection
                const prevLevel = activeLevels[activeLevels.findIndex(l => l.key === level.key) - 1];
                const isVisible = !prevLevel || selections[prevLevel.key];

                if (!isVisible) return null;

                const options = levelsData[level.key] || [];

                return (
                    <div key={level.key} className="form-control w-full">
                        <label className="label">
                            <span className="label-text">{level.name}</span>
                        </label>
                        <select
                            className="select select-bordered w-full"
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
