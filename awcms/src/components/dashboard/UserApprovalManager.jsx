import { useState, useEffect, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/customSupabaseClient';
import { usePermissions } from '@/contexts/PermissionContext';
import { useToast } from '@/components/ui/use-toast';
import { useTranslation } from 'react-i18next';
import { CheckCircle2, ChevronRight, Home, UserCheck, XCircle } from 'lucide-react';
import { PageTabs, TabsContent } from '@/templates/flowbite-admin';
import ApprovalHeaderActions from '@/components/dashboard/user-approvals/ApprovalHeaderActions';
import ApprovalRequestsTable from '@/components/dashboard/user-approvals/ApprovalRequestsTable';
import RejectApplicationDialog from '@/components/dashboard/user-approvals/RejectApplicationDialog';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

const APPROVAL_TABS = ['pending', 'completed', 'rejected'];

const UserApprovalManager = ({ activeTab: controlledTab, onTabChange, embedded = false }) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [internalTab, setInternalTab] = useState('pending');
  const activeTab = controlledTab || internalTab;
  const handleTabChange = onTabChange || setInternalTab;
  const effectiveTab = APPROVAL_TABS.includes(activeTab) ? activeTab : 'pending';

  const [processingId, setProcessingId] = useState(null);
  const [rejectReason, setRejectReason] = useState('');
  const [selectedRequest, setSelectedRequest] = useState(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(10);
  const [totalItems, setTotalItems] = useState(0);

  const { hasPermission, isPlatformAdmin, isFullAccess } = usePermissions();
  const { toast } = useToast();

  const isSuperAdmin = isPlatformAdmin || isFullAccess;
  const canViewApprovals = hasPermission('platform.approvals.read') || isSuperAdmin;

  useEffect(() => {
    if (!onTabChange) return;
    if (!controlledTab || !APPROVAL_TABS.includes(controlledTab)) {
      onTabChange('pending');
    }
  }, [onTabChange, controlledTab]);

  useEffect(() => {
    setCurrentPage(1);
  }, [effectiveTab]);

  const fetchRequests = useCallback(async () => {
    setLoading(true);
    try {
      let query = supabase
        .from('account_requests')
        .select('*', { count: 'exact' })
        .order('created_at', { ascending: false });

      if (effectiveTab === 'pending') {
        if (isSuperAdmin) {
          query = query.in('status', ['pending_admin', 'pending_super_admin']);
        } else {
          query = query.eq('status', 'pending_admin');
        }
      } else {
        query = query.eq('status', effectiveTab);
      }

      const from = (currentPage - 1) * itemsPerPage;
      const to = from + itemsPerPage - 1;
      query = query.range(from, to);

      const { data, error, count } = await query;
      if (error) throw error;

      setRequests(data || []);
      setTotalItems(count || 0);
    } catch (error) {
      console.error('Error fetching requests:', error);
      toast({ variant: 'destructive', title: t('common.error'), description: t('approvals.toast.load_error') });
    } finally {
      setLoading(false);
    }
  }, [effectiveTab, currentPage, itemsPerPage, isSuperAdmin, toast, t]);

  useEffect(() => {
    if (!canViewApprovals) return;
    fetchRequests();
  }, [fetchRequests, canViewApprovals]);

  const handleApprove = async (request) => {
    setProcessingId(request.id);
    try {
      let action = '';
      if (request.status === 'pending_admin') {
        action = 'approve_application_admin';
      } else if (request.status === 'pending_super_admin') {
        action = 'approve_application_super_admin';
      } else {
        throw new Error('Invalid status for approval');
      }

      const { data, error } = await supabase.functions.invoke('manage-users', {
        body: { action, request_id: request.id },
      });

      if (error) {
        let detailedMessage = error.message;
        if (error.context && typeof error.context.json === 'function') {
          try {
            const body = await error.context.json();
            if (body && body.error) {
              detailedMessage = body.error;
            }
          } catch (contextError) {
            console.warn('Failed to parse error context JSON:', contextError);
          }
        }
        throw new Error(detailedMessage);
      }

      if (data?.error) throw new Error(data.error);

      toast({ title: t('common.success'), description: data.message });
      fetchRequests();
    } catch (error) {
      console.error('Approval error:', error);
      toast({ variant: 'destructive', title: t('approvals.toast.action_failed'), description: error.message });
    } finally {
      setProcessingId(null);
    }
  };

  const handleReject = async () => {
    if (!selectedRequest) return;

    setProcessingId(selectedRequest.id);
    try {
      const { data, error } = await supabase.functions.invoke('manage-users', {
        body: {
          action: 'reject_application',
          request_id: selectedRequest.id,
          reason: rejectReason,
        },
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      toast({ title: t('approvals.toast.rejected_title'), description: t('approvals.toast.rejected_desc') });
      setDialogOpen(false);
      setRejectReason('');
      fetchRequests();
    } catch (error) {
      console.error('Rejection error:', error);
      toast({ variant: 'destructive', title: t('approvals.toast.action_failed'), description: error.message });
    } finally {
      setProcessingId(null);
    }
  };

  const totalPages = Math.ceil(totalItems / itemsPerPage);

  const summaryCards = [
    {
      title: t('approvals.tabs.pending'),
      value: effectiveTab === 'pending' ? totalItems : 'Queue',
      description: 'Incoming applications waiting for the next approval step.',
      accent: 'from-primary/15 via-primary/6 to-transparent',
      icon: UserCheck,
    },
    {
      title: t('approvals.tabs.approved'),
      value: effectiveTab === 'completed' ? totalItems : 'History',
      description: 'Approved account requests and completed onboarding outcomes.',
      accent: 'from-emerald-500/15 via-emerald-500/6 to-transparent',
      icon: CheckCircle2,
    },
    {
      title: t('approvals.tabs.rejected'),
      value: effectiveTab === 'rejected' ? totalItems : 'Audit',
      description: 'Rejected applications and reasons tracked for review.',
      accent: 'from-destructive/15 via-destructive/6 to-transparent',
      icon: XCircle,
    },
  ];

  return (
    <div className="space-y-8">
      {!canViewApprovals ? (
        <div className="rounded-2xl border border-destructive/25 bg-destructive/8 px-4 py-3 text-sm text-destructive shadow-sm">
          <span className="font-semibold">Access denied.</span> You do not have permission to review user approvals.
        </div>
      ) : (
        <>
      {embedded ? (
        <div className="space-y-8">
          <div className="rounded-3xl border border-border/70 bg-gradient-to-br from-background via-background to-primary/5 p-6 shadow-sm">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="space-y-1.5">
                <div className="flex items-center gap-3">
                  <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary shadow-sm">
                    <UserCheck className="h-5 w-5" />
                  </span>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">Approvals</p>
                    <p className="text-lg font-semibold text-foreground">{t('approvals.manager.title')}</p>
                  </div>
                </div>
                <p className="max-w-3xl text-sm text-muted-foreground">{t('approvals.manager.description')}</p>
              </div>
              <ApprovalHeaderActions loading={loading} onRefresh={fetchRequests} />
            </div>
          </div>

          <div className="rounded-[28px] border border-border/60 bg-gradient-to-br from-muted/50 via-background to-background p-3 shadow-sm">
            <div className="grid gap-4 md:grid-cols-3">
              {summaryCards.map((card) => {
                const Icon = card.icon;
                return (
                  <Card key={card.title} className="overflow-hidden rounded-2xl border-border/70 shadow-sm">
                    <CardContent className="relative p-5">
                      <div className={cn('pointer-events-none absolute inset-0 bg-gradient-to-br', card.accent)} />
                      <div className="relative">
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">{card.title}</p>
                          <Icon className="h-4 w-4 text-primary" />
                        </div>
                        <p className="mt-3 text-4xl font-semibold leading-none text-foreground">{card.value}</p>
                        <p className="mt-3 max-w-xs text-sm leading-6 text-muted-foreground">{card.description}</p>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </div>
        </div>
      ) : (
        <nav className="mb-6">
          <ol className="flex flex-wrap items-center gap-1.5 break-words text-sm text-muted-foreground sm:gap-2.5">
            <li className="inline-flex items-center gap-1.5">
              <Link to="/cmspanel" className="flex items-center gap-1 transition-colors hover:text-foreground">
                <Home className="h-4 w-4" />
                Dashboard
              </Link>
            </li>
            <li aria-hidden="true" className="[&>svg]:size-3.5"><ChevronRight /></li>
            <li className="inline-flex items-center gap-1.5">
              <div className="flex items-center gap-1.5 rounded-full bg-primary px-3 py-1 font-medium text-primary-foreground shadow-sm">
                <span>{t('approvals.manager.title')}</span>
              </div>
            </li>
          </ol>
        </nav>
      )}

      <div className={embedded ? '' : 'rounded-2xl border border-border/60 bg-card/70 p-6 shadow-sm backdrop-blur-sm'}>
        <PageTabs
          value={effectiveTab}
          onValueChange={handleTabChange}
          tabs={[
            { value: 'pending', label: t('approvals.tabs.pending') },
            { value: 'completed', label: t('approvals.tabs.approved') },
            { value: 'rejected', label: t('approvals.tabs.rejected') },
          ]}
        >
          <TabsContent value="pending" className="space-y-4">
            <ApprovalRequestsTable
              loading={loading}
              requests={requests}
              activeTab={effectiveTab}
              showActions={true}
              processingId={processingId}
              isSuperAdmin={isSuperAdmin}
              onApprove={handleApprove}
              onOpenReject={(request) => {
                setSelectedRequest(request);
                setDialogOpen(true);
              }}
              currentPage={currentPage}
              setCurrentPage={setCurrentPage}
              itemsPerPage={itemsPerPage}
              setItemsPerPage={setItemsPerPage}
              totalItems={totalItems}
              totalPages={totalPages}
            />
          </TabsContent>

          <TabsContent value="completed">
            <ApprovalRequestsTable
              loading={loading}
              requests={requests}
              activeTab={effectiveTab}
              showActions={false}
              processingId={processingId}
              isSuperAdmin={isSuperAdmin}
              onApprove={handleApprove}
              onOpenReject={(request) => {
                setSelectedRequest(request);
                setDialogOpen(true);
              }}
              currentPage={currentPage}
              setCurrentPage={setCurrentPage}
              itemsPerPage={itemsPerPage}
              setItemsPerPage={setItemsPerPage}
              totalItems={totalItems}
              totalPages={totalPages}
            />
          </TabsContent>

          <TabsContent value="rejected">
            <ApprovalRequestsTable
              loading={loading}
              requests={requests}
              activeTab={effectiveTab}
              showActions={false}
              processingId={processingId}
              isSuperAdmin={isSuperAdmin}
              onApprove={handleApprove}
              onOpenReject={(request) => {
                setSelectedRequest(request);
                setDialogOpen(true);
              }}
              currentPage={currentPage}
              setCurrentPage={setCurrentPage}
              itemsPerPage={itemsPerPage}
              setItemsPerPage={setItemsPerPage}
              totalItems={totalItems}
              totalPages={totalPages}
            />
          </TabsContent>
        </PageTabs>

        <RejectApplicationDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          rejectReason={rejectReason}
          setRejectReason={setRejectReason}
          processing={Boolean(processingId)}
          onConfirm={handleReject}
        />
      </div>
        </>
      )}
    </div>
  );
};

export default UserApprovalManager;
