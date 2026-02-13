
import { useState } from 'react';
import { Download, Star, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/use-toast';
import { supabase } from '@/lib/customSupabaseClient';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { useTenant } from '@/contexts/TenantContext';

// Mock Data for Marketplace
const MARKETPLACE_EXTENSIONS = [
  {
    id: 'ext-analytics',
    name: 'Advanced Analytics',
    slug: 'advanced-analytics',
    description: 'Detailed dashboard analytics with charts, user journey tracking, and export capabilities.',
    version: '2.1.0',
    author: 'CMS Team',
    icon: '📊',
    rating: 4.8,
    downloads: '1.2k',
    verified: true
  },
  {
    id: 'ext-newsletter',
    name: 'Newsletter Manager',
    slug: 'newsletter-manager',
    description: 'Create, schedule, and send newsletters directly from your CMS. Includes templates.',
    version: '1.0.5',
    author: 'EmailPro',
    icon: '📧',
    rating: 4.5,
    downloads: '850',
    verified: true
  },
  {
    id: 'ext-backup',
    name: 'Auto Backup',
    slug: 'auto-backup',
    description: 'Automated daily backups of your content to secure storage. Restore with one click.',
    version: '1.2.0',
    author: 'SysAdmin',
    icon: '💾',
    rating: 4.9,
    downloads: '2k',
    verified: true
  },
  {
    id: 'ext-seo-pro',
    name: 'SEO Pro',
    slug: 'seo-pro',
    description: 'Advanced SEO tools, meta tag generator, sitemap management, and keyword analysis.',
    version: '3.0.1',
    author: 'SEO Master',
    icon: '🔍',
    rating: 4.7,
    downloads: '3.5k',
    verified: true
  }
];

function ExtensionMarketplace({ onInstall }) {
  const { toast } = useToast();
  const { user } = useAuth();
  const { currentTenant } = useTenant();
  const [installing, setInstalling] = useState(null);

  const handleInstall = async (ext) => {
    setInstalling(ext.id);

    // Simulate network delay
    await new Promise(resolve => setTimeout(resolve, 1500));

    try {
      const payload = {
        name: ext.name,
        slug: ext.slug,
        description: ext.description,
        version: ext.version,
        author: ext.author,
        icon: ext.icon,
        is_active: true,
        created_by: user.id,
        config: { installed_from: 'marketplace', original_id: ext.id },
        tenant_id: currentTenant?.id || null
      };

      const { error } = await supabase
        .from('extensions')
        .insert([payload]);

      if (error) {
        if (error.code === '23505') { // Unique violation
          throw new Error("This extension is already installed.");
        }
        throw error;
      }

      toast({
        title: "Installation Complete",
        description: `${ext.name} has been successfully installed and activated.`
      });

      if (onInstall) onInstall();

    } catch (error) {
      toast({
        variant: "destructive",
        title: "Installation Failed",
        description: error.message
      });
    } finally {
      setInstalling(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="bg-primary/5 border border-primary/20 rounded-xl p-8 py-10 shadow-sm mb-8 relative overflow-hidden">
        <div className="absolute top-0 right-0 p-12 opacity-5">
          <div className="w-64 h-64 rounded-full bg-primary blur-3xl"></div>
        </div>
        <h2 className="text-3xl font-bold mb-2 text-foreground">Extension Marketplace</h2>
        <p className="text-muted-foreground max-w-2xl text-lg">
          Discover and install plugins to supercharge your CMS. From analytics to SEO,
          find the tools you need to grow.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
        {MARKETPLACE_EXTENSIONS.map((ext) => (
          <div key={ext.id} className="bg-card rounded-xl border border-border shadow-sm hover:shadow-md transition-shadow flex flex-col group">
            <div className="p-6 flex-1">
              <div className="flex justify-between items-start mb-4">
                <div className="w-12 h-12 bg-muted border border-border rounded-xl flex items-center justify-center text-2xl shadow-sm text-foreground">
                  {ext.icon}
                </div>
                {ext.verified && (
                  <Badge variant="secondary" className="bg-primary/10 text-primary border-primary/20 flex gap-1">
                    <ShieldCheck className="w-3 h-3" /> Verified
                  </Badge>
                )}
              </div>

              <h3 className="text-lg font-bold text-foreground mb-2 group-hover:text-primary transition-colors">{ext.name}</h3>
              <p className="text-muted-foreground text-sm mb-4 leading-relaxed">
                {ext.description}
              </p>

              <div className="flex items-center gap-4 text-xs text-muted-foreground font-medium">
                <div className="flex items-center gap-1 text-amber-500">
                  <Star className="w-3 h-3 fill-current" />
                  <span>{ext.rating}</span>
                </div>
                <span>{ext.downloads} installs</span>
                <span>v{ext.version}</span>
              </div>
            </div>

            <div className="p-4 bg-muted/30 border-t border-border rounded-b-xl">
              <Button
                className="w-full"
                onClick={() => handleInstall(ext)}
                disabled={!!installing}
              >
                {installing === ext.id ? (
                  'Installing...'
                ) : (
                  <>
                    <Download className="w-4 h-4 mr-2" />
                    Install Extension
                  </>
                )}
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default ExtensionMarketplace;
