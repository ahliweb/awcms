import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { CORE_WIDGETS } from '@/lib/widgetRegistry';

const WidgetEditor = ({ type, config, onChange, onSave, onCancel }) => {
    const { t } = useTranslation();
    // Clone config to local state
    const [localConfig, setLocalConfig] = useState(config || {});

    // Helper to update local config
    const updateField = (key, value) => {
        setLocalConfig(prev => ({ ...prev, [key]: value }));
    };

    // Notify parent on change if needed (for live preview?)
    useEffect(() => {
        onChange && onChange(localConfig);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [localConfig]);

    // Render form based on type
    const renderFields = () => {
        switch (type) {
            case 'core/text':
                return (
                    <div className="space-y-4">
                        <div className="grid gap-2">
                            <Label>{t('widgets_manager.editor.content_label')}</Label>
                            <Textarea
                                value={localConfig.content || ''}
                                onChange={e => updateField('content', e.target.value)}
                                rows={8}
                            />
                        </div>
                        <div className="flex items-center space-x-2">
                            <Switch
                                id="isHtml"
                                checked={localConfig.isHtml || false}
                                onCheckedChange={checked => updateField('isHtml', checked)}
                            />
                            <Label htmlFor="isHtml">{t('widgets_manager.editor.render_html_label')}</Label>
                        </div>
                    </div>
                );
            case 'core/image':
                return (
                    <div className="space-y-4">
                        <div className="grid gap-2">
                            <Label>{t('widgets_manager.editor.image_url_label')}</Label>
                            <Input
                                value={localConfig.url || ''}
                                onChange={e => updateField('url', e.target.value)}
                            />
                        </div>
                        <div className="grid gap-2">
                            <Label>{t('widgets_manager.editor.alt_text_label')}</Label>
                            <Input
                                value={localConfig.alt || ''}
                                onChange={e => updateField('alt', e.target.value)}
                            />
                        </div>
                    </div>
                );
            case 'core/button':
                return (
                    <div className="space-y-4">
                        <div className="grid gap-2">
                            <Label>{t('widgets_manager.editor.button_text_label')}</Label>
                            <Input
                                value={localConfig.text || ''}
                                onChange={e => updateField('text', e.target.value)}
                            />
                        </div>
                        <div className="grid gap-2">
                            <Label>{t('widgets_manager.editor.url_label')}</Label>
                            <Input
                                value={localConfig.url || '#'}
                                onChange={e => updateField('url', e.target.value)}
                            />
                        </div>
                    </div>
                );
            case 'core/menu':
                return (
                    <div className="space-y-4">
                        <div className="grid gap-2">
                            <Label>{t('widgets_manager.editor.menu_id_label')}</Label>
                            <Input
                                value={localConfig.menuId || ''}
                                onChange={e => updateField('menuId', e.target.value)}
                                placeholder={t('widgets_manager.editor.placeholder_uuid')}
                            />
                            <p className="text-xs text-muted-foreground">{t('widgets_manager.editor.menu_help')}</p>
                        </div>
                    </div>
                );
            default:
                return (
                    <div className="space-y-4">
                        <div className="p-4 bg-yellow-50 text-yellow-800 rounded text-sm">
                            {t('widgets_manager.editor.generic_notice')}
                        </div>
                        <div className="grid gap-2">
                            <Label>{t('widgets_manager.editor.config_json_label')}</Label>
                            <Textarea
                                value={JSON.stringify(localConfig, null, 2)}
                                onChange={e => {
                                    try {
                                        setLocalConfig(JSON.parse(e.target.value));
                                    } catch {
                                        // ignore parse error while typing
                                    }
                                }}
                                rows={10}
                                className="font-mono text-xs"
                            />
                        </div>
                    </div>
                );
        }
    };

    return (
        <div className="space-y-6">
            <div className="border-b pb-4 mb-4">
                <h3 className="font-medium text-lg">
                    {t('widgets_manager.editor.edit_prefix')} {CORE_WIDGETS.find(w => w.type === type)?.name || type}
                </h3>
            </div>

            {renderFields()}

            <div className="flex justify-end gap-2 pt-4 border-t mt-4">
                <Button variant="outline" onClick={onCancel}>{t('common.cancel')}</Button>
                <Button onClick={() => onSave(localConfig)}>{t('widgets_manager.editor.save_button')}</Button>
            </div>
        </div>
    );
};

export default WidgetEditor;
