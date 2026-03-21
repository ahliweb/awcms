import { Link } from 'react-router-dom';
import {
  Activity,
  RefreshCw,
  Search,
  CheckCircle2,
  XCircle,
  Clock,
  ChevronLeft,
  ChevronRight,
  Mail,
  MessageSquare,
  Send,
} from 'lucide-react';
import { AdminPageLayout, PageHeader } from '@/templates/flowbite-admin';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useNotificationDispatches } from '@/hooks/useNotificationDispatches';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const formatDate = (value) => {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString();
};

// ─── Channel icon ─────────────────────────────────────────────────────────────

function ChannelIcon({ type }) {
  const map = {
    email:    { Icon: Mail,          label: 'Email' },
    whatsapp: { Icon: MessageSquare, label: 'WhatsApp' },
    telegram: { Icon: Send,          label: 'Telegram' },
  };
  const { Icon, label } = map[type] ?? { Icon: Activity, label: type };
  return (
    <span className="flex items-center gap-1.5 text-sm text-foreground">
      <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
      {label}
    </span>
  );
}

// ─── Status badge ─────────────────────────────────────────────────────────────

function StatusBadge({ status }) {
  switch (status) {
    case 'sent':
      return (
        <Badge className="flex w-fit items-center gap-1 border-transparent bg-primary/10 text-primary">
          <CheckCircle2 className="h-3.5 w-3.5" />
          Sent
        </Badge>
      );
    case 'failed':
      return (
        <Badge className="flex w-fit items-center gap-1 border-transparent bg-destructive/10 text-destructive">
          <XCircle className="h-3.5 w-3.5" />
          Failed
        </Badge>
      );
    case 'pending':
      return (
        <Badge className="flex w-fit items-center gap-1 border-transparent bg-muted text-muted-foreground">
          <Clock className="h-3.5 w-3.5" />
          Pending
        </Badge>
      );
    default:
      return <Badge variant="outline">{status ?? '—'}</Badge>;
  }
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function NotificationDispatchLog() {
  const {
    dispatches,
    totalCount,
    totalPages,
    loading,
    page,
    setPage,
    filters,
    setFilters,
    canRead,
    refresh,
  } = useNotificationDispatches();

  const handleFilterChange = (key, value) => {
    setFilters((prev) => ({ ...prev, [key]: value === 'all' ? '' : value }));
    setPage(1);
  };

  const handleSearch = (e) => {
    handleFilterChange('search', e.target.value);
  };

  if (!canRead) {
    return (
      <AdminPageLayout requiredPermission="tenant.notifications.read">
        <PageHeader
          title="Notification Dispatch Log"
          description="View outbound message dispatch history across all notification channels."
          icon={Activity}
          breadcrumbs={[{ label: 'Settings' }, { label: 'Dispatch Log', icon: Activity }]}
        />
      </AdminPageLayout>
    );
  }

  return (
    <AdminPageLayout requiredPermission="tenant.notifications.read">
      <PageHeader
        title="Notification Dispatch Log"
        description="Outbound message history for email, WhatsApp, and Telegram channels."
        icon={Activity}
        breadcrumbs={[{ label: 'Settings' }, { label: 'Dispatch Log', icon: Activity }]}
        actions={
          <Button asChild variant="outline" size="sm">
            <Link to="/cmspanel/notification-channels">Channel Settings</Link>
          </Button>
        }
      />

      {/* Filters */}
      <Card className="mb-4 border-border/60 bg-card/70 shadow-sm">
        <CardContent className="flex flex-wrap items-center gap-3 p-4">
          {/* Search */}
          <div className="relative min-w-[200px] flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-9"
              placeholder="Search recipient or message ID…"
              value={filters.search}
              onChange={handleSearch}
            />
          </div>

          {/* Channel type */}
          <Select
            value={filters.channel_type || 'all'}
            onValueChange={(v) => handleFilterChange('channel_type', v)}
          >
            <SelectTrigger className="w-[160px]">
              <SelectValue placeholder="Channel" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All channels</SelectItem>
              <SelectItem value="email">Email</SelectItem>
              <SelectItem value="whatsapp">WhatsApp</SelectItem>
              <SelectItem value="telegram">Telegram</SelectItem>
            </SelectContent>
          </Select>

          {/* Status */}
          <Select
            value={filters.status || 'all'}
            onValueChange={(v) => handleFilterChange('status', v)}
          >
            <SelectTrigger className="w-[140px]">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="sent">Sent</SelectItem>
              <SelectItem value="failed">Failed</SelectItem>
            </SelectContent>
          </Select>

          <Button variant="outline" size="icon" onClick={refresh} title="Refresh">
            <RefreshCw className="h-4 w-4" />
          </Button>
        </CardContent>
      </Card>

      {/* Table */}
      <Card className="border-border/60 bg-card shadow-sm">
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="border-border/60">
                  <TableHead>Channel</TableHead>
                  <TableHead>Recipient</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Provider Message ID</TableHead>
                  <TableHead>Error</TableHead>
                  <TableHead>Sent at</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={6} className="py-12 text-center text-muted-foreground">
                      <div className="flex items-center justify-center gap-2">
                        <div className="h-5 w-5 animate-spin rounded-full border-b-2 border-primary" />
                        Loading…
                      </div>
                    </TableCell>
                  </TableRow>
                ) : dispatches.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="py-12 text-center text-muted-foreground">
                      No dispatch records found.
                    </TableCell>
                  </TableRow>
                ) : (
                  dispatches.map((row) => (
                    <TableRow key={row.id} className="border-border/60 hover:bg-muted/30">
                      <TableCell>
                        <ChannelIcon type={row.channel_type} />
                      </TableCell>
                      <TableCell className="max-w-[200px] truncate font-mono text-xs">
                        {row.recipient ?? '—'}
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={row.status} />
                      </TableCell>
                      <TableCell className="max-w-[160px] truncate font-mono text-xs text-muted-foreground">
                        {row.provider_message_id ?? '—'}
                      </TableCell>
                      <TableCell className="max-w-[240px] truncate text-xs text-destructive">
                        {row.error_message ?? '—'}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                        {formatDate(row.created_at)}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between border-t border-border/60 px-4 py-3">
              <p className="text-sm text-muted-foreground">
                {totalCount} total records · page {page} of {totalPages}
              </p>
              <div className="flex items-center gap-1">
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </AdminPageLayout>
  );
}
