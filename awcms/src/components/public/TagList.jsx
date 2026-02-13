
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/customSupabaseClient';
import { Tag } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

const TagList = ({ selectedTags = [], onSelectTag }) => {
  const [tags, setTags] = useState([]);

  useEffect(() => {
    const fetchTags = async () => {
      // Safely attempt to fetch tags with counts via RPC, fallback to simple select if RPC fails/missing
      try {
        const { data, error } = await supabase.rpc('get_tags_with_counts');
        if (!error && data) {
          const activeTags = data
            .filter(t => t.total_usage > 0 && t.is_active !== false)
            .sort((a, b) => b.total_usage - a.total_usage)
            .slice(0, 20);
          setTags(activeTags);
        } else {
          // Fallback if RPC is missing or errors
          const { data: simpleTags, error: fallbackError } = await supabase
            .from('tags')
            .select('id, name, slug, color')
            .is('deleted_at', null)
            .eq('is_active', true)
            .limit(20);
          if (fallbackError) {
            console.error("Fallback tag fetch error:", fallbackError);
            return;
          }
          if (simpleTags) setTags(simpleTags.map(t => ({ ...t, total_usage: 0 })));
        }
      } catch (e) {
        console.error("Error fetching tags", e);
      }
    };
    fetchTags();
  }, []);

  if (tags.length === 0) return null;

  return (
    <div className="mb-8 p-6 bg-white rounded-2xl shadow-sm border border-slate-200">
      <h3 className="font-bold text-slate-900 mb-4 flex items-center gap-2">
        <Tag className="w-4 h-4" /> Popular Tags
      </h3>
      <div className="flex flex-wrap gap-2">
        {tags.map((tag) => (
          <Badge
            key={tag.id}
            variant={selectedTags.includes(tag.name) ? "default" : "secondary"}
            className={`cursor-pointer transition-all hover:scale-105 ${selectedTags.includes(tag.name)
                ? "bg-blue-600 hover:bg-blue-700"
                : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
            onClick={() => onSelectTag(tag.name)}
          >
            {tag.name}
            {tag.total_usage > 0 && <span className="ml-1.5 opacity-60 text-[10px]">({tag.total_usage})</span>}
          </Badge>
        ))}
      </div>
    </div>
  );
};

export default TagList;
