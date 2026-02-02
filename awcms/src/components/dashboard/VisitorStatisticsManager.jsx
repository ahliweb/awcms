import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { format } from 'date-fns';
import { LineChart, RefreshCw, Search } from 'lucide-react';

import { supabase } from '@/lib/customSupabaseClient';
import { usePermissions } from '@/contexts/PermissionContext';
import { useTenant } from '@/contexts/TenantContext';
import { useToast } from '@/components/ui/use-toast';
import { AdminPageLayout, PageHeader } from '@/templates/flowbite-admin';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

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
  } catch (error) {
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
          <Button
            variant="outline"
            onClick={() => {
              fetchSummary();
              fetchEvents();
            }}
            disabled={summaryLoading || eventsLoading}
          >
            <RefreshCw
              className={`w-4 h-4 mr-2 ${summaryLoading || eventsLoading ? 'animate-spin' : ''}`}
            />
            Refresh
          </Button>
        )}
      />

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Page Views (30d)</CardDescription>
            <CardTitle className="text-2xl">
              {summaryLoading ? '...' : formatNumber(summary.pageViews)}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Unique Visitors (30d)</CardDescription>
            <CardTitle className="text-2xl">
              {summaryLoading ? '...' : formatNumber(summary.uniqueVisitors)}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Sessions (30d)</CardDescription>
            <CardTitle className="text-2xl">
              {summaryLoading ? '...' : formatNumber(summary.uniqueSessions)}
            </CardTitle>
          </CardHeader>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Top Pages</CardTitle>
            <CardDescription>Most viewed pages in the last 30 days.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {summary.topPages.length === 0 ? (
              <p className="text-sm text-muted-foreground">No page view data yet.</p>
            ) : (
              summary.topPages.map((item) => (
                <div key={item.label} className="flex items-center justify-between text-sm">
                  <span className="font-medium text-foreground">{item.label}</span>
                  <span className="text-muted-foreground">{formatNumber(item.count)} views</span>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Top Referrers</CardTitle>
            <CardDescription>Leading sources over the last week.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {summary.topReferrers.length === 0 ? (
              <p className="text-sm text-muted-foreground">No referrer data yet.</p>
            ) : (
              summary.topReferrers.map((item) => (
                <div key={item.label} className="flex items-center justify-between text-sm">
                  <span className="font-medium text-foreground">{item.label}</span>
                  <span className="text-muted-foreground">{formatNumber(item.count)}</span>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Device Mix</CardTitle>
            <CardDescription>Recent device breakdown.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {summary.topDevices.length === 0 ? (
              <p className="text-sm text-muted-foreground">No device data yet.</p>
            ) : (
              summary.topDevices.map((item) => (
                <div key={item.label} className="flex items-center justify-between text-sm">
                  <span className="font-medium text-foreground">{item.label}</span>
                  <span className="text-muted-foreground">{formatNumber(item.count)}</span>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Top Countries</CardTitle>
            <CardDescription>Most active regions.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {summary.topCountries.length === 0 ? (
              <p className="text-sm text-muted-foreground">No country data yet.</p>
            ) : (
              summary.topCountries.map((item) => (
                <div key={item.label} className="flex items-center justify-between text-sm">
                  <span className="font-medium text-foreground">{item.label}</span>
                  <span className="text-muted-foreground">{formatNumber(item.count)}</span>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Consent Status</CardTitle>
            <CardDescription>Latest consent responses.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {summary.consentStates.length === 0 ? (
              <p className="text-sm text-muted-foreground">No consent data yet.</p>
            ) : (
              summary.consentStates.map((item) => (
                <div key={item.label} className="flex items-center justify-between text-sm">
                  <span className="font-medium text-foreground">{item.label}</span>
                  <span className="text-muted-foreground">{formatNumber(item.count)}</span>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="border-border">
        <CardHeader>
          <CardTitle>Recent Visits</CardTitle>
          <CardDescription>Latest visitor events with IP and page path.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by path, IP, or referrer"
                className="pl-9"
                value={searchQuery}
                onChange={(event) => {
                  setSearchQuery(event.target.value);
                  setPage(1);
                }}
              />
            </div>
          </div>

          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 border-b border-border">
                <tr>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">Time</th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">Page</th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">IP</th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">Visitor</th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">Device</th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">Country</th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">Referrer</th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">Consent</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {eventsLoading ? (
                  <tr>
                    <td colSpan="8" className="px-4 py-6 text-center text-muted-foreground">
                      Loading visitor events...
                    </td>
                  </tr>
                ) : events.length === 0 ? (
                  <tr>
                    <td colSpan="8" className="px-4 py-6 text-center text-muted-foreground">
                      No visitor events found.
                    </td>
                  </tr>
                ) : (
                  events.map((event) => (
                    <tr key={event.id} className="hover:bg-muted/50 transition-colors">
                      <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                        {format(new Date(event.created_at), 'MMM dd, yyyy HH:mm')}
                      </td>
                      <td className="px-4 py-3 font-medium text-foreground">{event.path}</td>
                      <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                        {event.ip_address || '-'}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                        {event.visitor_id ? `${event.visitor_id.slice(0, 8)}...` : '-'}
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant="outline" className="text-xs">
                          {capitalize(event.device_type)}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {event.country || '-'}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {getReferrerLabel(event.referrer)}
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant="secondary" className="text-xs">
                          {capitalize(event.consent_state || 'unknown')}
                        </Badge>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
            <span>
              Showing {events.length} of {formatNumber(totalCount)} visits
            </span>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((prev) => Math.max(1, prev - 1))}
                disabled={page <= 1}
              >
                Previous
              </Button>
              <span className="text-xs">
                Page {page} of {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))}
                disabled={page >= totalPages}
              >
                Next
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </AdminPageLayout>
  );
}

export default VisitorStatisticsManager;
