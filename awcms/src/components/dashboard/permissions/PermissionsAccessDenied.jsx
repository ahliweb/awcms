import { Shield } from 'lucide-react';

function PermissionsAccessDenied() {
  return (
    <div className="flex min-h-[400px] flex-col items-center justify-center rounded-xl border border-border bg-card p-12 text-center">
      <Shield className="mb-4 h-12 w-12 text-destructive" />
      <h3 className="text-xl font-bold text-foreground">Access Restricted</h3>
      <p className="text-muted-foreground">Platform admin only.</p>
    </div>
  );
}

export default PermissionsAccessDenied;
