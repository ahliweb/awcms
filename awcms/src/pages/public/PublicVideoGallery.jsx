
import React, { useEffect, useState } from 'react';
import { supabase } from '@/lib/customSupabaseClient';
import { motion } from 'framer-motion';
import { Helmet } from 'react-helmet-async';
import { PlayCircle } from 'lucide-react';
import { Link } from 'react-router-dom';

function PublicVideoGallery() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchVideos = async () => {
    setLoading(true);
    const { data } = await supabase
      .from('video_gallery')
      .select('*')
      .eq('status', 'published')
      .order('created_at', { ascending: false });
    setItems(data || []);
    setLoading(false);
  };

  useEffect(() => {
    fetchVideos();
  }, []);

  return (
    <div className="min-h-screen bg-background py-16">
      <Helmet>
        <title>Video Gallery - AWCMS</title>
      </Helmet>

      <div className="container mx-auto px-4">
        <h1 className="text-4xl font-bold text-foreground mb-12 text-center">Video Gallery</h1>



        {loading ? (
          <div className="flex justify-center items-center h-64">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
          </div>
        ) : (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
            {items.map((item, i) => (
              <motion.div
                key={item.id}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: i * 0.1 }}
              >
                <Link to={`/video-gallery/${item.slug}`} className="group block">
                  <div className="aspect-video rounded-2xl overflow-hidden bg-muted relative mb-4 border border-border shadow-sm group-hover:shadow-md transition-all">
                    {/* Simple placeholder for thumbnail logic since we might not have actual thumbnails from youtube API directly stored always */}
                    <div className="w-full h-full bg-slate-900 flex items-center justify-center group-hover:bg-slate-800 transition-colors">
                      <PlayCircle className="w-16 h-16 text-white/80 group-hover:text-white group-hover:scale-110 transition-all" />
                    </div>

                    <div className="absolute bottom-0 left-0 w-full p-4 bg-gradient-to-t from-black/80 to-transparent">
                      <p className="text-white font-medium truncate">{item.title}</p>
                    </div>
                  </div>
                  <h3 className="font-bold text-lg text-foreground group-hover:text-primary transition-colors">{item.title}</h3>
                  <p className="text-sm text-muted-foreground line-clamp-1">{item.description}</p>
                </Link>
              </motion.div>
            ))}

          </div>
        )}
      </div>
    </div>
  );
}

export default PublicVideoGallery;
