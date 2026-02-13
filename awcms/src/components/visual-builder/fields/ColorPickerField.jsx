/**
 * Custom Color Picker Field for Puck Editor
 * Provides visual hex color selection with live preview
 */


export const ColorPickerField = ({ field, name, value, onChange }) => {
    const handleChange = (e) => {
        onChange(e.target.value);
    };

    const handleTextChange = (e) => {
        const val = e.target.value;
        // Allow partial typing
        onChange(val);
    };

    return (
        <div className="space-y-2">
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
                {field.label || name}
            </label>
            <div className="flex items-center gap-2">
                {/* Color picker input */}
                <input
                    type="color"
                    value={value || '#000000'}
                    onChange={handleChange}
                    className="h-10 w-20 rounded border border-slate-300 dark:border-slate-600 cursor-pointer bg-transparent"
                    title="Pick a color"
                />
                {/* Text input for hex code */}
                <input
                    type="text"
                    value={value || ''}
                    onChange={handleTextChange}
                    placeholder="#000000"
                    maxLength={7}
                    className="flex-1 px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 font-mono text-sm bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100"
                />
                {/* Preview swatch */}
                <div
                    className="w-10 h-10 rounded border border-slate-300 shadow-inner"
                    style={{ backgroundColor: value || '#000000' }}
                    title="Color preview"
                />
            </div>
            {field.description && (
                <p className="text-xs text-slate-500">{field.description}</p>
            )}
        </div>
    );
};

export default ColorPickerField;
