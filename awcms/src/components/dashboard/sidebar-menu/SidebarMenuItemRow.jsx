import { createElement } from 'react';
import { Reorder } from 'framer-motion';
import {
  Edit2,
  Eye,
  EyeOff,
  FolderOpen,
  GripVertical,
  Puzzle,
  Settings2,
  FileText,
} from 'lucide-react';
import { getIconComponent } from '@/lib/adminIcons';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';

function SidebarMenuItemRow({
  item,
  canManage,
  onEdit,
  onToggleVisibility,
  t,
}) {
  const iconComponent = getIconComponent(item.icon);
  const inputId = `visible-${item.id}`;

  const isExtension = item.source === 'extension';
  const isPlugin = item.source === 'plugin';
  const isResource = item.source === 'resource' || item.is_resource_fallback;
  const canEdit = canManage && !isExtension && !isPlugin && !isResource;
  const canToggle = canManage && !isPlugin;

  return (
    <Reorder.Item
      key={item.id}
      value={item}
      dragListener={canManage}
      className={`flex items-center gap-4 rounded-lg border bg-card p-3 shadow-sm transition-all ${item.is_visible ? 'border-border' : 'border-border bg-muted/30 opacity-75'} ${canManage ? 'cursor-grab active:cursor-grabbing hover:border-primary/50 hover:shadow-md' : 'cursor-default'}`}
    >
      {canManage ? (
        <div className="p-1 text-muted-foreground hover:text-foreground">
          <GripVertical className="h-5 w-5" />
        </div>
      ) : (
        <div className="h-5 w-5" />
      )}

      <div className={`rounded-md p-2 ${item.is_visible ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'}`}>
        {createElement(iconComponent, { className: 'h-5 w-5' })}
      </div>

      <div className="min-w-0 flex-1">
        <div className="mb-1 flex items-center gap-2">
          <span className={`truncate font-medium ${item.is_visible ? 'text-foreground' : 'text-muted-foreground line-through'}`}>
            {item.label}
          </span>
          <Badge variant="outline" className="text-[10px] font-mono text-muted-foreground">
            {item.key}
          </Badge>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <div className="flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-muted-foreground">
            <FolderOpen className="h-3 w-3" />
            <span className="max-w-[100px] truncate">{item.group_label || 'General'}</span>
          </div>

          {item.permission && (
            <span className="flex items-center rounded border border-amber-100 bg-amber-50 px-1.5 py-0.5 text-amber-600 dark:border-amber-900/20 dark:bg-amber-900/10 dark:text-amber-500">
              <Settings2 className="mr-1 h-3 w-3" />
              {item.permission}
            </span>
          )}

          {item.source === 'extension' && (
            <span className="flex items-center rounded border border-indigo-100 bg-indigo-50 px-1.5 py-0.5 text-indigo-600 dark:border-indigo-900/20 dark:bg-indigo-900/10 dark:text-indigo-400">
              <Puzzle className="mr-1 h-3 w-3" />
              {t('sidebar_manager.module')}
            </span>
          )}

          {item.source === 'plugin' && (
            <span className="flex items-center rounded border border-purple-100 bg-purple-50 px-1.5 py-0.5 text-purple-600 dark:border-purple-900/20 dark:bg-purple-900/10 dark:text-purple-400">
              <Puzzle className="mr-1 h-3 w-3" />
              Plugin
            </span>
          )}

          {item.source === 'resource' && (
            <span className="flex items-center rounded border border-blue-100 bg-blue-50 px-1.5 py-0.5 text-blue-600 dark:border-blue-900/20 dark:bg-blue-900/10 dark:text-blue-400">
              <FileText className="mr-1 h-3 w-3" />
              Resource
            </span>
          )}

          {(item.plugin_type === 'core' || item.is_core) && (
            <span className="flex items-center rounded border border-emerald-100 bg-emerald-50 px-1.5 py-0.5 text-emerald-600 dark:border-emerald-900/20 dark:bg-emerald-900/10 dark:text-emerald-400">
              <Puzzle className="mr-1 h-3 w-3" />
              {t('sidebar_manager.core')}
            </span>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2">
        {canManage && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onEdit(item)}
            disabled={!canEdit}
            className={!canEdit ? 'cursor-not-allowed text-muted-foreground opacity-50' : 'text-muted-foreground hover:text-primary'}
            title={!canEdit ? (isExtension ? t('sidebar_manager.managed_by_ext') : isPlugin ? t('sidebar_manager.managed_by_plugin') : t('sidebar_manager.edit_item')) : t('sidebar_manager.edit_item')}
          >
            <Edit2 className="h-4 w-4" />
          </Button>
        )}

        <div className="flex items-center gap-2 border-l border-border pl-2">
          <Label htmlFor={inputId} className="sr-only">Visibility</Label>
          <Switch
            id={inputId}
            checked={item.is_visible}
            disabled={!canToggle}
            onCheckedChange={() => onToggleVisibility(item)}
          />
          {item.is_visible ? (
            <Eye className="h-4 w-4 text-muted-foreground" />
          ) : (
            <EyeOff className="h-4 w-4 text-muted-foreground/50" />
          )}
        </div>
      </div>
    </Reorder.Item>
  );
}

export default SidebarMenuItemRow;
