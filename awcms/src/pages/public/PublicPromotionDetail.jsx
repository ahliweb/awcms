
import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { supabase } from '@/lib/customSupabaseClient';
import { Tag, ArrowLeft, Copy, Check } from 'lucide-react';
import SeoHelmet from '@/components/public/SeoHelmet';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

function PublicPromotionDetail() {
  const { id } = useParams(); // Using ID for promotions as slugs usually aren't standard for promos, but if we have slugs we use them. Promo table has no slug in schema, so ID.
  const [promotion, setPromotion] = useState(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const fetchDetail = async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from('promotions')
        .select(`*, categories(name)`)
        .eq('id', id)
        .eq('status', 'active')
        .maybeSingle();
      
      if (!error && data) {
        setPromotion(data);
      }
      setLoading(false);
    };
    fetchDetail();
  }, [id]);

  const copyCode = () => {
      if(promotion?.code) {
          navigator.clipboard.writeText(promotion.code);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
      }
  };

  if (loading) return <div className="py-20 text-center">Loading promotion...</div>;

  if (!promotion) return (
    <div className="py-20 text-center">
       <h2 className="text-2xl font-bold text-slate-800">Promotion Not Found</h2>
       <Link to="/promotions" className="text-blue-600 mt-4 inline-block">Back to promotions</Link>
    </div>
  );

  return (
    <div className="container mx-auto px-4 py-12 max-w-3xl">
      <SeoHelmet 
        type="promotion_detail"
        id={promotion.id}
        defaultTitle={`${promotion.title} | Promotions`} 
        defaultDescription={promotion.description}
      />

      <Link to="/promotions" className="inline-flex items-center text-sm text-slate-500 hover:text-blue-600 transition-colors mb-8">
         <ArrowLeft className="w-4 h-4 mr-1" /> Back to Promotions
      </Link>

      <div className="bg-white rounded-2xl shadow-lg border border-slate-200 overflow-hidden">
          <div className="bg-gradient-to-r from-blue-600 to-purple-600 p-12 text-center text-white">
              <div className="inline-flex items-center justify-center w-20 h-20 bg-white/20 backdrop-blur-sm rounded-full mb-6">
                  <Tag className="w-10 h-10 text-white" />
              </div>
              <h1 className="text-3xl md:text-4xl font-bold mb-4">{promotion.title}</h1>
              {promotion.discount_percentage > 0 && (
                  <div className="text-5xl font-bold text-yellow-300 mb-2">{promotion.discount_percentage}% OFF</div>
              )}
              {promotion.discount_amount > 0 && (
                  <div className="text-5xl font-bold text-yellow-300 mb-2">${promotion.discount_amount} OFF</div>
              )}
          </div>

          <div className="p-8 md:p-12">
              <div className="flex justify-center mb-8">
                  {promotion.categories && <Badge className="text-sm py-1 px-3">{promotion.categories.name}</Badge>}
              </div>
              
              <p className="text-lg text-slate-600 text-center leading-relaxed mb-10">
                  {promotion.description}
              </p>

              {promotion.code && (
                  <div className="bg-slate-50 border border-dashed border-slate-300 rounded-xl p-6 flex flex-col items-center gap-4">
                      <span className="text-sm text-slate-500 uppercase tracking-widest">Promo Code</span>
                      <div className="text-3xl font-mono font-bold text-slate-800 tracking-widest">{promotion.code}</div>
                      <Button onClick={copyCode} variant={copied ? "outline" : "default"} className="min-w-[140px]">
                          {copied ? <><Check className="w-4 h-4 mr-2" /> Copied</> : <><Copy className="w-4 h-4 mr-2" /> Copy Code</>}
                      </Button>
                  </div>
              )}
              
              <div className="mt-8 text-center text-sm text-slate-400">
                  {promotion.end_date && (
                      <p>Valid until {new Date(promotion.end_date).toLocaleDateString()}</p>
                  )}
              </div>
          </div>
      </div>
    </div>
  );
}

export default PublicPromotionDetail;
