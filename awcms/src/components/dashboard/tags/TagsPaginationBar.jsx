import { Pagination } from '@/components/ui/pagination';

function TagsPaginationBar({
  displayedTags,
  currentPage,
  itemsPerPage,
  setItemsPerPage,
  setCurrentPage,
  totalPages,
}) {
  if (displayedTags.length === 0) return null;

  return (
    <div className="dashboard-surface flex flex-col items-center justify-between gap-4 px-4 py-4 sm:flex-row">
      <div className="text-xs text-muted-foreground">
        Showing <span className="font-medium text-foreground">{((currentPage - 1) * itemsPerPage) + 1}</span> to <span className="font-medium text-foreground">{Math.min(currentPage * itemsPerPage, displayedTags.length)}</span> of <span className="font-medium text-foreground">{displayedTags.length}</span> items
      </div>

      <div className="flex flex-col items-center gap-3 sm:flex-row sm:justify-end">
        <select
          className="h-8 rounded-md border border-input bg-background px-2 text-xs text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200"
          value={itemsPerPage}
          onChange={(event) => {
            setItemsPerPage(Number(event.target.value));
            setCurrentPage(1);
          }}
        >
          <option value={10}>10 / page</option>
          <option value={20}>20 / page</option>
          <option value={50}>50 / page</option>
          <option value={100}>100 / page</option>
        </select>

        <Pagination
          currentPage={currentPage}
          totalPages={totalPages}
          onPageChange={setCurrentPage}
        />
      </div>
    </div>
  );
}

export default TagsPaginationBar;
