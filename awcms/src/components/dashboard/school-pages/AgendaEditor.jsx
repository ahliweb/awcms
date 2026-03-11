import { Plus, Trash2 } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import LocalizedInput from '@/components/ui/LocalizedInput';

function AgendaEditor({ data = {}, updateTopLevel }) {
  const events = data?.events || [];

  const handleEventsChange = (newEvents) => {
    updateTopLevel('events', newEvents);
  };

  const addEvent = () => {
    handleEventsChange([
      ...events,
      {
        id: `event-${Date.now()}`,
        title: { id: '', en: '' },
        description: { id: '', en: '' },
        date: '',
        endDate: '',
        location: '',
        isAllDay: false,
      },
    ]);
  };

  const updateEvent = (index, field, value) => {
    const updated = events.map((event, eventIndex) =>
      eventIndex === index ? { ...event, [field]: value } : event
    );
    handleEventsChange(updated);
  };

  const removeEvent = (index) => {
    handleEventsChange(events.filter((_, eventIndex) => eventIndex !== index));
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-medium">School Agenda</h3>
          <p className="text-sm text-muted-foreground">Manage upcoming events and activities</p>
        </div>
        <Button onClick={addEvent} variant="outline" size="sm">
          <Plus className="mr-1 h-4 w-4" /> Add Event
        </Button>
      </div>

      {events.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-8 text-center text-muted-foreground">
            No events scheduled. Click &quot;Add Event&quot; to create one.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {events.map((event, index) => (
            <Card key={event.id || index}>
              <CardHeader className="flex flex-row items-start justify-between pb-2">
                <div>
                  <CardTitle className="text-base">
                    {event.title?.id || event.title?.en || `Event ${index + 1}`}
                  </CardTitle>
                  {event.date && (
                    <CardDescription>
                      {event.date}
                      {event.endDate ? ` - ${event.endDate}` : ''}
                    </CardDescription>
                  )}
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-destructive"
                  onClick={() => removeEvent(index)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </CardHeader>

              <CardContent className="space-y-4">
                <LocalizedInput
                  label="Event Title"
                  value={event.title}
                  onChange={(value) => updateEvent(index, 'title', value)}
                />

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label>Start Date</Label>
                    <Input
                      type="date"
                      value={event.date || ''}
                      onChange={(eventInput) => updateEvent(index, 'date', eventInput.target.value)}
                    />
                  </div>
                  <div>
                    <Label>End Date (optional)</Label>
                    <Input
                      type="date"
                      value={event.endDate || ''}
                      onChange={(eventInput) => updateEvent(index, 'endDate', eventInput.target.value)}
                    />
                  </div>
                </div>

                <div>
                  <Label>Location</Label>
                  <Input
                    value={event.location || ''}
                    onChange={(eventInput) => updateEvent(index, 'location', eventInput.target.value)}
                    placeholder="Event location"
                  />
                </div>

                <LocalizedInput
                  label="Description"
                  type="textarea"
                  value={event.description}
                  onChange={(value) => updateEvent(index, 'description', value)}
                />
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

export default AgendaEditor;
