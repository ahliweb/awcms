import { AlertTriangle, Key, Lock, Shield } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { TabsContent } from '@/components/ui/tabs';
import SecurityFeatureCard from '@/components/dashboard/sso/SecurityFeatureCard';

function SSOOverviewTab({ securityInfo }) {
  return (
    <TabsContent value="overview" className="space-y-4">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Shield className="h-5 w-5 text-blue-600" />
              <CardTitle>Security Features</CardTitle>
            </div>
            <CardDescription>Active security measures protecting your platform</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <SecurityFeatureCard
              title="Turnstile CAPTCHA"
              description="Cloudflare Turnstile protection on login"
              enabled={securityInfo.securityFeatures.turnstile}
              icon={Shield}
            />
            <SecurityFeatureCard
              title="Email Verification"
              description="Users must verify email before access"
              enabled={securityInfo.securityFeatures.emailVerification}
              icon={Key}
            />
            <SecurityFeatureCard
              title="Password Policy"
              description={`Minimum ${securityInfo.securityFeatures.passwordMinLength} characters required`}
              enabled={true}
              icon={Lock}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Lock className="h-5 w-5 text-green-600" />
              <CardTitle>Platform Security</CardTitle>
            </div>
            <CardDescription>Core security infrastructure</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <SecurityFeatureCard
              title="Row Level Security (RLS)"
              description="Database-level access control enabled"
              enabled={true}
              icon={Shield}
            />
            <SecurityFeatureCard
              title="JWT Authentication"
              description="Secure token-based authentication"
              enabled={true}
              icon={Key}
            />
            <SecurityFeatureCard
              title="HTTPS Enforced"
              description="All connections encrypted in transit"
              enabled={true}
              icon={Lock}
            />
          </CardContent>
        </Card>
      </div>

      <Card className="border-blue-100 bg-blue-50 dark:border-blue-800 dark:bg-blue-900/10">
        <CardHeader>
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-blue-600 dark:text-blue-400" />
            <CardTitle className="text-blue-900 dark:text-blue-200">OAuth Provider Configuration</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-blue-800 dark:text-blue-300">
          <p>OAuth providers (Google, GitHub, Azure AD, etc.) are configured directly in <strong>Supabase Dashboard</strong>.</p>
          <p className="flex items-center gap-2">
            <span>-&gt;</span>
            <a
              href="https://supabase.com/dashboard/project/_/auth/providers"
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-blue-600 dark:hover:text-blue-400"
            >
              Configure OAuth in Supabase Dashboard
            </a>
          </p>
        </CardContent>
      </Card>
    </TabsContent>
  );
}

export default SSOOverviewTab;
