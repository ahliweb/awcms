import { AdminPageLayout } from '@/templates/flowbite-admin';

function TenantSettingsErrorState({ title, description }) {
  return (
    <AdminPageLayout>
      <div className="rounded-2xl border border-destructive/25 bg-destructive/5 p-6 text-center">
        <h2 className="text-xl font-semibold text-destructive">{title}</h2>
        <p className="mt-2 text-sm text-muted-foreground">{description}</p>
      </div>
    </AdminPageLayout>
  );
}

export default TenantSettingsErrorState;
