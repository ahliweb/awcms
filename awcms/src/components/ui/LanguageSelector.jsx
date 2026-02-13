
import { useTranslation } from 'react-i18next';
import { Globe } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { supabase } from '@/lib/customSupabaseClient';

function LanguageSelector({ variant = "ghost" }) {
  const { i18n } = useTranslation();
  const { user } = useAuth();

  const changeLanguage = async (lng) => {
    i18n.changeLanguage(lng);
    localStorage.setItem('i18nextLng', lng);

    // Persist to DB if user is logged in
    if (user) {
      try {
        await supabase
          .from('users')
          .update({ language: lng })
          .eq('id', user.id);
      } catch (err) {
        console.error("Failed to save language preference to DB:", err);
      }
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant={variant} size="icon" className="rounded-full">
          <Globe className="w-5 h-5" />
          <span className="sr-only">Switch Language</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 z-[100]">
        <DropdownMenuItem
          onClick={() => changeLanguage('en')}
          className={i18n.language === 'en' ? 'bg-slate-100 font-bold' : ''}
        >
          🇺🇸 English
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => changeLanguage('id')}
          className={i18n.language === 'id' ? 'bg-slate-100 font-bold' : ''}
        >
          🇮🇩 Indonesia
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export default LanguageSelector;
