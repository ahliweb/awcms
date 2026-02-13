
import { cn } from '@/lib/utils';

const CategoryFilter = ({ categories, activeCategory, onSelect, vertical = false }) => {
  if (!categories || categories.length === 0) return null;

  return (
    <div className={cn("flex flex-wrap gap-2", vertical ? "flex-col items-start" : "flex-row")}>
      <button
        onClick={() => onSelect(null)}
        className={cn(
          "px-4 py-2 rounded-full text-sm font-medium transition-colors w-full md:w-auto text-left",
          !activeCategory
            ? 'bg-slate-900 text-white'
            : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'
        )}
      >
        All Categories
      </button>
      {categories.map(cat => (
        <button
          key={cat.id}
          onClick={() => onSelect(cat.id)}
          className={cn(
            "px-4 py-2 rounded-full text-sm font-medium transition-colors w-full md:w-auto text-left",
            activeCategory === cat.id
              ? 'bg-blue-600 text-white'
              : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'
          )}
        >
          {cat.name}
        </button>
      ))}
    </div>
  );
};

export default CategoryFilter;
