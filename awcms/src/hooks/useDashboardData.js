
import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/customSupabaseClient';
import { useAuth } from '@/contexts/SupabaseAuthContext';

export function useDashboardData() {
  const { session } = useAuth();
  const [data, setData] = useState({
    overview: {
      blogs: 0,
      pages: 0,
      products: 0,
      users: 0,
      storage: '0 MB'
    },
    activity: [],
    topContent: [],
    systemHealth: {
      database: 'connected',
      storage: 'connected',
      api: 'operational'
    }
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(new Date());

  const fetchDashboardData = useCallback(async () => {
    if (!session) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      // 1. Fetch Overview Counts
      const results = await Promise.allSettled([
        supabase.from('blogs').select('*', { count: 'exact', head: true }).is('deleted_at', null),
        supabase.from('pages').select('*', { count: 'exact', head: true }).is('deleted_at', null),
        supabase.from('products').select('*', { count: 'exact', head: true }).is('deleted_at', null),
        supabase.from('users').select('*', { count: 'exact', head: true }).is('deleted_at', null),
        supabase.from('orders').select('*', { count: 'exact', head: true }),
        supabase.from('files').select('file_size').is('deleted_at', null)
      ]);

      const [
        blogsRes,
        pagesRes,
        productsRes,
        usersRes,
        ordersRes,
        filesRes
      ] = results;

      // Log errors if any
      results.forEach((res, index) => {
        if (res.status === 'rejected') {
          console.error(`Dashboard fetch ${index} failed:`, res.reason);
        } else if (res.value.error) {
          console.error(`Dashboard query ${index} error:`, res.value.error);
        }
      });

      const blogCount = blogsRes.status === 'fulfilled' ? blogsRes.value.count : 0;
      const pagesCount = pagesRes.status === 'fulfilled' ? pagesRes.value.count : 0;
      const productsCount = productsRes.status === 'fulfilled' ? productsRes.value.count : 0;
      const usersCount = usersRes.status === 'fulfilled' ? usersRes.value.count : 0;
      const ordersCount = ordersRes.status === 'fulfilled' ? ordersRes.value.count : 0;
      const files = filesRes.status === 'fulfilled' ? filesRes.value.data : [];

      // Calculate storage usage
      const totalBytes = files?.reduce((acc, curr) => acc + (curr.file_size || 0), 0) || 0;
      const storageMB = (totalBytes / (1024 * 1024)).toFixed(2);

      // 2. Fetch Recent Activity (Simulated by combining recent updates)
      const { data: recentBlogs } = await supabase
        .from('blogs')
        .select('title, updated_at, users!created_by(full_name)')
        .order('updated_at', { ascending: false })
        .limit(5);

      const { data: recentPages } = await supabase
        .from('pages')
        .select('title, updated_at, users!created_by(full_name)')
        .order('updated_at', { ascending: false })
        .limit(5);

      const combinedActivity = [
        ...(recentBlogs || []).map(a => ({
          type: 'blog',
          action: 'updated',
          title: a.title,
          user: a.users?.full_name || 'Unknown',
          time: a.updated_at
        })),
        ...(recentPages || []).map(p => ({
          type: 'page',
          action: 'updated',
          title: p.title,
          user: p.users?.full_name || 'Unknown',
          time: p.updated_at
        }))
      ].sort((a, b) => new Date(b.time) - new Date(a.time)).slice(0, 10);

      // 3. Fetch Top Content (Most Viewed)
      const { data: topBlogs } = await supabase
        .from('blogs')
        .select('title, views, status')
        .order('views', { ascending: false })
        .limit(5);

      setData({
        overview: {
          blogs: blogCount || 0,
          pages: pagesCount || 0,
          products: productsCount || 0,
          orders: ordersCount || 0,
          users: usersCount || 0,
          storage: `${storageMB} MB`
        },
        activity: combinedActivity,
        topContent: topBlogs || [],
        systemHealth: {
          database: 'connected', // Assumed if queries worked
          storage: 'connected',
          api: 'operational'
        }
      });
      setLastUpdated(new Date());
    } catch (err) {
      console.error("Dashboard data fetch error:", err);
      setError("Failed to load dashboard data. Please check your connection.");
    } finally {
      setLoading(false);
    }
  }, [session]);

  useEffect(() => {
    fetchDashboardData();
  }, [fetchDashboardData]);

  return { data, loading, error, lastUpdated, refresh: fetchDashboardData };
}
