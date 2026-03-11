import { Plus, Trash2, Trophy } from 'lucide-react';
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
  };

  const updateItem = (index, field, value) => {
    const updated = items.map((item, i) =>
      i === index ? { ...item, [field]: value } : item
    );
    handleItemsChange(updated);
  };

  const removeItem = (index) => {
    handleItemsChange(items.filter((_, i) => i !== index));
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
          <div className="grid gap-4">
            {items.map((item, index) => (
              <Card key={item.id || index}>
                <CardHeader className="flex flex-row items-start justify-between pb-2">
                  <div>
                    <CardTitle className="text-base">
                      {item.title?.id || item.title?.en || `Achievement ${index + 1}`}
                    </CardTitle>
                    <CardDescription>
                      {item.year && `${item.year} · `}
                      {ACHIEVEMENT_LEVELS.find((l) => l.value === item.level)?.label || ''}
                      {item.category && ` · ${ACHIEVEMENT_CATEGORIES.find((c) => c.value === item.category)?.label || ''}`}
                    </CardDescription>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-destructive"
                    onClick={() => removeItem(index)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </CardHeader>
                <CardContent className="space-y-4">
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
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default AchievementsEditor;
