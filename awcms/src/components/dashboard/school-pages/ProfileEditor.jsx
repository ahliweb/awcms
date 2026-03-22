import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import LocalizedArrayEditor from '@/components/ui/LocalizedArrayEditor';
import LocalizedInput from '@/components/ui/LocalizedInput';
import { ImageUpload } from '@/components/ui/ImageUpload';

function ProfileEditor({ data = {}, updateField }) {
  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Principal Message</CardTitle>
          <CardDescription>Welcome message from the school principal</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <LocalizedInput
            label="Title"
            value={data.principalMessage?.title}
            onChange={(value) => updateField('principalMessage', 'title', value)}
          />
          <LocalizedInput
            label="Content"
            type="richtext"
            value={data.principalMessage?.content}
            onChange={(value) => updateField('principalMessage', 'content', value)}
          />
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Author Name</Label>
              <Input
                value={data.principalMessage?.author || ''}
                onChange={(event) => updateField('principalMessage', 'author', event.target.value)}
                placeholder="Principal's name"
              />
            </div>
            <div>
              <Label>Position</Label>
              <Input
                value={data.principalMessage?.position || ''}
                onChange={(event) => updateField('principalMessage', 'position', event.target.value)}
                placeholder="e.g., Kepala Sekolah"
              />
            </div>
          </div>
          <ImageUpload
            label="Principal Photo"
            value={data.principalMessage?.image}
            onChange={(value) => updateField('principalMessage', 'image', value)}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Vision & Mission</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <LocalizedInput
            label="Vision"
            type="textarea"
            value={data.visionMission?.vision}
            onChange={(value) => updateField('visionMission', 'vision', value)}
          />
          <LocalizedArrayEditor
            label="Mission Statements"
            itemLabel="Mission"
            addLabel="Add Mission"
            value={data.visionMission?.mission}
            onChange={(value) => updateField('visionMission', 'mission', value)}
          />
          <LocalizedInput
            label="Motto"
            value={data.visionMission?.motto}
            onChange={(value) => updateField('visionMission', 'motto', value)}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">School History</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <LocalizedInput
            label="History Content"
            type="richtext"
            value={data.history?.content}
            onChange={(value) => updateField('history', 'content', value)}
          />
        </CardContent>
      </Card>
    </div>
  );
}

export default ProfileEditor;
