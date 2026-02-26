import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';

function TenantsPagination({
	totalPages,
	currentPage,
	startIndex,
	endIndex,
	totalItems,
	setCurrentPage,
}) {
	if (totalPages <= 1) {
		return null;
	}

	return (
		<div className="flex flex-col gap-3 border-t border-border/70 bg-background/40 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
			<div className="text-sm text-muted-foreground">
				Showing {startIndex + 1} - {Math.min(endIndex, totalItems)} of {totalItems} tenants
			</div>
			<div className="flex items-center gap-1 rounded-full border border-border/70 bg-background/80 p-1 shadow-sm">
				<Button
					variant="outline"
					size="sm"
					onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
					disabled={currentPage === 1}
					className="h-8 w-8 rounded-full border-border/70 bg-transparent p-0"
				>
					<ChevronLeft className="w-4 h-4" />
				</Button>

				{Array.from({ length: Math.min(5, totalPages) }, (_, index) => {
					let pageNumber;
					if (totalPages <= 5) {
						pageNumber = index + 1;
					} else if (currentPage <= 3) {
						pageNumber = index + 1;
					} else if (currentPage >= totalPages - 2) {
						pageNumber = totalPages - 4 + index;
					} else {
						pageNumber = currentPage - 2 + index;
					}

					return (
						<Button
							key={pageNumber}
							variant={currentPage === pageNumber ? 'default' : 'outline'}
							size="sm"
							onClick={() => setCurrentPage(pageNumber)}
							className={currentPage === pageNumber
								? 'h-8 w-8 rounded-full border-primary/20 bg-primary text-primary-foreground p-0'
								: 'h-8 w-8 rounded-full border-border/70 bg-transparent p-0'}
						>
							{pageNumber}
						</Button>
					);
				})}

				<Button
					variant="outline"
					size="sm"
					onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))}
					disabled={currentPage === totalPages}
					className="h-8 w-8 rounded-full border-border/70 bg-transparent p-0"
				>
					<ChevronRight className="w-4 h-4" />
				</Button>
			</div>
		</div>
	);
}

export default TenantsPagination;
