import { useState } from 'react';
import { Plus, Trash2, GraduationCap, GripVertical, ChevronDown, ChevronUp } from 'lucide-react';
// ... rest of imports
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import LocalizedInput from '@/components/ui/LocalizedInput';
import ImageUpload from '@/components/ui/ImageUpload';

function AlumniEditor({ data = {}, updateField, updateTopLevel }) {
  const items = data?.items || [];
  const [expandedIndex, setExpandedIndex] = useState(null);

  const handleItemsChange = (newItems) => {
    updateTopLevel('items', newItems);
  };

  const addItem = () => {
    handleItemsChange([
      ...items,
      {
        id: `alumni-${Date.now()}`,
        name: '',
        graduationYear: '',
        currentPosition: '',
        company: '',
        testimonial: { id: '', en: '' },
        photo: '',
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
          <CardDescription>General description shown at the top of the alumni page</CardDescription>
        </CardHeader>
        <CardContent>
          <LocalizedInput
            label="Page Description"
            type="textarea"
            value={data.alumniPage?.description}
            onChange={(value) => updateField('alumniPage', 'description', value)}
          />
        </CardContent>
      </Card>

      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-medium">Featured Alumni</h3>
            <p className="text-sm text-muted-foreground">Notable graduates and their achievements</p>
          </div>
          <Button onClick={addItem} variant="outline" size="sm">
            <Plus className="mr-1 h-4 w-4" /> Add Alumni
          </Button>
        </div>

        {items.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="py-8 text-center text-muted-foreground">
              <GraduationCap className="mx-auto mb-2 h-8 w-8 opacity-50" />
              No alumni entries yet. Click &quot;Add Alumni&quot; to create one.
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
                    <div className="w-10 h-10 bg-muted rounded-full flex items-center justify-center text-base font-medium shrink-0">
                        {item.name?.charAt(0) || '?'}
                    </div>
                    <div className="flex-1 min-w-0">
                        <div className="font-medium truncate">
                            {item.name || `Alumni ${index + 1}`}
                        </div>
                        <div className="text-sm text-muted-foreground truncate">
                            {item.graduationYear && `Class of ${item.graduationYear} · `}
                            {item.currentPosition || ''} 
                            {item.company && ` at ${item.company}`}
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
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label>Full Name</Label>
                      <Input
                        value={item.name || ''}
                        onChange={(e) => updateItem(index, 'name', e.target.value)}
                        placeholder="Alumni's name"
                      />
                    </div>
                    <div>
                      <Label>Graduation Year</Label>
                      <Input
                        value={item.graduationYear || ''}
                        onChange={(e) => updateItem(index, 'graduationYear', e.target.value)}
                        placeholder="2020"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label>Current Position</Label>
                      <Input
                        value={item.currentPosition || ''}
                        onChange={(e) => updateItem(index, 'currentPosition', e.target.value)}
                        placeholder="Software Engineer"
                      />
                    </div>
                    <div>
                      <Label>Company / Institution</Label>
                      <Input
                        value={item.company || ''}
                        onChange={(e) => updateItem(index, 'company', e.target.value)}
                        placeholder="Google"
                      />
                    </div>
                  </div>

                  <LocalizedInput
                    label="Testimonial"
                    type="textarea"
                    value={item.testimonial}
                    onChange={(value) => updateItem(index, 'testimonial', value)}
                  />

                  <ImageUpload
                    label="Photo"
                    value={item.photo}
                    onChange={(value) => updateItem(index, 'photo', value)}
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

export default AlumniEditor;
