
import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/lib/customSupabaseClient';
import { motion } from 'framer-motion';
import { Helmet } from 'react-helmet-async';
import { Tag, Clock, Copy, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';

function PublicPromotions() {
  const [items, setItems] = useState([]);
  const { toast } = useToast();
  const [copiedId, setCopiedId] = useState(null);

  const fetchPromotions = useCallback(async () => {

    const { data } = await supabase
      .from('promotions')
      .select('*')
      .eq('status', 'active')
      .gt('end_date', new Date().toISOString())
      .order('end_date', { ascending: true });
    setItems(data || []);

  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchPromotions();
  }, [fetchPromotions]);

  const copyCode = (code, id) => {
    navigator.clipboard.writeText(code);
    setCopiedId(id);
    toast({ title: "Copied!", description: "Promo code copied to clipboard." });
    setTimeout(() => setCopiedId(null), 2000);
  };

  return (
    <div className="min-h-screen bg-background py-16">
      <Helmet>
        <title>Special Offers - AWCMS</title>
      </Helmet>

      <div className="container mx-auto px-4">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center mb-16"
        >
          <h1 className="text-4xl font-bold text-foreground mb-4">Special Offers</h1>
          <p className="text-muted-foreground">Grab these exclusive deals before they expire!</p>
        </motion.div>

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
          {items.map((item, i) => (
            <motion.div
              key={item.id}
              initial={{ opacity: 0, scale: 0.95 }}
              whileInView={{ opacity: 1, scale: 1 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.1 }}
              className="relative bg-card rounded-xl border-2 border-dashed border-primary/20 overflow-hidden hover:border-primary/50 transition-colors group"
            >
              {/* Decorative Circle */}
              <div className="absolute -right-12 -top-12 w-24 h-24 bg-primary/10 rounded-full group-hover:bg-primary/20 transition-colors" />

              <div className="p-6">
                <div className="flex items-start justify-between mb-4">
                  <div className="p-2 bg-primary/10 text-primary rounded-lg">
                    <Tag className="w-6 h-6" />
                  </div>
                  {item.discount_percentage && (
                    <span className="font-bold text-2xl text-primary">
                      {item.discount_percentage}% OFF
                    </span>
                  )}
                  {item.discount_amount && (
                    <span className="font-bold text-2xl text-primary">
                      ${item.discount_amount} OFF
                    </span>
                  )}
                </div>

                <h3 className="text-xl font-bold text-foreground mb-2">{item.title}</h3>
                <p className="text-sm text-muted-foreground mb-6 line-clamp-2">{item.description}</p>

                <div className="bg-muted p-4 rounded-lg flex items-center justify-between gap-4 mb-4">
                  <code className="text-lg font-mono font-bold text-foreground tracking-wider">
                    {item.code || 'NOCODE'}
                  </code>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => copyCode(item.code, item.id)}
                    className="h-8 w-8 p-0"
                  >
                    {copiedId === item.id ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
                  </Button>
                </div>

                <div className="flex items-center gap-2 text-xs text-muted-foreground/80">
                  <Clock className="w-3 h-3" />
                  <span>Expires: {new Date(item.end_date).toLocaleDateString()}</span>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default PublicPromotions;
