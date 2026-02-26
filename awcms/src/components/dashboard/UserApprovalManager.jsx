import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/customSupabaseClient';
import { usePermissions } from '@/contexts/PermissionContext';
import { useToast } from '@/components/ui/use-toast';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { UserCheck } from 'lucide-react';
import { AdminPageLayout, PageHeader } from '@/templates/flowbite-admin';
import ApprovalHeaderActions from '@/components/dashboard/user-approvals/ApprovalHeaderActions';
import ApprovalRequestsTable from '@/components/dashboard/user-approvals/ApprovalRequestsTable';
import RejectApplicationDialog from '@/components/dashboard/user-approvals/RejectApplicationDialog';

const APPROVAL_TABS = ['pending', 'completed', 'rejected'];

const UserApprovalManager = ({ activeTab: controlledTab, onTabChange }) => {
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

  const { isPlatformAdmin, isFullAccess } = usePermissions();
  const { toast } = useToast();

  const isSuperAdmin = isPlatformAdmin || isFullAccess;

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
      toast({ variant: 'destructive', title: 'Error', description: 'Failed to load requests.' });
    } finally {
      setLoading(false);
    }
  }, [effectiveTab, currentPage, itemsPerPage, isSuperAdmin, toast]);

  useEffect(() => {
    fetchRequests();
  }, [fetchRequests]);

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

      toast({ title: 'Success', description: data.message });
      fetchRequests();
    } catch (error) {
      console.error('Approval error:', error);
      toast({ variant: 'destructive', title: 'Action Failed', description: error.message });
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

      toast({ title: 'Application Rejected', description: 'The request has been rejected.' });
      setDialogOpen(false);
      setRejectReason('');
      fetchRequests();
    } catch (error) {
      console.error('Rejection error:', error);
      toast({ variant: 'destructive', title: 'Action Failed', description: error.message });
    } finally {
      setProcessingId(null);
    }
  };

  const totalPages = Math.ceil(totalItems / itemsPerPage);

  return (
    <AdminPageLayout requiredPermission="platform.approvals.read">
      <PageHeader
        title="Account Approvals"
        description="Manage user registration and approval requests."
        icon={UserCheck}
        breadcrumbs={[{ label: 'Approvals', icon: UserCheck }]}
        actions={(
          <ApprovalHeaderActions
            loading={loading}
            onRefresh={fetchRequests}
          />
        )}
      />

      <Card className="w-full">
        <CardContent className="pt-6">
          <Tabs value={effectiveTab} onValueChange={handleTabChange} className="space-y-4">
            <TabsList>
              <TabsTrigger value="pending">Pending</TabsTrigger>
              <TabsTrigger value="completed">Approved</TabsTrigger>
              <TabsTrigger value="rejected">Rejected</TabsTrigger>
            </TabsList>

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
          </Tabs>
        </CardContent>

        <RejectApplicationDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          rejectReason={rejectReason}
          setRejectReason={setRejectReason}
          processing={Boolean(processingId)}
          onConfirm={handleReject}
        />
      </Card>
    </AdminPageLayout>
  );
};

export default UserApprovalManager;
