import { useEffect, useState } from 'react';
import { CalendarDays, MapPin, PlusCircle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { supabase } from '@/lib/customSupabaseClient';
import { useTenant } from '@/contexts/TenantContext';
import { usePermissions } from '@/contexts/PermissionContext';

function EventsDashboard() {
  const { currentTenant } = useTenant();
  const { hasPermission } = usePermissions();
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadEvents = async () => {
      if (!hasPermission('tenant.events.read')) {
        setEvents([]);
        setLoading(false);
        return;
      }

      setLoading(true);
      const { data } = await supabase
        .from('events')
        .select('id, title, summary, location, start_at, status')
        .eq('tenant_id', currentTenant?.id)
        .is('deleted_at', null)
        .order('start_at', { ascending: true })
        .limit(8);

      setEvents(data || []);
      setLoading(false);
    };

    loadEvents();
  }, [currentTenant?.id, hasPermission]);

  return (
    <div className="space-y-6">
      <Card className="border-border/60 bg-card/75">
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2">
              <CalendarDays className="h-5 w-5 text-primary" />
              Events
            </CardTitle>
            <CardDescription>Manifest-driven reference extension for tenant event publishing.</CardDescription>
          </div>
          <Button disabled={!hasPermission('tenant.events.create')} className="rounded-xl bg-primary text-primary-foreground hover:opacity-95">
            <PlusCircle className="mr-2 h-4 w-4" />
            New Event
          </Button>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="py-8 text-sm text-muted-foreground">Loading events...</div>
          ) : events.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border/70 p-6 text-sm text-muted-foreground">
              No events are active for this tenant yet.
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {events.map((eventItem) => (
                <div key={eventItem.id} className="rounded-xl border border-border/60 bg-background/80 p-4 shadow-sm">
                  <div className="flex items-center justify-between gap-4">
                    <h3 className="font-semibold text-foreground">{eventItem.title}</h3>
                    <span className="rounded-full border border-primary/20 bg-primary/10 px-2 py-1 text-xs font-medium text-primary">
                      {eventItem.status}
                    </span>
                  </div>
                  {eventItem.summary ? (
                    <p className="mt-2 text-sm text-muted-foreground">{eventItem.summary}</p>
                  ) : null}
                  <div className="mt-4 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                    <span>{new Date(eventItem.start_at).toLocaleString()}</span>
                    {eventItem.location ? (
                      <span className="flex items-center gap-1">
                        <MapPin className="h-3 w-3" />
                        {eventItem.location}
                      </span>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default EventsDashboard;
