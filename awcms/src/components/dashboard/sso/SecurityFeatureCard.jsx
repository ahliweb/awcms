import { CheckCircle, XCircle } from 'lucide-react';

function SecurityFeatureCard({
  title,
  description,
  enabled,
  icon: Icon,
}) {
  return (
    <div className="flex items-start gap-4 rounded-lg border bg-card p-4">
      <div className={`rounded-lg p-2 ${enabled ? 'bg-green-100 text-green-600 dark:bg-green-900/30 dark:text-green-400' : 'bg-muted text-muted-foreground'}`}>
        <Icon className="h-5 w-5" />
      </div>
      <div className="flex-1">
        <div className="flex items-center gap-2">
          <h4 className="font-medium text-foreground">{title}</h4>
          {enabled ? (
            <CheckCircle className="h-4 w-4 text-green-500" />
          ) : (
            <XCircle className="h-4 w-4 text-muted-foreground" />
          )}
        </div>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}

export default SecurityFeatureCard;
