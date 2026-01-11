
import React, { useState, useEffect } from 'react';
import { supabase } from '@/lib/customSupabaseClient'; // Use custom client for tenant headers
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { useToast } from '@/components/ui/use-toast';

const ResourceSelect = ({
    table,
    labelKey = 'name',
    valueKey = 'id',
    value,
    onChange,
    placeholder = "Select item...",
    filter = null // Optional filter object { column: 'value' } or function
}) => {
    const [items, setItems] = useState([]);
    const [loading, setLoading] = useState(false);
    const { toast } = useToast();

    const filterString = JSON.stringify(filter);

    useEffect(() => {
        if (!table) return;

        const fetchItems = async () => {
            setLoading(true);
            try {
                let query = supabase
                    .from(table)
                    .select(`${valueKey}, ${labelKey}`)
                    .is('deleted_at', null);

                // Apply simple equality filters if provided
                if (filter && typeof filter === 'object') {
                    Object.entries(filter).forEach(([key, val]) => {
                        query = query.eq(key, val);
                    });
                }

                // Default limit to prevent massive loads in dropdowns
                query = query.limit(100);

                console.log(`[ResourceSelect] Fetching ${table} with filter:`, filter);
                const { data, error } = await query;
                console.log(`[ResourceSelect] Fetched ${data?.length} items for ${table}`, data);

                if (error) throw error;
                setItems(data || []);
            } catch (err) {
                console.error(`Error fetching resources for ${table}:`, err);
                toast({
                    variant: "destructive",
                    title: "Error loading resources",
                    description: err.message
                });
            } finally {
                setLoading(false);
            }
        };

        fetchItems();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [table, labelKey, valueKey, filterString, toast]);

    return (
        <div className="flex flex-col gap-1">
            {loading ? (
                <div className="h-10 w-full border border-input bg-muted/50 rounded-md px-3 py-2 text-sm text-muted-foreground flex items-center">
                    Loading options...
                </div>
            ) : (
                <Select
                    value={value ? String(value) : ''}
                    onValueChange={onChange}
                    disabled={false}
                >
                    <SelectTrigger className="w-full">
                        <SelectValue placeholder={placeholder} />
                    </SelectTrigger>
                    <SelectContent>
                        {items.length === 0 ? (
                            <div className="p-2 text-sm text-center text-muted-foreground">No items found</div>
                        ) : (
                            items.map(item => (
                                <SelectItem key={item[valueKey]} value={String(item[valueKey])}>
                                    {item[labelKey] || `Item ${item[valueKey]}`}
                                </SelectItem>
                            ))
                        )}
                    </SelectContent>
                </Select>
            )}
        </div>
    );
};

export default ResourceSelect;
