
import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/customSupabaseClient';
import { usePermissions } from '@/contexts/PermissionContext';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { useToast } from '@/components/ui/use-toast';
import { Loader2, CheckCircle, UserCheck, ShieldCheck, ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AdminPageLayout, PageHeader } from '@/templates/flowbite-admin';

const ITEMS_PER_PAGE_OPTIONS = [5, 10, 25, 50];

const UserApprovalManager = () => {
    const [requests, setRequests] = useState([]);
    const [loading, setLoading] = useState(true);
    const [activeTab, setActiveTab] = useState('pending');
    const [processingId, setProcessingId] = useState(null);
    const [rejectReason, setRejectReason] = useState('');
    const [selectedRequest, setSelectedRequest] = useState(null);
    const [dialogOpen, setDialogOpen] = useState(false);

    // Pagination state
    const [currentPage, setCurrentPage] = useState(1);
    const [itemsPerPage, setItemsPerPage] = useState(10);
    const [totalItems, setTotalItems] = useState(0);

    const { isPlatformAdmin, isFullAccess } = usePermissions();
    const { toast } = useToast();

    const isSuperAdmin = isPlatformAdmin || isFullAccess;

    // Reset page when tab changes
    useEffect(() => {
        setCurrentPage(1);
    }, [activeTab]);



    const fetchRequests = useCallback(async () => {
        setLoading(true);
        try {
            let query = supabase
                .from('account_requests')
                .select('*', { count: 'exact' })
                .order('created_at', { ascending: false });

            // Filter by status based on tab
            if (activeTab === 'pending') {
                if (isSuperAdmin) {
                    query = query.in('status', ['pending_admin', 'pending_super_admin']);
                } else {
                    query = query.eq('status', 'pending_admin');
                }
            } else {
                query = query.eq('status', activeTab);
            }

            // Apply pagination
            const from = (currentPage - 1) * itemsPerPage;
            const to = from + itemsPerPage - 1;
            query = query.range(from, to);

            const { data, error, count } = await query;
            if (error) throw error;

            setRequests(data || []);
            setTotalItems(count || 0);
        } catch (error) {
            console.error('Error fetching requests:', error);
            toast({ variant: "destructive", title: "Error", description: "Failed to load requests." });
        } finally {
            setLoading(false);
        }
    }, [activeTab, currentPage, itemsPerPage, isSuperAdmin, toast]);

    useEffect(() => {
        fetchRequests();
    }, [activeTab, currentPage, itemsPerPage, fetchRequests]);

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
                body: { action, request_id: request.id }
            });

            if (error) {
                // Attempt to retrieve the specific error message from the response body
                let detailedMessage = error.message;
                if (error.context && typeof error.context.json === 'function') {
                    try {
                        const body = await error.context.json();
                        if (body && body.error) {
                            detailedMessage = body.error;
                        }
                    } catch (e) {
                        console.warn('Failed to parse error context JSON:', e);
                    }
                }
                throw new Error(detailedMessage);
            }
            if (data?.error) throw new Error(data.error);

            toast({ title: "Success", description: data.message });
            fetchRequests();
        } catch (error) {
            console.error('Approval error:', error);
            toast({ variant: "destructive", title: "Action Failed", description: error.message });
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
                    reason: rejectReason
                }
            });

            if (error) throw error;
            if (data?.error) throw new Error(data.error);

            toast({ title: "Application Rejected", description: "The request has been rejected." });
            setDialogOpen(false);
            setRejectReason('');
            fetchRequests();
        } catch (error) {
            console.error('Rejection error:', error);
            toast({ variant: "destructive", title: "Action Failed", description: error.message });
        } finally {
            setProcessingId(null);
        }
    };

    const getStatusBadge = (status) => {
        switch (status) {
            case 'pending_admin': return <Badge className="bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-900/40 dark:text-amber-300 dark:border-amber-800">Pending Admin</Badge>;
            case 'pending_super_admin': return <Badge className="bg-primary/10 text-primary border-primary/20">Pending Platform Admin</Badge>;
            case 'completed': return <Badge className="bg-green-100 text-green-800 border-green-200 dark:bg-green-900/40 dark:text-green-300 dark:border-green-800">Approved & Invited</Badge>;
            case 'rejected': return <Badge variant="destructive">Rejected</Badge>;
            default: return <Badge variant="secondary" className="text-secondary-foreground">{status}</Badge>;
        }
    };

    const totalPages = Math.ceil(totalItems / itemsPerPage);

    const PaginationControls = () => (
        <div className="flex items-center justify-between pt-4 border-t border-border">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <span>Rows per page:</span>
                <Select value={String(itemsPerPage)} onValueChange={(v) => { setItemsPerPage(Number(v)); setCurrentPage(1); }}>
                    <SelectTrigger className="w-16 h-8 bg-background border-input">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        {ITEMS_PER_PAGE_OPTIONS.map(opt => (
                            <SelectItem key={opt} value={String(opt)}>{opt}</SelectItem>
                        ))}
                    </SelectContent>
                </Select>
                <span className="ml-4">
                    {totalItems > 0 ? `${(currentPage - 1) * itemsPerPage + 1}-${Math.min(currentPage * itemsPerPage, totalItems)} of ${totalItems}` : '0 items'}
                </span>
            </div>
            <div className="flex items-center gap-1">
                <Button variant="outline" size="icon" className="h-8 w-8 text-muted-foreground" onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage <= 1}>
                    <ChevronLeft className="w-4 h-4" />
                </Button>
                <span className="px-2 text-sm text-foreground">Page {currentPage} of {totalPages || 1}</span>
                <Button variant="outline" size="icon" className="h-8 w-8 text-muted-foreground" onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={currentPage >= totalPages}>
                    <ChevronRight className="w-4 h-4" />
                </Button>
            </div>
        </div>
    );

    const renderTable = (showActions = false) => (
        <>
            {loading ? (
                <div className="flex items-center justify-center p-8">
                    <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                </div>
            ) : requests.length === 0 ? (
                <div className="text-center p-8 text-muted-foreground border border-dashed border-border rounded-lg bg-muted/20">
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
                        {requests.map((req) => (
                            <TableRow key={req.id}>
                                <TableCell className="text-slate-500 text-sm">
                                    {new Date(req.created_at).toLocaleDateString()}
                                </TableCell>
                                <TableCell className="font-medium">{req.full_name}</TableCell>
                                <TableCell>{req.email}</TableCell>
                                <TableCell>{getStatusBadge(req.status)}</TableCell>
                                {activeTab === 'rejected' && (
                                    <TableCell className="text-red-600 italic max-w-xs truncate">{req.rejection_reason || '-'}</TableCell>
                                )}
                                {showActions && (
                                    <TableCell className="text-right space-x-2">
                                        {req.status === 'pending_admin' && (
                                            <Button size="sm" onClick={() => handleApprove(req)} disabled={processingId === req.id}>
                                                {processingId === req.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4 mr-1" />}
                                                Approve
                                            </Button>
                                        )}
                                        {req.status === 'pending_super_admin' && isSuperAdmin && (
                                            <Button size="sm" className="bg-blue-600 hover:bg-blue-700 text-white" onClick={() => handleApprove(req)} disabled={processingId === req.id}>
                                                {processingId === req.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4 mr-1" />}
                                                Final Approve
                                            </Button>
                                        )}
                                        <Button variant="destructive" size="sm" onClick={() => { setSelectedRequest(req); setDialogOpen(true); }} disabled={processingId === req.id}>
                                            Reject
                                        </Button>
                                    </TableCell>
                                )}
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            )}
            <PaginationControls />
        </>
    );

    return (
        <AdminPageLayout requiredPermission="platform.approvals.read">
            <PageHeader
                title="Account Approvals"
                description="Manage user registration and approval requests."
                icon={UserCheck}
                breadcrumbs={[{ label: 'Approvals', icon: UserCheck }]}
                actions={(
                    <Button variant="ghost" size="icon" onClick={fetchRequests} title="Refresh">
                        <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                    </Button>
                )}
            />

            <Card className="w-full">
                <CardContent className="pt-6">
                    <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
                        <TabsList>
                            <TabsTrigger value="pending">Pending</TabsTrigger>
                            <TabsTrigger value="completed">Approved</TabsTrigger>
                            <TabsTrigger value="rejected">Rejected</TabsTrigger>
                        </TabsList>

                        <TabsContent value="pending" className="space-y-4">
                            {renderTable(true)}
                        </TabsContent>

                        <TabsContent value="completed">
                            {renderTable(false)}
                        </TabsContent>

                        <TabsContent value="rejected">
                            {renderTable(false)}
                        </TabsContent>
                    </Tabs>
                </CardContent>

                {/* Reject Dialog */}
                <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                    <DialogContent>
                        <DialogHeader>
                            <DialogTitle>Reject Application</DialogTitle>
                            <DialogDescription>
                                Provide a reason for rejecting this application.
                            </DialogDescription>
                        </DialogHeader>
                        <div className="py-4">
                            <Textarea
                                placeholder="Reason for rejection..."
                                value={rejectReason}
                                onChange={(e) => setRejectReason(e.target.value)}
                            />
                        </div>
                        <DialogFooter>
                            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
                            <Button variant="destructive" onClick={handleReject} disabled={!rejectReason || processingId}>
                                {processingId ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                                Confirm Rejection
                            </Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>
            </Card>
        </AdminPageLayout>
    );
};

export default UserApprovalManager;
