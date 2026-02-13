import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const HelloWorldWidget = () => (
    <Card className="mb-6 border-blue-200 bg-blue-50">
        <CardHeader className="pb-2">
            <CardTitle className="text-blue-700">Hello from Plugin!</CardTitle>
        </CardHeader>
        <CardContent>
            <p className="text-blue-600">This widget was injected via the <strong>dashboard_top</strong> action hook.</p>
        </CardContent>
    </Card>
);

export const register = ({ addAction, addFilter }) => {
    console.log("Hello World Plugin Registered!");

    // Action: Add widget to dashboard top
    addAction('dashboard_top', 'hello_world_widget', () => {
        // Since PluginAction uses the 'applyFilters' pattern internally or renders components pushed to it?
        // Wait, my PluginAction implementation in PluginContext.jsx uses:
        // const components = applyFilters(name, []);
        // So I should use addFilter to append to the array.
        // BUT, I named the prop 'addAction' in the context...

        // Let's re-read PluginAction in PluginContext.jsx:
        // "const components = applyFilters(name, []);"

        // So to inject into <PluginAction name="foo">, I must use addFilter('foo', ...)
        // The 'addAction' is for pure logic events (like 'plugins_loaded').

        // CORRECTION: 'PluginAction' is a UI slot. It uses filters to gather components.
        // So I must use addFilter.
    });

    addFilter('dashboard_top', 'hello_world_widget_render', (components) => {
        return [...components, HelloWorldWidget];
    });

    // Filter: Modify Sidebar Menu
    addFilter('admin_sidebar_menu', 'hello_world_menu', (items) => {
        return [
            ...items,
            {
                key: 'hello_world',
                label: 'Hello Plugin',
                path: 'hello-world', // This won't work without a route, but shows in menu
                icon: 'Star',
                group_label: 'Plugins'
            }
        ];
    });
};

export default HelloWorldWidget; // Default export for registry fallback if needed
