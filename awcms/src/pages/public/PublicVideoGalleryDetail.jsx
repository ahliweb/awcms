
import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { supabase } from '@/lib/customSupabaseClient';
import { ArrowLeft, PlayCircle, ExternalLink, Tag, Calendar } from 'lucide-react';
import SeoHelmet from '@/components/public/SeoHelmet';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

function PublicVideoGalleryDetail() {
  const { slug } = useParams();
  const [video, setVideo] = useState(null);
  const [relatedVideos, setRelatedVideos] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchDetail = async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from('video_gallery')
        .select(`*, categories(name)`)
        .eq('slug', slug)
        .eq('status', 'published')
        .maybeSingle();
      
      if (!error && data) {
        setVideo(data);

        if (data.category_id) {
             const { data: related } = await supabase
                .from('video_gallery')
                .select('id, title, slug, created_at')
                .eq('category_id', data.category_id)
                .neq('id', data.id)
                .eq('status', 'published')
                .limit(3);
             setRelatedVideos(related || []);
        }
      }
      setLoading(false);
    };
    fetchDetail();
  }, [slug]);

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
          <div className="aspect-video bg-slate-900 flex items-center justify-center relative group">
               <PlayCircle className="w-20 h-20 text-white/80 group-hover:scale-110 transition-transform duration-300" />
               {video.youtube_playlist_url && (
                   <a 
                     href={video.youtube_playlist_url}
                     target="_blank"
                     rel="noopener noreferrer"
                     className="absolute inset-0 z-10"
                     aria-label="Watch Video"
                   />
               )}
          </div>
          
          <div className="p-8 md:p-10">
              <div className="flex flex-wrap items-center gap-3 mb-6">
                  <Badge variant="destructive" className="bg-red-50 text-red-600 border-red-100">YouTube</Badge>
                  {video.categories && <Badge variant="outline">{video.categories.name}</Badge>}
                  <span className="text-sm text-slate-500 ml-auto flex items-center gap-1">
                      <Calendar className="w-4 h-4" /> {new Date(video.created_at).toLocaleDateString()}
                  </span>
              </div>
              
              <h1 className="text-3xl font-bold text-slate-900 mb-4">{video.title}</h1>
              
              <div className="prose prose-slate max-w-none mb-8">
                 <p className="text-slate-600 text-lg leading-relaxed">{video.description}</p>
              </div>
              
              {video.youtube_playlist_url && (
                  <Button className="bg-red-600 hover:bg-red-700 text-white" asChild>
                      <a 
                        href={video.youtube_playlist_url} 
                        target="_blank" 
                        rel="noopener noreferrer"
                      >
                          Watch on YouTube <ExternalLink className="w-4 h-4 ml-2" />
                      </a>
                  </Button>
              )}

              {video.tags && video.tags.length > 0 && (
                  <div className="mt-8 pt-8 border-t border-slate-100">
                      <div className="flex flex-wrap gap-2">
                          {video.tags.map((tag, i) => (
                              <span key={i} className="inline-flex items-center gap-1 text-sm text-slate-500 bg-slate-50 px-3 py-1 rounded-full border border-slate-200">
                                  <Tag className="w-3 h-3" /> {tag}
                              </span>
                          ))}
                      </div>
                  </div>
              )}
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
