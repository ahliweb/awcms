import { useCallback, useEffect, useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { ClipboardList } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { usePermissions } from '@/contexts/PermissionContext';
import { supabase } from '@/lib/customSupabaseClient';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { AdminPageLayout, PageHeader } from '@/templates/flowbite-admin';
import AuditLogsHeaderActions from '@/components/dashboard/audit-logs/AuditLogsHeaderActions';
import AuditLogsSearchBar from '@/components/dashboard/audit-logs/AuditLogsSearchBar';
import AuditLogsTable from '@/components/dashboard/audit-logs/AuditLogsTable';
import AuditLogsPaginationBar from '@/components/dashboard/audit-logs/AuditLogsPaginationBar';
import AuditLogDiffDialog from '@/components/dashboard/audit-logs/AuditLogDiffDialog';

function AuditLogsManager() {
  const { t } = useTranslation();
  const { tenantId, hasPermission, isPlatformAdmin, isFullAccess } = usePermissions();

  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedLog, setSelectedLog] = useState(null);

  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(50);
  const [totalCount, setTotalCount] = useState(0);

  const canView = hasPermission('tenant.audit.read')
    || hasPermission('platform.reporting.read')
    || isPlatformAdmin
    || isFullAccess;

  const fetchLogs = useCallback(async () => {
    if (!canView) return;

    setLoading(true);
    try {
      const from = (page - 1) * limit;
      const to = from + limit - 1;

      let query = supabase
        .from('audit_logs')
        .select('*, user:users(email, full_name)', { count: 'exact' })
        .order('created_at', { ascending: false })
        .range(from, to);

      if (searchQuery) {
        query = query.or(`action.ilike.%${searchQuery}%,resource.ilike.%${searchQuery}%`);
      }

      const { data, count, error } = await query;
      if (error) throw error;

      setLogs(data || []);
      setTotalCount(count || 0);
    } catch (error) {
      console.error('Error fetching audit logs:', error);
    } finally {
      setLoading(false);
    }
  }, [canView, limit, page, searchQuery]);

  useEffect(() => {
    if (canView && (tenantId || isPlatformAdmin || isFullAccess)) {
      fetchLogs();
    }
  }, [canView, tenantId, isPlatformAdmin, isFullAccess, fetchLogs]);

  if (!canView) {
    return (
      <div className="p-8 text-center">
        <p className="text-muted-foreground">{t('audit.permission_denied')}</p>
      </div>
    );
  }

  return (
    <AdminPageLayout requiredPermission="tenant.audit.read">
      <Helmet>
        <title>{t('audit.page_title')}</title>
      </Helmet>

      <PageHeader
        title={t('audit.header_title')}
        description={t('audit.header_desc')}
        icon={ClipboardList}
        breadcrumbs={[{ label: t('audit.header_title'), icon: ClipboardList }]}
        actions={(
          <AuditLogsHeaderActions
            loading={loading}
            onRefresh={fetchLogs}
            t={t}
          />
        )}
      />

      <AuditLogsSearchBar
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
        t={t}
      />

      <Card className="border-border">
        <CardHeader>
          <CardTitle>{t('audit.activity_history')}</CardTitle>
          <CardDescription>{t('audit.activity_desc')}</CardDescription>
        </CardHeader>
        <CardContent>
          <AuditLogsTable
            loading={loading}
            logs={logs}
            setSelectedLog={setSelectedLog}
            t={t}
          />

          <AuditLogsPaginationBar
            totalCount={totalCount}
            page={page}
            limit={limit}
            setLimit={setLimit}
            setPage={setPage}
            t={t}
          />
        </CardContent>
      </Card>

      <AuditLogDiffDialog
        selectedLog={selectedLog}
        setSelectedLog={setSelectedLog}
        t={t}
      />
    </AdminPageLayout>
  );
}

export default AuditLogsManager;
