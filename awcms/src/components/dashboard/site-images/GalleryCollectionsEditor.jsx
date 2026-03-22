import { useState } from 'react';
import { ChevronDown, ChevronUp, GripVertical, Plus, Trash2 } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import LocalizedInput from '@/components/ui/LocalizedInput';
import { ImageUpload } from '@/components/ui/ImageUpload';

function GalleryCollectionsEditor({ data = [], onChange }) {
  const [expandedIndex, setExpandedIndex] = useState(null);

  const addCollection = () => {
    onChange([
      ...data,
      {
        id: `collection-${Date.now()}`,
        name: { id: '', en: '' },
        description: { id: '', en: '' },
        category: '',
        images: [],
      },
    ]);
  };

  const updateCollection = (index, field, value) => {
    const updated = data.map((item, itemIndex) => (
      itemIndex === index ? { ...item, [field]: value } : item
    ));
    onChange(updated);
  };

  const removeCollection = (index) => {
    onChange(data.filter((_, itemIndex) => itemIndex !== index));
    if (expandedIndex === index) setExpandedIndex(null);
  };

  const addImageToCollection = (index, imageUrl) => {
    const collection = data[index];
    const updatedImages = [...(collection.images || []), imageUrl];
    updateCollection(index, 'images', updatedImages);
  };

  const removeImageFromCollection = (collectionIndex, imageIndex) => {
    const collection = data[collectionIndex];
    const updatedImages = collection.images.filter((_, index) => index !== imageIndex);
    updateCollection(collectionIndex, 'images', updatedImages);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-medium">Gallery Collections</h3>
          <p className="text-sm text-muted-foreground">Organize images into themed collections</p>
        </div>
        <Button onClick={addCollection} variant="outline" size="sm">
          <Plus className="mr-1 h-4 w-4" /> Add Collection
        </Button>
      </div>

      {data.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-8 text-center text-muted-foreground">
            No collections created yet. Click &quot;Add Collection&quot; to create one.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {data.map((collection, index) => (
            <Card key={collection.id || index}>
              <div
                className="flex cursor-pointer items-center gap-3 p-4 hover:bg-muted/50"
                onClick={() => setExpandedIndex(expandedIndex === index ? null : index)}
              >
                <GripVertical className="h-4 w-4 text-muted-foreground" />
                <div className="flex-1">
                  <div className="font-medium">
                    {collection.name?.id || collection.name?.en || `Collection ${index + 1}`}
                  </div>
                  <div className="text-sm text-muted-foreground">
                    {collection.images?.length || 0} images • {collection.category || 'No category'}
                  </div>
                </div>

                <div className="flex items-center gap-1">
                  {expandedIndex === index ? (
                    <ChevronUp className="h-4 w-4" />
                  ) : (
                    <ChevronDown className="h-4 w-4" />
                  )}

                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-destructive"
                    onClick={(event) => {
                      event.stopPropagation();
                      removeCollection(index);
                    }}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              {expandedIndex === index && (
                <CardContent className="space-y-4 border-t pt-4">
                  <LocalizedInput
                    label="Collection Name"
                    value={collection.name}
                    onChange={(value) => updateCollection(index, 'name', value)}
                  />

                  <LocalizedInput
                    label="Description"
                    type="textarea"
                    value={collection.description}
                    onChange={(value) => updateCollection(index, 'description', value)}
                  />

                  <div>
                    <Label>Category</Label>
                    <Input
                      value={collection.category || ''}
                      onChange={(event) => updateCollection(index, 'category', event.target.value)}
                      placeholder="e.g., KBM, Ekskul, Upacara"
                    />
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label>Images ({collection.images?.length || 0})</Label>
                      <ImageUpload
                        buttonOnly
                        onUpload={(url) => addImageToCollection(index, url)}
                      />
                    </div>

                    {collection.images?.length > 0 && (
                      <div className="grid grid-cols-4 gap-2">
                        {collection.images.map((imageUrl, imageIndex) => (
                          <div key={imageIndex} className="group relative">
                            <img
                              src={imageUrl}
                              alt=""
                              className="h-20 w-full rounded border object-cover"
                            />
                            <Button
                              variant="destructive"
                              size="icon"
                              className="absolute right-1 top-1 h-6 w-6 opacity-0 transition-opacity group-hover:opacity-100"
                              onClick={() => removeImageFromCollection(index, imageIndex)}
                            >
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </CardContent>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

export default GalleryCollectionsEditor;
