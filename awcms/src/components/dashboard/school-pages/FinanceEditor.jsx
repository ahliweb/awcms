import { Plus, Trash2, FileText } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import LocalizedInput from '@/components/ui/LocalizedInput';

function FinanceEditor({ data = {}, updateField, updateTopLevel }) {
  const documents = data?.documents || [];

  const handleDocumentsChange = (newDocs) => {
    updateTopLevel('documents', newDocs);
  };

  const addDocument = () => {
    handleDocumentsChange([
      ...documents,
      {
        id: `doc-${Date.now()}`,
        label: { id: '', en: '' },
        url: '',
        year: new Date().getFullYear().toString(),
      },
    ]);
  };

  const updateDocument = (index, field, value) => {
    const updated = documents.map((doc, i) =>
      i === index ? { ...doc, [field]: value } : doc
    );
    handleDocumentsChange(updated);
  };

  const removeDocument = (index) => {
    handleDocumentsChange(documents.filter((_, i) => i !== index));
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">BOS (School Operational Assistance)</CardTitle>
          <CardDescription>Budget transparency for BOS funds</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <LocalizedInput
            label="BOS Report Title"
            value={data.bos?.title}
            onChange={(value) => updateField('bos', 'title', value)}
          />
          <LocalizedInput
            label="BOS Report Content"
            type="richtext"
            value={data.bos?.content}
            onChange={(value) => updateField('bos', 'content', value)}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">APBD (Regional Budget)</CardTitle>
          <CardDescription>Regional government budget allocation details</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <LocalizedInput
            label="APBD Report Title"
            value={data.apbd?.title}
            onChange={(value) => updateField('apbd', 'title', value)}
          />
          <LocalizedInput
            label="APBD Report Content"
            type="richtext"
            value={data.apbd?.content}
            onChange={(value) => updateField('apbd', 'content', value)}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Committee Funds</CardTitle>
          <CardDescription>School committee financial reports and accountability</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <LocalizedInput
            label="Committee Report Title"
            value={data.committee?.title}
            onChange={(value) => updateField('committee', 'title', value)}
          />
          <LocalizedInput
            label="Committee Report Content"
            type="richtext"
            value={data.committee?.content}
            onChange={(value) => updateField('committee', 'content', value)}
          />
        </CardContent>
      </Card>

      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-medium">Transparency Documents</h3>
            <p className="text-sm text-muted-foreground">Links to downloadable financial reports</p>
          </div>
          <Button onClick={addDocument} variant="outline" size="sm">
            <Plus className="mr-1 h-4 w-4" /> Add Document
          </Button>
        </div>

        {documents.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="py-8 text-center text-muted-foreground">
              <FileText className="mx-auto mb-2 h-8 w-8 opacity-50" />
              No documents added yet. Click &quot;Add Document&quot; to link one.
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-3">
            {documents.map((doc, index) => (
              <Card key={doc.id || index}>
                <CardContent className="py-4">
                  <div className="flex items-start gap-3">
                    <FileText className="h-5 w-5 mt-1 text-muted-foreground shrink-0" />
                    <div className="flex-1 space-y-3">
                      <div className="grid grid-cols-3 gap-3">
                        <div className="col-span-2">
                          <LocalizedInput
                            label="Document Label"
                            value={doc.label}
                            onChange={(value) => updateDocument(index, 'label', value)}
                          />
                        </div>
                        <div>
                          <Label>Year</Label>
                          <Input
                            value={doc.year || ''}
                            onChange={(e) => updateDocument(index, 'year', e.target.value)}
                            placeholder="2024"
                          />
                        </div>
                      </div>
                      <div>
                        <Label>Document URL</Label>
                        <Input
                          value={doc.url || ''}
                          onChange={(e) => updateDocument(index, 'url', e.target.value)}
                          placeholder="https://..."
                        />
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-destructive shrink-0"
                      onClick={() => removeDocument(index)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default FinanceEditor;
