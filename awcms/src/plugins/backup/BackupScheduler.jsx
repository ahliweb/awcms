
import { useState } from 'react';
import { Calendar, Clock, Save } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { useToast } from '@/components/ui/use-toast';

function BackupScheduler() {
  const { toast } = useToast();
  const [frequency, setFrequency] = useState('daily');
  const [time, setTime] = useState('00:00');

  const handleSave = () => {
    toast({
       title: "Schedule Updated",
       description: `Backups will run ${frequency} at ${time}.`
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 mb-4">
         <Calendar className="w-6 h-6 text-blue-600" />
         <h2 className="text-2xl font-bold text-slate-800">Backup Schedule</h2>
      </div>

      <Card className="max-w-md">
        <CardHeader>
          <CardTitle>Automated Backups</CardTitle>
          <CardDescription>Configure when the system should automatically create backups.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
           <div className="space-y-2">
              <Label>Frequency</Label>
              <Select value={frequency} onValueChange={setFrequency}>
                 <SelectTrigger>
                    <SelectValue />
                 </SelectTrigger>
                 <SelectContent>
                    <SelectItem value="daily">Daily</SelectItem>
                    <SelectItem value="weekly">Weekly</SelectItem>
                    <SelectItem value="monthly">Monthly</SelectItem>
                 </SelectContent>
              </Select>
           </div>

           <div className="space-y-2">
              <Label>Time (UTC)</Label>
              <div className="relative">
                 <Clock className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                 <Input 
                    type="time" 
                    value={time} 
                    onChange={(e) => setTime(e.target.value)}
                    className="pl-9"
                 />
              </div>
           </div>

           <Button onClick={handleSave} className="w-full mt-4">
              <Save className="w-4 h-4 mr-2" />
              Save Schedule
           </Button>
        </CardContent>
      </Card>
    </div>
  );
}

export default BackupScheduler;
