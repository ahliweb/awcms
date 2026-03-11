import { Plus, Trash2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import LocalizedInput from '@/components/ui/LocalizedInput';
import ImageUpload from '@/components/ui/ImageUpload';

function GalleryEditor({ data = {}, updateTopLevel }) {
  const albums = data?.albums || [];

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
  };

  const updateAlbum = (index, field, value) => {
    const updated = albums.map((album, albumIndex) =>
      albumIndex === index ? { ...album, [field]: value } : album
    );
    handleAlbumsChange(updated);
  };

  const removeAlbum = (index) => {
    handleAlbumsChange(albums.filter((_, albumIndex) => albumIndex !== index));
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
            No albums created yet. Click &quot;Add Album&quot; to create one.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {albums.map((album, index) => (
            <Card key={album.id || index}>
              <CardHeader className="flex flex-row items-start justify-between">
                <div>
                  <CardTitle className="text-base">
                    {album.title?.id || album.title?.en || `Album ${index + 1}`}
                  </CardTitle>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-destructive"
                  onClick={() => removeAlbum(index)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </CardHeader>
              <CardContent className="space-y-4">
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
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

export default GalleryEditor;
