import { getVersionInfo } from '@/lib/version';
import { Info } from 'lucide-react';
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from '@/components/ui/tooltip';

/**
 * Version Badge Component
 * Displays the current application version with optional tooltip showing detailed info
 */
function VersionBadge({
    variant = 'default', // 'default', 'compact', 'full'
    showTooltip = true,
    className = ''
}) {
    const versionInfo = getVersionInfo();

    const getBadgeContent = () => {
        switch (variant) {
            case 'compact':
                return `v${versionInfo.version}`;
            case 'full':
                return versionInfo.displayVersion;
            default:
                return `v${versionInfo.version}`;
        }
    };

    const badge = (
        <div className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium bg-slate-100 text-slate-600 border border-slate-200 ${className}`}>
            <span>{getBadgeContent()}</span>
            {showTooltip && <Info className="w-3 h-3 text-slate-400" />}
        </div>
    );

    if (!showTooltip) {
        return badge;
    }

    return (
        <TooltipProvider>
            <Tooltip>
                <TooltipTrigger asChild>
                    {badge}
                </TooltipTrigger>
                <TooltipContent side="top" className="text-xs">
                    <div className="space-y-1">
                        <div className="font-bold">{versionInfo.displayVersion}</div>
                        <div className="text-slate-400">Build: {versionInfo.build}</div>
                        <div className="text-slate-400">Released: {versionInfo.date}</div>
                    </div>
                </TooltipContent>
            </Tooltip>
        </TooltipProvider>
    );
}

export default VersionBadge;
