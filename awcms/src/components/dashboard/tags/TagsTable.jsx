import { motion } from 'framer-motion';
import {
  AlertCircle,
  Edit,
  RefreshCw,
  RotateCcw,
  SortAsc,
  SortDesc,
  Tag,
  Trash2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';

function TagsTable({
  isPlatformAdmin,
  sortConfig,
  handleSort,
  showTrash,
  loading,
  currentData,
  canRestore,
  canEdit,
  canSoftDelete,
  onRestore,
  onEdit,
  onRequestDelete,
}) {
  const colSpan = 5 + (isPlatformAdmin ? 1 : 0) + (!showTrash ? 1 : 0);

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="border-b border-border bg-muted/50">
            <tr>
              {isPlatformAdmin && <th className="px-6 py-4 text-left text-xs font-bold uppercase text-muted-foreground">Nama Tenant</th>}

              <th
                className="group cursor-pointer px-6 py-4 text-left text-xs font-bold uppercase text-muted-foreground hover:text-foreground"
                onClick={() => handleSort('name')}
              >
                <div className="flex items-center gap-1">
                  Tag Details
                  {sortConfig.key === 'name' && (
                    sortConfig.direction === 'asc' ? <SortAsc className="h-3 w-3" /> : <SortDesc className="h-3 w-3" />
                  )}
                </div>
              </th>

              <th className="px-6 py-4 text-left text-xs font-bold uppercase text-muted-foreground">Color</th>

              {!showTrash && <th className="px-6 py-4 text-left text-xs font-bold uppercase text-muted-foreground">Usage Breakdown</th>}

              <th
                className="cursor-pointer px-6 py-4 text-center text-xs font-bold uppercase text-muted-foreground hover:text-foreground"
                onClick={() => handleSort('total_usage')}
              >
                <div className="flex items-center justify-center gap-1">
                  Total Usage
                  {sortConfig.key === 'total_usage' && (
                    sortConfig.direction === 'asc' ? <SortAsc className="h-3 w-3" /> : <SortDesc className="h-3 w-3" />
                  )}
                </div>
              </th>

              <th className="px-6 py-4 text-center text-xs font-bold uppercase text-muted-foreground">Status</th>
              <th className="px-6 py-4 text-right text-xs font-bold uppercase text-muted-foreground">Actions</th>
            </tr>
          </thead>

          <tbody className="divide-y divide-border">
            {loading ? (
              <tr>
                <td colSpan={colSpan} className="p-12 text-center text-slate-500">
                  <div className="flex flex-col items-center gap-2">
                    <RefreshCw className="h-6 w-6 animate-spin text-blue-500" />
                    <span>Loading tags...</span>
                  </div>
                </td>
              </tr>
            ) : currentData.length === 0 ? (
              <tr>
                <td colSpan={colSpan} className="p-12 text-center text-slate-500">
                  <div className="flex flex-col items-center gap-2">
                    <AlertCircle className="h-8 w-8 text-slate-300" />
                    <span>No tags found matching your criteria.</span>
                  </div>
                </td>
              </tr>
            ) : (
              currentData.map((tag) => (
                <motion.tr
                  key={tag.tag_id}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="transition-colors hover:bg-muted/50"
                >
                  {isPlatformAdmin && (
                    <td className="px-6 py-4">
                      <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
                        {tag.tenant_name || '(Unknown Tenant)'}
                      </span>
                    </td>
                  )}

                  <td className="px-6 py-4">
                    <div className="flex flex-col">
                      <div className="flex items-center gap-2">
                        <Tag className="h-4 w-4 text-muted-foreground" />
                        <span className="font-medium text-foreground">{tag.tag_name}</span>
                      </div>
                      <span className="pl-6 text-xs text-muted-foreground">{tag.tag_slug}</span>
                      {tag.tag_description && (
                        <span className="mt-1 max-w-[200px] truncate pl-6 text-xs text-muted-foreground">{tag.tag_description}</span>
                      )}
                    </div>
                  </td>

                  <td className="px-6 py-4">
                    <div className="group relative flex items-center gap-2">
                      <div className="h-6 w-6 cursor-help rounded-full border border-border shadow-sm transition-transform hover:scale-110" style={{ backgroundColor: tag.tag_color }} />
                      <span className="absolute left-8 z-10 rounded border border-border bg-card px-1 font-mono text-xs text-muted-foreground opacity-0 shadow-sm transition-opacity group-hover:opacity-100">
                        {tag.tag_color}
                      </span>
                    </div>
                  </td>

                  {!showTrash && (
                    <td className="px-6 py-4">
                      <div className="flex max-w-[250px] flex-wrap gap-1">
                        {Object.entries(tag.breakdown || {}).slice(0, 4).map(([module, count]) => (
                          <span key={module} className="flex items-center gap-1 rounded border border-border bg-secondary px-1.5 py-0.5 text-[10px] uppercase text-secondary-foreground">
                            {module}
                            <span className="rounded-full bg-background px-1 text-[9px] font-bold">{count}</span>
                          </span>
                        ))}

                        {Object.keys(tag.breakdown || {}).length > 4 && (
                          <span className="rounded bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
                            +{Object.keys(tag.breakdown).length - 4} more
                          </span>
                        )}
                      </div>
                    </td>
                  )}

                  <td className="px-6 py-4 text-center">
                    <span className={`inline-flex items-center justify-center rounded-full px-2.5 py-0.5 text-xs font-medium ${tag.count > 0 ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'}`}>
                      {tag.count || 0} uses
                    </span>
                  </td>

                  <td className="px-6 py-4 text-center">
                    {tag.tag_is_active ? (
                      <span className="inline-flex items-center rounded border border-green-500/20 bg-green-500/10 px-2 py-0.5 text-xs font-medium text-green-600 dark:text-green-400">Active</span>
                    ) : (
                      <span className="inline-flex items-center rounded border border-border bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">Inactive</span>
                    )}
                  </td>

                  <td className="px-6 py-4 text-right">
                    <div className="flex justify-end gap-1">
                      {showTrash ? (
                        canRestore && (
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => onRestore(tag.tag_id)}
                            className="text-green-600 hover:bg-green-50 hover:text-green-700"
                            title="Restore"
                          >
                            <RotateCcw className="h-4 w-4" />
                          </Button>
                        )
                      ) : (
                        <>
                          {canEdit && (
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => onEdit(tag)}
                              className="text-muted-foreground hover:bg-primary/10 hover:text-primary"
                            >
                              <Edit className="h-4 w-4" />
                            </Button>
                          )}

                          {canSoftDelete && (
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => onRequestDelete(tag)}
                              className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          )}
                        </>
                      )}
                    </div>
                  </td>
                </motion.tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default TagsTable;
