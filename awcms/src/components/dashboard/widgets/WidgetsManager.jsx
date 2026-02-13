import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Layers, Plus, Settings, Trash2, GripVertical, ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
    Dialog,
    DialogContent,
    DialogTrigger,
} from "@/components/ui/dialog";
import { useTemplates } from '@/hooks/useTemplates';
import { useWidgets } from '@/hooks/useWidgets';
import { getWidgets as getRegistryWidgets } from '@/lib/widgetRegistry';
import { usePermissions } from '@/contexts/PermissionContext';
import WidgetEditor from './WidgetEditor';

const WidgetsManager = () => {
    const { templateParts } = useTemplates();
    const { t } = useTranslation();
    const { hasPermission, isPlatformAdmin } = usePermissions();

    // Filter only widget areas
    const widgetAreas = templateParts.filter(p => p.type === 'widget_area');

    const [selectedAreaId, setSelectedAreaId] = useState(null);

    // Initial load: select first area if available and none selected
    React.useEffect(() => {
        if (!selectedAreaId && widgetAreas.length > 0) {
            setSelectedAreaId(widgetAreas[0].id);
        }
    }, [widgetAreas, selectedAreaId]);

    if (!hasPermission('tenant.widgets.read')) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[400px] bg-white rounded-xl border border-slate-200 p-12 text-center">
                <div className="p-4 bg-red-50 rounded-full mb-4">
                    <ShieldAlert className="w-12 h-12 text-red-500" />
                </div>
                <h3 className="text-xl font-bold text-slate-800">{t('common.access_denied')}</h3>
                <p className="text-slate-500 mt-2">{t('widgets_manager.access_denied_desc')}</p>
            </div>
        );
    }

    return (
        <div className="p-6 space-y-8">
            <div>
                <h1 className="text-3xl font-bold text-slate-900 flex items-center gap-2">
                    <Layers className="w-8 h-8 text-indigo-600" /> {t('widgets_manager.title')}
                </h1>
                <p className="text-slate-500 mt-1">{t('widgets_manager.subtitle')}</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                {/* Sidebar: Area Selector */}
                <div className="md:col-span-1 space-y-4">
                    <h3 className="font-semibold text-slate-900">{t('widgets_manager.areas_title')}</h3>
                    {widgetAreas.length === 0 ? (
                        <p className="text-sm text-slate-500">{t('widgets_manager.no_areas')}</p>
                    ) : (
                        <div className="space-y-1">
                            {widgetAreas.map(area => (
                                <button
                                    key={area.id}
                                    onClick={() => setSelectedAreaId(area.id)}
                                    className={`w-full text-left px-4 py-2 rounded-md text-sm font-medium transition-colors ${selectedAreaId === area.id
                                        ? 'bg-indigo-50 text-indigo-700'
                                        : 'text-slate-600 hover:bg-slate-50'
                                        }`}
                                >
                                    {area.name}
                                </button>
                            ))}
                        </div>
                    )}
                </div>

                {/* Main: Widgets List */}
                <div className="md:col-span-3">
                    {selectedAreaId ? (
                        <AreaEditor areaId={selectedAreaId} areaName={widgetAreas.find(a => a.id === selectedAreaId)?.name} isPlatformAdmin={isPlatformAdmin} />
                    ) : (
                        <div className="h-64 flex items-center justify-center border-2 border-dashed rounded-lg bg-slate-50 text-slate-400">
                            {t('widgets_manager.select_area_prompt')}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

const AreaEditor = ({ areaId, areaName, isPlatformAdmin }) => {
    const { t } = useTranslation();
    const { widgets, loading, addWidget, updateWidget, deleteWidget } = useWidgets(areaId);
    const availableWidgets = getRegistryWidgets();
    const [editingWidget, setEditingWidget] = useState(null);
    const [isAddOpen, setIsAddOpen] = useState(false);

    const handleAdd = async (type) => {
        const widgetDef = availableWidgets.find(w => w.type === type);
        await addWidget(type, widgetDef?.defaultConfig || {});
        setIsAddOpen(false);
    };

    const handleSaveEdit = async (config) => {
        if (editingWidget) {
            await updateWidget(editingWidget.id, { config });
            setEditingWidget(null);
        }
    };

    if (loading) return <div>{t('common.loading')}</div>;

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center border-b pb-4">
                <h2 className="text-xl font-semibold">{areaName}</h2>

                <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
                    <DialogTrigger asChild>
                        <Button>
                            <Plus className="w-4 h-4 mr-2" /> {t('widgets_manager.add_button')}
                        </Button>
                    </DialogTrigger>
                    <DialogContent>
                        <div className="grid gap-4 py-4">
                            <h3 className="font-semibold mb-2">{t('widgets_manager.select_type_title')}</h3>
                            <div className="grid grid-cols-2 gap-4">
                                {availableWidgets.map(w => (
                                    <button
                                        key={w.type}
                                        onClick={() => handleAdd(w.type)}
                                        className="flex flex-col items-center justify-center p-4 border rounded-lg hover:bg-slate-50 hover:border-indigo-200 transition-all"
                                    >
                                        <w.icon className="w-8 h-8 text-slate-500 mb-2" />
                                        <span className="text-sm font-medium">{w.name}</span>
                                    </button>
                                ))}
                            </div>
                        </div>
                    </DialogContent>
                </Dialog>
            </div>

            <div className="space-y-4">
                {widgets.length === 0 ? (
                    <div className="py-12 text-center text-slate-500 bg-slate-50 rounded-lg">
                        {t('widgets_manager.empty_area')}
                    </div>
                ) : (
                    widgets.map((widget, _index) => {
                        const def = availableWidgets.find(w => w.type === widget.type);
                        const Icon = def?.icon || Settings;

                        return (
                            <div key={widget.id} className="bg-white border rounded-lg p-4 shadow-sm flex items-center justify-between group">
                                <div className="flex items-center gap-4">
                                    <div className="cursor-move text-slate-300 hover:text-slate-500">
                                        <GripVertical className="w-5 h-5" />
                                    </div>
                                    <div className="p-2 bg-slate-100 rounded">
                                        <Icon className="w-5 h-5 text-slate-600" />
                                    </div>
                                    <div>
                                        <div className="font-medium text-slate-900">{def?.name || widget.type}</div>
                                        {isPlatformAdmin && (
                                            <span className="text-[10px] font-medium text-slate-600 bg-slate-100 px-1.5 py-0.5 rounded mr-2">
                                                {widget.tenant?.name || t('widgets_manager.unknown_tenant')}
                                            </span>
                                        )}
                                        <div className="text-xs text-slate-500 truncate max-w-[300px]">
                                            {/* Preview config values */}
                                            {Object.values(widget.config || {}).filter(v => typeof v === 'string').join(', ') || 'No content'}
                                        </div>
                                    </div>
                                </div>

                                <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                    <Dialog open={editingWidget?.id === widget.id} onOpenChange={(open) => !open && setEditingWidget(null)}>
                                        <DialogTrigger asChild>
                                            <Button variant="ghost" size="sm" onClick={() => setEditingWidget(widget)}>
                                                <Settings className="w-4 h-4" />
                                            </Button>
                                        </DialogTrigger>
                                        <DialogContent className="sm:max-w-[600px]">
                                            <WidgetEditor
                                                type={widget.type}
                                                config={widget.config}
                                                onSave={handleSaveEdit}
                                                onCancel={() => setEditingWidget(null)}
                                            />
                                        </DialogContent>
                                    </Dialog>

                                    <Button variant="ghost" size="sm" className="text-red-600 hover:text-red-700 hover:bg-red-50" onClick={() => deleteWidget(widget.id)}>
                                        <Trash2 className="w-4 h-4" />
                                    </Button>
                                </div>
                            </div>
                        );
                    })
                )}
            </div>
        </div>
    );
};

export default WidgetsManager;
