
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Menu, LogOut, User, Building2, ShieldCheck } from 'lucide-react';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { usePermissions } from '@/contexts/PermissionContext';
import { useTenant } from '@/contexts/TenantContext';
import { Button } from '@/components/ui/button';
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

function Header({ toggleSidebar, _onNavigate }) {
  const { user, signOut } = useAuth();
  const { t } = useTranslation();
  const { isPlatformAdmin } = usePermissions();
  const { currentTenant } = useTenant();

  const getInitials = (email) => {
    return email ? email.substring(0, 2).toUpperCase() : 'U';
  };

  return (
    <header className="relative sticky top-0 z-[60] border-b border-border/60 bg-background/80 shadow-[0_8px_24px_-24px_rgba(15,23,42,0.8)] backdrop-blur-xl supports-[backdrop-filter]:bg-background/70">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/45 to-transparent" />

      <div className="flex items-center justify-between gap-3 px-4 py-3.5 sm:px-6 lg:px-8">
        <div className="flex min-w-0 items-center gap-3 sm:gap-4">
          <Button
            variant="ghost"
            size="icon"
            onClick={toggleSidebar}
            className="h-10 w-10 rounded-xl border border-border/60 bg-card/80 text-muted-foreground hover:bg-accent hover:text-foreground lg:hidden"
          >
            <Menu className="w-6 h-6" />
          </Button>

          <div className="flex min-w-0 items-center gap-3">
            <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-sky-500 via-blue-500 to-indigo-600 p-2 text-white shadow-md shadow-blue-500/30">
              <ShieldCheck className="h-full w-full" />
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold tracking-tight text-foreground">AWCMS Admin</p>
              <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">Control Center</p>
            </div>
          </div>

          {/* Tenant Context Badge for Platform Admins */}
          {isPlatformAdmin && currentTenant && (
            <div className="hidden lg:flex items-center gap-2 rounded-full border border-primary/25 bg-primary/10 px-3 py-1.5 text-primary shadow-sm dark:bg-primary/20">
              <Building2 className="w-4 h-4" />
              <span className="max-w-[220px] truncate text-xs font-semibold uppercase tracking-[0.08em]">
                {currentTenant.name || 'Primary Tenant'}
              </span>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 sm:gap-3">
          <div className="flex items-center gap-1 rounded-xl border border-border/60 bg-card/75 px-1.5 py-1 shadow-sm backdrop-blur-sm">
            <DarkModeToggle />
            <LanguageSelector />
            <NotificationDropdown />
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger className="relative flex h-10 w-10 items-center justify-center rounded-full focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 transition-opacity hover:opacity-90">
              <Avatar className="h-10 w-10 cursor-pointer border-2 border-primary/25 ring-2 ring-background shadow-md transition-colors hover:border-primary/60">
                {(user?.user_metadata?.avatar_url) ? (
                  <AvatarImage
                    src={user.user_metadata.avatar_url}
                    alt="Profile"
                    className="object-cover"
                  />
                ) : (
                  <AvatarFallback className="bg-primary/10 text-primary font-bold">
                    {getInitials(user?.email)}
                  </AvatarFallback>
                )}
              </Avatar>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="z-[100] mt-2 w-64 overflow-hidden rounded-xl border border-border/70 bg-popover/95 p-0 shadow-2xl backdrop-blur-xl" align="end" forceMount>
              {/* Profile Header Section */}
              <div className="flex flex-col items-center gap-2 border-b border-border/50 bg-muted/30 px-6 py-5 text-center">
                <Avatar className="h-16 w-16 mb-2 border-4 border-background shadow-sm">
                  {(user?.user_metadata?.avatar_url) ? (
                    <AvatarImage src={user.user_metadata.avatar_url} className="object-cover" />
                  ) : (
                    <AvatarFallback className="text-xl bg-primary/10 text-primary font-bold">
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
