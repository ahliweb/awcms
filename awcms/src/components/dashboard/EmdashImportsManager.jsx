import { useCallback, useEffect, useState } from 'react';
import { ArrowDownToLine, Loader2, RefreshCw } from 'lucide-react';
import AdminPageLayout from '@/templates/flowbite-admin/layouts/AdminPageLayout';
import { PageHeader } from '@/templates/flowbite-admin';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { supabase } from '@/lib/customSupabaseClient';
import { useTenant } from '@/contexts/TenantContext';
import { useToast } from '@/components/ui/use-toast';

const defaultForm = {
  templateSlug: 'blog',
  importType: 'seed',
  sourceLocator: 'emdash/templates/blog/seed/seed.json',
};

function EmdashImportsManager() {
  const { currentTenant } = useTenant();
  const { toast } = useToast();
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState(defaultForm);
  const [error, setError] = useState(null);

  const loadJobs = useCallback(async () => {
    if (!currentTenant?.id) {
      setJobs([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    const { data, error: invokeError } = await supabase.functions.invoke('tenant-imports', {
      body: {
        action: 'list',
        tenantId: currentTenant.id,
      },
    });

    if (invokeError || data?.error) {
      setError(invokeError?.message || data?.error || 'Failed to load EmDash imports');
      setJobs([]);
      setLoading(false);
      return;
    }

    setJobs(Array.isArray(data?.jobs) ? data.jobs : []);
    setLoading(false);
  }, [currentTenant?.id]);

  useEffect(() => {
    loadJobs();
  }, [loadJobs]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!currentTenant?.id) {
      toast({ variant: 'destructive', title: 'Missing tenant context', description: 'Select a tenant before creating an import job.' });
      return;
    }

    setSubmitting(true);
    setError(null);
    const payload = {
      action: 'create-job',
      tenantId: currentTenant.id,
      importType: form.importType,
      templateSlug: form.templateSlug,
      dryRun: true,
      parameters: {
        source_system: 'emdash',
        parity_target: form.templateSlug,
        public_target: 'awcms-public/primary',
      },
      source: {
        sourceKey: `${form.templateSlug}:seed`,
        sourceKind: 'seed',
        sourceLocator: form.sourceLocator,
        sourceVersion: 'emdash-template-v1',
        sourcePayload: {
          template: form.templateSlug,
          parityMode: 'strict',
        },
      },
    };

    const { data, error: invokeError } = await supabase.functions.invoke('tenant-imports', { body: payload });
    setSubmitting(false);

    if (invokeError || data?.error) {
      const message = invokeError?.message || data?.error || 'Failed to create import job';
      setError(message);
      toast({ variant: 'destructive', title: 'Import job failed', description: message });
      return;
    }

    toast({ title: 'Import job created', description: `Queued dry-run import for ${form.templateSlug}.` });
    await loadJobs();
  };

  return (
    <AdminPageLayout requiredPermission="tenant.emdash_import.read">
      <PageHeader
        title="EmDash Imports"
        description="Queue and inspect tenant-scoped EmDash import jobs and compatibility state."
        icon={ArrowDownToLine}
        breadcrumbs={[{ label: 'EmDash Imports', icon: ArrowDownToLine }]}
      />

      <div className="space-y-6 p-6 pt-0">
        {error && (
          <Alert variant="destructive">
            <AlertTitle>Import workflow error</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Create Import Job</CardTitle>
            <CardDescription>
              Foundation flow for EmDash tenant imports. This currently creates auditable dry-run jobs for seeded template migration work.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form className="grid gap-4 md:grid-cols-3" onSubmit={handleSubmit}>
              <div className="space-y-2">
                <Label htmlFor="templateSlug">Template</Label>
                <Select value={form.templateSlug} onValueChange={(value) => setForm((current) => ({
                  ...current,
                  templateSlug: value,
                  sourceLocator: `emdash/templates/${value}/seed/seed.json`,
                }))}>
                  <SelectTrigger id="templateSlug">
                    <SelectValue placeholder="Select template" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="blog">Blog</SelectItem>
                    <SelectItem value="marketing">Marketing</SelectItem>
                    <SelectItem value="portfolio">Portfolio</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="importType">Import Type</Label>
                <Select value={form.importType} onValueChange={(value) => setForm((current) => ({ ...current, importType: value }))}>
                  <SelectTrigger id="importType">
                    <SelectValue placeholder="Select import type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="seed">Seed import</SelectItem>
                    <SelectItem value="content_sync">Content sync</SelectItem>
                    <SelectItem value="replay">Replay import</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="sourceLocator">Source Locator</Label>
                <Input
                  id="sourceLocator"
                  value={form.sourceLocator}
                  onChange={(event) => setForm((current) => ({ ...current, sourceLocator: event.target.value }))}
                />
              </div>

              <div className="md:col-span-3 flex items-center gap-3">
                <Button type="submit" disabled={submitting}>
                  {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  Queue Dry Run
                </Button>
                <Button type="button" variant="outline" onClick={loadJobs} disabled={loading}>
                  <RefreshCw className="mr-2 h-4 w-4" />
                  Refresh
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recent Import Jobs</CardTitle>
            <CardDescription>Latest dry-run and queued EmDash jobs for the active tenant.</CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading jobs...
              </div>
            ) : jobs.length === 0 ? (
              <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
                No EmDash import jobs found for this tenant yet.
              </div>
            ) : (
              <div className="space-y-3">
                {jobs.map((job) => (
                  <div key={job.id} className="rounded-lg border p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <div className="font-medium text-slate-900">{job.template_slug || 'unnamed import'} </div>
                        <div className="text-xs text-slate-500">{job.import_type} • {job.source_system} • {job.id}</div>
                      </div>
                      <div className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium uppercase tracking-wide text-slate-700">
                        {job.status}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AdminPageLayout>
  );
}

export default EmdashImportsManager;
