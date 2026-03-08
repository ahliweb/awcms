
import React, { useState, useEffect, useRef } from 'react';
import { X, Plus, Tag, Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/lib/customSupabaseClient';
import { cn } from '@/lib/utils';
import { useToast } from '@/components/ui/use-toast';
import { useTenant } from '@/contexts/TenantContext';

const TAG_INPUT_ID = 'tag-input-field';

const TagInput = ({
  value = [],
  onChange,
  placeholder = "Add tags...",
  className,
  disabled = false
}) => {
  const { toast } = useToast();
  const { currentTenant } = useTenant();
  const [inputValue, setInputValue] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [loading, setLoading] = useState(false);
  const wrapperRef = useRef(null);

  const safeValue = React.useMemo(() => Array.isArray(value) ? value : [], [value]);

  // Debounced autocomplete
  useEffect(() => {
    const fetchTags = async () => {
      if (inputValue.trim().length < 1) {
        setSuggestions([]);
        return;
      }

      setLoading(true);
      try {
        let query = supabase
          .from('tags')
          .select('id, name, color')
          .ilike('name', `%${inputValue}%`)
          .is('deleted_at', null)
          .eq('is_active', true);

        // Apply tenant filter if available
        if (currentTenant?.id) {
          query = query.eq('tenant_id', currentTenant.id);
        }

        const { data } = await query.limit(5);

        if (data) {
          const filtered = data.filter(t => !safeValue.includes(t.name));
          setSuggestions(filtered);
        }
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    };

    const timeoutId = setTimeout(fetchTags, 300);
    return () => clearTimeout(timeoutId);
  }, [inputValue, safeValue, currentTenant?.id]);

  // Outside click handler
  useEffect(() => {
    function handleClickOutside(event) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target)) {
        setShowSuggestions(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addTag(inputValue);
    } else if (e.key === 'Backspace' && inputValue === '' && safeValue.length > 0) {
      e.preventDefault();
      removeTag(safeValue.length - 1);
    } else if (e.key === 'Escape') {
      setShowSuggestions(false);
    }
  };

  const addTag = (tagName) => {
    if (disabled) return;
    const trimmed = tagName.trim();

    if (!trimmed) return;

    if (safeValue.includes(trimmed)) {
      toast({ description: `Tag "${trimmed}" is already added.`, duration: 2000 });
      setInputValue('');
      return;
    }

    onChange([...safeValue, trimmed]);
    setInputValue('');
    setSuggestions([]);
    setShowSuggestions(false);
  };

  const removeTag = (index) => {
    if (disabled) return;
    const newValue = [...safeValue];
    newValue.splice(index, 1);
    onChange(newValue);
  };

  return (
    <div ref={wrapperRef} className={cn("relative w-full", className)}>
      <div
        className={cn(
          "flex min-h-[42px] w-full flex-wrap items-center gap-2 rounded-md border border-slate-300 bg-white p-2 transition-all focus-within:border-transparent focus-within:ring-2 focus-within:ring-blue-500",
          disabled && "bg-slate-50 opacity-70 cursor-not-allowed"
        )}
        onClick={() => !disabled && document.getElementById(TAG_INPUT_ID)?.focus()}
      >
        {safeValue.map((tag, index) => (
          <Badge
            key={index}
            variant="secondary"
            className="flex items-center gap-1 px-2 py-1 text-sm font-normal bg-blue-50 text-blue-700 border border-blue-100"
          >
            <Tag className="w-3 h-3 opacity-50" />
            {tag}
            {!disabled && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); removeTag(index); }}
                className="ml-1 text-blue-400 hover:text-blue-600 hover:bg-blue-200 rounded-full p-0.5 transition-colors"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </Badge>
        ))}

        <input
          id={TAG_INPUT_ID}
          type="text"
          value={inputValue}
          onChange={(e) => {
            setInputValue(e.target.value);
            setShowSuggestions(true);
          }}
          onKeyDown={handleKeyDown}
          onFocus={() => !disabled && setShowSuggestions(true)}
          className="flex-1 min-w-[120px] bg-transparent outline-none text-sm text-slate-900 placeholder:text-slate-400 h-6"
          placeholder={safeValue.length === 0 ? placeholder : ""}
          disabled={disabled}
          autoComplete="off"
        />
      </div>

      {showSuggestions && inputValue.length > 0 && !disabled && (
        <div className="absolute z-50 w-full mt-1 bg-white rounded-md border border-slate-200 shadow-lg max-h-60 overflow-auto">
          {loading ? (
            <div className="flex items-center justify-center gap-2 p-3 text-center text-sm text-slate-500">
              <Loader2 className="w-3 h-3 animate-spin" /> Searching...
            </div>
          ) : suggestions.length > 0 ? (
            suggestions.map((suggestion) => (
              <div
                key={suggestion.id}
                className="flex cursor-pointer items-center gap-2 border-b border-slate-50 px-3 py-2 text-sm text-slate-700 hover:bg-blue-50 hover:text-blue-700 last:border-0"
                onClick={() => addTag(suggestion.name)}
              >
                <div
                  className={cn("w-2 h-2 rounded-full", !suggestion.color && "bg-slate-300")}
                  style={suggestion.color ? { backgroundColor: suggestion.color } : undefined}
                />
                <div className="flex min-w-0 flex-1 items-center justify-between gap-2">
                  <span className="truncate">{suggestion.name}</span>
                  {suggestion.color && (
                    <span className="font-mono text-[10px] uppercase text-slate-400">{suggestion.color}</span>
                  )}
                </div>
              </div>
            ))
          ) : (
            <div
              className="px-3 py-2 text-sm text-slate-500 hover:bg-slate-50 cursor-pointer flex items-center gap-2"
              onClick={() => addTag(inputValue)}
            >
              <Plus className="w-3 h-3" />
              Create new tag &quot;<span className="font-medium text-slate-800">{inputValue}</span>&quot;
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default TagInput;
