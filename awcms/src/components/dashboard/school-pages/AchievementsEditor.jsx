import { useState } from 'react';
import { Plus, Trash2, Trophy, GripVertical, ChevronDown, ChevronUp } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import LocalizedInput from '@/components/ui/LocalizedInput';
import ImageUpload from '@/components/ui/ImageUpload';

const ACHIEVEMENT_LEVELS = [
  { value: 'international', label: 'International' },
  { value: 'national', label: 'National' },
  { value: 'provincial', label: 'Provincial' },
  { value: 'district', label: 'District/Regency' },
  { value: 'school', label: 'School' },
];

const ACHIEVEMENT_CATEGORIES = [
  { value: 'academic', label: 'Academic' },
  { value: 'sports', label: 'Sports' },
  { value: 'arts', label: 'Arts & Culture' },
  { value: 'technology', label: 'Science & Technology' },
  { value: 'religious', label: 'Religious' },
  { value: 'other', label: 'Other' },
];

function AchievementsEditor({ data = {}, updateField, updateTopLevel }) {
  const items = data?.items || [];
  const [expandedIndex, setExpandedIndex] = useState(null);

  const handleItemsChange = (newItems) => {
    updateTopLevel('items', newItems);
  };

  const addItem = () => {
    handleItemsChange([
      ...items,
      {
        id: `ach-${Date.now()}`,
        title: { id: '', en: '' },
        description: { id: '', en: '' },
        year: new Date().getFullYear().toString(),
        level: 'school',
        category: 'academic',
        student: '',
        image: '',
      },
    ]);
    setExpandedIndex(items.length);
  };

  const updateItem = (index, field, value) => {
    const updated = items.map((item, i) =>
      i === index ? { ...item, [field]: value } : item
    );
    handleItemsChange(updated);
  };

  const removeItem = (index) => {
    handleItemsChange(items.filter((_, i) => i !== index));
    if (expandedIndex === index) setExpandedIndex(null);
  };

  const moveItem = (index, direction) => {
    const newIndex = direction === 'up' ? index - 1 : index + 1;
    if (newIndex < 0 || newIndex >= items.length) return;
    const updated = [...items];
    [updated[index], updated[newIndex]] = [updated[newIndex], updated[index]];
    handleItemsChange(updated);
    
    if (expandedIndex === index) setExpandedIndex(newIndex);
    else if (expandedIndex === newIndex) setExpandedIndex(index);
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Page Description</CardTitle>
          <CardDescription>General description shown at the top of the achievements page</CardDescription>
        </CardHeader>
        <CardContent>
          <LocalizedInput
            label="Page Description"
            type="textarea"
            value={data.achievementsPage?.description}
            onChange={(value) => updateField('achievementsPage', 'description', value)}
          />
        </CardContent>
      </Card>

      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-medium">Achievement Records</h3>
            <p className="text-sm text-muted-foreground">Awards, competitions, and recognitions</p>
          </div>
          <Button onClick={addItem} variant="outline" size="sm">
            <Plus className="mr-1 h-4 w-4" /> Add Achievement
          </Button>
        </div>

        {items.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="py-8 text-center text-muted-foreground">
              <Trophy className="mx-auto mb-2 h-8 w-8 opacity-50" />
              No achievements recorded yet. Click &quot;Add Achievement&quot; to create one.
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {items.map((item, index) => (
              <Card key={item.id || index} className="overflow-hidden">
                <div
                    className="flex items-center gap-2 p-3 cursor-pointer hover:bg-muted/50"
                    onClick={() => setExpandedIndex(expandedIndex === index ? null : index)}
                >
                    <GripVertical className="h-4 w-4 text-muted-foreground shrink-0" />
                    <div className="flex-1 min-w-0">
                        <div className="font-medium truncate">
                            {item.title?.id || item.title?.en || `Achievement ${index + 1}`}
                        </div>
                        <div className="text-sm text-muted-foreground truncate">
                            {item.year && `${item.year} · `}
                            {ACHIEVEMENT_LEVELS.find((l) => l.value === item.level)?.label || ''}
                            {item.category && ` · ${ACHIEVEMENT_CATEGORIES.find((c) => c.value === item.category)?.label || ''}`}
                        </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={(e) => { e.stopPropagation(); moveItem(index, 'up'); }}
                            disabled={index === 0}
                        >
                            <ChevronUp className="h-4 w-4" />
                        </Button>
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={(e) => { e.stopPropagation(); moveItem(index, 'down'); }}
                            disabled={index === items.length - 1}
                        >
                            <ChevronDown className="h-4 w-4" />
                        </Button>
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-destructive hover:text-destructive"
                            onClick={(e) => { e.stopPropagation(); removeItem(index); }}
                        >
                            <Trash2 className="h-4 w-4" />
                        </Button>
                    </div>
                </div>

                {expandedIndex === index && (
                <CardContent className="border-t pt-4 space-y-4">
                  <LocalizedInput
                    label="Achievement Title"
                    value={item.title}
                    onChange={(value) => updateItem(index, 'title', value)}
                  />

                  <div className="grid grid-cols-3 gap-4">
                    <div>
                      <Label>Year</Label>
                      <Input
                        value={item.year || ''}
                        onChange={(e) => updateItem(index, 'year', e.target.value)}
                        placeholder="2024"
                      />
                    </div>
                    <div>
                      <Label>Level</Label>
                      <Select value={item.level || ''} onValueChange={(v) => updateItem(index, 'level', v)}>
                        <SelectTrigger><SelectValue placeholder="Select level" /></SelectTrigger>
                        <SelectContent>
                          {ACHIEVEMENT_LEVELS.map((l) => (
                            <SelectItem key={l.value} value={l.value}>{l.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label>Category</Label>
                      <Select value={item.category || ''} onValueChange={(v) => updateItem(index, 'category', v)}>
                        <SelectTrigger><SelectValue placeholder="Select category" /></SelectTrigger>
                        <SelectContent>
                          {ACHIEVEMENT_CATEGORIES.map((c) => (
                            <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div>
                    <Label>Student / Team Name</Label>
                    <Input
                      value={item.student || ''}
                      onChange={(e) => updateItem(index, 'student', e.target.value)}
                      placeholder="Student or team name"
                    />
                  </div>

                  <LocalizedInput
                    label="Description"
                    type="textarea"
                    value={item.description}
                    onChange={(value) => updateItem(index, 'description', value)}
                  />

                  <ImageUpload
                    label="Achievement Photo"
                    value={item.image}
                    onChange={(value) => updateItem(index, 'image', value)}
                  />
                </CardContent>
                )}
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default AchievementsEditor;
