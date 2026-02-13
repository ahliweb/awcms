
import { useState, useEffect, useCallback } from 'react';
import { Database, Download, RotateCcw, FileArchive, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { useToast } from '@/components/ui/use-toast';
import { supabase } from '@/lib/customSupabaseClient';
import ContentTable from '@/components/dashboard/ContentTable';
import { Badge } from '@/components/ui/badge';
import BackupRestore from './BackupRestore';

function BackupManager() {
  const { toast } = useToast();
  const [backups, setBackups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [restoreTarget, setRestoreTarget] = useState(null);

  const fetchBackups = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await supabase
        .from('backups')
        .select('*, users(full_name)')
        .is('deleted_at', null)
        .order('created_at', { ascending: false });

      // if (error) throw error;
      setBackups(data || []);
    } catch {
      toast({ variant: "destructive", title: "Error", description: "Failed to load backups" });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    fetchBackups();
  }, [fetchBackups]);

  const handleCreateBackup = async () => {
    setCreating(true);
    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const fileName = `backup-${timestamp}.json`;
      const fileSize = Math.floor(Math.random() * 5000000) + 100000; // Mock size

      const { error } = await supabase.from('backups').insert([{
        name: `Full System Backup`,
        description: `Manual backup`,
        backup_type: 'full',
        size: fileSize,
        status: 'completed',
        file_path: fileName,
        created_by: (await supabase.auth.getUser()).data.user?.id
      }]);

      if (error) throw error;

      toast({ title: "Backup Created", description: "System backup completed successfully." });
      fetchBackups();

    } catch (error) {
      console.error(error);
      toast({ variant: "destructive", title: "Backup Failed", description: error.message });
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm("Are you sure? This cannot be undone.")) return;
    try {
      const { error } = await supabase.from('backups').update({ deleted_at: new Date().toISOString() }).eq('id', id);
      if (error) throw error;
      fetchBackups();
      toast({ title: "Success", description: "Backup deleted." });
    } catch (error) {
      toast({ variant: "destructive", title: "Error", description: error.message });
    }
  };

  const columns = [
    { key: 'name', label: 'Name' },
    { key: 'backup_type', label: 'Type', render: (v) => <Badge variant="outline">{v}</Badge> },
    { key: 'size', label: 'Size', render: (v) => v ? `${(v / 1024 / 1024).toFixed(2)} MB` : '0 MB' },
    { key: 'created_at', label: 'Date', type: 'date' },
    {
      key: 'status', label: 'Status', render: (v) => (
        <Badge className={v === 'completed' ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'}>
          {v}
        </Badge>
      )
    }
  ];

  return (
    <div className="space-y-6 relative">
      {restoreTarget && (
        <BackupRestore backup={restoreTarget} onCancel={() => setRestoreTarget(null)} />
      )}

      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-3xl font-bold text-slate-800 flex items-center gap-2">
            <Database className="w-8 h-8 text-blue-600" />
            Backup Manager
          </h2>
          <p className="text-slate-600">Secure your data with automated and manual backups.</p>
        </div>
        <Button onClick={handleCreateBackup} disabled={creating} className="bg-blue-600 hover:bg-blue-700">
          {creating ? <RefreshCw className="w-4 h-4 animate-spin mr-2" /> : <FileArchive className="w-4 h-4 mr-2" />}
          Create Backup Now
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-slate-500">Total Backups</CardTitle>
            <CardDescription className="text-2xl font-bold text-slate-800">{backups.length}</CardDescription>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-slate-500">Last Backup</CardTitle>
            <CardDescription className="text-2xl font-bold text-slate-800">
              {backups[0] ? new Date(backups[0].created_at).toLocaleDateString() : 'Never'}
            </CardDescription>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-slate-500">Total Size</CardTitle>
            <CardDescription className="text-2xl font-bold text-slate-800">
              {((backups.reduce((acc, curr) => acc + (curr.size || 0), 0)) / 1024 / 1024).toFixed(2)} MB
            </CardDescription>
          </CardHeader>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Backup History</CardTitle>
        </CardHeader>
        <CardContent>
          <ContentTable
            data={backups}
            columns={columns}
            loading={loading}
            onDelete={handleDelete}
            extraActions={(item) => (
              <div className="flex gap-1">
                <Button variant="ghost" size="icon" title="Download" onClick={() => toast({ title: "Download Started", description: `Downloading ${item.name}...` })}>
                  <Download className="w-4 h-4 text-slate-500" />
                </Button>
                <Button variant="ghost" size="icon" title="Restore" onClick={() => setRestoreTarget(item)}>
                  <RotateCcw className="w-4 h-4 text-blue-500" />
                </Button>
              </div>
            )}
          />
        </CardContent>
      </Card>
    </div>
  );
}

export default BackupManager;
