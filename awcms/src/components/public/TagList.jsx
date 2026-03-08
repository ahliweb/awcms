
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/customSupabaseClient';
import { Tag } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { useTenant } from '@/contexts/TenantContext';

const TagList = ({ selectedTags = [], onSelectTag }) => {
  const [tags, setTags] = useState([]);
  const { currentTenant } = useTenant();

  useEffect(() => {
    const fetchTags = async () => {
      try {
        if (!currentTenant?.id) return;

        const { data, error } = await supabase
          .from('tags')
          .select('id, name, slug, color')
          .eq('tenant_id', currentTenant.id)
          .is('deleted_at', null)
          .eq('is_active', true)
          .order('name')
          .limit(20);

        if (error) {
          console.error('Tag fetch error:', error);
          return;
        }

        if (data) setTags(data.map((tag) => ({ ...tag, total_usage: 0 })));
      } catch (e) {
        console.error("Error fetching tags", e);
      }
    };
    fetchTags();
  }, [currentTenant?.id]);

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
