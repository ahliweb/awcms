
import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ArrowLeft, PlayCircle, Calendar } from 'lucide-react';
import SeoHelmet from '@/components/public/SeoHelmet';
import { Badge } from '@/components/ui/badge';
import { usePublicTenant } from '@/hooks/usePublicTenant';
import { fetchPublicMediaBySlug, fetchRelatedPublicMedia } from '@/lib/publicMedia';

function PublicVideoGalleryDetail() {
  const { slug } = useParams();
  const [video, setVideo] = useState(null);
  const [relatedVideos, setRelatedVideos] = useState([]);
  const [loading, setLoading] = useState(true);
  const { tenant } = usePublicTenant();

  useEffect(() => {
    const fetchDetail = async () => {
      setLoading(true);
      try {
        const data = await fetchPublicMediaBySlug({ mediaKind: 'video', slug, tenantId: tenant?.id });
        setVideo(data);

        if (data) {
          const related = await fetchRelatedPublicMedia({
            mediaKind: 'video',
            currentId: data.id,
            categoryId: data.category_id,
            tenantId: tenant?.id,
            limit: 3,
          });
          setRelatedVideos(related);
        } else {
          setRelatedVideos([]);
        }
      } catch (error) {
        console.error('Failed to fetch public video gallery detail:', error);
        setVideo(null);
        setRelatedVideos([]);
      }
      setLoading(false);
    };
    fetchDetail();
  }, [slug, tenant?.id]);

  if (loading) return <div className="py-20 text-center">Loading video...</div>;

  if (!video) return (
    <div className="py-20 text-center">
       <h2 className="text-2xl font-bold text-slate-800">Video Not Found</h2>
       <Link to="/gallery/videos" className="text-blue-600 mt-4 inline-block">Back to gallery</Link>
    </div>
  );

  return (
    <div className="container mx-auto px-4 py-12 max-w-4xl">
      <SeoHelmet 
        type="video_gallery_detail"
        id={video.id}
        defaultTitle={`${video.title} | Video Gallery`} 
        defaultDescription={video.description}
      />

      <Link to="/gallery/videos" className="inline-flex items-center text-sm text-slate-500 hover:text-blue-600 transition-colors mb-8">
         <ArrowLeft className="w-4 h-4 mr-1" /> Back to Gallery
      </Link>

       <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
          <div className="overflow-hidden rounded-b-none border-b border-slate-200 bg-slate-950">
               <video src={video.videoUrl} controls className="aspect-video w-full" preload="metadata" />
          </div>
          
          <div className="p-8 md:p-10">
              <div className="flex flex-wrap items-center gap-3 mb-6">
                  <Badge variant="destructive" className="bg-red-50 text-red-600 border-red-100">Video</Badge>
                  {video.category && <Badge variant="outline">{video.category.name}</Badge>}
                  <span className="text-sm text-slate-500 ml-auto flex items-center gap-1">
                      <Calendar className="w-4 h-4" /> {new Date(video.created_at).toLocaleDateString()}
                  </span>
              </div>
              
              <h1 className="text-3xl font-bold text-slate-900 mb-4">{video.title}</h1>
              
              <div className="prose prose-slate max-w-none mb-8">
                 <p className="text-slate-600 text-lg leading-relaxed">{video.description || video.alt_text || video.title}</p>
               </div>
           </div>
       </div>

      {relatedVideos.length > 0 && (
          <div className="mt-16">
              <h3 className="text-2xl font-bold text-slate-900 mb-6">Related Videos</h3>
              <div className="grid md:grid-cols-3 gap-6">
                  {relatedVideos.map(item => (
                      <Link key={item.id} to={`/gallery/videos/${item.slug}`} className="group block">
                          <div className="bg-white rounded-xl border border-slate-200 p-4 hover:shadow-md transition-all">
                              <div className="bg-slate-900 h-32 rounded-lg mb-3 flex items-center justify-center">
                                  <PlayCircle className="w-8 h-8 text-white/70" />
                              </div>
                              <h4 className="font-bold text-slate-900 group-hover:text-blue-600 transition-colors line-clamp-1">{item.title}</h4>
                              <div className="text-xs text-slate-500 mt-1">{new Date(item.created_at).toLocaleDateString()}</div>
                          </div>
                      </Link>
                  ))}
              </div>
          </div>
      )}
    </div>
  );
}

export default PublicVideoGalleryDetail;
