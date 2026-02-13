import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

/**
 * ModuleTabs - Standardized tabs component for admin modules.
 * Provides consistent styling with gradient active states.
 *
 * @param {string} value - Current active tab value
 * @param {function} onValueChange - Callback when tab changes
 * @param {Array} tabs - Array of {value, label, icon, color} objects
 *   - color: 'blue' (default), 'purple', 'emerald', 'amber', 'rose', 'slate'
 * @param {React.ReactNode} children - TabsContent elements
 */
const ModuleTabs = ({
    value,
    onValueChange,
    tabs = [],
    children
}) => {
    const colorClasses = {
        blue: 'data-[state=active]:from-blue-600 data-[state=active]:to-blue-700',
        purple: 'data-[state=active]:from-purple-600 data-[state=active]:to-purple-700',
        emerald: 'data-[state=active]:from-emerald-600 data-[state=active]:to-emerald-700',
        amber: 'data-[state=active]:from-amber-600 data-[state=active]:to-amber-700',
        rose: 'data-[state=active]:from-rose-600 data-[state=active]:to-rose-700',
        slate: 'data-[state=active]:from-slate-600 data-[state=active]:to-slate-700',
    };

    return (
        <Tabs value={value} onValueChange={onValueChange} className="w-full">
            <div className="bg-white rounded-xl border border-slate-200 p-1.5 shadow-sm mb-6 inline-flex">
                <TabsList className={`grid grid-cols-${tabs.length} gap-1 bg-transparent p-0`}>
                    {tabs.map((tab) => {
                        const Icon = tab.icon;
                        const gradient = colorClasses[tab.color || 'blue'];
                        return (
                            <TabsTrigger
                                key={tab.value}
                                value={tab.value}
                                className={`flex items-center gap-2 px-6 py-2.5 rounded-lg data-[state=active]:bg-gradient-to-r ${gradient} data-[state=active]:text-white data-[state=active]:shadow-md transition-all duration-200 font-medium`}
                            >
                                {Icon && <Icon className="w-4 h-4" />}
                                {tab.label}
                            </TabsTrigger>
                        );
                    })}
                </TabsList>
            </div>
            {children}
        </Tabs>
    );
};

// Re-export TabsContent for convenience
export { TabsContent };
export default ModuleTabs;
