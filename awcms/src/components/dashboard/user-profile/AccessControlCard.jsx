import { CheckCircle2, Crown, Shield } from 'lucide-react';
import { useTranslation } from 'react-i18next';

const AccessControlCard = ({
	profileData,
	userRole,
	isPlatformAdmin,
	isFullAccess,
	permissions,
}) => {
	const { t } = useTranslation();
	const isElevatedRole = profileData.role_is_platform_admin || profileData.role_is_full_access || isPlatformAdmin || isFullAccess;

	return (
		<div className="dashboard-surface dashboard-surface-hover overflow-hidden flex flex-col flex-1 min-h-0">
			<div className="flex items-center gap-3 border-b border-slate-200/60 bg-slate-50/70 px-6 py-5 dark:border-slate-800/70 dark:bg-slate-900/60">
				<div className="p-2 bg-purple-100/70 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400 rounded-lg">
					<Shield className="w-5 h-5" />
				</div>
				<div>
					<h3 className="font-semibold text-slate-900 dark:text-white">{t('profile.access_control.title', 'Access Control')}</h3>
					<p className="text-xs text-slate-500 dark:text-slate-400">{t('profile.access_control.subtitle', 'Your assigned role and permissions')}</p>
				</div>
			</div>

			<div className="p-6 space-y-6 flex-1 flex flex-col min-h-0">
				<div>
					<h4 className="text-xs font-bold text-slate-400 dark:text-slate-500 mb-3 uppercase tracking-wider">{t('profile.access_control.current_role', 'Current Role')}</h4>
					<div
						className={`inline-flex items-center px-3 py-1.5 rounded-full font-semibold text-sm border ${isElevatedRole
							? 'bg-purple-100/70 dark:bg-purple-900/30 text-purple-800 dark:text-purple-300 border-purple-200/70 dark:border-purple-800'
							: 'bg-slate-100/70 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200/70 dark:border-slate-700'
							}`}
					>
						{isElevatedRole
							? <Crown className="w-3.5 h-3.5 mr-2 text-purple-600 dark:text-purple-400" />
							: <Shield className="w-3.5 h-3.5 mr-2" />}
						{(profileData.role_name || userRole) ? (profileData.role_name || userRole).replace(/_/g, ' ') : t('users.guest', 'Guest')}
					</div>
					{profileData.role_description && (
						<p className="text-sm text-slate-500 dark:text-slate-400 mt-2 italic">
							&quot;{profileData.role_description}&quot;
						</p>
					)}
				</div>

				<div className="flex-1 flex flex-col min-h-0">
					<h4 className="text-xs font-bold text-slate-400 dark:text-slate-500 mb-3 uppercase tracking-wider flex items-center justify-between">
						{t('profile.access_control.active_permissions', 'Active Permissions')}
						<span className="text-xs normal-case bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded-full text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-700">
							{permissions?.length || 0}
						</span>
					</h4>

					{permissions && permissions.length > 0 ? (
						<div className="flex-1 min-h-0 rounded-2xl border border-slate-200/70 bg-white/80 p-3 shadow-sm dark:border-slate-800/70 dark:bg-slate-900/50">
							<div className="max-h-[400px] overflow-y-auto pr-2 custom-scrollbar space-y-2">
								{permissions.map((permission, index) => (
									<div key={index} className="flex items-center gap-2 rounded-xl border border-transparent p-2 text-sm text-slate-600 transition-colors group hover:bg-slate-50/70 hover:border-slate-100 dark:text-slate-400 dark:hover:bg-slate-800/50 dark:hover:border-slate-700">
										<CheckCircle2 className="w-4 h-4 text-green-500 dark:text-green-400 shrink-0" />
										<span className="group-hover:text-slate-900 dark:group-hover:text-slate-200">{permission.replace(/_/g, ' ')}</span>
									</div>
								))}
							</div>
						</div>
					) : (
						<div className="flex-1 text-sm text-slate-400 italic p-6 bg-slate-50 dark:bg-slate-900/50 rounded-lg text-center border border-slate-100 dark:border-slate-800/70 flex flex-col items-center justify-center gap-2">
							<Shield className="w-8 h-8 text-slate-200 dark:text-slate-600" />
							{t('profile.access_control.no_permissions', 'No specific permissions assigned.')}
						</div>
					)}
				</div>
			</div>
		</div>
	);
};

export default AccessControlCard;
