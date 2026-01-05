import React, { createContext, useContext, useEffect, useState } from 'react';

const STORAGE_KEY = 'awcms-dark-mode';

/**
 * Dark Mode Context
 * Manages light/dark/system theme preference
 * Separate from ThemeContext which handles tenant branding
 */
const DarkModeContext = createContext({
    mode: 'system', // 'light' | 'dark' | 'system'
    isDark: false,
    setMode: () => { },
});

export const useDarkMode = () => useContext(DarkModeContext);

export const DarkModeProvider = ({ children }) => {
    const [mode, setModeState] = useState('system');
    const [isDark, setIsDark] = useState(false);

    // Apply dark class to document
    const applyDarkClass = (dark) => {
        if (dark) {
            document.documentElement.classList.add('dark');
        } else {
            document.documentElement.classList.remove('dark');
        }
        setIsDark(dark);
    };

    // Check system preference
    const getSystemPreference = () => {
        return window.matchMedia('(prefers-color-scheme: dark)').matches;
    };

    // Update theme based on mode
    const updateTheme = (currentMode) => {
        if (currentMode === 'system') {
            applyDarkClass(getSystemPreference());
        } else {
            applyDarkClass(currentMode === 'dark');
        }
    };

    // Set mode and persist
    const setMode = (newMode) => {
        setModeState(newMode);
        localStorage.setItem(STORAGE_KEY, newMode);
        updateTheme(newMode);
    };

    // Initialize on mount
    useEffect(() => {
        const stored = localStorage.getItem(STORAGE_KEY);
        const initialMode = stored || 'system';
        setModeState(initialMode);
        updateTheme(initialMode);

        // Listen for system preference changes
        const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
        const handleChange = () => {
            if (mode === 'system') {
                applyDarkClass(getSystemPreference());
            }
        };

        mediaQuery.addEventListener('change', handleChange);
        return () => mediaQuery.removeEventListener('change', handleChange);
    }, []);

    // Update when mode changes
    useEffect(() => {
        updateTheme(mode);
    }, [mode]);

    return (
        <DarkModeContext.Provider value={{ mode, isDark, setMode }}>
            {children}
        </DarkModeContext.Provider>
    );
};
