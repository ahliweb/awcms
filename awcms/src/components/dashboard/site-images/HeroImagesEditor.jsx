import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ImageUpload } from '@/components/ui/ImageUpload';
import LocalizedInput from '@/components/ui/LocalizedInput';

function HeroImagesEditor({ data = {}, onChange }) {
  const updateField = (field, value) => {
    onChange({ ...data, [field]: value });
  };

  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Homepage Hero</CardTitle>
          <CardDescription>Main hero image for the homepage</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <ImageUpload
            label="Hero Image"
            value={data.main}
            onChange={(value) => updateField('main', value)}
          />
          <LocalizedInput
            label="Hero Title"
            value={data.mainTitle}
            onChange={(value) => updateField('mainTitle', value)}
          />
          <LocalizedInput
            label="Hero Subtitle"
            type="textarea"
            value={data.mainSubtitle}
            onChange={(value) => updateField('mainSubtitle', value)}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">About Page Hero</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <ImageUpload
            label="About Hero Image"
            value={data.about}
            onChange={(value) => updateField('about', value)}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Contact Page Hero</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <ImageUpload
            label="Contact Hero Image"
            value={data.contact}
            onChange={(value) => updateField('contact', value)}
          />
        </CardContent>
      </Card>
    </div>
  );
}

export default HeroImagesEditor;
