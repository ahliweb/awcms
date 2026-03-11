import { useState } from 'react';
import { Plus, Trash2, FileText, GripVertical, ChevronDown, ChevronUp } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import LocalizedInput from '@/components/ui/LocalizedInput';

function FinanceEditor({ data = {}, updateField, updateTopLevel }) {
  const documents = data?.documents || [];
  const [expandedIndex, setExpandedIndex] = useState(null);

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
    setExpandedIndex(documents.length);
  };

  const updateDocument = (index, field, value) => {
    const updated = documents.map((doc, i) =>
      i === index ? { ...doc, [field]: value } : doc
    );
    handleDocumentsChange(updated);
  };

  const removeDocument = (index) => {
    handleDocumentsChange(documents.filter((_, i) => i !== index));
    if (expandedIndex === index) setExpandedIndex(null);
  };

  const moveDocument = (index, direction) => {
    const newIndex = direction === 'up' ? index - 1 : index + 1;
    if (newIndex < 0 || newIndex >= documents.length) return;
    const updated = [...documents];
    [updated[index], updated[newIndex]] = [updated[newIndex], updated[index]];
    handleDocumentsChange(updated);
    
    if (expandedIndex === index) setExpandedIndex(newIndex);
    else if (expandedIndex === newIndex) setExpandedIndex(index);
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
          <div className="space-y-2">
            {documents.map((doc, index) => (
              <Card key={doc.id || index} className="overflow-hidden">
                <div
                    className="flex items-center gap-2 p-3 cursor-pointer hover:bg-muted/50"
                    onClick={() => setExpandedIndex(expandedIndex === index ? null : index)}
                >
                    <GripVertical className="h-4 w-4 text-muted-foreground shrink-0" />
                    <div className="w-10 h-10 bg-primary/10 rounded-full flex items-center justify-center text-primary shrink-0">
                        <FileText className="h-5 w-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                        <div className="font-medium truncate">
                            {doc.label?.id || doc.label?.en || `Document ${index + 1}`}
                        </div>
                        <div className="text-sm text-muted-foreground truncate">
                            {doc.year && `Year: ${doc.year}`}
                        </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={(e) => { e.stopPropagation(); moveDocument(index, 'up'); }}
                            disabled={index === 0}
                        >
                            <ChevronUp className="h-4 w-4" />
                        </Button>
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={(e) => { e.stopPropagation(); moveDocument(index, 'down'); }}
                            disabled={index === documents.length - 1}
                        >
                            <ChevronDown className="h-4 w-4" />
                        </Button>
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-destructive hover:text-destructive"
                            onClick={(e) => { e.stopPropagation(); removeDocument(index); }}
                        >
                            <Trash2 className="h-4 w-4" />
                        </Button>
                    </div>
                </div>

                {expandedIndex === index && (
                <CardContent className="border-t pt-4 space-y-4">
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
                </CardContent>
                )}
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default FinanceEditor;
