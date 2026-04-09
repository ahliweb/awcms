import { useEffect, useState } from 'react';
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Loader2 } from 'lucide-react';
import { supabase } from '@/lib/customSupabaseClient';
import { useTenant } from '@/contexts/TenantContext';

export const ReusableSectionField = ({ name, value, onChange, field }) => {
  const { currentTenant } = useTenant();
  const [sections, setSections] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const fetchSections = async () => {
      setLoading(true);
      try {
        let query = supabase
          .from('reusable_sections')
          .select('id, name, slug, owner_tenant_id, status')
          .eq('status', 'active')
          .is('deleted_at', null)
          .order('updated_at', { ascending: false });

        if (currentTenant?.id) {
          query = query.or(`owner_tenant_id.eq.${currentTenant.id},owner_tenant_id.is.null`);
        } else {
          query = query.is('owner_tenant_id', null);
        }

        const { data, error } = await query;

        if (error) throw error;
        setSections(data || []);
      } catch (error) {
        console.error('Error fetching reusable sections:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchSections();
  }, [currentTenant?.id]);

  return (
    <div className="space-y-3">
      <Label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">{field.label || name}</Label>

      {loading ? (
        <div className="flex items-center text-xs text-muted-foreground py-2">
          <Loader2 className="mr-2 h-3 w-3 animate-spin" /> Loading reusable sections...
        </div>
      ) : (
        <Select value={value || ''} onValueChange={onChange}>
          <SelectTrigger className="h-9 w-full">
            <SelectValue placeholder="Select a reusable section..." />
          </SelectTrigger>
          <SelectContent className="max-h-[240px]">
            <SelectGroup>
              <SelectLabel>Reusable Sections</SelectLabel>
              {sections.map((section) => (
                <SelectItem key={section.id} value={section.slug}>
                  <span className="truncate block max-w-[240px]">
                    {section.name} ({section.owner_tenant_id ? 'Tenant' : 'Platform'})
                  </span>
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      )}

      <div className="text-[10px] text-muted-foreground bg-slate-50 dark:bg-slate-900 p-1.5 rounded border border-slate-100 dark:border-slate-800">
        Slug: <span className="font-mono">{value || '(empty)'}</span>
      </div>
    </div>
  );
};
