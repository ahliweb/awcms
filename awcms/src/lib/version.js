// AWCMS Version Configuration
// Package manifests are the canonical release source.
// This file mirrors the current admin UI display version.

export const VERSION = {
    // Semantic Version (Major.Minor.Patch)
    major: 4,
    minor: 6,
    patch: 0,

    // Pre-release identifier (alpha, beta, rc.1, etc.) - empty for stable
    prerelease: '',

    // Build metadata
    build: 241,

    // Release date
    date: '2026-04-09',

    // Codename (optional)
    codename: '',
};

// Computed version strings
// - getVersionString(): package/runtime-safe semver (e.g. 4.5.2)
// - getReleaseLabel(): human-facing release label (e.g. v4.5.2)
export const getVersionString = () => {
    const base = `${VERSION.major}.${VERSION.minor}.${VERSION.patch}`;
    return VERSION.prerelease ? `${base}-${VERSION.prerelease}` : base;
};

export const getReleaseLabel = () => `v${getVersionString()}`;

export const RELEASE_LABEL = getReleaseLabel();
