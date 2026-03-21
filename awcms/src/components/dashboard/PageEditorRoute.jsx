import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { supabase } from '@/lib/customSupabaseClient';
import PageEditor from '@/components/dashboard/PageEditor';
import { useToast } from '@/components/ui/use-toast';
import useSecureRouteParam from '@/hooks/useSecureRouteParam';
import { encodeRouteParam } from '@/lib/routeSecurity';
import { getPageEditorProps } from '@/components/dashboard/pages/pageEditorConfig';

const PageEditorRoute = () => {
  const { id: routeParam } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { value: pageId, loading: routeLoading, isLegacy } = useSecureRouteParam(routeParam, 'pages.edit');
  const [page, setPage] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!routeParam || routeLoading) return;
    if (!pageId) {
      toast({ variant: 'destructive', title: 'Error', description: 'Invalid page link.' });
      navigate('/cmspanel/pages');
      return;
    }
    if (isLegacy) {
      const redirectLegacy = async () => {
        const signedId = await encodeRouteParam({ value: pageId, scope: 'pages.edit' });
        if (!signedId || signedId === routeParam) return;
        navigate(`/cmspanel/pages/edit/${signedId}`, { replace: true });
      };
      redirectLegacy();
      return;
    }

    const fetchPage = async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from('pages')
        .select('*')
        .eq('id', pageId)
        .is('deleted_at', null)
        .single();

      if (error || !data) {
        toast({ variant: 'destructive', title: 'Error', description: 'Page not found or unavailable.' });
        navigate('/cmspanel/pages');
        return;
      }

      setPage(data);
      setLoading(false);
    };

    fetchPage();
  }, [routeParam, routeLoading, pageId, isLegacy, navigate, toast]);

  if (loading || routeLoading) {
    return <div className="p-6">Loading...</div>;
  }

  if (!page) return null;

  return (
    <PageEditor
      page={page}
      onClose={() => navigate('/cmspanel/pages')}
      onSuccess={() => navigate('/cmspanel/pages')}
      {...getPageEditorProps('id')}
    />
  );
};

export default PageEditorRoute;
