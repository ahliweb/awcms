import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  MessageSquare,
  Mail,
  Send,
  PlugZap,
  Eye,
  EyeOff,
  Save,
  Trash2,
} from 'lucide-react';
import { AdminPageLayout, PageHeader } from '@/templates/flowbite-admin';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { usePermissions } from '@/contexts/PermissionContext';
import { useNotificationChannels } from '@/hooks/useNotificationChannels';
import { useModules } from '@/hooks/useModules';

// ─── Channel meta ─────────────────────────────────────────────────────────────

const CHANNEL_META = {
  email: {
    label: 'Email (Mailketing)',
    icon: Mail,
    moduleSlug: 'email-notifications',
    description: 'Send transactional and marketing emails via Mailketing.',
    credentialFields: [
      { key: 'api_key', label: 'API Key', type: 'password', placeholder: 'mk_live_…' },
      { key: 'sender_id', label: 'Sender ID / List ID', type: 'text', placeholder: 'your-list-id' },
      { key: 'from_name', label: 'From Name', type: 'text', placeholder: 'AWCMS' },
      { key: 'from_email', label: 'From Email', type: 'text', placeholder: 'noreply@example.com' },
    ],
  },
  whatsapp: {
    label: 'WhatsApp (StarSender)',
    icon: MessageSquare,
    moduleSlug: 'whatsapp-notifications',
    description: 'Send WhatsApp messages via StarSender gateway.',
    credentialFields: [
      { key: 'api_token', label: 'Bearer Token', type: 'password', placeholder: 'starsender-api-token' },
      { key: 'sender_id', label: 'Sender ID', type: 'text', placeholder: 'your-sender-id' },
    ],
  },
  telegram: {
    label: 'Telegram Bot',
    icon: Send,
    moduleSlug: 'telegram-notifications',
    description: 'Send Telegram messages via a bot token.',
    credentialFields: [
      { key: 'bot_token', label: 'Bot Token', type: 'password', placeholder: '123456:ABC-DEF…' },
      { key: 'default_chat_id', label: 'Default Chat ID (optional)', type: 'text', placeholder: '-100123456789' },
    ],
  },
};

// ─── Module-disabled notice ───────────────────────────────────────────────────

function ModuleDisabledNotice({ channelType }) {
  const { hasPermission, isPlatformAdmin, isFullAccess } = usePermissions();
  const canViewModules = isPlatformAdmin || isFullAccess || hasPermission('platform.module.read');
  const meta = CHANNEL_META[channelType];

  return (
    <Card className="border-border/60 bg-card/70 shadow-sm">
      <CardContent className="space-y-4 p-6">
        <div className="flex items-start gap-3">
          <span className="rounded-xl border border-border/60 bg-muted p-3 text-muted-foreground">
            <PlugZap className="h-5 w-5" />
          </span>
          <div>
            <p className="font-semibold text-foreground">{meta.label} module is not active</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Enable the <strong>{meta.moduleSlug}</strong> module to configure this channel.
            </p>
          </div>
        </div>
        {canViewModules && (
          <Button asChild size="sm" variant="outline">
            <Link to="/cmspanel/modules">Open Modules</Link>
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Single channel form ──────────────────────────────────────────────────────

function ChannelForm({ channelType, channel, canManage, onSave, onToggle, onDelete, saving }) {
  const meta = CHANNEL_META[channelType];
  const Icon = meta.icon;

  // Build initial credential state from existing DB record or empty
  const initCreds = () => {
    const base = {};
    meta.credentialFields.forEach((f) => {
      base[f.key] = channel?.credentials?.[f.key] ?? '';
    });
    return base;
  };

  const [creds, setCreds] = useState(initCreds);
  const [displayName, setDisplayName] = useState(channel?.display_name ?? '');
  const [quotaPerDay, setQuotaPerDay] = useState(channel?.quota_per_day ?? '');
  const [showSecrets, setShowSecrets] = useState({});

  const toggleShowSecret = (key) =>
    setShowSecrets((prev) => ({ ...prev, [key]: !prev[key] }));

  const handleSave = () => {
    onSave({
      channel_type: channelType,
      credentials: creds,
      enabled: channel?.enabled ?? false,
      quota_per_day: quotaPerDay !== '' ? Number(quotaPerDay) : null,
      display_name: displayName || null,
    });
  };

  return (
    <Card className="border-border/60 bg-card shadow-sm">
      <CardHeader className="flex flex-row items-center justify-between gap-4 pb-2">
        <div className="flex items-center gap-3">
          <span className="rounded-xl border border-border/60 bg-muted p-2.5 text-foreground">
            <Icon className="h-5 w-5" />
          </span>
          <div>
            <CardTitle className="text-base">{meta.label}</CardTitle>
            <CardDescription className="text-xs">{meta.description}</CardDescription>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {channel && (
            <Badge
              className={
                channel.enabled
                  ? 'border-transparent bg-primary/10 text-primary'
                  : 'border-transparent bg-muted text-muted-foreground'
              }
            >
              {channel.enabled ? 'Enabled' : 'Disabled'}
            </Badge>
          )}
          {channel && canManage && (
            <Switch
              checked={channel.enabled ?? false}
              onCheckedChange={() => onToggle(channel.id, channel.enabled)}
              aria-label={`Toggle ${meta.label}`}
            />
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-4 pt-4">
        {/* Display name */}
        <div className="space-y-1.5">
          <Label htmlFor={`${channelType}-display-name`} className="text-sm font-medium">
            Display Name <span className="text-muted-foreground">(optional)</span>
          </Label>
          <Input
            id={`${channelType}-display-name`}
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder={meta.label}
            disabled={!canManage}
          />
        </div>

        {/* Credential fields */}
        {meta.credentialFields.map((field) => (
          <div key={field.key} className="space-y-1.5">
            <Label htmlFor={`${channelType}-${field.key}`} className="text-sm font-medium">
              {field.label}
            </Label>
            <div className="relative">
              <Input
                id={`${channelType}-${field.key}`}
                type={field.type === 'password' && !showSecrets[field.key] ? 'password' : 'text'}
                value={creds[field.key] ?? ''}
                onChange={(e) =>
                  setCreds((prev) => ({ ...prev, [field.key]: e.target.value }))
                }
                placeholder={field.placeholder}
                disabled={!canManage}
                className={field.type === 'password' ? 'pr-10' : ''}
              />
              {field.type === 'password' && canManage && (
                <button
                  type="button"
                  onClick={() => toggleShowSecret(field.key)}
                  className="absolute inset-y-0 right-3 flex items-center text-muted-foreground hover:text-foreground"
                  tabIndex={-1}
                >
                  {showSecrets[field.key] ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              )}
            </div>
          </div>
        ))}

        {/* Daily quota */}
        <div className="space-y-1.5">
          <Label htmlFor={`${channelType}-quota`} className="text-sm font-medium">
            Daily quota <span className="text-muted-foreground">(leave blank for unlimited)</span>
          </Label>
          <Input
            id={`${channelType}-quota`}
            type="number"
            min={0}
            value={quotaPerDay}
            onChange={(e) => setQuotaPerDay(e.target.value)}
            placeholder="e.g. 500"
            disabled={!canManage}
            className="max-w-[180px]"
          />
        </div>

        {/* Actions */}
        {canManage && (
          <div className="flex items-center gap-2 pt-2">
            <Button onClick={handleSave} disabled={saving} size="sm">
              <Save className="mr-2 h-4 w-4" />
              {saving ? 'Saving…' : 'Save'}
            </Button>

            {channel && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="outline" size="sm" className="text-destructive border-destructive/40 hover:bg-destructive/10">
                    <Trash2 className="mr-2 h-4 w-4" />
                    Remove
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Remove {meta.label} configuration?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This will delete the stored credentials for this channel. Messages already
                      dispatched are not affected. You can re-add the configuration at any time.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={() => onDelete(channel.id)}
                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    >
                      Remove
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function NotificationChannelsManager() {
  const {
    channels,
    loading,
    saving,
    canManage,
    canRead,
    saveChannel,
    toggleChannel,
    deleteChannel,
    getChannelByType,
  } = useNotificationChannels();

  const { isModuleEnabled } = useModules();

  if (!canRead) {
    return (
      <AdminPageLayout requiredPermission="tenant.notifications.read">
        <PageHeader
          title="Notification Channels"
          description="Manage per-tenant outbound notification channel credentials."
          icon={MessageSquare}
          breadcrumbs={[{ label: 'Settings' }, { label: 'Notification Channels', icon: MessageSquare }]}
        />
      </AdminPageLayout>
    );
  }

  return (
    <AdminPageLayout requiredPermission="tenant.notifications.read">
      <PageHeader
        title="Notification Channels"
        description="Configure outbound messaging channels: Email, WhatsApp, and Telegram. Credentials are stored per tenant and routed through the async queue."
        icon={MessageSquare}
        breadcrumbs={[{ label: 'Settings' }, { label: 'Notification Channels', icon: MessageSquare }]}
        actions={
          <Button asChild variant="outline" size="sm">
            <Link to="/cmspanel/notification-dispatches">View Dispatch Log</Link>
          </Button>
        }
      />

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-primary" />
        </div>
      ) : (
        <div className="space-y-6">
          {Object.keys(CHANNEL_META).map((channelType) => {
            const meta = CHANNEL_META[channelType];
            const moduleActive = isModuleEnabled(meta.moduleSlug);
            const channel = getChannelByType(channelType);

            if (!moduleActive) {
              return (
                <div key={channelType}>
                  <ModuleDisabledNotice channelType={channelType} />
                </div>
              );
            }

            return (
              <ChannelForm
                key={channelType}
                channelType={channelType}
                channel={channel}
                canManage={canManage}
                saving={saving}
                onSave={saveChannel}
                onToggle={toggleChannel}
                onDelete={deleteChannel}
              />
            );
          })}
        </div>
      )}
    </AdminPageLayout>
  );
}
