import { Search, Loader2, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

/**
 * Standardized Search Input with Minimum Character Enforcement
 * 
 * @param {string} value - Current query value
 * @param {function} onChange - Handler for query changes (e.target.value)
 * @param {function} onClear - Handler for clearing search
 * @param {boolean} loading - Loading state
 * @param {boolean} isValid - Whether the query meets min length (or is empty)
 * @param {string} message - Validation message (optional)
 * @param {number} minLength - Minimum characters required (default: 5)
 * @param {string} placeholder - Placeholder text
 * @param {string} className - Additional classes
 */
const MinCharSearchInput = ({
    value,
    onChange,
    onClear,
    loading,
    isValid = true,
    message,
    minLength = 5,
    placeholder = "Search...",
    className
}) => {
    return (
        <div className={cn("relative w-full", className)}>
            <Search className="absolute left-3 top-3 h-4 w-4 text-slate-400" />
            <Input
                placeholder={`${placeholder} (${minLength}+ chars)`}
                value={value}
                onChange={onChange}
                className={cn(
                    "h-11 rounded-xl border-slate-200/70 bg-white/90 pl-9 pr-24 text-sm shadow-sm transition-colors focus:border-indigo-500/60 focus:ring-indigo-500/30 dark:border-slate-700/70 dark:bg-slate-950/60",
                    !isValid && value.length > 0
                        ? "border-destructive/50 focus-visible:ring-destructive/30 bg-destructive/5"
                        : ""
                )}
            />

            <div className="absolute right-3 top-3 flex items-center gap-2">
                {loading && <Loader2 className="h-4 w-4 animate-spin text-slate-400" />}

                {value && (
                    <button
                        onClick={onClear}
                        className="text-muted-foreground hover:text-foreground transition-colors"
                        type="button"
                        aria-label="Clear search"
                    >
                        <X className="h-4 w-4" />
                    </button>
                )}

                <span className={cn(
                    "text-xs font-mono transition-colors min-w-[3ch] text-right",
                    !isValid && value.length > 0 ? "text-destructive font-bold" : "text-muted-foreground"
                )}>
                    {value.length}/{minLength}
                </span>
            </div>

            {message && !isValid && value.length > 0 && (
                <div className="absolute top-full left-0 mt-1 text-xs text-destructive font-medium animate-in slide-in-from-top-1 px-1">
                    {message}
                </div>
            )}
        </div>
    );
};

export default MinCharSearchInput;
