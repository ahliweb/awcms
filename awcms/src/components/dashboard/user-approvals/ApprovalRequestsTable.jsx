import { CheckCircle, Loader2, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import ApprovalStatusBadge from '@/components/dashboard/user-approvals/ApprovalStatusBadge';
import ApprovalPaginationControls from '@/components/dashboard/user-approvals/ApprovalPaginationControls';

function ApprovalRequestsTable({
  loading,
  requests,
  activeTab,
  showActions,
  processingId,
  isSuperAdmin,
  onApprove,
  onOpenReject,
  currentPage,
  setCurrentPage,
  itemsPerPage,
  setItemsPerPage,
  totalItems,
  totalPages,
}) {
  return (
    <>
      {loading ? (
        <div className="flex items-center justify-center p-8">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : requests.length === 0 ? (
        <div className="rounded-lg border border-border border-dashed bg-muted/20 p-8 text-center text-muted-foreground">
          No requests found
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Full Name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Status</TableHead>
              {activeTab === 'rejected' && <TableHead>Reason</TableHead>}
              {showActions && <TableHead className="text-right">Actions</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {requests.map((request) => (
              <TableRow key={request.id}>
                <TableCell className="text-sm text-slate-500">
                  {new Date(request.created_at).toLocaleDateString()}
                </TableCell>
                <TableCell className="font-medium">{request.full_name}</TableCell>
                <TableCell>{request.email}</TableCell>
                <TableCell>
                  <ApprovalStatusBadge status={request.status} />
                </TableCell>

                {activeTab === 'rejected' && (
                  <TableCell className="max-w-xs truncate text-red-600 italic">
                    {request.rejection_reason || '-'}
                  </TableCell>
                )}

                {showActions && (
                  <TableCell className="space-x-2 text-right">
                    {request.status === 'pending_admin' && (
                      <Button size="sm" onClick={() => onApprove(request)} disabled={processingId === request.id}>
                        {processingId === request.id
                          ? <Loader2 className="h-4 w-4 animate-spin" />
                          : <CheckCircle className="mr-1 h-4 w-4" />}
                        Approve
                      </Button>
                    )}

                    {request.status === 'pending_super_admin' && isSuperAdmin && (
                      <Button
                        size="sm"
                        className="bg-blue-600 text-white hover:bg-blue-700"
                        onClick={() => onApprove(request)}
                        disabled={processingId === request.id}
                      >
                        {processingId === request.id
                          ? <Loader2 className="h-4 w-4 animate-spin" />
                          : <ShieldCheck className="mr-1 h-4 w-4" />}
                        Final Approve
                      </Button>
                    )}

                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => onOpenReject(request)}
                      disabled={processingId === request.id}
                    >
                      Reject
                    </Button>
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <ApprovalPaginationControls
        currentPage={currentPage}
        setCurrentPage={setCurrentPage}
        itemsPerPage={itemsPerPage}
        setItemsPerPage={setItemsPerPage}
        totalItems={totalItems}
        totalPages={totalPages}
      />
    </>
  );
}

export default ApprovalRequestsTable;
