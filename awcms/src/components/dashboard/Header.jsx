
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Menu, LogOut, User, Building2, ShieldCheck, CloudCog } from 'lucide-react';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { usePermissions } from '@/contexts/PermissionContext';
import { useTenant } from '@/contexts/TenantContext';
import { supabase } from '@/lib/customSupabaseClient';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import LanguageSelector from '@/components/ui/LanguageSelector';
import { NotificationDropdown } from '@/components/dashboard/notifications/NotificationDropdown';
import { DarkModeToggle } from '@/components/ui/DarkModeToggle';
import { RELEASE_LABEL } from '@/lib/version';

function Header({ toggleSidebar, _onNavigate }) {
  const { user, signOut } = useAuth();
  const { t } = useTranslation();
  const { isPlatformAdmin } = usePermissions();
  const { currentTenant, resolvedTenant, switchTenantScope } = useTenant();
  const [tenantOptions, setTenantOptions] = useState([]);

  useEffect(() => {
    if (!isPlatformAdmin) return;

    let ignore = false;

    const loadTenants = async () => {
      const { data } = await supabase
        .from('tenants')
        .select('id, slug, name, status')
        .is('deleted_at', null)
        .order('name', { ascending: true });

      if (!ignore) {
        setTenantOptions(data || []);
      }
    };

    loadTenants();
    return () => {
      ignore = true;
    };
  }, [isPlatformAdmin]);

  const getInitials = (email) => {
    return email ? email.substring(0, 2).toUpperCase() : 'U';
  };

  return (
    <header className="relative sticky top-0 z-[60] h-16 border-b border-slate-900/10 bg-background/70 backdrop-blur-2xl supports-[backdrop-filter]:bg-background/55 dark:border-white/10">
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-primary/45 to-transparent" />

      <div className="flex h-full items-center justify-between gap-3 px-4 sm:px-6 lg:px-8">
        {/* Left: branding + mobile menu */}
        <div className="flex shrink-0 items-center gap-3 sm:gap-4">
          <Button
            variant="ghost"
            size="icon"
            onClick={toggleSidebar}
            className="h-10 w-10 rounded-2xl border border-slate-900/10 bg-white/80 text-muted-foreground hover:bg-accent hover:text-foreground lg:hidden dark:border-white/10 dark:bg-slate-900/70"
          >
            <Menu className="w-6 h-6" />
          </Button>

          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-white/60 bg-slate-950 text-white shadow-[0_16px_35px_-20px_rgba(15,23,42,0.9)] dark:border-white/10">
              <ShieldCheck className="h-full w-full" />
            </div>
            <div className="min-w-0 hidden sm:block">
              <p className="truncate text-sm font-semibold tracking-[0.02em] text-foreground">AWCMS / EmDash</p>
              <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                <span>Editorial Command</span>
                <span className="text-[10px] tracking-[0.12em] text-muted-foreground/80">{RELEASE_LABEL}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Center: Tenant Switcher (Platform Admins only) */}
        {isPlatformAdmin && currentTenant && (
          <div className="hidden xl:flex flex-1 items-center justify-center px-6">
            <div className="flex items-center gap-2.5 rounded-[1.35rem] border border-slate-900/10 bg-white/78 px-3.5 py-1.5 shadow-[0_14px_34px_-24px_rgba(15,23,42,0.55)] ring-1 ring-slate-900/5 dark:border-white/10 dark:bg-slate-900/72 dark:ring-white/5 w-full max-w-[520px]">
              <div className="flex shrink-0 items-center gap-2 text-primary">
                <div className="flex h-8 w-8 items-center justify-center rounded-xl border border-primary/15 bg-primary/12">
                  <Building2 className="h-3.5 w-3.5" />
                </div>
                <div className="leading-none">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-primary/60">Active Scope</p>
                </div>
              </div>
              <div className="h-4 w-px shrink-0 bg-primary/20" />
              <Select
                value={currentTenant.id}
                onValueChange={(value) => {
                  switchTenantScope(value);
                }}
              >
                <SelectTrigger className="h-9 flex-1 rounded-2xl border-0 bg-transparent px-2 text-sm font-semibold text-foreground shadow-none focus:ring-0 focus:ring-offset-0 hover:bg-primary/5">
                  <SelectValue placeholder="Select tenant scope" />
                </SelectTrigger>
                <SelectContent align="center" className="min-w-[320px]">
                  {resolvedTenant?.id ? (
                    <SelectItem value={resolvedTenant.id}>
                      {resolvedTenant.name || resolvedTenant.slug || 'Resolved Tenant'}
                    </SelectItem>
                  ) : null}
                  {tenantOptions
                    .filter((tenant) => tenant.id !== resolvedTenant?.id)
                    .map((tenant) => (
                      <SelectItem key={tenant.id} value={tenant.id}>
                        {tenant.name} ({tenant.slug})
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        )}

        {/* Spacer when no tenant switcher (keeps right actions pinned) */}
        {!(isPlatformAdmin && currentTenant) && <div className="flex-1" />}

        <div className="flex items-center gap-2 sm:gap-3">
          <div className="flex items-center gap-1 rounded-[1.15rem] border border-slate-900/10 bg-white/76 px-1.5 py-1 shadow-[0_12px_28px_-22px_rgba(15,23,42,0.55)] backdrop-blur-sm dark:border-white/10 dark:bg-slate-900/72">
            <DarkModeToggle />
            <LanguageSelector />
            <NotificationDropdown />
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger className="relative flex h-10 w-10 items-center justify-center rounded-full focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 transition-opacity hover:opacity-90">
              <Avatar className="h-10 w-10 cursor-pointer border-2 border-slate-950/10 ring-2 ring-background shadow-md transition-colors hover:border-primary/60 dark:border-white/10">
                {(user?.user_metadata?.avatar_url) ? (
                  <AvatarImage
                    src={user.user_metadata.avatar_url}
                    alt="Profile"
                    className="object-cover"
                  />
                ) : (
                    <AvatarFallback className="bg-slate-950 text-white font-bold dark:bg-primary/20">
                    {getInitials(user?.email)}
                  </AvatarFallback>
                )}
              </Avatar>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="z-[100] mt-2 w-64 overflow-hidden rounded-[1.5rem] border border-slate-900/10 bg-popover/96 p-0 shadow-[0_30px_80px_-30px_rgba(15,23,42,0.6)] backdrop-blur-2xl dark:border-white/10" align="end" forceMount>
              {/* Profile Header Section */}
              <div className="flex flex-col items-center gap-2 border-b border-border/50 bg-[linear-gradient(180deg,rgba(15,23,42,0.04),transparent)] px-6 py-5 text-center dark:bg-[linear-gradient(180deg,rgba(255,255,255,0.04),transparent)]">
                <Avatar className="h-16 w-16 mb-2 border-4 border-background shadow-sm">
                  {(user?.user_metadata?.avatar_url) ? (
                    <AvatarImage src={user.user_metadata.avatar_url} className="object-cover" />
                  ) : (
                    <AvatarFallback className="text-xl bg-slate-950 text-white font-bold dark:bg-primary/20">
                      {getInitials(user?.email)}
                    </AvatarFallback>
                  )}
                </Avatar>
                <div className="space-y-0.5">
                  <p className="font-semibold text-foreground text-sm truncate max-w-[200px]">
                    {user?.email}
                  </p>
                  <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">
                    {isPlatformAdmin ? 'Platform Admin' : 'Tenant Admin'}
                  </p>
                </div>
              </div>

              <div className="p-2 space-y-1">
                <DropdownMenuLabel className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-3 py-2">
                  {t('menu.account', 'Account')}
                </DropdownMenuLabel>

                {isPlatformAdmin && (
                  <DropdownMenuItem asChild className="cursor-pointer rounded-lg px-3 py-2.5 transition-colors focus:bg-primary/10 focus:text-primary">
                    <Link to="/cmspanel/platform/diagnostics" className="flex items-center w-full font-medium">
                      <CloudCog className="w-4 h-4 mr-3" />
                      {t('menu.platform_diagnostics', 'Platform Diagnostics')}
                    </Link>
                  </DropdownMenuItem>
                )}

                <DropdownMenuItem asChild className="cursor-pointer rounded-lg px-3 py-2.5 transition-colors focus:bg-primary/10 focus:text-primary">
                  <Link to="/cmspanel/profile" className="flex items-center w-full font-medium">
                    <User className="w-4 h-4 mr-3" />
                    {t('menu.profile')}
                  </Link>
                </DropdownMenuItem>
              </div>

              <DropdownMenuSeparator className="bg-border/50 my-1 mx-2" />

              <div className="p-2 pb-3">
                <DropdownMenuItem
                  onClick={signOut}
                  className="cursor-pointer rounded-lg px-3 py-2.5 font-medium text-red-600 transition-colors focus:bg-red-50 focus:text-red-600 dark:focus:bg-red-950/30"
                >
                  <LogOut className="w-4 h-4 mr-3" />
                  {t('auth.logout')}
                </DropdownMenuItem>
              </div>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  );
}

export default Header;
