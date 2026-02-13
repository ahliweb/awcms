
import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/lib/customSupabaseClient';
import { motion } from 'framer-motion';
import { Helmet } from 'react-helmet-async';
import { Quote, Star } from 'lucide-react';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';

function PublicTestimonies() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchTestimonies = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from('testimonies')
      .select('*')
      .eq('status', 'published')
      .order('created_at', { ascending: false });
    setItems(data || []);
    setLoading(false);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchTestimonies();
  }, [fetchTestimonies]);

  return (
    <div className="min-h-screen bg-background py-16">
      <Helmet>
        <title>What People Say - AWCMS</title>
      </Helmet>

      <div className="container mx-auto px-4">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center mb-16"
        >
          <h1 className="text-4xl font-bold text-foreground mb-4">Client Testimonials</h1>
          <p className="text-muted-foreground">Don&apos;t just take our word for it.</p>
        </motion.div>

        {loading ? (
          <div className="flex justify-center items-center h-64">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
          </div>
        ) : (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
            {items.map((item, i) => (
              <motion.div
                key={item.id}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.1 }}
                className="bg-card p-8 rounded-2xl border border-border relative"
              >
                <Quote className="absolute top-6 right-6 w-8 h-8 text-primary/10 rotate-180" />

                <div className="flex gap-1 mb-6">
                  {[...Array(5)].map((_, i) => (
                    <Star
                      key={i}
                      className={`w-4 h-4 ${i < (item.rating || 5) ? 'text-yellow-400 fill-yellow-400' : 'text-muted'}`}
                    />
                  ))}
                </div>

                <p className="text-muted-foreground italic mb-6 leading-relaxed">
                  &quot;{item.content}&quot;
                </p>

                <div className="flex items-center gap-4">
                  <Avatar className="w-10 h-10 border border-border">
                    <AvatarImage src={item.author_image} />
                    <AvatarFallback className="bg-primary/10 text-primary">
                      {item.author_name?.charAt(0)}
                    </AvatarFallback>
                  </Avatar>
                  <div>
                    <h4 className="font-bold text-sm text-foreground">{item.author_name}</h4>
                    <p className="text-xs text-muted-foreground">{item.author_position || 'Client'}</p>
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default PublicTestimonies;
