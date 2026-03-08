
import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Helmet } from 'react-helmet-async';
import { Image as ImageIcon } from 'lucide-react';
import { Link } from 'react-router-dom';
import { usePublicTenant } from '@/hooks/usePublicTenant';
import { fetchPublicMediaItems } from '@/lib/publicMedia';

function PublicPhotoGallery() {
  const [items, setItems] = useState([]);
  const { tenant } = usePublicTenant();

  useEffect(() => {
    let isCancelled = false;

    const loadItems = async () => {
      try {
        const data = await fetchPublicMediaItems({ mediaKind: 'image', tenantId: tenant?.id });
        if (!isCancelled) {
          setItems(data);
        }
      } catch (error) {
        console.error('Failed to fetch public photo gallery:', error);
        if (!isCancelled) {
          setItems([]);
        }
      }
    };

    void loadItems();

    return () => {
      isCancelled = true;
    };
  }, [tenant]);

  return (
    <div className="min-h-screen bg-background py-16">
      <Helmet>
        <title>Photo Gallery - AWCMS</title>
      </Helmet>

      <div className="container mx-auto px-4">
        <h1 className="text-4xl font-bold text-foreground mb-12 text-center">Photo Gallery</h1>

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
          {items.map((item, i) => {
            return (
              <motion.div
                key={item.id}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: i * 0.1 }}
              >
                <Link to={`/gallery/photos/${item.slug}`} className="group block">
                  <div className="aspect-[4/3] rounded-2xl overflow-hidden bg-muted relative mb-4 border border-border">
                    {item.imageUrl ? (
                       <img
                         src={item.imageUrl}
                         alt={item.alt_text || item.title}
                         className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                       />
                    ) : (
                      <div className="flex items-center justify-center h-full text-muted-foreground">
                        <ImageIcon className="w-8 h-8 opacity-50" />
                      </div>
                    )}
                    <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                      <div className="bg-background/90 text-foreground px-4 py-2 rounded-full text-sm font-medium backdrop-blur-sm">
                        View Album
                      </div>
                    </div>
                  </div>
                  <h3 className="font-bold text-lg text-foreground group-hover:text-primary transition-colors">{item.title}</h3>
                  <p className="text-sm text-muted-foreground line-clamp-1">{item.description || item.category?.name || 'Media Library image'}</p>
                </Link>
              </motion.div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default PublicPhotoGallery;
