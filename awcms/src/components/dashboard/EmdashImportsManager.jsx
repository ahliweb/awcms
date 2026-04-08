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
  sourceLocator: './docs/examples/emdash/blog/seed.json',
};

function EmdashImportsManager() {
  const { currentTenant } = useTenant();
  const { toast } = useToast();
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [submittingMode, setSubmittingMode] = useState(null);
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

  const handleCreateJob = async (dryRun) => {
    if (!currentTenant?.id) {
      toast({ variant: 'destructive', title: 'Missing tenant context', description: 'Select a tenant before creating an import job.' });
      return;
    }

    setSubmittingMode(dryRun ? 'dry-run' : 'execute');
    setError(null);
    const payload = {
      action: 'create-job',
      tenantId: currentTenant.id,
      importType: form.importType,
      templateSlug: form.templateSlug,
      dryRun,
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
    setSubmittingMode(null);

    if (invokeError || data?.error) {
      const message = invokeError?.message || data?.error || 'Failed to create import job';
      setError(message);
      toast({ variant: 'destructive', title: 'Import job failed', description: message });
      return;
    }

    toast({
      title: dryRun ? 'Import dry run created' : 'Import executed',
      description: dryRun
        ? `Queued dry-run import for ${form.templateSlug}.`
        : `Executed seeded ${form.templateSlug} import for the active tenant.`,
    });
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
              Foundation flow for EmDash tenant imports. Dry runs remain auditable, and the blog plus marketing seed paths can now materialize tenant content for the active tenant.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form className="grid gap-4 md:grid-cols-3" onSubmit={(event) => event.preventDefault()}>
              <div className="space-y-2">
                <Label htmlFor="templateSlug">Template</Label>
                <Select value={form.templateSlug} onValueChange={(value) => setForm((current) => ({
                  ...current,
                  templateSlug: value,
                  sourceLocator: `./docs/examples/emdash/${value}/seed.json`,
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
                  placeholder="https://example.com/emdash/blog/seed.json"
                  value={form.sourceLocator}
                  onChange={(event) => setForm((current) => ({ ...current, sourceLocator: event.target.value }))}
                />
                <p className="text-xs text-slate-500">
                  External imports accept `http(s)` URLs plus local file paths such as `./docs/examples/emdash/marketing/seed.json`.
                </p>
              </div>

              <div className="md:col-span-3 flex items-center gap-3">
                <Button type="button" variant="outline" disabled={Boolean(submittingMode)} onClick={() => handleCreateJob(true)}>
                  {submittingMode === 'dry-run' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  Queue Dry Run
                </Button>
                <Button type="button" disabled={Boolean(submittingMode)} onClick={() => handleCreateJob(false)}>
                  {submittingMode === 'execute' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  Run Seed Import
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

                    {job.result_summary && Object.keys(job.result_summary).length > 0 ? (
                      <div className="mt-3 rounded-md bg-slate-50 p-3 text-xs text-slate-600">
                        {job.result_summary.imported_counts ? (
                          <div className="flex flex-wrap gap-3">
                            {Object.entries(job.result_summary.imported_counts).map(([key, value]) => (
                              <span key={key}>{key.replace(/_/g, ' ')}: {value || 0}</span>
                            ))}
                          </div>
                        ) : null}
                        {job.result_summary.error ? (
                          <div className="text-red-600">{job.result_summary.error}</div>
                        ) : null}
                      </div>
                    ) : null}

                    <div className="mt-3 flex flex-wrap gap-3 text-xs text-slate-500">
                      <span>Sources: {Array.isArray(job.sources) ? job.sources.length : 0}</span>
                      <span>Mappings: {Array.isArray(job.mappings) ? job.mappings.length : 0}</span>
                      <span>Artifacts: {Array.isArray(job.artifacts) ? job.artifacts.length : 0}</span>
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
