
import React, { useState } from 'react';
import { 
  ChevronLeft, 
  ChevronRight, 
  MoreHorizontal, 
  ChevronsLeft, 
  ChevronsRight 
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

export function Pagination({ 
  currentPage, 
  totalPages, 
  onPageChange, 
  className,
  showFirstLast = true,
  showPageInput = false
}) {
  const [pageInput, setPageInput] = useState(currentPage.toString());

  // Update input when current page changes externally
  React.useEffect(() => {
    setPageInput(currentPage.toString());
  }, [currentPage]);

  const handleInputChange = (e) => {
    setPageInput(e.target.value);
  };

  const handleInputKeyDown = (e) => {
    if (e.key === 'Enter') {
      const page = parseInt(pageInput);
      if (!isNaN(page) && page >= 1 && page <= totalPages) {
        onPageChange(page);
      } else {
        setPageInput(currentPage.toString()); // Reset on invalid
      }
    }
  };

  const handleBlur = () => {
    const page = parseInt(pageInput);
    if (!isNaN(page) && page >= 1 && page <= totalPages) {
       if (page !== currentPage) onPageChange(page);
    } else {
       setPageInput(currentPage.toString());
    }
  };

  if (totalPages <= 1) return null;

  const pages = [];
  const showEllipsisStart = currentPage > 3;
  const showEllipsisEnd = currentPage < totalPages - 2;

  if (totalPages <= 7) {
      for(let i = 1; i <= totalPages; i++) pages.push(i);
  } else {
      pages.push(1);
      if (showEllipsisStart) pages.push('...');
      
      let start = Math.max(2, currentPage - 1);
      let end = Math.min(totalPages - 1, currentPage + 1);
      
      if (!showEllipsisStart) start = 2;
      if (!showEllipsisEnd) end = totalPages - 1;

      for(let i = start; i <= end; i++) pages.push(i);

      if (showEllipsisEnd) pages.push('...');
      pages.push(totalPages);
  }

  return (
    <div className={cn("flex items-center gap-1 sm:gap-2", className)} aria-label="Pagination">
      {/* First Page */}
      {showFirstLast && (
        <Button
          variant="outline"
          size="icon"
          onClick={() => onPageChange(1)}
          disabled={currentPage === 1}
          className="h-8 w-8 hidden sm:flex"
          aria-label="First page"
        >
          <ChevronsLeft className="h-4 w-4" />
        </Button>
      )}

      {/* Previous */}
      <Button
        variant="outline"
        size="icon"
        onClick={() => onPageChange(currentPage - 1)}
        disabled={currentPage <= 1}
        className="h-8 w-8"
        aria-label="Previous page"
      >
        <ChevronLeft className="h-4 w-4" />
      </Button>
      
      {/* Page Numbers */}
      <div className="hidden sm:flex items-center gap-1">
        {pages.map((page, i) => (
          <React.Fragment key={i}>
            {page === '...' ? (
              <span className="flex h-8 w-8 items-center justify-center text-sm text-slate-400">
                <MoreHorizontal className="h-4 w-4" />
              </span>
            ) : (
              <Button
                variant={currentPage === page ? "default" : "outline"}
                size="icon"
                onClick={() => onPageChange(page)}
                className={cn(
                    "h-8 w-8 text-xs font-medium transition-colors", 
                    currentPage === page 
                        ? "bg-primary hover:bg-primary/90 text-primary-foreground shadow-sm" 
                        : "hover:bg-accent hover:text-accent-foreground"
                )}
                aria-current={currentPage === page ? "page" : undefined}
              >
                {page}
              </Button>
            )}
          </React.Fragment>
        ))}
      </div>

      {/* Mobile Page Indicator / Input */}
      <div className="flex sm:hidden items-center gap-2">
         {showPageInput ? (
            <div className="flex items-center gap-1">
                <Input 
                    className="h-8 w-12 px-1 text-center text-xs" 
                    value={pageInput}
                    onChange={handleInputChange}
                    onKeyDown={handleInputKeyDown}
                    onBlur={handleBlur}
                />
                <span className="text-xs text-slate-500">of {totalPages}</span>
            </div>
         ) : (
            <span className="text-sm font-medium text-slate-700">
                {currentPage} / {totalPages}
            </span>
         )}
      </div>

      {/* Next */}
      <Button
        variant="outline"
        size="icon"
        onClick={() => onPageChange(currentPage + 1)}
        disabled={currentPage >= totalPages}
        className="h-8 w-8"
        aria-label="Next page"
      >
        <ChevronRight className="h-4 w-4" />
      </Button>

      {/* Last Page */}
      {showFirstLast && (
        <Button
          variant="outline"
          size="icon"
          onClick={() => onPageChange(totalPages)}
          disabled={currentPage === totalPages}
          className="h-8 w-8 hidden sm:flex"
          aria-label="Last page"
        >
          <ChevronsRight className="h-4 w-4" />
        </Button>
      )}
    </div>
  );
}
