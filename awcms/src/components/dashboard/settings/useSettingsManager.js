import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/customSupabaseClient';
import { useTenant } from '@/contexts/TenantContext';

const toSnapshot = (value) => {
  try {
    return JSON.stringify(value ?? null);
  } catch {
    return String(value ?? '');
  }
};

const cloneValue = (value) => {
  if (value == null) return value;

  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return value;
  }
};

const parseStoredValue = (value, fallbackValue) => {
  if (value == null) return cloneValue(fallbackValue);

  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }

  return value;
};

const serializeStoredValue = (value) => {
  if (typeof value === 'string') {
    return value;
  }

  return JSON.stringify(value ?? null);
};

export function useSettingsRecord({
  settingKey,
  initialValue = {},
  settingType = 'json',
  tenantId: tenantIdOverride,
  enabled = true,
  loadRecord,
  saveRecord,
}) {
  const { currentTenant } = useTenant();
  const tenantId = tenantIdOverride ?? currentTenant?.id ?? null;
  const [value, setValue] = useState(cloneValue(initialValue));
  const [loading, setLoading] = useState(Boolean(enabled));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [savedSnapshot, setSavedSnapshot] = useState(toSnapshot(initialValue));

  const reload = useCallback(async () => {
    if (!enabled) {
      setLoading(false);
      return cloneValue(initialValue);
    }

    if (!tenantId) {
      setValue(cloneValue(initialValue));
      setSavedSnapshot(toSnapshot(initialValue));
      setLoading(false);
      return cloneValue(initialValue);
    }

    setLoading(true);
    setError(null);

    try {
      const nextValue = loadRecord
        ? await loadRecord({ tenantId, settingKey, initialValue, supabase })
        : await (async () => {
            const { data, error: loadError } = await supabase
              .from('settings')
              .select('value')
              .eq('tenant_id', tenantId)
              .eq('key', settingKey)
              .is('deleted_at', null)
              .maybeSingle();

            if (loadError) throw loadError;

            return parseStoredValue(data?.value, initialValue);
          })();

      const normalized = nextValue == null ? cloneValue(initialValue) : nextValue;
      setValue(cloneValue(normalized));
      setSavedSnapshot(toSnapshot(normalized));
      return normalized;
    } catch (loadError) {
      setError(loadError);
      throw loadError;
    } finally {
      setLoading(false);
    }
  }, [enabled, initialValue, loadRecord, settingKey, tenantId]);

  useEffect(() => {
    reload().catch(() => {});
  }, [reload]);

  const save = useCallback(async (nextValue = value) => {
    if (!enabled || !tenantId) {
      return nextValue;
    }

    setSaving(true);
    setError(null);

    try {
      if (saveRecord) {
        await saveRecord({ tenantId, settingKey, value: nextValue, supabase });
      } else {
        const { error: saveError } = await supabase.from('settings').upsert(
          {
            tenant_id: tenantId,
            key: settingKey,
            value: serializeStoredValue(nextValue),
            type: settingType,
            deleted_at: null,
          },
          { onConflict: 'tenant_id,key' }
        );

        if (saveError) throw saveError;
      }

      setValue(cloneValue(nextValue));
      setSavedSnapshot(toSnapshot(nextValue));
      return nextValue;
    } catch (saveError) {
      setError(saveError);
      throw saveError;
    } finally {
      setSaving(false);
    }
  }, [enabled, saveRecord, settingKey, settingType, tenantId, value]);

  const hasChanges = useMemo(() => toSnapshot(value) !== savedSnapshot, [savedSnapshot, value]);

  return {
    tenantId,
    value,
    setValue,
    loading,
    saving,
    error,
    hasChanges,
    reload,
    save,
  };
}

export function useSettingsCollection({
  settingKeys,
  initialValue = {},
  tenantId: tenantIdOverride,
  enabled = true,
  settingType = 'json',
}) {
  const { currentTenant } = useTenant();
  const tenantId = tenantIdOverride ?? currentTenant?.id ?? null;
  const [value, setValue] = useState(cloneValue(initialValue));
  const [loading, setLoading] = useState(Boolean(enabled));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [savedSnapshot, setSavedSnapshot] = useState(toSnapshot(initialValue));

  const keyEntries = useMemo(() => Object.entries(settingKeys || {}), [settingKeys]);

  const reload = useCallback(async () => {
    if (!enabled) {
      setLoading(false);
      return cloneValue(initialValue);
    }

    if (!tenantId || keyEntries.length === 0) {
      setValue(cloneValue(initialValue));
      setSavedSnapshot(toSnapshot(initialValue));
      setLoading(false);
      return cloneValue(initialValue);
    }

    setLoading(true);
    setError(null);

    try {
      const requestedKeys = keyEntries.map(([, key]) => key);
      const { data, error: loadError } = await supabase
        .from('settings')
        .select('key, value')
        .eq('tenant_id', tenantId)
        .in('key', requestedKeys)
        .is('deleted_at', null);

      if (loadError) throw loadError;

      const keyMap = new Map((data || []).map((row) => [row.key, parseStoredValue(row.value)]));
      const nextValue = keyEntries.reduce((acc, [section, key]) => {
        acc[section] = keyMap.has(key) ? keyMap.get(key) : cloneValue(initialValue[section] ?? {});
        return acc;
      }, {});

      setValue(cloneValue(nextValue));
      setSavedSnapshot(toSnapshot(nextValue));
      return nextValue;
    } catch (loadError) {
      setError(loadError);
      throw loadError;
    } finally {
      setLoading(false);
    }
  }, [enabled, initialValue, keyEntries, tenantId]);

  useEffect(() => {
    reload().catch(() => {});
  }, [reload]);

  const save = useCallback(async (nextValue = value) => {
    if (!enabled || !tenantId || keyEntries.length === 0) {
      return nextValue;
    }

    setSaving(true);
    setError(null);

    try {
      const updates = keyEntries.map(([section, key]) => ({
        tenant_id: tenantId,
        key,
        value: serializeStoredValue(nextValue?.[section] ?? initialValue?.[section] ?? {}),
        type: settingType,
        deleted_at: null,
      }));

      const { error: saveError } = await supabase.from('settings').upsert(updates, {
        onConflict: 'tenant_id,key',
      });

      if (saveError) throw saveError;

      setValue(cloneValue(nextValue));
      setSavedSnapshot(toSnapshot(nextValue));
      return nextValue;
    } catch (saveError) {
      setError(saveError);
      throw saveError;
    } finally {
      setSaving(false);
    }
  }, [enabled, initialValue, keyEntries, settingType, tenantId, value]);

  const updateField = useCallback((section, field, fieldValue) => {
    setValue((prev) => ({
      ...prev,
      [section]: {
        ...(prev?.[section] || {}),
        [field]: fieldValue,
      },
    }));
  }, []);

  const updateSection = useCallback((section, sectionValue) => {
    setValue((prev) => ({
      ...prev,
      [section]: sectionValue,
    }));
  }, []);

  const hasChanges = useMemo(() => toSnapshot(value) !== savedSnapshot, [savedSnapshot, value]);

  return {
    tenantId,
    value,
    setValue,
    loading,
    saving,
    error,
    hasChanges,
    reload,
    save,
    updateField,
    updateSection,
  };
}
