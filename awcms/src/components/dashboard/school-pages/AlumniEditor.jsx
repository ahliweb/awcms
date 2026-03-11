import { Plus, Trash2, GraduationCap } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import LocalizedInput from '@/components/ui/LocalizedInput';
import ImageUpload from '@/components/ui/ImageUpload';

function AlumniEditor({ data = {}, updateField, updateTopLevel }) {
  const items = data?.items || [];

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
          <div className="grid gap-4 md:grid-cols-2">
            {items.map((item, index) => (
              <Card key={item.id || index}>
                <CardHeader className="flex flex-row items-start justify-between pb-2">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-muted rounded-full flex items-center justify-center text-base font-medium">
                      {item.name?.charAt(0) || '?'}
                    </div>
                    <div>
                      <CardTitle className="text-base">
                        {item.name || `Alumni ${index + 1}`}
                      </CardTitle>
                      {item.graduationYear && (
                        <CardDescription>Class of {item.graduationYear}</CardDescription>
                      )}
                    </div>
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
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default AlumniEditor;
