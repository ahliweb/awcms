import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import LocalizedInput from '@/components/ui/LocalizedInput';

function ContactEditor({ data = {}, updateField }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Contact Information</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <LocalizedInput
          label="Address"
          type="textarea"
          value={data.contactInfo?.address}
          onChange={(value) => updateField('contactInfo', 'address', value)}
        />

        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label>Phone</Label>
            <Input
              value={data.contactInfo?.phone || ''}
              onChange={(event) => updateField('contactInfo', 'phone', event.target.value)}
              placeholder="Phone number"
            />
          </div>
          <div>
            <Label>Email</Label>
            <Input
              value={data.contactInfo?.email || ''}
              onChange={(event) => updateField('contactInfo', 'email', event.target.value)}
              placeholder="Email address"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label>Fax</Label>
            <Input
              value={data.contactInfo?.fax || ''}
              onChange={(event) => updateField('contactInfo', 'fax', event.target.value)}
              placeholder="Fax number"
            />
          </div>
          <div>
            <Label>Website</Label>
            <Input
              value={data.contactInfo?.website || ''}
              onChange={(event) => updateField('contactInfo', 'website', event.target.value)}
              placeholder="https://school.example.com"
            />
          </div>
        </div>

        <LocalizedInput
          label="Operational Hours"
          value={data.contactInfo?.operationalHours}
          onChange={(value) => updateField('contactInfo', 'operationalHours', value)}
        />

        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label>Google Maps Embed URL</Label>
            <Input
              value={data.contactInfo?.mapEmbed || ''}
              onChange={(event) => updateField('contactInfo', 'mapEmbed', event.target.value)}
              placeholder="https://maps.google.com/..."
            />
          </div>
          <div>
            <Label>Google Maps Coordinates</Label>
            <Input
              value={data.contactInfo?.mapCoordinates || ''}
              onChange={(event) => updateField('contactInfo', 'mapCoordinates', event.target.value)}
              placeholder="-2.123, 116.456"
            />
          </div>
        </div>

        <div>
          <Label className="text-sm font-medium">Social Media</Label>
          <div className="grid grid-cols-2 gap-4 mt-2">
            <div>
              <Label className="text-xs text-muted-foreground">Facebook</Label>
              <Input
                value={data.socialMedia?.facebook || ''}
                onChange={(event) => updateField('socialMedia', 'facebook', event.target.value)}
                placeholder="https://facebook.com/..."
              />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Instagram</Label>
              <Input
                value={data.socialMedia?.instagram || ''}
                onChange={(event) => updateField('socialMedia', 'instagram', event.target.value)}
                placeholder="https://instagram.com/..."
              />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">YouTube</Label>
              <Input
                value={data.socialMedia?.youtube || ''}
                onChange={(event) => updateField('socialMedia', 'youtube', event.target.value)}
                placeholder="https://youtube.com/..."
              />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Twitter/X</Label>
              <Input
                value={data.socialMedia?.twitter || ''}
                onChange={(event) => updateField('socialMedia', 'twitter', event.target.value)}
                placeholder="https://x.com/..."
              />
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default ContactEditor;
