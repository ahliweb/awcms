
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Menu, LogOut, User, Building2 } from 'lucide-react';
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
    <header className="sticky top-0 z-[60] bg-background/80 backdrop-blur border-b border-border/70 shadow-sm">
      <div className="flex items-center justify-between px-6 py-4">
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            size="icon"
            onClick={toggleSidebar}
            className="lg:hidden text-muted-foreground hover:text-foreground"
          >
            <Menu className="w-6 h-6" />
          </Button>
          <div className="hidden md:block">
            {/* Title removed: Handled by individual pages via PageHeader */}
          </div>
          {/* Tenant Context Badge for Platform Admins */}
          {isPlatformAdmin && currentTenant && (
            <div className="hidden lg:flex items-center gap-2 ml-4 px-3 py-1.5 rounded-full bg-primary/10 dark:bg-primary/20 border border-primary/20 dark:border-primary/30">
              <Building2 className="w-4 h-4 text-primary" />
              <span className="text-sm font-medium text-primary">{currentTenant.name || 'Primary Tenant'}</span>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 md:gap-4">
          {/* Dark Mode Toggle */}
          <DarkModeToggle />

          <LanguageSelector />

          {/* Notification Dropdown */}
          <NotificationDropdown />

          <div className="h-8 w-px bg-border mx-1 hidden md:block"></div>

          <DropdownMenu>
            <DropdownMenuTrigger className="relative h-10 w-10 rounded-full hover:opacity-80 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 transition-opacity flex items-center justify-center">
              <Avatar className="h-10 w-10 border-2 border-primary/20 hover:border-primary transition-colors ring-2 ring-background shadow-md cursor-pointer">
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
            <DropdownMenuContent className="w-64 mt-2 p-0 bg-white dark:bg-slate-900/95 backdrop-blur-xl border border-slate-200 dark:border-slate-800 shadow-2xl rounded-xl overflow-hidden z-[100]" align="end" forceMount>
              {/* Profile Header Section */}
              <div className="px-6 py-5 bg-muted/30 border-b border-border/50 flex flex-col items-center text-center gap-2">
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

                <DropdownMenuItem asChild className="rounded-lg focus:bg-primary/10 focus:text-primary cursor-pointer transition-colors px-3 py-2.5">
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
                  className="rounded-lg text-red-600 focus:bg-red-50 dark:focus:bg-red-950/30 focus:text-red-600 cursor-pointer transition-colors px-3 py-2.5 font-medium"
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
