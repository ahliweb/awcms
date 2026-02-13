
import { useState } from 'react';
import { AlertTriangle, RotateCcw, CheckCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { useToast } from '@/components/ui/use-toast';

function BackupRestore({ backup, onCancel }) {
  const { toast } = useToast();
  const [confirming, setConfirming] = useState(false);
  const [restoring, setRestoring] = useState(false);

  const handleRestore = async () => {
    setRestoring(true);
    // Simulate restore process
    setTimeout(() => {
        setRestoring(false);
        toast({
            title: "Restore Initiated",
            description: "System restore has been queued. You will be notified when complete."
        });
        onCancel();
    }, 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
        <Card className="w-full max-w-lg shadow-2xl">
            <CardHeader>
                <CardTitle className="flex items-center gap-2 text-red-600">
                    <AlertTriangle className="w-6 h-6" />
                    System Restore
                </CardTitle>
                <CardDescription>
                    You are about to restore the system to the state of <strong>{backup.name}</strong> from {new Date(backup.created_at).toLocaleString()}.
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                <div className="bg-red-50 p-4 rounded-md border border-red-100 text-red-800 text-sm">
                    <strong>Warning:</strong> This action will overwrite current data. Any changes made since this backup will be lost permanently.
                </div>
                
                {!confirming ? (
                    <div className="flex justify-end gap-3 pt-4">
                        <Button variant="ghost" onClick={onCancel}>Cancel</Button>
                        <Button variant="destructive" onClick={() => setConfirming(true)}>I Understand, Proceed</Button>
                    </div>
                ) : (
                    <div className="space-y-4 pt-2 animate-in fade-in">
                        <p className="text-sm font-bold text-slate-700">Are you absolutely sure?</p>
                        <div className="flex justify-end gap-3">
                            <Button variant="outline" onClick={() => setConfirming(false)} disabled={restoring}>Go Back</Button>
                            <Button variant="destructive" onClick={handleRestore} disabled={restoring}>
                                {restoring ? <RotateCcw className="w-4 h-4 animate-spin mr-2" /> : <CheckCircle className="w-4 h-4 mr-2" />}
                                {restoring ? 'Restoring...' : 'Confirm Restore'}
                            </Button>
                        </div>
                    </div>
                )}
            </CardContent>
        </Card>
    </div>
  );
}

export default BackupRestore;
