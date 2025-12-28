/**
 * Region Utility Functions
 * Helper functions for handling administrative region hierarchy
 */

export const REGION_LEVELS = [
    { key: 'negara', name: 'Negara', order: 1 },
    { key: 'pulau', name: 'Pulau', order: 2 },
    { key: 'prop', name: 'Provinsi', order: 3 },
    { key: 'kota_kab', name: 'Kota/Kabupaten', order: 4 },
    { key: 'kec', name: 'Kecamatan', order: 5 },
    { key: 'kel_desa', name: 'Kelurahan/Desa', order: 6 },
    { key: 'dk_ds', name: 'Dukuh/Dusun', order: 7 },
    { key: 'rw', name: 'RW', order: 8 },
    { key: 'rt', name: 'RT', order: 9 },
    { key: 'kk', name: 'Kepala Keluarga', order: 10 },
];

/**
 * Build a full path string for display
 * @param {Array} ancestors - List of ancestor region objects
 * @param {Object} currentRegion - The current region object
 * @returns {String} Full path string (e.g. "Indonesia > Jawa Tengah > Semarang")
 */
export const buildRegionPath = (ancestors = [], currentRegion) => {
    const parts = [...ancestors, currentRegion].filter(Boolean);
    return parts.map(r => r.name).join(' > ');
};

/**
 * Get the next level key based on current level
 * @param {String} currentLevelKey 
 * @returns {Object|null} Next level object or null
 */
export const getNextLevel = (currentLevelKey) => {
    if (!currentLevelKey) return REGION_LEVELS[0];
    const currentIndex = REGION_LEVELS.findIndex(l => l.key === currentLevelKey);
    if (currentIndex === -1 || currentIndex === REGION_LEVELS.length - 1) return null;
    return REGION_LEVELS[currentIndex + 1];
};

/**
 * Sort regions by name
 * @param {Array} regions 
 * @returns {Array} Sorted regions
 */
export const sortRegionsByName = (regions) => {
    return [...regions].sort((a, b) => a.name.localeCompare(b.name));
};
