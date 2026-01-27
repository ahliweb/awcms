import React, { useState } from 'react';
import { AdminPageLayout, PageHeader, PageTabs, TabsContent } from '@/templates/flowbite-admin';
import TemplatesList from './templates/TemplatesList';
import TemplatePartsList from './templates/TemplatePartsList';
import TemplateAssignments from './templates/TemplateAssignments';
import TemplateLanguageManager from './templates/TemplateLanguageManager';
import { Layout, Puzzle, Link2, Languages } from 'lucide-react';

/**
 * TemplatesManager - Manages admin templates and configurations.
 * RESTRICTED: Only accessible to platform admin or full-access roles.
 * Refactored to use awadmintemplate01 with ABAC enforcement.
 */
const TemplatesManager = () => {
    const [activeTab, setActiveTab] = useState('pages');

    // Tab definitions
    const tabs = [
        { value: 'pages', label: 'Page Templates', icon: Layout, color: 'blue' },
        { value: 'parts', label: 'Template Parts', icon: Puzzle, color: 'purple' },
        { value: 'assignments', label: 'Assignments', icon: Link2, color: 'emerald' },
        { value: 'languages', label: 'Languages', icon: Languages, color: 'amber' },
    ];

    // Breadcrumb
    const breadcrumbs = [
        { label: 'Templates', icon: Layout },
    ];

    return (
        <AdminPageLayout
            requiredPermission="platform.template.manage"
            showTenantBadge={false}
        >
            {/* Page Header */}
            <PageHeader
                title="Templates"
                description="Manage page templates, parts, and language assignments"
                icon={Layout}
                breadcrumbs={breadcrumbs}
            />

            {/* Tabs Navigation */}
            <PageTabs value={activeTab} onValueChange={setActiveTab} tabs={tabs}>
                <TabsContent value="pages" className="mt-0">
                    <TemplatesList />
                </TabsContent>

                <TabsContent value="parts" className="mt-0">
                    <TemplatePartsList />
                </TabsContent>

                <TabsContent value="assignments" className="mt-0">
                    <TemplateAssignments />
                </TabsContent>

                <TabsContent value="languages" className="mt-0">
                    <TemplateLanguageManager />
                </TabsContent>
            </PageTabs>
        </AdminPageLayout>
    );
};

export default TemplatesManager;
