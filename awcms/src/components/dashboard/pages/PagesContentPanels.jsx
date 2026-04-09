import GenericContentManager from '@/components/dashboard/GenericContentManager';
import CategoriesManager from '@/components/dashboard/CategoriesManager';
import TagsManager from '@/components/dashboard/TagsManager';
import { PageTabs, TabsContent } from '@/templates/emdash-admin';

function PagesContentPanels({
	onlyVisual,
	activeTab,
	tabs,
	navigate,
	t,
	pageColumns,
	pageFormFields,
	pageEditorProps,
	customRowActions,
}) {
	if (onlyVisual) {
		return (
			<GenericContentManager
				tableName="pages"
				resourceName={t('pages.visual_title')}
				columns={pageColumns}
				formFields={pageFormFields}
				editorProps={pageEditorProps}
				permissionPrefix="visual_pages"
				customSelect="*, category:categories!pages_category_id_fkey(id, name), owner:users!created_by(email, full_name), tenant:tenants(name)"
				customRowActions={customRowActions}
				defaultFilters={{ editor_type: 'visual' }}
				showBreadcrumbs={false}
				showHeader={false}
			/>
		);
	}

	return (
		<PageTabs
			value={activeTab}
			onValueChange={(value) => {
				navigate(value === 'pages' ? '/cmspanel/pages' : `/cmspanel/pages/${value}`);
			}}
			tabs={tabs}
		>
			<TabsContent value="pages" className="mt-0">
				<GenericContentManager
					tableName="pages"
					resourceName={t('pages.badges.regular')}
					columns={pageColumns}
					formFields={pageFormFields}
					editorProps={pageEditorProps}
					permissionPrefix="pages"
					defaultFilters={{ page_type: 'regular' }}
					customSelect="*, category:categories!pages_category_id_fkey(id, name), owner:users!created_by(email, full_name), tenant:tenants(name)"
					customRowActions={customRowActions}
					showBreadcrumbs={false}
				/>
			</TabsContent>

			<TabsContent value="categories" className="mt-0">
				<CategoriesManager
					embedded
					basePath="/cmspanel/pages/categories"
					nestedSegment="categories"
					lockedModule="pages"
					title={t('pages.category.form.type_page') || 'Page Category'}
					description="Organize static and landing pages with page-specific and shared content categories that survive refreshes."
				/>
			</TabsContent>

			<TabsContent value="tags" className="mt-0">
				<TagsManager
					embedded
					basePath="/cmspanel/pages/tags"
					nestedSegment="tags"
					lockedModuleFilter="pages"
					title={t('pages.tabs.tags') || 'Page Tags'}
					description="Manage the tags attached to static and landing pages, including inactive labels and trash cleanup, while staying in the Pages workflow."
				/>
			</TabsContent>
		</PageTabs>
	);
}

export default PagesContentPanels;
