import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import LocalizedInput from '@/components/ui/LocalizedInput';
import ImageUpload from '@/components/ui/ImageUpload';

function ServicesEditor({ data = {}, updateField }) {
  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Library</CardTitle>
          <CardDescription>School library facilities and resources</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <LocalizedInput
            label="Title"
            value={data.library?.title}
            onChange={(value) => updateField('library', 'title', value)}
          />
          <LocalizedInput
            label="Content"
            type="richtext"
            value={data.library?.content}
            onChange={(value) => updateField('library', 'content', value)}
          />
          <ImageUpload
            label="Library Photo"
            value={data.library?.image}
            onChange={(value) => updateField('library', 'image', value)}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Laboratories</CardTitle>
          <CardDescription>Science, computer, and other laboratory facilities</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <LocalizedInput
            label="Title"
            value={data.labs?.title}
            onChange={(value) => updateField('labs', 'title', value)}
          />
          <LocalizedInput
            label="Content"
            type="richtext"
            value={data.labs?.content}
            onChange={(value) => updateField('labs', 'content', value)}
          />
          <ImageUpload
            label="Lab Photo"
            value={data.labs?.image}
            onChange={(value) => updateField('labs', 'image', value)}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Extracurricular Activities</CardTitle>
          <CardDescription>Student clubs, sports teams, and extracurricular programs</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <LocalizedInput
            label="Title"
            value={data.extracurricular?.title}
            onChange={(value) => updateField('extracurricular', 'title', value)}
          />
          <LocalizedInput
            label="Content"
            type="richtext"
            value={data.extracurricular?.content}
            onChange={(value) => updateField('extracurricular', 'content', value)}
          />
          <ImageUpload
            label="Extracurricular Photo"
            value={data.extracurricular?.image}
            onChange={(value) => updateField('extracurricular', 'image', value)}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Counseling / BK</CardTitle>
          <CardDescription>Guidance and counseling services for students</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <LocalizedInput
            label="Title"
            value={data.counseling?.title}
            onChange={(value) => updateField('counseling', 'title', value)}
          />
          <LocalizedInput
            label="Content"
            type="richtext"
            value={data.counseling?.content}
            onChange={(value) => updateField('counseling', 'content', value)}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Health Services / UKS</CardTitle>
          <CardDescription>School health unit and facilities</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <LocalizedInput
            label="Title"
            value={data.health?.title}
            onChange={(value) => updateField('health', 'title', value)}
          />
          <LocalizedInput
            label="Content"
            type="richtext"
            value={data.health?.content}
            onChange={(value) => updateField('health', 'content', value)}
          />
        </CardContent>
      </Card>
    </div>
  );
}

export default ServicesEditor;
