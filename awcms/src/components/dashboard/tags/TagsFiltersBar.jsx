import { CheckCircle, Filter, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import MinCharSearchInput from '@/components/common/MinCharSearchInput';

function TagsFiltersBar({
  query,
  setQuery,
  clearSearch,
  loading,
  searchLoading,
  isSearchValid,
  searchMessage,
  minLength,
  showTrash,
  moduleFilter,
  setModuleFilter,
  activeFilter,
  setActiveFilter,
  modules,
  fetchTags,
  setCurrentPage,
}) {
  return (
    <div className="dashboard-surface flex flex-col gap-4 p-4 lg:flex-row">
      <div className="max-w-sm flex-1">
        <MinCharSearchInput
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setCurrentPage(1);
          }}
          onClear={() => {
            clearSearch();
            setCurrentPage(1);
          }}
          loading={loading || searchLoading}
          isValid={isSearchValid}
          message={searchMessage}
          minLength={minLength}
          placeholder="Search tags... (5+ chars)"
        />
      </div>

      {!showTrash && (
        <div className="flex flex-col gap-3 sm:flex-row">
          <div className="relative w-full sm:w-48">
            <Filter className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <select
              value={moduleFilter}
              onChange={(event) => {
                setModuleFilter(event.target.value);
                setCurrentPage(1);
              }}
              className="h-10 w-full appearance-none rounded-xl border border-input bg-background px-3 py-2 pl-9 text-sm shadow-sm focus:ring-2 focus:ring-ring dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200"
            >
              {modules.map((module) => (
                <option key={module.value} value={module.value}>{module.label}</option>
              ))}
            </select>
          </div>

          <div className="relative w-full sm:w-40">
            <CheckCircle className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <select
              value={activeFilter}
              onChange={(event) => {
                setActiveFilter(event.target.value);
                setCurrentPage(1);
              }}
              className="h-10 w-full appearance-none rounded-xl border border-input bg-background px-3 py-2 pl-9 text-sm shadow-sm focus:ring-2 focus:ring-ring dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200"
            >
              <option value="all">All Status</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </div>
        </div>
      )}

      <Button
        variant="ghost"
        size="icon"
        onClick={fetchTags}
        title="Refresh Data"
        className="text-muted-foreground hover:text-foreground"
      >
        <RefreshCw className="h-4 w-4" />
      </Button>
    </div>
  );
}

export default TagsFiltersBar;
