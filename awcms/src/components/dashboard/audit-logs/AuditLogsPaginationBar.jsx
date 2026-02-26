import { Button } from '@/components/ui/button';

function AuditLogsPaginationBar({
  totalCount,
  page,
  limit,
  setLimit,
  setPage,
  t,
}) {
  if (totalCount <= 0) {
    return null;
  }

  return (
    <div className="mt-4 flex flex-col items-center justify-between gap-4 border-t border-border pt-4 sm:flex-row">
      <div className="text-sm text-muted-foreground">
        {t('audit.pagination.showing', {
          from: (page - 1) * limit + 1,
          to: Math.min(page * limit, totalCount),
          total: totalCount,
        })}
      </div>

      <div className="flex items-center gap-4">
        <select
          value={limit}
          onChange={(event) => {
            setLimit(Number(event.target.value));
            setPage(1);
          }}
          className="rounded border border-input bg-white px-3 py-1.5 text-sm text-slate-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
        >
          <option value={25}>25 {t('audit.pagination.per_page')}</option>
          <option value={50}>50 {t('audit.pagination.per_page')}</option>
          <option value={100}>100 {t('audit.pagination.per_page')}</option>
        </select>

        <div className="flex gap-1">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage((previous) => Math.max(1, previous - 1))}
            disabled={page === 1}
          >
            {t('audit.pagination.previous')}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage((previous) => previous + 1)}
            disabled={page * limit >= totalCount}
          >
            {t('audit.pagination.next')}
          </Button>
        </div>
      </div>
    </div>
  );
}

export default AuditLogsPaginationBar;
