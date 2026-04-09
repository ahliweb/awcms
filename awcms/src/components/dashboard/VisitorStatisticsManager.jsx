import { useCallback, useEffect, useMemo, useState } from 'react';
import { LineChart } from 'lucide-react';

import { supabase } from '@/lib/customSupabaseClient';
import { usePermissions } from '@/contexts/PermissionContext';
import { useTenant } from '@/contexts/TenantContext';
import { useToast } from '@/components/ui/use-toast';
import { AdminPageLayout, PageHeader } from '@/templates/emdash-admin';
import VisitorStatsHeaderActions from '@/components/dashboard/visitor-statistics/VisitorStatsHeaderActions';
import VisitorStatsSummaryCards from '@/components/dashboard/visitor-statistics/VisitorStatsSummaryCards';
import VisitorStatsTopSections from '@/components/dashboard/visitor-statistics/VisitorStatsTopSections';
import VisitorStatsEventsTableCard from '@/components/dashboard/visitor-statistics/VisitorStatsEventsTableCard';

const SUMMARY_DAYS = 30;
const RECENT_DAYS = 7;
const EVENTS_PER_PAGE = 50;

const formatNumber = (value) => new Intl.NumberFormat().format(value || 0);

const capitalize = (value) =>
  value
    ? value
        .toString()
        .replace(/_/g, ' ')
        .replace(/\b\w/g, (char) => char.toUpperCase())
    : 'Unknown';

const getReferrerLabel = (referrer) => {
  if (!referrer) return 'Direct';
  try {
    return new URL(referrer).hostname || referrer;
  } catch {
    return referrer;
  }
};

const buildTopList = (map, limit = 5) =>
  Array.from(map.entries())
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);

const incrementMap = (map, key) => {
  const nextKey = key || 'Unknown';
  map.set(nextKey, (map.get(nextKey) || 0) + 1);
};

function VisitorStatisticsManager() {
  const { toast } = useToast();
  const { hasPermission, isPlatformAdmin, isFullAccess } = usePermissions();
  const { currentTenant } = useTenant();

  const [summaryLoading, setSummaryLoading] = useState(false);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [events, setEvents] = useState([]);
  const [page, setPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [summary, setSummary] = useState({
    pageViews: 0,
    uniqueVisitors: 0,
    uniqueSessions: 0,
    topPages: [],
    topReferrers: [],
    topDevices: [],
    topCountries: [],
    consentStates: [],
  });

  const canView = hasPermission('tenant.analytics.read') || isPlatformAdmin || isFullAccess;

  const totalPages = useMemo(() => {
    if (!totalCount) return 1;
    return Math.max(1, Math.ceil(totalCount / EVENTS_PER_PAGE));
  }, [totalCount]);

  const fetchSummary = useCallback(async () => {
    if (!canView) return;
    if (!currentTenant?.id && !isPlatformAdmin && !isFullAccess) return;

    setSummaryLoading(true);
    try {
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - SUMMARY_DAYS + 1);
      const startDateIso = startDate.toISOString().slice(0, 10);

      let dailyQuery = supabase
        .from('analytics_daily')
        .select('path, page_views, unique_visitors, unique_sessions, date')
        .gte('date', startDateIso);

      if (currentTenant?.id) {
        dailyQuery = dailyQuery.eq('tenant_id', currentTenant.id);
      }

      const { data: dailyData, error: dailyError } = await dailyQuery;

      if (dailyError) throw dailyError;

      const pageMap = new Map();
      const totals = {
        pageViews: 0,
        uniqueVisitors: 0,
        uniqueSessions: 0,
      };

      (dailyData || []).forEach((row) => {
        if (row.path === '__all__') {
          totals.pageViews += row.page_views || 0;
          totals.uniqueVisitors += row.unique_visitors || 0;
          totals.uniqueSessions += row.unique_sessions || 0;
          return;
        }

        const path = row.path || '/';
        pageMap.set(path, (pageMap.get(path) || 0) + (row.page_views || 0));
      });

      const recentStart = new Date();
      recentStart.setDate(recentStart.getDate() - RECENT_DAYS + 1);

      let recentQuery = supabase
        .from('analytics_events')
        .select('referrer, device_type, country, consent_state, created_at')
        .gte('created_at', recentStart.toISOString())
        .order('created_at', { ascending: false })
        .limit(1500);

      if (currentTenant?.id) {
        recentQuery = recentQuery.eq('tenant_id', currentTenant.id);
      }

      const { data: recentEvents, error: recentError } = await recentQuery;

      if (recentError) throw recentError;

      const referrerMap = new Map();
      const deviceMap = new Map();
      const countryMap = new Map();
      const consentMap = new Map();

      (recentEvents || []).forEach((event) => {
        incrementMap(referrerMap, getReferrerLabel(event.referrer));
        incrementMap(deviceMap, capitalize(event.device_type));
        incrementMap(countryMap, event.country || 'Unknown');
        incrementMap(consentMap, capitalize(event.consent_state || 'unknown'));
      });

      setSummary({
        pageViews: totals.pageViews,
        uniqueVisitors: totals.uniqueVisitors,
        uniqueSessions: totals.uniqueSessions,
        topPages: buildTopList(pageMap),
        topReferrers: buildTopList(referrerMap),
        topDevices: buildTopList(deviceMap),
        topCountries: buildTopList(countryMap),
        consentStates: buildTopList(consentMap),
      });
    } catch (error) {
      console.error('Error fetching visitor summary:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Failed to load visitor statistics',
      });
    } finally {
      setSummaryLoading(false);
    }
  }, [canView, currentTenant?.id, isFullAccess, isPlatformAdmin, toast]);

  const fetchEvents = useCallback(async () => {
    if (!canView) return;
    if (!currentTenant?.id && !isPlatformAdmin && !isFullAccess) return;

    setEventsLoading(true);
    try {
      const from = (page - 1) * EVENTS_PER_PAGE;
      const to = from + EVENTS_PER_PAGE - 1;

      let query = supabase
        .from('analytics_events')
        .select(
          'id, path, ip_address, visitor_id, session_id, referrer, device_type, country, consent_state, created_at, tenant_id',
          { count: 'exact' },
        )
        .order('created_at', { ascending: false })
        .range(from, to);

      if (currentTenant?.id) {
        query = query.eq('tenant_id', currentTenant.id);
      }

      if (searchQuery) {
        query = query.or(
          `path.ilike.%${searchQuery}%,ip_address.ilike.%${searchQuery}%,referrer.ilike.%${searchQuery}%`,
        );
      }

      const { data, count, error } = await query;

      if (error) throw error;

      setEvents(data || []);
      setTotalCount(count || 0);
    } catch (error) {
      console.error('Error fetching visitor events:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Failed to load visitor events',
      });
    } finally {
      setEventsLoading(false);
    }
  }, [canView, currentTenant?.id, isFullAccess, isPlatformAdmin, page, searchQuery, toast]);

  useEffect(() => {
    if (canView && (currentTenant?.id || isPlatformAdmin || isFullAccess)) {
      fetchSummary();
    }
  }, [canView, currentTenant?.id, fetchSummary, isFullAccess, isPlatformAdmin]);

  useEffect(() => {
    if (canView && (currentTenant?.id || isPlatformAdmin || isFullAccess)) {
      fetchEvents();
    }
  }, [canView, currentTenant?.id, fetchEvents, isFullAccess, isPlatformAdmin]);

  if (!canView) {
    return (
      <div className="p-8 text-center">
        <p className="text-muted-foreground">Access Denied</p>
      </div>
    );
  }

  return (
    <AdminPageLayout requiredPermission="tenant.analytics.read">
      <PageHeader
        title="Visitor Statistics"
        description="Monitor visits, page views, and traffic sources."
        icon={LineChart}
        breadcrumbs={[{ label: 'Visitor Statistics', icon: LineChart }]}
        actions={(
          <VisitorStatsHeaderActions
            summaryLoading={summaryLoading}
            eventsLoading={eventsLoading}
            onRefresh={() => {
              fetchSummary();
              fetchEvents();
            }}
          />
        )}
      />

      <div className="mb-6 overflow-hidden rounded-2xl border border-border/60 bg-card/70 shadow-sm backdrop-blur-sm">
        <div className="bg-gradient-to-r from-primary/12 via-background/40 to-emerald-500/12 p-4 sm:p-5">
          <h3 className="text-base font-semibold text-foreground">Traffic analytics workspace</h3>
          <p className="mt-1 text-sm text-muted-foreground">Track page views, recent events, and top traffic sources within the current tenant analytics scope.</p>
        </div>
      </div>

      <VisitorStatsSummaryCards
        summary={summary}
        summaryLoading={summaryLoading}
        formatNumber={formatNumber}
      />

      <VisitorStatsTopSections
        summary={summary}
        formatNumber={formatNumber}
      />

      <VisitorStatsEventsTableCard
        events={events}
        eventsLoading={eventsLoading}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        page={page}
        setPage={setPage}
        totalPages={totalPages}
        totalCount={totalCount}
        capitalize={capitalize}
        getReferrerLabel={getReferrerLabel}
        formatNumber={formatNumber}
      />
    </AdminPageLayout>
  );
}

export default VisitorStatisticsManager;
