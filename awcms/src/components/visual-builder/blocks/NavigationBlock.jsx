/**
 * NavigationBlock - Dynamic menu component for visual page builder
 * Fetches and displays public menus from the database
 */

import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, Menu as MenuIcon } from 'lucide-react';
import { supabase } from '@/lib/customSupabaseClient';
import { ColorPickerField } from '../fields/ColorPickerField';

// Field definitions for the Puck editor
export const NavigationBlockFields = {
    style: {
        type: 'select',
        label: 'Style',
        options: [
            { label: 'Horizontal', value: 'horizontal' },
            { label: 'Vertical', value: 'vertical' }
        ]
    },
    alignment: {
        type: 'select',
        label: 'Alignment',
        options: [
            { label: 'Left', value: 'left' },
            { label: 'Center', value: 'center' },
            { label: 'Right', value: 'right' }
        ]
    },
    showDropdowns: {
        type: 'radio',
        label: 'Show Dropdowns',
        options: [
            { label: 'Yes', value: true },
            { label: 'No', value: false }
        ]
    },
    fontSize: {
        type: 'select',
        label: 'Font Size',
        options: [
            { label: 'Small', value: 'sm' },
            { label: 'Medium', value: 'base' },
            { label: 'Large', value: 'lg' }
        ]
    },
    gap: {
        type: 'select',
        label: 'Item Spacing',
        options: [
            { label: 'Tight', value: 4 },
            { label: 'Normal', value: 8 },
            { label: 'Loose', value: 16 }
        ]
    },
    linkColor: { type: 'custom', label: 'Link Color', render: ColorPickerField },
    hoverColor: { type: 'custom', label: 'Hover Color', render: ColorPickerField }
};

export const NavigationBlock = ({
    style = 'horizontal',
    alignment = 'left',
    showDropdowns = true,
    fontSize = 'base',
    gap = 8,
    _linkColor,
    _hoverColor
}) => {
    const [menus, setMenus] = useState([]);
    const [loading, setLoading] = useState(true);
    const [openDropdown, setOpenDropdown] = useState(null);

    useEffect(() => {
        fetchMenus();
    }, []);

    const fetchMenus = async () => {
        try {
            const { data, error } = await supabase
                .from('menus')
                .select('*')
                .eq('is_active', true)
                .eq('is_public', true)
                .is('deleted_at', null)
                .order('order', { ascending: true });

            if (error) throw error;

            if (data) {
                // Build tree structure
                const menuMap = {};
                data.forEach(m => menuMap[m.id] = { ...m, children: [] });

                const rootMenus = [];
                data.forEach(m => {
                    if (m.parent_id && menuMap[m.parent_id]) {
                        menuMap[m.parent_id].children.push(menuMap[m.id]);
                    } else {
                        rootMenus.push(menuMap[m.id]);
                    }
                });

                // Sort children
                rootMenus.forEach(r => r.children.sort((a, b) => a.order - b.order));
                setMenus(rootMenus);
            }
        } catch (err) {
            console.error('Error fetching navigation menus:', err);
        } finally {
            setLoading(false);
        }
    };

    const alignmentClass = {
        left: 'justify-start',
        center: 'justify-center',
        right: 'justify-end'
    };

    const fontSizeClass = {
        sm: 'text-sm',
        base: 'text-base',
        lg: 'text-lg'
    };

    if (loading) {
        return (
            <nav className="py-4">
                <div className={`flex ${alignmentClass[alignment]} gap-${gap}`}>
                    <div className="h-4 w-20 bg-slate-200 rounded animate-pulse"></div>
                    <div className="h-4 w-16 bg-slate-200 rounded animate-pulse"></div>
                    <div className="h-4 w-24 bg-slate-200 rounded animate-pulse"></div>
                </div>
            </nav>
        );
    }

    if (menus.length === 0) {
        return (
            <nav className="py-4 text-center text-slate-400 text-sm">
                <MenuIcon className="w-5 h-5 mx-auto mb-1 opacity-50" />
                No menu items available
            </nav>
        );
    }

    // Vertical layout
    if (style === 'vertical') {
        return (
            <nav className="py-4">
                <ul className={`flex flex-col ${fontSizeClass[fontSize]}`} style={{ gap: `${gap}px` }}>
                    {menus.map(menu => (
                        <li key={menu.id}>
                            <Link
                                to={menu.url}
                                className="block px-3 py-2 rounded-lg text-slate-700 hover:text-blue-600 hover:bg-blue-50 transition-colors font-medium"
                            >
                                {menu.label}
                            </Link>
                            {showDropdowns && menu.children && menu.children.length > 0 && (
                                <ul className="pl-4 mt-1 space-y-1 border-l-2 border-slate-100 ml-3">
                                    {menu.children.map(child => (
                                        <li key={child.id}>
                                            <Link
                                                to={child.url}
                                                className="block px-3 py-1.5 text-slate-500 hover:text-blue-600 transition-colors"
                                            >
                                                {child.label}
                                            </Link>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </li>
                    ))}
                </ul>
            </nav>
        );
    }

    // Horizontal layout (default)
    return (
        <nav className="py-4">
            <ul className={`flex flex-wrap ${alignmentClass[alignment]} ${fontSizeClass[fontSize]}`} style={{ gap: `${gap * 2}px` }}>
                {menus.map(menu => {
                    const hasChildren = menu.children && menu.children.length > 0;

                    return (
                        <li key={menu.id} className="relative group">
                            {hasChildren && showDropdowns ? (
                                <>
                                    <button
                                        className="flex items-center gap-1 px-3 py-2 rounded-lg text-slate-700 hover:text-blue-600 hover:bg-blue-50 transition-colors font-medium"
                                        onMouseEnter={() => setOpenDropdown(menu.id)}
                                        onMouseLeave={() => setOpenDropdown(null)}
                                    >
                                        {menu.label}
                                        <ChevronDown className="w-3.5 h-3.5 opacity-70" />
                                    </button>
                                    <div
                                        className={`absolute top-full left-0 mt-1 w-48 bg-white rounded-xl shadow-lg border border-slate-200 overflow-hidden z-50 transition-all duration-200 ${openDropdown === menu.id ? 'opacity-100 visible translate-y-0' : 'opacity-0 invisible translate-y-2'
                                            }`}
                                        onMouseEnter={() => setOpenDropdown(menu.id)}
                                        onMouseLeave={() => setOpenDropdown(null)}
                                    >
                                        <div className="p-1">
                                            {menu.children.map(child => (
                                                <Link
                                                    key={child.id}
                                                    to={child.url}
                                                    className="block px-3 py-2 text-sm text-slate-600 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                                                >
                                                    {child.label}
                                                </Link>
                                            ))}
                                        </div>
                                    </div>
                                </>
                            ) : (
                                <Link
                                    to={menu.url}
                                    className="block px-3 py-2 rounded-lg text-slate-700 hover:text-blue-600 hover:bg-blue-50 transition-colors font-medium"
                                >
                                    {menu.label}
                                </Link>
                            )}
                        </li>
                    );
                })}
            </ul>
        </nav>
    );
};

export default NavigationBlock;
