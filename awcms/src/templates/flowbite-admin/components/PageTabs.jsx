/**
 * PageTabs Component
 * 
 * A simple tabbed interface for switching between content sections.
 * API-compatible with existing usage in ArticlesManager, PagesManager, etc.
 * Now with proper dark mode support.
 */

import React, { createContext, useContext } from 'react';
import { cn } from '@/lib/utils';

// Context for sharing active tab state
const TabsContext = createContext(null);

/**
 * PageTabs - Main container for the tabbed interface
 * 
 * @param {string} value - Currently active tab value
 * @param {function} onValueChange - Callback when tab changes
 * @param {Array} tabs - Array of tab definitions { value, label, icon?, color? }
 * @param {ReactNode} children - TabsContent children
 */
export function PageTabs({ value, onValueChange, tabs, children, className }) {
    return (
        <TabsContext.Provider value={{ activeTab: value, setActiveTab: onValueChange }}>
            <div className={cn("w-full", className)}>
                {/* Tab List */}
                {tabs && tabs.length > 0 && (
                    <div className="flex gap-1 border-b border-slate-200 dark:border-slate-700 mb-6 overflow-x-auto">
                        {tabs.map((tab) => {
                            const isActive = value === tab.value;
                            const Icon = tab.icon;

                            return (
                                <button
                                    key={tab.value}
                                    type="button"
                                    onClick={() => onValueChange(tab.value)}
                                    className={cn(
                                        "px-4 py-2.5 text-sm font-medium whitespace-nowrap transition-colors relative flex items-center gap-2",
                                        "focus:outline-none focus:ring-2 focus:ring-primary/20 rounded-t-md",
                                        isActive
                                            ? "text-primary border-b-2 border-primary -mb-px bg-background"
                                            : "text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800/50"
                                    )}
                                >
                                    {Icon && <Icon className="w-4 h-4" />}
                                    {tab.label}
                                </button>
                            );
                        })}
                    </div>
                )}

                {/* Tab Content */}
                {children}
            </div>
        </TabsContext.Provider>
    );
}

/**
 * TabsContent - Content panel for each tab
 */
export function TabsContent({ value, children, className }) {
    const context = useContext(TabsContext);

    if (!context) {
        throw new Error('TabsContent must be used within PageTabs');
    }

    const { activeTab } = context;

    if (activeTab !== value) {
        return null;
    }

    return (
        <div className={cn("animate-in fade-in-50 duration-200", className)}>
            {children}
        </div>
    );
}

// Also export TabsList and TabsTrigger for more granular control if needed
export function TabsList({ children, className }) {
    return (
        <div className={cn(
            "flex gap-1 border-b border-slate-200 dark:border-slate-700 mb-6 overflow-x-auto",
            className
        )}>
            {children}
        </div>
    );
}

export function TabsTrigger({ value, children, className }) {
    const context = useContext(TabsContext);

    if (!context) {
        throw new Error('TabsTrigger must be used within PageTabs');
    }

    const { activeTab, setActiveTab } = context;
    const isActive = activeTab === value;

    return (
        <button
            type="button"
            onClick={() => setActiveTab(value)}
            className={cn(
                "px-4 py-2.5 text-sm font-medium whitespace-nowrap transition-colors relative",
                "focus:outline-none focus:ring-2 focus:ring-primary/20 rounded-t-md",
                isActive
                    ? "text-primary border-b-2 border-primary -mb-px bg-background"
                    : "text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800/50",
                className
            )}
        >
            {children}
        </button>
    );
}

// Default export for backward compatibility
export default PageTabs;
