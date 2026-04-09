/**
 * PageTabs Component
 * 
 * A simple tabbed interface for switching between content sections.
 * API-compatible with existing usage in BlogsManager, PagesManager, etc.
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
                    <div className="mb-6 overflow-x-auto rounded-[1.4rem] border border-slate-900/10 bg-white/78 p-1.5 shadow-[0_18px_34px_-24px_rgba(15,23,42,0.35)] dark:border-white/10 dark:bg-slate-950/52">
                        <div className="flex min-w-max items-center gap-1">
                            {tabs.map((tab) => {
                                const isActive = value === tab.value;
                                const Icon = tab.icon;

                                return (
                                    <button
                                        key={tab.value}
                                        type="button"
                                        onClick={() => onValueChange(tab.value)}
                                        className={cn(
                                            "relative flex items-center gap-2 whitespace-nowrap rounded-xl border px-4 py-2.5 text-sm font-medium transition-all",
                                            "focus:outline-none focus:ring-2 focus:ring-primary/20",
                                            isActive
                                                ? "border-slate-900/10 bg-slate-950 text-white shadow-[0_18px_34px_-26px_rgba(15,23,42,0.65)] dark:border-white/10 dark:bg-white dark:text-slate-950"
                                                : "border-transparent text-muted-foreground hover:border-slate-900/10 hover:bg-accent/60 hover:text-foreground dark:hover:border-white/10"
                                        )}
                                    >
                                        {Icon && <Icon className="w-4 h-4" />}
                                        {tab.label}
                                    </button>
                                );
                            })}
                        </div>
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
            "mb-6 flex overflow-x-auto rounded-[1.4rem] border border-slate-900/10 bg-white/78 p-1.5 shadow-[0_18px_34px_-24px_rgba(15,23,42,0.35)] dark:border-white/10 dark:bg-slate-950/52",
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
                "relative whitespace-nowrap rounded-xl border px-4 py-2.5 text-sm font-medium transition-all",
                "focus:outline-none focus:ring-2 focus:ring-primary/20",
                isActive
                    ? "border-slate-900/10 bg-slate-950 text-white shadow-[0_18px_34px_-26px_rgba(15,23,42,0.65)] dark:border-white/10 dark:bg-white dark:text-slate-950"
                    : "border-transparent text-muted-foreground hover:border-slate-900/10 hover:bg-accent/60 hover:text-foreground dark:hover:border-white/10",
                className
            )}
        >
            {children}
        </button>
    );
}

// Default export for backward compatibility
export default PageTabs;
