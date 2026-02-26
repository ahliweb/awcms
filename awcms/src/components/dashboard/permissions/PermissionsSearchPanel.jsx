import MinCharSearchInput from '@/components/common/MinCharSearchInput';

function PermissionsSearchPanel({
  query,
  setQuery,
  clearSearch,
  loading,
  searchLoading,
  isSearchValid,
  searchMessage,
  minLength,
}) {
  return (
    <div className="dashboard-surface dashboard-surface-hover p-4">
      <MinCharSearchInput
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onClear={clearSearch}
        loading={loading || searchLoading}
        isValid={isSearchValid}
        message={searchMessage}
        minLength={minLength}
        placeholder="Search permissions"
      />
    </div>
  );
}

export default PermissionsSearchPanel;
