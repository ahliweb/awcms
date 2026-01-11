
import React, { useState, useEffect, useRef } from 'react';
import { X, Plus, Tag, Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/lib/customSupabaseClient';
import { cn } from '@/lib/utils';
import { useToast } from '@/components/ui/use-toast';
import { useTenant } from '@/contexts/TenantContext';

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
          "flex flex-wrap gap-2 p-2 min-h-[42px] rounded-md border border-slate-300 bg-white transition-all w-full items-center focus-within:ring-2 focus-within:ring-blue-500 focus-within:border-transparent",
          disabled && "bg-slate-50 opacity-70 cursor-not-allowed"
        )}
        onClick={() => !disabled && document.getElementById('tag-input-field')?.focus()}
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
          id="tag-input-field"
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
            <div className="p-3 text-center text-slate-500 text-sm flex items-center justify-center gap-2">
              <Loader2 className="w-3 h-3 animate-spin" /> Searching...
            </div>
          ) : suggestions.length > 0 ? (
            suggestions.map((suggestion) => (
              <div
                key={suggestion.id}
                className="px-3 py-2 text-sm text-slate-700 hover:bg-blue-50 hover:text-blue-700 cursor-pointer flex items-center gap-2 border-b border-slate-50 last:border-0"
                onClick={() => addTag(suggestion.name)}
              >
                <div className="w-2 h-2 rounded-full" style={{ backgroundColor: suggestion.color || '#cbd5e1' }} />
                {suggestion.name}
              </div>
            ))
          ) : (
            <div
              className="px-3 py-2 text-sm text-slate-500 hover:bg-slate-50 cursor-pointer flex items-center gap-2"
              onClick={() => addTag(inputValue)}
            >
              <Plus className="w-3 h-3" />
              Create new tag "<span className="font-medium text-slate-800">{inputValue}</span>"
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default TagInput;
