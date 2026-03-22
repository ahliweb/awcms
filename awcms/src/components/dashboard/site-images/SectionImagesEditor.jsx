import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ImageUpload } from '@/components/ui/ImageUpload';
import { SECTION_IMAGE_FIELDS } from '@/components/dashboard/site-images/constants';

function SectionImagesEditor({ data = {}, onChange }) {
  const updateField = (field, value) => {
    onChange({ ...data, [field]: value });
  };

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      {SECTION_IMAGE_FIELDS.map((section) => (
        <Card key={section.key}>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">{section.label}</CardTitle>
            <CardDescription className="text-xs">{section.description}</CardDescription>
          </CardHeader>
          <CardContent>
            <ImageUpload
              value={data[section.key]}
              onChange={(value) => updateField(section.key, value)}
              compact
            />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

export default SectionImagesEditor;
