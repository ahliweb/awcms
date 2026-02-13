
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from '@/components/ui/button';
import { Edit, Trash2, Eye } from 'lucide-react';
import { format } from 'date-fns';
import { Pagination } from '@/components/ui/pagination';

const ContentTable = ({
  data = [],
  columns = [],
  loading = false,
  onEdit,
  onDelete,
  onView,
  extraActions,
  pagination
}) => {

  if (loading) {
    return (
      <div className="dashboard-surface overflow-hidden">
        <Table>
          <TableHeader className="bg-muted/50">
            <TableRow>
              {columns.map((col, i) => (
                <TableHead key={i} className={col.className}>
                  <Skeleton className="h-4 w-24 bg-muted" />
                </TableHead>
              ))}
              <TableHead className="text-right"><Skeleton className="h-4 w-16 ml-auto bg-muted" /></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {[...Array(5)].map((_, i) => (
              <TableRow key={i}>
                {columns.map((col, j) => (
                  <TableCell key={j} className={col.className}>
                    <Skeleton className="h-4 w-full bg-muted/50" />
                  </TableCell>
                ))}
                <TableCell className="text-right">
                  <div className="flex justify-end gap-2">
                    <Skeleton className="h-8 w-8 rounded-md bg-muted/50" />
                    <Skeleton className="h-8 w-8 rounded-md bg-muted/50" />
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    );
  }

  if (!data || data.length === 0) {
    return (
      <div className="dashboard-surface p-12 flex flex-col items-center justify-center text-slate-500">
        <p className="text-lg font-semibold text-slate-700">No items found</p>
        <p className="text-sm text-slate-500">Try adjusting your search or filters.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="dashboard-surface overflow-hidden">
        <Table>
          <TableHeader className="bg-muted/50">
            <TableRow className="hover:bg-transparent">
              {columns.map((col) => (
                <TableHead key={col.key} className={`${col.className} text-muted-foreground`}>
                  {col.label}
                </TableHead>
              ))}
              {(onEdit || onDelete || onView || extraActions) && (
                <TableHead className="text-right text-muted-foreground">Actions</TableHead>
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.map((item, index) => (
              <TableRow key={item.id || index} className="hover:bg-muted/50 data-[state=selected]:bg-muted">
                {columns.map((col) => (
                  <TableCell key={`${item.id}-${col.key}`} className={col.className}>
                    {col.render ? (
                      col.render(item[col.key], item)
                    ) : col.type === 'date' ? (
                      item[col.key] ? format(new Date(item[col.key]), 'MMM d, yyyy') : '-'
                    ) : col.type === 'boolean' ? (
                      item[col.key] ? <span className="text-green-600">Yes</span> : <span className="text-destructive">No</span>
                    ) : (
                      <span className="text-foreground">{item[col.key]}</span>
                    )}
                  </TableCell>
                ))}
                {(onEdit || onDelete || onView || extraActions) && (
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      {extraActions && extraActions(item)}
                      {onView && (
                        <Button variant="ghost" size="icon" onClick={() => onView(item)} className="h-8 w-8 text-muted-foreground hover:text-primary hover:bg-primary/10">
                          <Eye className="w-4 h-4" />
                        </Button>
                      )}
                      {onEdit && (
                        <Button variant="ghost" size="icon" onClick={() => onEdit(item)} className="h-8 w-8 text-muted-foreground hover:text-primary hover:bg-primary/10">
                          <Edit className="w-4 h-4" />
                        </Button>
                      )}
                      {onDelete && (
                        <Button variant="ghost" size="icon" onClick={() => onDelete(item)} className="h-8 w-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10">
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {pagination && (
        <div className="flex flex-col sm:flex-row justify-between items-center gap-4 px-2">
          <div className="text-sm text-slate-500">
            Showing {((pagination.currentPage - 1) * pagination.itemsPerPage) + 1} to {Math.min(pagination.currentPage * pagination.itemsPerPage, pagination.totalItems)} of {pagination.totalItems} entries
          </div>
          <div className="flex items-center gap-4">
            <Select
              value={String(pagination.itemsPerPage)}
              onValueChange={(value) => pagination.onLimitChange(Number(value))}
            >
              <SelectTrigger className="h-9 w-[110px] rounded-xl border gap-2 border-slate-200/70 bg-white/90 px-3 text-xs font-medium text-slate-700 shadow-sm focus:ring-indigo-500/30 dark:border-slate-700/70 dark:bg-slate-950/60 dark:text-slate-200">
                <span className="truncate">Page Size</span>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="10">10 / page</SelectItem>
                <SelectItem value="20">20 / page</SelectItem>
                <SelectItem value="50">50 / page</SelectItem>
              </SelectContent>
            </Select>
            <Pagination
              currentPage={pagination.currentPage}
              totalPages={pagination.totalPages}
              onPageChange={pagination.onPageChange}
            />
          </div>
        </div>
      )}
    </div>
  );
};

export default ContentTable;
