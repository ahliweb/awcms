import { useEffect, useState } from 'react';
import { CalendarDays } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import DashboardWidgetHeader from '@/components/dashboard/widgets/DashboardWidgetHeader';
import { supabase } from '@/lib/customSupabaseClient';
import { useTenant } from '@/contexts/TenantContext';

function EventsOverviewWidget() {
  const { currentTenant } = useTenant();
  const [count, setCount] = useState(0);

  useEffect(() => {
    const loadCount = async () => {
      const { count: nextCount } = await supabase
        .from('events')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', currentTenant?.id)
        .eq('status', 'published')
        .gte('start_at', new Date().toISOString())
        .is('deleted_at', null);

      setCount(nextCount || 0);
    };

    loadCount();
  }, [currentTenant?.id]);

  return (
    <Card className="dashboard-surface dashboard-surface-hover">
      <DashboardWidgetHeader title="Upcoming Events" icon={CalendarDays} badge="Live" />
      <CardContent className="pt-4">
        <div className="text-3xl font-semibold text-foreground">{count}</div>
        <p className="mt-2 text-sm text-muted-foreground">Published events scheduled for this tenant.</p>
      </CardContent>
    </Card>
  );
}

export default EventsOverviewWidget;
