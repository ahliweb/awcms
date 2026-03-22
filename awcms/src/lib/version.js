// AWCMS Version Configuration
// Package manifests are the canonical release source.
// This file mirrors the current admin UI display version.

export const VERSION = {
    // Semantic Version (Major.Minor.Patch)
    major: 4,
    minor: 4,
    patch: 0,

    // Pre-release identifier (alpha, beta, rc.1, etc.) - empty for stable
    prerelease: '',

    // Build metadata
    build: 237,

    // Release date
    date: '2026-03-20',

    // Codename (optional)
    codename: '',
};

// Computed version strings
export const getVersionString = () => {
    const base = `${VERSION.major}.${VERSION.minor}.${VERSION.patch}`;
    return VERSION.prerelease ? `${base}-${VERSION.prerelease}` : base;
};
