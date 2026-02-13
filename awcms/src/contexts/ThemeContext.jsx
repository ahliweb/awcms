
import { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '@/lib/customSupabaseClient';
import { applyTheme } from '@/lib/themeUtils';

const ThemeContext = createContext({
  currentTheme: null,
  refreshTheme: () => { },
  loading: true
});

export const useTheme = () => useContext(ThemeContext);

export const ThemeProvider = ({ children }) => {
  const [currentTheme, setCurrentTheme] = useState(null);
  const [loading, setLoading] = useState(true);

  const fetchActiveTheme = async () => {
    try {
      setLoading(true);
      const { data } = await supabase
        .from('themes')
        .select('*')
        .eq('is_active', true)
        .is('deleted_at', null)
        .maybeSingle();

      if (data && data.config) {
        setCurrentTheme(data);
        applyTheme(data.config);
      } else {
        // Fallback or leave as is (default CSS)
        console.log("No active theme found, using default.");
      }
    } catch (err) {
      console.error("Error fetching theme:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchActiveTheme();

    // Subscribe to theme changes to update in real-time
    const channel = supabase
      .channel('public:themes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'themes' }, (payload) => {
        // If the active theme changed or the currently active theme was updated
        if (payload.new && payload.new.is_active && !payload.new.deleted_at) {
          setCurrentTheme(payload.new);
          applyTheme(payload.new.config);
        }
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  return (
    <ThemeContext.Provider value={{ currentTheme, refreshTheme: fetchActiveTheme, loading }}>
      {children}
    </ThemeContext.Provider>
  );
};
