
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/customSupabaseClient';
import { motion } from 'framer-motion';
import { Helmet } from 'react-helmet-async';
import { Image as ImageIcon, Layers } from 'lucide-react';
import { Link } from 'react-router-dom';

function PublicPhotoGallery() {
  const [items, setItems] = useState([]);

  const fetchGalleries = async () => {

    const { data } = await supabase
      .from('photo_gallery')
      .select('*')
      .eq('status', 'published')
      .order('created_at', { ascending: false });
    setItems(data || []);

  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchGalleries();
  }, []);

  return (
    <div className="min-h-screen bg-background py-16">
      <Helmet>
        <title>Photo Gallery - AWCMS</title>
      </Helmet>

      <div className="container mx-auto px-4">
        <h1 className="text-4xl font-bold text-foreground mb-12 text-center">Photo Gallery</h1>

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
          {items.map((item, i) => {
            const coverImage = item.photos?.[0]?.url;
            return (
              <motion.div
                key={item.id}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: i * 0.1 }}
              >
                <Link to={`/photo-gallery/${item.slug}`} className="group block">
                  <div className="aspect-[4/3] rounded-2xl overflow-hidden bg-muted relative mb-4 border border-border">
                    {coverImage ? (
                      <img
                        src={coverImage}
                        alt={item.title}
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
                    <div className="absolute bottom-3 right-3 bg-black/60 text-white text-xs px-2 py-1 rounded-md flex items-center gap-1 backdrop-blur-sm">
                      <Layers className="w-3 h-3" />
                      {item.photos?.length || 0}
                    </div>
                  </div>
                  <h3 className="font-bold text-lg text-foreground group-hover:text-primary transition-colors">{item.title}</h3>
                  <p className="text-sm text-muted-foreground line-clamp-1">{item.description}</p>
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
