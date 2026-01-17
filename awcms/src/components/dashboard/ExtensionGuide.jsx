
import React from 'react';
import { ArrowLeft, Code, Book, Shield, Zap, Database } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

function ExtensionGuide({ onBack }) {
   return (
      <div className="max-w-5xl mx-auto space-y-8 py-6">
         <div className="flex items-center gap-4 mb-6">
            <Button variant="ghost" size="icon" onClick={onBack}>
               <ArrowLeft className="w-5 h-5" />
            </Button>
            <div>
               <h2 className="text-3xl font-bold text-slate-800">Developer Guide</h2>
               <p className="text-slate-600">How to build and integrate extensions</p>
            </div>
         </div>

         <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Card>
               <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                     <Book className="w-5 h-5 text-blue-600" />
                     Overview
                  </CardTitle>
               </CardHeader>
               <CardContent className="text-slate-600 text-sm leading-relaxed">
                  <p className="mb-4">
                     Extensions allow you to add new features, pages, and logic to the CMS without modifying core code.
                     They are stored in the database and loaded dynamically.
                  </p>
                  <ul className="list-disc pl-5 space-y-2">
                     <li>Add custom pages to the dashboard sidebar</li>
                     <li>Register new permissions for ABAC</li>
                     <li>Store custom configuration via JSON</li>
                     <li>Hook into system events (lifecycle hooks)</li>
                  </ul>
               </CardContent>
            </Card>

            <Card>
               <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                     <Code className="w-5 h-5 text-green-600" />
                     Configuration Format
                  </CardTitle>
               </CardHeader>
               <CardContent>
                  <pre className="bg-slate-900 text-slate-50 p-4 rounded-lg text-xs font-mono overflow-x-auto">
                     {`{
  "routes": [
    {
      "path": "/my-plugin",
      "name": "My Plugin",
      "component": "MyPluginMain",
      "icon": "Puzzle" 
    }
  ],
  "permissions": [
    "view_my_plugin",
    "manage_my_plugin"
  ],
  "settings": {
    "apiKey": "..."
  }
}`}
                  </pre>
               </CardContent>
            </Card>

            <Card>
               <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                     <Shield className="w-5 h-5 text-purple-600" />
                     ABAC Integration
                  </CardTitle>
               </CardHeader>
               <CardContent className="text-slate-600 text-sm">
                  <p className="mb-3">
                     Extensions fully integrate with the Attribute-Based Access Control system.
                  </p>
                  <div className="space-y-2">
                     <div className="p-3 bg-slate-50 rounded border border-slate-100">
                        <strong className="text-slate-800 block mb-1">Defining Permissions</strong>
                        <p>Add permission keys to your config. Admin can then assign these to Roles.</p>
                     </div>
                     <div className="p-3 bg-slate-50 rounded border border-slate-100">
                        <strong className="text-slate-800 block mb-1">Checking Access</strong>
                        <p>Use the <code>useExtension</code> hook or standard <code>usePermissions</code> context to check access in your components.</p>
                     </div>
                  </div>
               </CardContent>
            </Card>

            <Card>
               <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                     <Database className="w-5 h-5 text-orange-600" />
                     Data Persistence
                  </CardTitle>
               </CardHeader>
               <CardContent className="text-slate-600 text-sm">
                  <p className="mb-4">
                     Extensions typically need to store data. You have two options:
                  </p>
                  <ol className="list-decimal pl-5 space-y-2">
                     <li>
                        <strong>Extension Config:</strong> Ideal for small settings, API keys, or preferences. Stored in the <code>config</code> JSONB column.
                     </li>
                     <li>
                        <strong>Custom Tables:</strong> For large datasets, create new tables in Supabase prefixed with your extension slug (e.g., <code>ext_analytics_events</code>).
                     </li>
                  </ol>
               </CardContent>
            </Card>
         </div>

         <div className="bg-slate-900 rounded-xl p-8 text-white">
            <div className="flex items-center gap-3 mb-4">
               <Zap className="w-6 h-6 text-yellow-400" />
               <h3 className="text-xl font-bold">Pro Tip: Extension Hooks</h3>
            </div>
            <p className="text-slate-300 mb-6 max-w-3xl">
               Use standard React hooks to interact with the CMS core. The <code>useExtension</code> hook provides
               a safe sandbox to access user details, toast notifications, and navigation without breaking the app.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
               <div className="bg-slate-800 p-4 rounded-lg border border-slate-700">
                  <code className="text-yellow-400 block mb-2">onActivate()</code>
                  <p className="text-xs text-slate-400">Triggered when admin enables the extension. Use this to initialize data or check dependencies.</p>
               </div>
               <div className="bg-slate-800 p-4 rounded-lg border border-slate-700">
                  <code className="text-yellow-400 block mb-2">onDeactivate()</code>
                  <p className="text-xs text-slate-400">Triggered on disable. Cleanup resources, stop listeners, or clear temporary state.</p>
               </div>
            </div>
         </div>
      </div>
   );
}

export default ExtensionGuide;
