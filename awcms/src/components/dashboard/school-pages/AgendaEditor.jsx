import { useState } from 'react';
import { Plus, Trash2, Calendar, GripVertical, ChevronDown, ChevronUp } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import LocalizedInput from '@/components/ui/LocalizedInput';

function AgendaEditor({ data = {}, updateTopLevel }) {
  const events = data?.events || [];
  const [expandedIndex, setExpandedIndex] = useState(null);

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
    setExpandedIndex(events.length);
  };

  const updateEvent = (index, field, value) => {
    const updated = events.map((event, eventIndex) =>
      eventIndex === index ? { ...event, [field]: value } : event
    );
    handleEventsChange(updated);
  };

  const removeEvent = (index) => {
    handleEventsChange(events.filter((_, eventIndex) => eventIndex !== index));
    if (expandedIndex === index) setExpandedIndex(null);
  };

  const moveEvent = (index, direction) => {
    const newIndex = direction === 'up' ? index - 1 : index + 1;
    if (newIndex < 0 || newIndex >= events.length) return;
    const updated = [...events];
    [updated[index], updated[newIndex]] = [updated[newIndex], updated[index]];
    handleEventsChange(updated);
    
    if (expandedIndex === index) setExpandedIndex(newIndex);
    else if (expandedIndex === newIndex) setExpandedIndex(index);
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
            <Calendar className="mx-auto mb-2 h-8 w-8 opacity-50" />
            No events scheduled. Click &quot;Add Event&quot; to create one.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {events.map((event, index) => (
            <Card key={event.id || index} className="overflow-hidden">
                <div
                    className="flex items-center gap-2 p-3 cursor-pointer hover:bg-muted/50"
                    onClick={() => setExpandedIndex(expandedIndex === index ? null : index)}
                >
                    <GripVertical className="h-4 w-4 text-muted-foreground shrink-0" />
                    <div className="w-10 h-10 bg-primary/10 rounded-full flex items-center justify-center text-primary shrink-0">
                        <Calendar className="h-5 w-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                        <div className="font-medium truncate">
                            {event.title?.id || event.title?.en || `Event ${index + 1}`}
                        </div>
                        <div className="text-sm text-muted-foreground truncate">
                            {event.date && `From ${event.date}`}
                            {event.endDate && ` to ${event.endDate}`}
                            {event.location && ` at ${event.location}`}
                        </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={(e) => { e.stopPropagation(); moveEvent(index, 'up'); }}
                            disabled={index === 0}
                        >
                            <ChevronUp className="h-4 w-4" />
                        </Button>
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={(e) => { e.stopPropagation(); moveEvent(index, 'down'); }}
                            disabled={index === events.length - 1}
                        >
                            <ChevronDown className="h-4 w-4" />
                        </Button>
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-destructive hover:text-destructive"
                            onClick={(e) => { e.stopPropagation(); removeEvent(index); }}
                        >
                            <Trash2 className="h-4 w-4" />
                        </Button>
                    </div>
                </div>

                {expandedIndex === index && (
                <CardContent className="border-t pt-4 space-y-4">
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
                )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

export default AgendaEditor;
