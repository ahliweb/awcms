import GenericContentManager from '@/components/dashboard/GenericContentManager';
import CategoriesManager from '@/components/dashboard/CategoriesManager';
import TagsManager from '@/components/dashboard/TagsManager';
import { PageTabs, TabsContent } from '@/templates/flowbite-admin';

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
			<CategoriesManager
				embedded
				basePath="/cmspanel/blogs/categories"
				nestedSegment="categories"
				lockedModule="blogs"
				title="Blog Category"
				description="Manage categories for editorial posts while keeping shared content categories available for cross-module reuse."
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
