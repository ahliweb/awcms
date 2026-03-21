import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { supabase } from '@/lib/customSupabaseClient';
import BlogEditor from '@/components/dashboard/BlogEditor';
import { useToast } from '@/components/ui/use-toast';
import useSecureRouteParam from '@/hooks/useSecureRouteParam';
import { encodeRouteParam } from '@/lib/routeSecurity';
import { getBlogEditorProps } from '@/components/dashboard/blogs/blogEditorConfig';

const BlogEditorRoute = () => {
  const { id: routeParam } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { value: blogId, loading: routeLoading, isLegacy } = useSecureRouteParam(routeParam, 'blogs.edit');
  const [item, setItem] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!routeParam || routeLoading) return;
    if (!blogId) {
      toast({ variant: 'destructive', title: 'Error', description: 'Invalid blog link.' });
      navigate('/cmspanel/blogs');
      return;
    }
    if (isLegacy) {
      const redirectLegacy = async () => {
        const signedId = await encodeRouteParam({ value: blogId, scope: 'blogs.edit' });
        if (!signedId || signedId === routeParam) return;
        navigate(`/cmspanel/blogs/edit/${signedId}`, { replace: true });
      };
      redirectLegacy();
      return;
    }

    const fetchBlog = async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from('blogs')
        .select('*')
        .eq('id', blogId)
        .is('deleted_at', null)
        .single();

      if (error || !data) {
        toast({ variant: 'destructive', title: 'Error', description: 'Blog not found or unavailable.' });
        navigate('/cmspanel/blogs');
        return;
      }

      setItem(data);
      setLoading(false);
    };

    fetchBlog();
  }, [routeParam, routeLoading, blogId, isLegacy, navigate, toast]);

  if (loading || routeLoading) {
    return <div className="p-6">Loading...</div>;
  }

  if (!item) return null;

  return (
    <BlogEditor
      item={item}
      onClose={() => navigate('/cmspanel/blogs')}
      onSuccess={() => navigate('/cmspanel/blogs')}
      {...getBlogEditorProps('id')}
    />
  );
};

export default BlogEditorRoute;
