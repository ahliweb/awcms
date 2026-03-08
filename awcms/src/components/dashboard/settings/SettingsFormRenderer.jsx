import { Fragment } from 'react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';

const getValueAtPath = (source, path) => {
  if (!path) return undefined;

  return String(path)
    .split('.')
    .reduce((acc, key) => (acc == null ? acc : acc[key]), source);
};

const setValueAtPath = (source, path, value) => {
  const keys = String(path || '').split('.').filter(Boolean);
  if (keys.length === 0) return source;

  const nextValue = Array.isArray(source) ? [...source] : { ...(source || {}) };
  let cursor = nextValue;

  keys.forEach((key, index) => {
    if (index === keys.length - 1) {
      cursor[key] = value;
      return;
    }

    const current = cursor[key];
    cursor[key] = Array.isArray(current) ? [...current] : { ...(current || {}) };
    cursor = cursor[key];
  });

  return nextValue;
};

const renderSchemaSlot = (slot, index) => {
  if (!slot) return null;

  if (slot.type === 'alert') {
    return (
      <Alert key={`${slot.type}-${index}`} variant={slot.variant === 'destructive' ? 'destructive' : 'default'}>
        {slot.title ? <AlertTitle>{slot.title}</AlertTitle> : null}
        {slot.description ? <AlertDescription>{slot.description}</AlertDescription> : null}
      </Alert>
    );
  }

  if (slot.type === 'card') {
    return (
      <Card key={`${slot.type}-${index}`} className="border-border/60 bg-card/70">
        <CardContent className="p-4">
          {slot.title ? <p className="text-sm font-semibold text-foreground">{slot.title}</p> : null}
          {slot.description ? <p className="mt-1 text-sm text-muted-foreground">{slot.description}</p> : null}
        </CardContent>
      </Card>
    );
  }

  return null;
};

function SettingsField({ field, value, onChange, disabled }) {
  const fieldName = field.name || field.key;
  const fieldValue = getValueAtPath(value, fieldName);
  const inputType = field.inputType || field.type || 'text';

  const handleValueChange = (nextFieldValue) => {
    onChange((prev) => setValueAtPath(prev, fieldName, nextFieldValue));
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1">
        <Label htmlFor={fieldName}>{field.label}</Label>
        {field.required ? <span className="text-destructive">*</span> : null}
      </div>

      {inputType === 'textarea' ? (
        <Textarea
          id={fieldName}
          rows={field.rows || 4}
          placeholder={field.placeholder}
          value={fieldValue ?? ''}
          onChange={(event) => handleValueChange(event.target.value)}
          disabled={disabled}
        />
      ) : null}

      {inputType === 'select' ? (
        <Select value={fieldValue ?? undefined} onValueChange={handleValueChange} disabled={disabled}>
          <SelectTrigger id={fieldName}>
            <SelectValue placeholder={field.placeholder || 'Select an option'} />
          </SelectTrigger>
          <SelectContent>
            {(field.options || []).map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : null}

      {inputType === 'boolean' ? (
        <div className="flex items-center justify-between rounded-xl border border-border/60 bg-card/60 px-4 py-3">
          <div>
            <p className="text-sm font-medium text-foreground">{field.toggleLabel || field.label}</p>
            {field.helpText ? <p className="text-xs text-muted-foreground">{field.helpText}</p> : null}
          </div>
          <Switch
            id={fieldName}
            checked={Boolean(fieldValue)}
            onCheckedChange={(checked) => handleValueChange(Boolean(checked))}
            disabled={disabled}
          />
        </div>
      ) : null}

      {!['textarea', 'select', 'boolean'].includes(inputType) ? (
        <Input
          id={fieldName}
          type={inputType}
          placeholder={field.placeholder}
          value={fieldValue ?? ''}
          onChange={(event) => handleValueChange(event.target.value)}
          disabled={disabled}
        />
      ) : null}

      {field.description ? <p className="text-xs text-muted-foreground">{field.description}</p> : null}
    </div>
  );
}

export default function SettingsFormRenderer({
  schema,
  value,
  onChange,
  disabled = false,
  preSections = [],
  postSections = [],
}) {
  const beforeSlots = schema?.slots?.before || [];
  const afterSlots = schema?.slots?.after || [];
  const fields = schema?.fields || [];

  return (
    <div className="space-y-6">
      {beforeSlots.map(renderSchemaSlot)}

      {preSections.map((section, index) => (
        <Fragment key={`pre-section-${index}`}>{section}</Fragment>
      ))}

      {fields.length > 0 ? (
        <Card className="border-border/60 bg-card/70 shadow-sm">
          <CardContent className="grid gap-6 p-6 md:grid-cols-2">
            {fields.map((field) => (
              <div key={field.name || field.key} className={field.fullWidth ? 'md:col-span-2' : ''}>
                <SettingsField field={field} value={value} onChange={onChange} disabled={disabled} />
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      {postSections.map((section, index) => (
        <Fragment key={`post-section-${index}`}>{section}</Fragment>
      ))}

      {afterSlots.map(renderSchemaSlot)}
    </div>
  );
}
