
import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { supabase } from '@/lib/customSupabaseClient';
import { ArrowLeft, Image as ImageIcon, ExternalLink, Tag, Calendar } from 'lucide-react';
import SeoHelmet from '@/components/public/SeoHelmet';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

function PublicPhotoGalleryDetail() {
  const { slug } = useParams(); 
  const [album, setAlbum] = useState(null);
  const [relatedAlbums, setRelatedAlbums] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchDetail = async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from('photo_gallery')
        .select(`*, categories(name)`)
        .eq('slug', slug)
        .eq('status', 'published')
        .maybeSingle();
      
      if (!error && data) {
        setAlbum(data);
        
        if (data.category_id) {
             const { data: related } = await supabase
                .from('photo_gallery')
                .select('id, title, slug, created_at')
                .eq('category_id', data.category_id)
                .neq('id', data.id)
                .eq('status', 'published')
                .limit(3);
             setRelatedAlbums(related || []);
        }
      }
      setLoading(false);
    };
    fetchDetail();
  }, [slug]);

  if (loading) return <div className="py-20 text-center">Loading album...</div>;

  if (!album) return (
    <div className="py-20 text-center">
       <h2 className="text-2xl font-bold text-slate-800">Album Not Found</h2>
       <Link to="/gallery/photos" className="text-blue-600 mt-4 inline-block">Back to gallery</Link>
    </div>
  );

  return (
    <div className="container mx-auto px-4 py-12 max-w-4xl">
      <SeoHelmet 
        type="photo_gallery_detail"
        id={album.id}
        defaultTitle={`${album.title} | Photo Gallery`} 
        defaultDescription={album.description}
      />

      <Link to="/gallery/photos" className="inline-flex items-center text-sm text-slate-500 hover:text-blue-600 transition-colors mb-8">
         <ArrowLeft className="w-4 h-4 mr-1" /> Back to Gallery
      </Link>

      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
          <div className="aspect-video bg-slate-100 flex items-center justify-center relative bg-[url('https://images.unsplash.com/photo-1492684223066-81342ee5ff30?w=800&auto=format&fit=crop&q=60')] bg-cover bg-center">
               <div className="absolute inset-0 bg-black/40 backdrop-blur-sm"></div>
               <div className="relative z-10 text-center text-white p-6">
                   <ImageIcon className="w-16 h-16 mx-auto mb-4 opacity-80" />
                   <h1 className="text-3xl font-bold">{album.title}</h1>
               </div>
          </div>
          
          <div className="p-8 md:p-10">
              <div className="flex flex-wrap items-center gap-3 mb-6">
                  {album.categories && <Badge variant="secondary" className="bg-blue-50 text-blue-700">{album.categories.name}</Badge>}
                  <span className="text-sm text-slate-500 flex items-center gap-1">
                      <Calendar className="w-4 h-4" /> {new Date(album.created_at).toLocaleDateString()}
                  </span>
              </div>
              
              <div className="prose prose-slate max-w-none mb-8">
                  <p className="text-slate-600 text-lg leading-relaxed">{album.description}</p>
              </div>
              
              {album.google_album_url && (
                  <div className="bg-slate-50 border border-slate-200 rounded-xl p-6 flex items-center justify-between">
                      <div>
                          <h4 className="font-bold text-slate-900">External Album</h4>
                          <p className="text-sm text-slate-500">View high-resolution photos on Google Photos</p>
                      </div>
                      <Button asChild>
                        <a href={album.google_album_url} target="_blank" rel="noopener noreferrer">
                            View Photos <ExternalLink className="w-4 h-4 ml-2" />
                        </a>
                      </Button>
                  </div>
              )}

              {album.tags && album.tags.length > 0 && (
                  <div className="mt-8 pt-8 border-t border-slate-100">
                      <div className="flex flex-wrap gap-2">
                          {album.tags.map((tag, i) => (
                              <span key={i} className="inline-flex items-center gap-1 text-sm text-slate-500 bg-slate-50 px-3 py-1 rounded-full border border-slate-200">
                                  <Tag className="w-3 h-3" /> {tag}
                              </span>
                          ))}
                      </div>
                  </div>
              )}
          </div>
      </div>

      {relatedAlbums.length > 0 && (
          <div className="mt-16">
              <h3 className="text-2xl font-bold text-slate-900 mb-6">Related Albums</h3>
              <div className="grid md:grid-cols-3 gap-6">
                  {relatedAlbums.map(item => (
                      <Link key={item.id} to={`/gallery/photos/${item.slug}`} className="group block">
                          <div className="bg-white rounded-xl border border-slate-200 p-4 hover:shadow-md transition-all">
                              <div className="bg-slate-100 h-32 rounded-lg mb-3 flex items-center justify-center">
                                  <ImageIcon className="w-8 h-8 text-slate-400" />
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

export default PublicPhotoGalleryDetail;
