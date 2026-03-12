import { useState } from 'react';
import { Plus, Trash2, ImageIcon, GripVertical, ChevronDown, ChevronUp } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import LocalizedInput from '@/components/ui/LocalizedInput';
import ImageUpload from '@/components/ui/ImageUpload';

function GalleryEditor({ data = {}, updateTopLevel }) {
  const albums = data?.albums || [];
  const [expandedIndex, setExpandedIndex] = useState(null);

  const handleAlbumsChange = (newAlbums) => {
    updateTopLevel('albums', newAlbums);
  };

  const addAlbum = () => {
    handleAlbumsChange([
      ...albums,
      {
        id: `album-${Date.now()}`,
        title: { id: '', en: '' },
        description: { id: '', en: '' },
        coverImage: '',
        images: [],
      },
    ]);
    setExpandedIndex(albums.length);
  };

  const updateAlbum = (index, field, value) => {
    const updated = albums.map((album, albumIndex) =>
      albumIndex === index ? { ...album, [field]: value } : album
    );
    handleAlbumsChange(updated);
  };

  const removeAlbum = (index) => {
    handleAlbumsChange(albums.filter((_, albumIndex) => albumIndex !== index));
    if (expandedIndex === index) setExpandedIndex(null);
  };

  const moveAlbum = (index, direction) => {
    const newIndex = direction === 'up' ? index - 1 : index + 1;
    if (newIndex < 0 || newIndex >= albums.length) return;
    const updated = [...albums];
    [updated[index], updated[newIndex]] = [updated[newIndex], updated[index]];
    handleAlbumsChange(updated);
    
    if (expandedIndex === index) setExpandedIndex(newIndex);
    else if (expandedIndex === newIndex) setExpandedIndex(index);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-medium">Photo Gallery Albums</h3>
          <p className="text-sm text-muted-foreground">Create and manage gallery albums</p>
        </div>
        <Button onClick={addAlbum} variant="outline" size="sm">
          <Plus className="mr-1 h-4 w-4" /> Add Album
        </Button>
      </div>

      {albums.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-8 text-center text-muted-foreground">
            <ImageIcon className="mx-auto mb-2 h-8 w-8 opacity-50" />
            No albums created yet. Click &quot;Add Album&quot; to create one.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {albums.map((album, index) => (
            <Card key={album.id || index} className="overflow-hidden">
                <div
                    className="flex items-center gap-2 p-3 cursor-pointer hover:bg-muted/50"
                    onClick={() => setExpandedIndex(expandedIndex === index ? null : index)}
                >
                    <GripVertical className="h-4 w-4 text-muted-foreground shrink-0" />
                    <div className="w-10 h-10 bg-primary/10 rounded-full flex items-center justify-center text-primary shrink-0">
                        <ImageIcon className="h-5 w-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                        <div className="font-medium truncate">
                            {album.title?.id || album.title?.en || `Album ${index + 1}`}
                        </div>
                        <div className="text-sm text-muted-foreground truncate">
                            {album.images?.length || 0} images
                        </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={(e) => { e.stopPropagation(); moveAlbum(index, 'up'); }}
                            disabled={index === 0}
                        >
                            <ChevronUp className="h-4 w-4" />
                        </Button>
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={(e) => { e.stopPropagation(); moveAlbum(index, 'down'); }}
                            disabled={index === albums.length - 1}
                        >
                            <ChevronDown className="h-4 w-4" />
                        </Button>
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-destructive hover:text-destructive"
                            onClick={(e) => { e.stopPropagation(); removeAlbum(index); }}
                        >
                            <Trash2 className="h-4 w-4" />
                        </Button>
                    </div>
                </div>

                {expandedIndex === index && (
                <CardContent className="border-t pt-4 space-y-4">
                  <LocalizedInput
                    label="Album Title"
                    value={album.title}
                    onChange={(value) => updateAlbum(index, 'title', value)}
                  />
                  <LocalizedInput
                    label="Description"
                    type="textarea"
                    value={album.description}
                    onChange={(value) => updateAlbum(index, 'description', value)}
                  />
                  <ImageUpload
                    label="Cover Image"
                    value={album.coverImage}
                    onChange={(value) => updateAlbum(index, 'coverImage', value)}
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

export default GalleryEditor;
