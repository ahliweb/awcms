import GenericContentManager from '@/components/dashboard/GenericContentManager';
import { PageTabs, TabsContent } from '@/templates/flowbite-admin';
import { restoreCategory, restoreTag, softDeleteCategory, softDeleteTag } from '@/lib/taxonomyMutations';

function BlogsContentPanels({
	activeTab,
	tabs,
	navigate,
	t,
	blogColumns,
	blogFormFields,
	blogFilters,
	BlogEditorComponent,
	customRowActions,
	customToolbarActions,
	categoryColumns,
	categoryFormFields,
	tagColumns,
	tagFormFields,
	onContentSaved,
}) {
	// Wrap BlogEditorComponent to trigger onContentSaved after save
	const WrappedBlogEditor = onContentSaved ? (props) => {
		const { onSuccess: originalOnSuccess, ...restProps } = props;
		const wrappedOnSuccess = () => {
			if (originalOnSuccess) originalOnSuccess();
			if (onContentSaved) onContentSaved();
		};
		return <BlogEditorComponent {...restProps} onSuccess={wrappedOnSuccess} />;
	} : BlogEditorComponent;

	return (
		<PageTabs
			value={activeTab}
			onValueChange={(value) => {
				navigate(value === 'blogs' ? '/cmspanel/blogs' : `/cmspanel/blogs/${value}`);
			}}
			tabs={tabs}
		>
			<TabsContent value="blogs" className="mt-0">
				<GenericContentManager
					tableName="blogs"
					resourceName={t('blogs.type')}
					columns={blogColumns}
					formFields={blogFormFields}
					permissionPrefix="blog"
					showBreadcrumbs={false}
					defaultFilters={blogFilters}
					EditorComponent={WrappedBlogEditor}
					customRowActions={customRowActions}
					customToolbarActions={customToolbarActions}
				/>
			</TabsContent>

			<TabsContent value="categories" className="mt-0">
				<GenericContentManager
					tableName="categories"
					resourceName={t('common.category')}
					columns={categoryColumns}
					formFields={categoryFormFields}
					permissionPrefix="categories"
					showBreadcrumbs={false}
					customSelect="*, owner:users!created_by(email, full_name), tenant:tenants(name)"
					defaultFilters={{ type: ['blog', 'blogs', 'content'] }}
					restorePermission="tenant.categories.restore"
					onSoftDeleteOverride={softDeleteCategory}
					onRestoreOverride={restoreCategory}
				/>
			</TabsContent>

			<TabsContent value="tags" className="mt-0">
				<GenericContentManager
					tableName="tags"
					resourceName="Tag"
					columns={tagColumns}
					formFields={tagFormFields}
					permissionPrefix="tag"
					showBreadcrumbs={false}
					restorePermission="tenant.tag.restore"
					onSoftDeleteOverride={softDeleteTag}
					onRestoreOverride={restoreTag}
				/>
			</TabsContent>
		</PageTabs>
	);
}

export default BlogsContentPanels;
