import GenericContentManager from '@/components/dashboard/GenericContentManager';
import TagsManager from '@/components/dashboard/TagsManager';
import { PageTabs, TabsContent } from '@/templates/flowbite-admin';
import { restoreCategory, softDeleteCategory } from '@/lib/taxonomyMutations';

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
	blogEditorProps = {},
	onContentSaved,
}) {
	// Wrap BlogEditorComponent to trigger onContentSaved after save
	const WrappedBlogEditor = onContentSaved ? (props) => {
		const { onSuccess: originalOnSuccess, ...restProps } = props;
		const wrappedOnSuccess = () => {
			if (originalOnSuccess) originalOnSuccess();
			if (onContentSaved) onContentSaved();
		};
		return <BlogEditorComponent {...restProps} {...blogEditorProps} onSuccess={wrappedOnSuccess} />;
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
				showHeader={false}
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
				showHeader={false}
				customSelect="*, owner:users!created_by(email, full_name), tenant:tenants(name)"
				defaultFilters={{ type: ['blog', 'blogs', 'content'] }}
				restorePermission="tenant.categories.restore"
				onSoftDeleteOverride={softDeleteCategory}
				onRestoreOverride={restoreCategory}
			/>
		</TabsContent>

		<TabsContent value="tags" className="mt-0">
			<TagsManager
				embedded
				basePath="/cmspanel/blogs/tags"
				nestedSegment="tags"
				lockedModuleFilter="blogs"
				title="Blog Tags"
				description="Review the tags currently used across blog posts, create new reusable labels, and clean up blog-only taxonomy without leaving the Blogs module."
			/>
		</TabsContent>
		</PageTabs>
	);
}

export default BlogsContentPanels;
