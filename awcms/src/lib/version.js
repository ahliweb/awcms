// AWCMS Version Configuration
// This file is the single source of truth for application version

export const VERSION = {
    // Semantic Version (Major.Minor.Patch)
    major: 2,
    minor: 12,
    patch: 1,

    // Pre-release identifier (alpha, beta, rc.1, etc.) - empty for stable
    prerelease: '',

    // Build metadata
    build: 31,

    // Release date
    date: '2026-01-12',

    // Codename (optional)
    codename: 'Mailbox',
};

// Computed version strings
export const getVersionString = () => {
    const base = `${VERSION.major}.${VERSION.minor}.${VERSION.patch}`;
    return VERSION.prerelease ? `${base}-${VERSION.prerelease}` : base;
};

export const getFullVersionString = () => {
    const version = getVersionString();
    return `${version}+build.${VERSION.build}`;
};

export const getDisplayVersion = () => {
    const version = getVersionString();
    return VERSION.codename ? `v${version} "${VERSION.codename}"` : `v${version}`;
};

// Version info object for API/display
export const getVersionInfo = () => ({
    version: getVersionString(),
    fullVersion: getFullVersionString(),
    displayVersion: getDisplayVersion(),
    major: VERSION.major,
    minor: VERSION.minor,
    patch: VERSION.patch,
    prerelease: VERSION.prerelease,
    build: VERSION.build,
    date: VERSION.date,
    codename: VERSION.codename,
});

// Export default for convenience
export default VERSION;
