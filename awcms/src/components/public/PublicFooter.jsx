
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/lib/customSupabaseClient';
import { useTranslation } from 'react-i18next';
import { Facebook, Twitter, Instagram, Linkedin, MapPin, Phone, Mail } from 'lucide-react';
import { Button } from '@/components/ui/button';

function PublicFooter({ tenant }) {
  const [menus, setMenus] = useState([]);
  const { t, i18n } = useTranslation();

  useEffect(() => {
    if (tenant?.id) {
      fetchFooterMenus();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenant?.id]);

  useEffect(() => {
    setMenus(prevMenus => [...prevMenus]);
  }, [i18n.language]);

  const getTranslatedLabel = (label) => {
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

  const fetchFooterMenus = async () => {
    try {
      const { data, error } = await supabase.from('menus')
        .select('*')
        .eq('is_active', true)
        .eq('is_public', true)
        .eq('tenant_id', tenant.id) // Explicit Filter
        .is('deleted_at', null)
        .order('order', { ascending: true });

      if (error) return;

      if (data) {
        const menuMap = {};
        data.forEach(m => menuMap[m.id] = { ...m, children: [] });
        const roots = [];
        data.forEach(m => {
          if (m.parent_id && menuMap[m.parent_id]) {
            menuMap[m.parent_id].children.push(menuMap[m.id]);
          } else {
            roots.push(menuMap[m.id]);
          }
        });
        roots.sort((a, b) => a.order - b.order);
        roots.forEach(r => r.children.sort((a, b) => a.order - b.order));
        setMenus(roots);
      }
    } catch (e) {
      console.error("Error in footer menu fetch:", e);
    }
  };

  return (
    <footer className="bg-muted/80 text-muted-foreground py-16 border-t border-border font-sans">
      <div className="container mx-auto px-4">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-12 mb-12">
          {/* Brand Column */}
          <div className="space-y-6">
            <div className="flex items-center gap-2">
              <img src="/logo.svg" alt="AWCMS" className="h-8 w-auto object-contain opacity-80" />
              <span className="text-lg font-bold text-foreground">AWCMS</span>
            </div>
            <p className="text-sm leading-relaxed opacity-80">
              {t('public.footer_desc')}
            </p>
            <div className="flex gap-2">
              <Button variant="ghost" size="icon" className="hover:bg-background rounded-full"><Facebook className="w-4 h-4" /></Button>
              <Button variant="ghost" size="icon" className="hover:bg-background rounded-full"><Twitter className="w-4 h-4" /></Button>
              <Button variant="ghost" size="icon" className="hover:bg-background rounded-full"><Instagram className="w-4 h-4" /></Button>
              <Button variant="ghost" size="icon" className="hover:bg-background rounded-full"><Linkedin className="w-4 h-4" /></Button>
            </div>
          </div>

          {/* Dynamic Footer Columns */}
          {menus.slice(0, 2).map(menu => (
            <div key={menu.id}>
              <h4 className="font-bold text-foreground mb-6 text-lg tracking-wide">{getTranslatedLabel(menu.label)}</h4>
              {menu.children && menu.children.length > 0 && (
                <ul className="space-y-3 text-sm">
                  {menu.children.map(child => (
                    <li key={child.id}>
                      <Link to={child.url} className="hover:text-primary transition-colors">
                        {getTranslatedLabel(child.label)}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}

          {/* Contact Info */}
          <div>
            <h4 className="font-bold text-foreground mb-6 text-lg tracking-wide">{t('public.contact_us')}</h4>
            <ul className="space-y-4 text-sm">
              <li className="flex items-start gap-3">
                <MapPin className="w-5 h-5 text-primary shrink-0 mt-0.5" />
                <span>123 Digital Avenue,<br />Tech City, Jakarta 10220</span>
              </li>
              <li className="flex items-center gap-3">
                <Phone className="w-5 h-5 text-primary shrink-0" />
                <span>+62895 1338 0400</span>
              </li>
              <li className="flex items-center gap-3">
                <Mail className="w-5 h-5 text-primary shrink-0" />
                <span>hello@ahliweb.com</span>
              </li>
            </ul>
          </div>
        </div>

        <div className="pt-8 border-t border-border/50 flex flex-col md:flex-row justify-between items-center gap-4 text-xs opacity-70">
          <p>
            © {new Date().getFullYear()} AhliWeb. {t('public.all_rights_reserved')}
          </p>
          <div className="flex gap-6">
            <Link to="/privacy-policy" className="hover:text-foreground transition-colors">{t('public.privacy_policy')}</Link>
            <Link to="/terms" className="hover:text-foreground transition-colors">{t('public.terms_of_service')}</Link>
            <Link to="/sitemap" className="hover:text-foreground transition-colors">{t('public.sitemap')}</Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
export default PublicFooter;
