
import React, { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { motion, AnimatePresence } from 'framer-motion';
import { LogIn, Menu as MenuIcon, X, ChevronDown, LayoutDashboard } from 'lucide-react';
import LanguageSelector from '@/components/ui/LanguageSelector';
import { supabase } from '@/lib/customSupabaseClient';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { Button } from '@/components/ui/button';

// Pass tenant as prop from DynamicTemplate or Layout
const PublicHeader = ({ tenant }) => {
  const location = useLocation();
  const { t, i18n } = useTranslation();
  const { user } = useAuth();

  const [menus, setMenus] = useState([]);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > 20);
    };
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  useEffect(() => {
    if (tenant?.id) {
      fetchMenus();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, tenant?.id]);

  // Force re-render of menu items when language changes
  useEffect(() => {
    setMenus(prevMenus => [...prevMenus]);
  }, [i18n.language]);

  const getTranslatedLabel = (label) => {
    // ... (keep translation logic same)
    const lowerLabel = label.toLowerCase();
    const keyMap = {
      'home': 'menu.home',
      'beranda': 'menu.home',
      'blogs': 'menu.blogs',
      'blog': 'menu.blogs',
      'articles': 'menu.blogs',
      'artikel': 'menu.blogs',
      'products': 'menu.products',
      'produk': 'menu.products',
      'portfolio': 'menu.portfolio',
      'portofolio': 'menu.portfolio',
      'contact': 'menu.contacts',
      'kontak': 'menu.contacts',
      'about': 'menu.about',
      'tentang': 'menu.about',
      'services': 'menu.services',
      'layanan': 'menu.services'
    };

    if (keyMap[lowerLabel]) return t(keyMap[lowerLabel]);
    const directKey = `menu.${lowerLabel}`;
    if (i18n.exists(directKey)) return t(directKey);
    return label;
  };

  const fetchMenus = async () => {
    try {
      let roleName = 'public';
      let roleId = null;

      if (user) {
        const { data: userData } = await supabase
          .from('users')
          .select('role_id, roles(name, deleted_at)')
          .eq('id', user.id)
          .maybeSingle();

        if (userData && userData.roles && !userData.roles.deleted_at) {
          roleName = userData.roles.name;
          roleId = userData.role_id;
        }
      }

      if (!roleId && roleName === 'public') {
        const { data: publicRole } = await supabase
          .from('roles')
          .select('id')
          .eq('name', 'public')
          .is('deleted_at', null)
          .maybeSingle();
        if (publicRole) roleId = publicRole.id;
      }

      // CRITICAL: Filter by Tenant ID
      let query = supabase
        .from('menus')
        .select('*')
        .eq('is_active', true)
        .is('deleted_at', null)
        .eq('tenant_id', tenant.id) // Explicit Filter
        .order('order', { ascending: true });

      const { data: allMenus } = await query;

      if (!allMenus) {
        setMenus([]);
        return;
      }

      let allowedMenuIds = new Set();
      if (roleId) {
        // PERMISSIONS: Also filter permissions by tenant implicitly via roles
        const { data: perms } = await supabase
          .from('menu_permissions')
          .select('menu_id')
          .eq('role_id', roleId)
          .eq('can_view', true);

        if (perms) {
          perms.forEach(p => allowedMenuIds.add(p.menu_id));
        }
      }

      const visibleMenus = allMenus.filter(m => {
        if (roleName === 'super_admin') return true;
        if (allowedMenuIds.has(m.id)) return true;
        if (roleName === 'public' && m.is_public) return true;
        return false;
      });

      const menuMap = {};
      visibleMenus.forEach(m => menuMap[m.id] = { ...m, children: [] });
      const rootMenus = [];
      visibleMenus.forEach(m => {
        if (m.parent_id && menuMap[m.parent_id]) {
          menuMap[m.parent_id].children.push(menuMap[m.id]);
        } else {
          rootMenus.push(menuMap[m.id]);
        }
      });

      rootMenus.forEach(root => root.children.sort((a, b) => a.order - b.order));
      setMenus(rootMenus);

    } catch (err) {
      console.error("Menu fetch error", err);
    }
  };

  return (
    <header className={`sticky top-0 z-50 transition-all duration-300 border-b ${scrolled
      ? 'bg-background/95 backdrop-blur-md border-border shadow-sm'
      : 'bg-background/80 backdrop-blur-sm border-transparent'
      }`}>
      <div className="container mx-auto px-4 h-20 flex items-center justify-between">
        <Link to="/" className="flex items-center gap-2 group">
          <img
            src="/logo.svg"
            alt="AWCMS"
            className="h-10 w-auto object-contain"
          />
          <span className="text-xl font-bold text-foreground">AWCMS</span>
        </Link>

        {/* Desktop Nav */}
        <nav className="hidden lg:flex items-center gap-1">
          {menus.map((item) => {
            const hasChildren = item.children && item.children.length > 0;
            const isActive = location.pathname === item.url || item.children?.some(c => location.pathname === c.url);
            const translatedLabel = getTranslatedLabel(item.label);

            if (hasChildren) {
              return (
                <div key={item.id} className="relative group px-1">
                  <button className={`flex items-center gap-1 px-3 py-2 rounded-full text-sm font-medium transition-all ${isActive ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                    }`}>
                    {translatedLabel}
                    <ChevronDown className="w-3.5 h-3.5 opacity-70" />
                  </button>
                  <div className="absolute top-full left-0 mt-2 w-48 bg-popover rounded-xl shadow-xl border border-border overflow-hidden opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all transform translate-y-2 group-hover:translate-y-0 z-50">
                    <div className="p-1">
                      {item.children.map(child => (
                        <Link
                          key={child.id}
                          to={child.url}
                          className="block px-3 py-2 text-sm text-popover-foreground hover:bg-accent hover:text-accent-foreground rounded-lg transition-colors"
                        >
                          {getTranslatedLabel(child.label)}
                        </Link>
                      ))}
                    </div>
                  </div>
                </div>
              );
            }

            return (
              <Link
                key={item.id}
                to={item.url}
                className={`mx-1 px-3 py-2 rounded-full text-sm font-medium transition-all ${isActive
                  ? 'bg-primary/10 text-primary'
                  : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                  }`}
              >
                {translatedLabel}
              </Link>
            );
          })}
        </nav>

        <div className="flex items-center gap-3">
          <LanguageSelector />

          {user ? (
            <Link to="/cmspanel">
              <Button className="hidden sm:inline-flex rounded-full gap-2">
                <LayoutDashboard className="w-4 h-4" />
                <span className="hidden md:inline">{t('menu.dashboard')}</span>
              </Button>
            </Link>
          ) : (
            <Link to="/cmspanel/login">
              <Button variant="outline" className="hidden sm:inline-flex rounded-full gap-2">
                <LogIn className="w-4 h-4" />
                <span className="hidden md:inline">{t('auth.login')}</span>
              </Button>
            </Link>
          )}

          <button
            className="lg:hidden p-2 text-foreground hover:bg-accent rounded-full transition-colors"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          >
            {mobileMenuOpen ? <X className="w-6 h-6" /> : <MenuIcon className="w-6 h-6" />}
          </button>
        </div>
      </div>

      {/* Mobile Menu */}
      <AnimatePresence>
        {mobileMenuOpen && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="lg:hidden bg-background border-b border-border px-4 py-4 overflow-hidden"
          >
            <nav className="flex flex-col space-y-2">
              {menus.map(item => (
                <div key={item.id}>
                  <Link
                    to={item.url}
                    className={`block py-2 px-2 rounded-lg text-base font-medium ${location.pathname === item.url
                      ? 'bg-primary/10 text-primary'
                      : 'text-foreground hover:bg-accent'
                      }`}
                    onClick={() => setMobileMenuOpen(false)}
                  >
                    {getTranslatedLabel(item.label)}
                  </Link>
                  {item.children && item.children.length > 0 && (
                    <div className="pl-4 space-y-1 mt-1 border-l-2 border-border ml-2">
                      {item.children.map(child => (
                        <Link
                          key={child.id}
                          to={child.url}
                          className="block py-2 px-2 rounded-lg text-sm text-muted-foreground hover:bg-accent hover:text-primary"
                          onClick={() => setMobileMenuOpen(false)}
                        >
                          {getTranslatedLabel(child.label)}
                        </Link>
                      ))}
                    </div>
                  )}
                </div>
              ))}
              <div className="pt-4 mt-4 border-t border-border">
                <Link
                  to={user ? "/cmspanel" : "/cmspanel/login"}
                  onClick={() => setMobileMenuOpen(false)}
                >
                  <Button className="w-full gap-2">
                    {user ? <LayoutDashboard className="w-4 h-4" /> : <LogIn className="w-4 h-4" />}
                    {user ? t('menu.dashboard') : t('auth.login')}
                  </Button>
                </Link>
              </div>
            </nav>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
}

export default PublicHeader;
