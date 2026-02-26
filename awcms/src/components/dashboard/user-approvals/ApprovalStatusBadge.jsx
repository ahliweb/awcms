import { Badge } from '@/components/ui/badge';

function ApprovalStatusBadge({ status }) {
  switch (status) {
    case 'pending_admin':
      return <Badge className="border-amber-200 bg-amber-100 text-amber-800 dark:border-amber-800 dark:bg-amber-900/40 dark:text-amber-300">Pending Admin</Badge>;
    case 'pending_super_admin':
      return <Badge className="border-primary/20 bg-primary/10 text-primary">Pending Platform Admin</Badge>;
    case 'completed':
      return <Badge className="border-green-200 bg-green-100 text-green-800 dark:border-green-800 dark:bg-green-900/40 dark:text-green-300">Approved & Invited</Badge>;
    case 'rejected':
      return <Badge variant="destructive">Rejected</Badge>;
    default:
      return <Badge variant="secondary" className="text-secondary-foreground">{status}</Badge>;
  }
}

export default ApprovalStatusBadge;
