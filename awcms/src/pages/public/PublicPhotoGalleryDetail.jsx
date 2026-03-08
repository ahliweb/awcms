
import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ArrowLeft, Image as ImageIcon, Calendar } from 'lucide-react';
import SeoHelmet from '@/components/public/SeoHelmet';
import { Badge } from '@/components/ui/badge';
import { usePublicTenant } from '@/hooks/usePublicTenant';
import { fetchPublicMediaBySlug, fetchRelatedPublicMedia } from '@/lib/publicMedia';

function PublicPhotoGalleryDetail() {
  const { slug } = useParams(); 
  const [mediaItem, setMediaItem] = useState(null);
  const [relatedItems, setRelatedItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const { tenant } = usePublicTenant();

  useEffect(() => {
    const fetchDetail = async () => {
      setLoading(true);
      try {
        const data = await fetchPublicMediaBySlug({ mediaKind: 'image', slug, tenantId: tenant?.id });
        setMediaItem(data);

        if (data) {
          const related = await fetchRelatedPublicMedia({
            mediaKind: 'image',
            currentId: data.id,
            categoryId: data.category_id,
            tenantId: tenant?.id,
            limit: 3,
          });
          setRelatedItems(related);
        } else {
          setRelatedItems([]);
        }
      } catch (error) {
        console.error('Failed to fetch public photo gallery detail:', error);
        setMediaItem(null);
        setRelatedItems([]);
      }
      setLoading(false);
    };
    fetchDetail();
  }, [slug, tenant?.id]);

  if (loading) return <div className="py-20 text-center">Loading album...</div>;

  if (!mediaItem) return (
    <div className="py-20 text-center">
       <h2 className="text-2xl font-bold text-slate-800">Album Not Found</h2>
       <Link to="/gallery/photos" className="text-blue-600 mt-4 inline-block">Back to gallery</Link>
    </div>
  );

  return (
    <div className="container mx-auto px-4 py-12 max-w-4xl">
      <SeoHelmet 
        type="photo_gallery_detail"
        id={mediaItem.id}
        defaultTitle={`${mediaItem.title} | Photo Gallery`} 
        defaultDescription={mediaItem.description}
      />

      <Link to="/gallery/photos" className="inline-flex items-center text-sm text-slate-500 hover:text-blue-600 transition-colors mb-8">
         <ArrowLeft className="w-4 h-4 mr-1" /> Back to Gallery
      </Link>

      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
          <div className="aspect-video bg-slate-100 flex items-center justify-center relative bg-[url('https://images.unsplash.com/photo-1492684223066-81342ee5ff30?w=800&auto=format&fit=crop&q=60')] bg-cover bg-center">
               <div className="absolute inset-0 bg-black/40 backdrop-blur-sm"></div>
               <div className="relative z-10 text-center text-white p-6">
                   <ImageIcon className="w-16 h-16 mx-auto mb-4 opacity-80" />
                    <h1 className="text-3xl font-bold">{mediaItem.title}</h1>
               </div>
          </div>
          
          <div className="p-8 md:p-10">
              <div className="flex flex-wrap items-center gap-3 mb-6">
                  {mediaItem.category && <Badge variant="secondary" className="bg-blue-50 text-blue-700">{mediaItem.category.name}</Badge>}
                  <span className="text-sm text-slate-500 flex items-center gap-1">
                      <Calendar className="w-4 h-4" /> {new Date(mediaItem.created_at).toLocaleDateString()}
                  </span>
              </div>
              
              <div className="prose prose-slate max-w-none mb-8">
                  <p className="text-slate-600 text-lg leading-relaxed">{mediaItem.description || mediaItem.alt_text || mediaItem.title}</p>
                </div>

              <div className="overflow-hidden rounded-xl border border-slate-200 bg-slate-50">
                <img src={mediaItem.imageUrl} alt={mediaItem.alt_text || mediaItem.title} className="w-full object-cover" />
              </div>
           </div>
       </div>

      {relatedItems.length > 0 && (
          <div className="mt-16">
              <h3 className="text-2xl font-bold text-slate-900 mb-6">Related Albums</h3>
              <div className="grid md:grid-cols-3 gap-6">
                  {relatedItems.map(item => (
                      <Link key={item.id} to={`/gallery/photos/${item.slug}`} className="group block">
                          <div className="bg-white rounded-xl border border-slate-200 p-4 hover:shadow-md transition-all">
                              <div className="bg-slate-100 h-32 rounded-lg mb-3 flex items-center justify-center">
                                   {item.imageUrl ? (
                                     <img src={item.imageUrl} alt={item.alt_text || item.title} className="h-full w-full rounded-lg object-cover" />
                                   ) : (
                                     <ImageIcon className="w-8 h-8 text-slate-400" />
                                   )}
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
