import { CheckCircle2, ClipboardList, History, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { usePermissions } from '@/contexts/PermissionContext';
import { useReusableSections } from '@/hooks/useReusableSections';

function ReusableSectionActionRequestsManager() {
  const { sections, actionRequestsBySection, loading, approveActionRequest, rejectActionRequest } = useReusableSections();
  const { hasPermission, isPlatformAdmin, isFullAccess } = usePermissions();

  const canApprove = isPlatformAdmin || isFullAccess || hasPermission('platform.approvals.read') || hasPermission('platform.template.manage');
  const sectionMap = new Map(sections.map((section) => [section.id, section]));
  const allRequests = Object.values(actionRequestsBySection).flat().sort((left, right) => new Date(right.updated_at || right.requested_at || 0) - new Date(left.updated_at || left.requested_at || 0));
  const pendingRequests = allRequests.filter((request) => request.status === 'pending');
  const historicalRequests = allRequests.filter((request) => request.status !== 'pending');

  if (loading) {
    return <div className="rounded-2xl border border-border/60 bg-card/60 p-8 text-center text-muted-foreground">Loading approval queue...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-border/60 bg-card/70 p-4 text-sm text-muted-foreground shadow-sm">
        Review reusable section bulk action requests across all sections from one place. This queue complements the section-level request cards in the reusable sections manager.
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-2xl border border-border/60 bg-card/75 p-4 shadow-sm">
          <div className="mb-4 flex items-center gap-2">
            <ClipboardList className="h-4 w-4 text-primary" />
            <h4 className="font-semibold text-foreground">Pending Requests</h4>
          </div>

          {pendingRequests.length > 0 ? (
            <div className="space-y-3">
              {pendingRequests.map((request) => {
                const section = sectionMap.get(request.reusable_section_id);
                return (
                  <div key={request.id} className="rounded-xl border border-border/60 bg-muted/20 p-3 text-sm">
                    <p className="font-medium text-foreground">{request.action_type}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Section: {section?.name || request.reusable_section_id} • Requested {request.requested_at ? new Date(request.requested_at).toLocaleString() : 'unknown'}
                    </p>
                    {canApprove ? (
                      <div className="mt-3 flex gap-2">
                        <Button size="sm" variant="outline" className="rounded-lg" onClick={() => approveActionRequest(request)}>
                          <CheckCircle2 className="mr-2 h-4 w-4" /> Approve
                        </Button>
                        <Button size="sm" variant="outline" className="rounded-lg" onClick={() => rejectActionRequest(request)}>
                          <XCircle className="mr-2 h-4 w-4" /> Reject
                        </Button>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No pending reusable section action requests.</p>
          )}
        </div>

        <div className="rounded-2xl border border-border/60 bg-card/75 p-4 shadow-sm">
          <div className="mb-4 flex items-center gap-2">
            <History className="h-4 w-4 text-primary" />
            <h4 className="font-semibold text-foreground">Request History</h4>
          </div>

          {historicalRequests.length > 0 ? (
            <div className="space-y-3">
              {historicalRequests.map((request) => {
                const section = sectionMap.get(request.reusable_section_id);
                return (
                  <div key={request.id} className="rounded-xl border border-border/60 bg-muted/20 p-3 text-sm">
                    <p className="font-medium text-foreground">{request.action_type} • {request.status}</p>
                    <p className="mt-1 text-xs text-muted-foreground">Section: {section?.name || request.reusable_section_id}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {request.reviewed_at ? `Reviewed ${new Date(request.reviewed_at).toLocaleString()}` : 'Not reviewed'}
                      {request.completed_at ? ` • Completed ${new Date(request.completed_at).toLocaleString()}` : ''}
                    </p>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No historical reusable section action requests.</p>
          )}
        </div>
      </div>
    </div>
  );
}

export default ReusableSectionActionRequestsManager;
