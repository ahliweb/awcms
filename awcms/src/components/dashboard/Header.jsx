
import React from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Menu, LogOut, User } from 'lucide-react';
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
import { TenantBadge } from '@/templates/awadmintemplate01';
import { DarkModeToggle } from '@/components/ui/DarkModeToggle';

function Header({ toggleSidebar, onNavigate }) {
  const { user, signOut } = useAuth();
  const { t } = useTranslation();
  const { isPlatformAdmin, userRole } = usePermissions();
  const { currentTenant } = useTenant();

  const getInitials = (email) => {
    return email ? email.substring(0, 2).toUpperCase() : 'U';
  };

  return (
    <header className="bg-background border-b border-border shadow-sm z-30">
      <div className="flex items-center justify-between px-6 py-4">
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            size="icon"
            onClick={toggleSidebar}
            className="lg:hidden text-slate-600 hover:text-slate-900"
          >
            <Menu className="w-6 h-6" />
          </Button>
          <div className="hidden md:block">
            <h1 className="text-xl font-bold text-slate-800">AWCMS Dashboard</h1>
            <p className="text-sm text-slate-500">{t('common.dashboard_subtitle')}</p>
          </div>
          {/* Tenant Context Badge for Platform Admins */}
          {isPlatformAdmin && (
            <div className="hidden lg:block ml-4">
              <TenantBadge tenant={currentTenant} />
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 md:gap-4">
          {/* Dark Mode Toggle */}
          <DarkModeToggle />

          <LanguageSelector />

          {/* Notification Dropdown */}
          <NotificationDropdown />

          <div className="h-8 w-px bg-slate-200 mx-1 hidden md:block"></div>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="flex items-center gap-3 pl-2 pr-4 py-2 h-auto hover:bg-slate-50 rounded-full border border-transparent hover:border-slate-200 transition-all">
                <Avatar className="w-9 h-9 border border-slate-200">
                  {(user?.user_metadata?.avatar_url) && (
                    <AvatarImage
                      src={user.user_metadata.avatar_url}
                      alt="Profile"
                      className="object-cover"
                    />
                  )}
                  <AvatarFallback className="bg-blue-600 text-white font-semibold">
                    {getInitials(user?.email)}
                  </AvatarFallback>
                </Avatar>
                <div className="hidden md:flex flex-col items-start text-sm">
                  <span className="font-semibold text-slate-800">{user?.email?.split('@')[0]}</span>
                  <span className="text-xs text-slate-500">Administrator</span>
                </div>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56 bg-white border-slate-200 text-slate-800 shadow-lg">
              <DropdownMenuLabel className="text-slate-900">{t('menu.profile')}</DropdownMenuLabel>
              <DropdownMenuSeparator className="bg-slate-100" />
              <DropdownMenuItem asChild className="focus:bg-slate-50 cursor-pointer">
                <Link to="/cmspanel/profile" className="flex items-center w-full">
                  <User className="w-4 h-4 mr-2 text-slate-500" />
                  {t('menu.profile')}
                </Link>
              </DropdownMenuItem>
              <DropdownMenuSeparator className="bg-slate-100" />
              <DropdownMenuItem onClick={signOut} className="text-red-600 focus:bg-red-50 focus:text-red-700 cursor-pointer">
                <LogOut className="w-4 h-4 mr-2" />
                {t('auth.logout')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  );
}

export default Header;
