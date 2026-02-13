
import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { supabase } from '@/lib/customSupabaseClient';
import { motion } from 'framer-motion';
import { Calendar, Tag, ArrowLeft, Share2, User } from 'lucide-react';
import SeoHelmet from '@/components/public/SeoHelmet';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';

function PublicAnnouncementDetail() {
  const { id } = useParams();
  const { toast } = useToast();
  const [announcement, setAnnouncement] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchDetail = async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from('announcements')
        .select(`*, categories(name), users(full_name)`)
        .eq('id', id)
        .eq('status', 'published') // Ensure public only sees published
        .maybeSingle();

      if (!error && data) {
        setAnnouncement(data);
      }
      setLoading(false);
    };
    fetchDetail();
  }, [id]);

  const handleShare = () => {
    navigator.clipboard.writeText(window.location.href);
    toast({ title: "Link Copied", description: "Announcement link copied to clipboard." });
  };

  if (loading) return <div className="py-20 text-center">Loading...</div>;

  if (!announcement) return (
    <div className="py-20 text-center">
      <h2 className="text-2xl font-bold text-slate-800">Announcement Not Found</h2>
      <Link to="/announcements" className="text-blue-600 mt-4 inline-block">Back to list</Link>
    </div>
  );

  return (
    <div className="container mx-auto px-4 py-12 max-w-4xl">
      <SeoHelmet
        type="announcement_detail"
        id={id}
        defaultTitle={`${announcement.title} | Announcements`}
        defaultDescription={announcement.content?.substring(0, 150) || ''}
      />

      <div className="mb-8">
        <Link to="/announcements" className="inline-flex items-center text-sm text-slate-500 hover:text-blue-600 transition-colors mb-4">
          <ArrowLeft className="w-4 h-4 mr-1" /> Back to Announcements
        </Link>

        <div className="flex flex-wrap gap-2 mb-4">
          <Badge className={announcement.priority === 'urgent' ? 'bg-red-100 text-red-700' : 'bg-blue-100 text-blue-700'}>
            {announcement.priority?.toUpperCase()}
          </Badge>
          {announcement.categories && <Badge variant="outline">{announcement.categories.name}</Badge>}
        </div>

        <h1 className="text-3xl md:text-4xl font-bold text-slate-900 mb-4 leading-tight">{announcement.title}</h1>

        <div className="flex items-center gap-4 text-sm text-slate-500 border-b border-slate-100 pb-6 mb-6">
          <span className="flex items-center gap-1">
            <Calendar className="w-4 h-4" /> {new Date(announcement.created_at).toLocaleDateString()}
          </span>
          {announcement.users && (
            <span className="flex items-center gap-1">
              <User className="w-4 h-4" /> {announcement.users.full_name}
            </span>
          )}
          <Button variant="ghost" size="sm" className="ml-auto" onClick={handleShare}>
            <Share2 className="w-4 h-4 mr-2" /> Share
          </Button>
        </div>

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="prose prose-slate max-w-none"
        >
          <div className="whitespace-pre-wrap leading-relaxed text-slate-800 text-lg">
            {announcement.content}
          </div>
        </motion.div>

        {announcement.tags && announcement.tags.length > 0 && (
          <div className="mt-8 pt-8 border-t border-slate-100">
            <h4 className="text-sm font-bold text-slate-900 mb-3 uppercase tracking-wider">Related Tags</h4>
            <div className="flex flex-wrap gap-2">
              {announcement.tags.map((tag, i) => (
                <span key={i} className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-slate-50 text-slate-600 text-sm">
                  <Tag className="w-3 h-3" /> {tag}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default PublicAnnouncementDetail;
