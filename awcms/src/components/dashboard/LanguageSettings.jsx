
import React, { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import { Globe, Check, ShieldAlert } from 'lucide-react';
import { usePermissions } from '@/contexts/PermissionContext';
import { useToast } from '@/components/ui/use-toast';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { supabase } from '@/lib/customSupabaseClient';

function LanguageSettings() {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const { toast } = useToast();
  const { hasPermission } = usePermissions();

  const currentLang = i18n.language;

  useEffect(() => {
    // Add Google Translate Script if not exists
    if (!document.getElementById('google-translate-script')) {
      const script = document.createElement('script');
      script.id = 'google-translate-script';
      script.src = '//translate.google.com/translate_a/element.js?cb=googleTranslateElementInit';
      document.body.appendChild(script);

      window.googleTranslateElementInit = () => {
        new window.google.translate.TranslateElement(
          { pageLanguage: 'id', layout: window.google.translate.TranslateElement.InlineLayout.SIMPLE },
          'google_translate_element'
        );
      };
    }
  }, []);

  if (!hasPermission('tenant.languages.read')) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] bg-white rounded-xl border border-slate-200 p-12 text-center">
        <div className="p-4 bg-red-50 rounded-full mb-4">
          <ShieldAlert className="w-12 h-12 text-red-500" />
        </div>
        <h3 className="text-xl font-bold text-slate-800">Access Denied</h3>
        <p className="text-slate-500 mt-2">You do not have permission to view language settings.</p>
      </div>
    );
  }

  const handleLanguageChange = async (lang) => {
    i18n.changeLanguage(lang);
    localStorage.setItem('i18nextLng', lang);

    if (user) {
      const { error } = await supabase
        .from('users')
        .update({ language: lang })
        .eq('id', user.id);

      if (error) {
        toast({
          variant: "destructive",
          title: t('common.error'),
          description: "Failed to save language preference"
        });
      } else {
        toast({
          title: t('common.success'),
          description: t('settings.save_preferences') + " success"
        });
      }
    }
  };

  return (
    <div className="max-w-4xl mx-auto p-6">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="space-y-8"
      >
        <div>
          <h2 className="text-3xl font-bold text-slate-900">{t('settings.language_title')}</h2>
          <p className="text-slate-600">{t('settings.language_desc')}</p>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
          <h3 className="text-lg font-bold mb-4 flex items-center gap-2">
            <Globe className="w-5 h-5 text-blue-600" />
            {t('settings.select_language')}
          </h3>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <button
              onClick={() => handleLanguageChange('id')}
              className={`flex items-center justify-between p-4 rounded-lg border transition-all ${currentLang === 'id'
                ? 'border-blue-600 bg-blue-50 ring-1 ring-blue-600'
                : 'border-slate-200 hover:border-blue-300 hover:bg-slate-50'
                }`}
            >
              <div className="flex items-center gap-3">
                <span className="text-2xl">🇮🇩</span>
                <div className="text-left">
                  <p className="font-bold text-slate-900">Bahasa Indonesia</p>
                  <p className="text-xs text-slate-500">Default</p>
                </div>
              </div>
              {currentLang === 'id' && <Check className="w-5 h-5 text-blue-600" />}
            </button>

            <button
              onClick={() => handleLanguageChange('en')}
              className={`flex items-center justify-between p-4 rounded-lg border transition-all ${currentLang === 'en'
                ? 'border-blue-600 bg-blue-50 ring-1 ring-blue-600'
                : 'border-slate-200 hover:border-blue-300 hover:bg-slate-50'
                }`}
            >
              <div className="flex items-center gap-3">
                <span className="text-2xl">🇺🇸</span>
                <div className="text-left">
                  <p className="font-bold text-slate-900">English</p>
                  <p className="text-xs text-slate-500">US / International</p>
                </div>
              </div>
              {currentLang === 'en' && <Check className="w-5 h-5 text-blue-600" />}
            </button>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
          <h3 className="text-lg font-bold mb-2">{t('settings.google_translate')}</h3>
          <p className="text-slate-500 mb-4">{t('settings.google_translate_desc')}</p>

          <div className="p-4 bg-slate-50 rounded-lg border border-slate-200">
            <div id="google_translate_element"></div>
          </div>
        </div>
      </motion.div>
    </div>
  );
}

export default LanguageSettings;
