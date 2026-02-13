
import { Settings } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';

function BackupSettings() {
  const { toast } = useToast();
  return (
    <Card>
       <CardHeader>
          <CardTitle className="flex items-center gap-2">
             <Settings className="w-5 h-5" />
             Retention Policy
          </CardTitle>
       </CardHeader>
       <CardContent className="space-y-4">
          <div className="space-y-2">
             <Label>Retain Daily Backups (Days)</Label>
             <Input type="number" defaultValue={30} />
          </div>
          <div className="space-y-2">
             <Label>Retain Weekly Backups (Weeks)</Label>
             <Input type="number" defaultValue={12} />
          </div>
          <div className="space-y-2">
             <Label>Retain Monthly Backups (Months)</Label>
             <Input type="number" defaultValue={24} />
          </div>
          <Button onClick={() => toast({ title: "Settings Saved" })}>
             Save Settings
          </Button>
       </CardContent>
    </Card>
  );
}

export default BackupSettings;
