/**
 * Custom Generic Select Field for Puck
 * Supports static options or async fetching from Supabase
 */

import { useEffect, useState } from 'react';
import { Label } from '@/components/ui/label';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { supabase } from '@/lib/customSupabaseClient';
import { Loader2 } from 'lucide-react';

export const SelectField = ({ field, value, onChange, name }) => {
    const [options, setOptions] = useState(field.options || []);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        // If options are provided statically, use them
        if (field.options) {
            setOptions(field.options);
            return;
        }

        // If a fetch configuration is provided, load data
        if (field.fetchConfig) {
            const fetchOptions = async () => {
                setLoading(true);
                try {
                    const { table, labelField = 'title', valueField = 'id', filter = {} } = field.fetchConfig;

                    let query = supabase.from(table).select(`${labelField}, ${valueField}`);

                    // Apply filters if any
                    Object.entries(filter).forEach(([key, val]) => {
                        query = query.eq(key, val);
                    });

                    const { data, error } = await query;

                    if (error) throw error;

                    const mappedOptions = data.map(item => ({
                        label: item[labelField],
                        value: item[valueField]
                    }));

                    setOptions(mappedOptions);
                } catch (err) {
                    console.error('Error fetching options:', err);
                    setOptions([]);
                } finally {
                    setLoading(false);
                }
            };

            fetchOptions();
        }
    }, [field.options, field.fetchConfig]);

    return (
        <div className="space-y-2">
            <Label>{field.label || name}</Label>
            <Select
                value={value || ''}
                onValueChange={onChange}
                disabled={loading}
            >
                <SelectTrigger className="w-full">
                    {loading ? (
                        <div className="flex items-center gap-2 text-slate-500">
                            <Loader2 className="w-3 h-3 animate-spin" />
                            <span>Loading...</span>
                        </div>
                    ) : (
                        <SelectValue placeholder="Select an option" />
                    )}
                </SelectTrigger>
                <SelectContent>
                    {options.length === 0 && !loading ? (
                        <div className="p-2 text-sm text-slate-500 text-center">No options found</div>
                    ) : (
                        options.map((opt) => (
                            <SelectItem key={opt.value} value={opt.value}>
                                {opt.label}
                            </SelectItem>
                        ))
                    )}
                </SelectContent>
            </Select>
        </div>
    );
};
