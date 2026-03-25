import GenericContentManager from '@/components/dashboard/GenericContentManager';
import TagsManager from '@/components/dashboard/TagsManager';
import { PageTabs, TabsContent } from '@/templates/flowbite-admin';
import { restoreCategory, softDeleteCategory } from '@/lib/taxonomyMutations';

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
	categoryColumns,
	categoryFormFields,
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
				<GenericContentManager
					tableName="categories"
					resourceName={t('pages.category.form.type_page')}
					columns={categoryColumns}
					formFields={categoryFormFields}
					permissionPrefix="categories"
					customSelect="*, owner:users!created_by(email, full_name), tenant:tenants(name)"
					defaultFilters={{ type: ['page', 'pages', 'content'] }}
					showBreadcrumbs={false}
					restorePermission="tenant.categories.restore"
					onSoftDeleteOverride={softDeleteCategory}
					onRestoreOverride={restoreCategory}
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
