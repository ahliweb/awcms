import React, { useEffect, useState } from 'react';
import { Moon, Sun, Monitor } from 'lucide-react';
import { Button } from './ui/Button';

const STORAGE_KEY = 'awcms-public-dark-mode';

/**
 * Dark Mode Toggle for Astro (React Island Component)
 * Manages light/dark/system preference with localStorage
 */
export function DarkModeToggle() {
    const [mode, setModeState] = useState<'light' | 'dark' | 'system'>('system');
    const [isDark, setIsDark] = useState(false);
    const [isOpen, setIsOpen] = useState(false);

    // Apply dark class to document
    const applyDarkClass = (dark: boolean) => {
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
    const updateTheme = (currentMode: string) => {
        if (currentMode === 'system') {
            applyDarkClass(getSystemPreference());
        } else {
            applyDarkClass(currentMode === 'dark');
        }
    };

    // Set mode and persist
    const setMode = (newMode: 'light' | 'dark' | 'system') => {
        setModeState(newMode);
        localStorage.setItem(STORAGE_KEY, newMode);
        updateTheme(newMode);
        setIsOpen(false);
    };

    // Initialize on mount
    useEffect(() => {
        const stored = localStorage.getItem(STORAGE_KEY) as 'light' | 'dark' | 'system' | null;
        const initialMode = stored || 'system';
        setModeState(initialMode);
        updateTheme(initialMode);

        // Listen for system preference changes
        const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
        const handleChange = () => {
            const currentMode = localStorage.getItem(STORAGE_KEY) || 'system';
            if (currentMode === 'system') {
                applyDarkClass(getSystemPreference());
            }
        };

        mediaQuery.addEventListener('change', handleChange);
        return () => mediaQuery.removeEventListener('change', handleChange);
    }, []);

    const getIcon = () => {
        if (mode === 'system') {
            return <Monitor className="h-4 w-4" />;
        }
        return isDark ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />;
    };

    return (
        <div className="relative">
            <Button
                variant="ghost"
                onClick={() => setIsOpen(!isOpen)}
                className="h-9 w-9 p-0"
            >
                {getIcon()}
                <span className="sr-only">Toggle theme</span>
            </Button>

            {isOpen && (
                <>
                    <div
                        className="fixed inset-0 z-40"
                        onClick={() => setIsOpen(false)}
                    />
                    <div className="absolute right-0 top-full mt-2 z-50 w-36 rounded-md border bg-background shadow-lg">
                        <button
                            onClick={() => setMode('light')}
                            className={`flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-accent ${mode === 'light' ? 'bg-accent' : ''}`}
                        >
                            <Sun className="h-4 w-4" />
                            Light
                        </button>
                        <button
                            onClick={() => setMode('dark')}
                            className={`flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-accent ${mode === 'dark' ? 'bg-accent' : ''}`}
                        >
                            <Moon className="h-4 w-4" />
                            Dark
                        </button>
                        <button
                            onClick={() => setMode('system')}
                            className={`flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-accent ${mode === 'system' ? 'bg-accent' : ''}`}
                        >
                            <Monitor className="h-4 w-4" />
                            System
                        </button>
                    </div>
                </>
            )}
        </div>
    );
}

export default DarkModeToggle;
