import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import { Globe, Check, Languages, Layers3, ShieldAlert, ShieldCheck } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { usePermissions } from '@/contexts/PermissionContext';
import { useToast } from '@/components/ui/use-toast';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { supabase } from '@/lib/customSupabaseClient';
import { AdminPageLayout, PageHeader } from '@/templates/flowbite-admin';
import DashboardModuleIntro from '@/components/dashboard/DashboardModuleIntro';
import { cn } from '@/lib/utils';

const LANGUAGE_OPTIONS = [
	{ value: 'id', name: 'Bahasa Indonesia', note: 'Secondary', flag: 'ID' },
	{ value: 'en', name: 'English', note: 'Default (Primary)', flag: 'EN' },
];

function LanguageSettings() {
	const { t, i18n } = useTranslation();
	const navigate = useNavigate();
	const location = useLocation();
	const { user } = useAuth();
	const { toast } = useToast();
	const { hasPermission } = usePermissions();
	const [savingLanguage, setSavingLanguage] = useState('');

	const canReadLanguageSettings = hasPermission('tenant.languages.read');
	const canUpdateLanguageSettings = hasPermission('tenant.languages.update') || hasPermission('tenant.setting.update') || canReadLanguageSettings;

	const currentLanguage = i18n.language;
	const currentLanguageLabel = useMemo(
		() => LANGUAGE_OPTIONS.find((language) => language.value === currentLanguage)?.name || currentLanguage.toUpperCase(),
		[currentLanguage]
	);
	const isCanonicalRoute = location.pathname === '/cmspanel/settings/language';

	useEffect(() => {
		if (!isCanonicalRoute) {
			navigate('/cmspanel/settings/language', { replace: true });
		}
	}, [isCanonicalRoute, navigate]);

	useEffect(() => {
		if (!canReadLanguageSettings) {
			return;
		}

		if (!document.getElementById('google-translate-script')) {
			const script = document.createElement('script');
			script.id = 'google-translate-script';
			script.src = '//translate.google.com/translate_a/element.js?cb=googleTranslateElementInit';
			document.body.appendChild(script);

			window.googleTranslateElementInit = () => {
				new window.google.translate.TranslateElement(
					{ pageLanguage: 'en', layout: window.google.translate.TranslateElement.InlineLayout.SIMPLE },
					'google_translate_element'
				);
			};
		}
	}, [canReadLanguageSettings]);

	const handleLanguageChange = async (language) => {
		if (!canUpdateLanguageSettings || language === currentLanguage) {
			return;
		}

		setSavingLanguage(language);

		try {
			await i18n.changeLanguage(language);
			localStorage.setItem('i18nextLng', language);

			if (user) {
				const { error } = await supabase
					.from('users')
					.update({ language })
					.eq('id', user.id);

				if (error) {
					throw error;
				}
			}

			toast({
				title: t('common.success'),
				description: `${t('settings.save_preferences')} success`
			});
		} catch (error) {
			console.error('Language update failed:', error);
			toast({
				variant: 'destructive',
				title: t('common.error'),
				description: 'Failed to save language preference'
			});
		} finally {
			setSavingLanguage('');
		}
	};

	if (!canReadLanguageSettings) {
		return (
			<AdminPageLayout>
				<div className="flex min-h-[400px] flex-col items-center justify-center rounded-2xl border border-border/60 bg-card/70 p-12 text-center shadow-sm">
					<div className="mb-4 rounded-full border border-destructive/30 bg-destructive/10 p-4">
						<ShieldAlert className="h-12 w-12 text-destructive" />
					</div>
					<h3 className="text-xl font-bold text-foreground">Access Denied</h3>
					<p className="mt-2 text-muted-foreground">You do not have permission to view language settings.</p>
				</div>
			</AdminPageLayout>
		);
	}

	return (
		<AdminPageLayout requiredPermission="tenant.languages.read">
			<PageHeader
				title={t('settings.language_title')}
				description="Manage admin language preferences with refresh-safe routing, profile-backed persistence, and multi-language support that stays aligned with the rest of the dashboard."
				icon={Languages}
				breadcrumbs={[{ label: 'Settings' }, { label: 'Language', icon: Languages }]}
			/>

			<DashboardModuleIntro
				icon={Languages}
				eyebrow="Localization"
				title="Language Settings"
				description="Keep language preferences synced to the signed-in user profile, preserve refresh-safe admin routing, and keep dashboard localization behavior consistent across modules."
				badges={[
					{ icon: Layers3, iconClassName: 'text-primary', label: 'Refresh-safe `/cmspanel/settings/language` route shell' },
					{ icon: ShieldCheck, iconClassName: 'text-emerald-600', label: 'Tenant language permissions and profile-backed updates' },
				]}
				summaryCards={[
					{ title: 'Current Language', value: currentLanguageLabel, description: `Locale code: ${currentLanguage}`, accent: 'from-primary/15 via-primary/6 to-transparent' },
					{ title: 'Supported Locales', value: LANGUAGE_OPTIONS.length, description: 'Configured in admin panel', accent: 'from-sky-500/15 via-sky-500/6 to-transparent' },
					{ title: 'Preference Scope', value: 'User Profile', description: 'Synced to user.language field', accent: 'from-emerald-500/15 via-emerald-500/6 to-transparent' },
					{ title: 'Google Translate', value: 'Enabled', description: 'Browser side language assist', accent: 'from-amber-500/15 via-amber-500/6 to-transparent' },
				]}
				valueClassName="text-2xl"
				className="mb-6"
			/>

			<motion.div
				initial={{ opacity: 0, y: 20 }}
				animate={{ opacity: 1, y: 0 }}
				className="space-y-6"
			>
				<div className="rounded-2xl border border-border/60 bg-card/70 p-6 shadow-sm backdrop-blur-sm">
					<h3 className="mb-4 flex items-center gap-2 text-lg font-semibold text-foreground">
						<Globe className="h-5 w-5 text-primary" />
						{t('settings.select_language')}
					</h3>

					<div className="grid grid-cols-1 gap-4 md:grid-cols-2">
						{LANGUAGE_OPTIONS.map((language) => {
							const isActive = currentLanguage === language.value;
							const isSaving = savingLanguage === language.value;

							return (
								<button
									key={language.value}
									type="button"
									onClick={() => handleLanguageChange(language.value)}
									disabled={!canUpdateLanguageSettings || isSaving}
									className={cn(
										'flex items-center justify-between rounded-xl border p-4 text-left transition-all',
										isActive
											? 'border-primary bg-primary/10 ring-1 ring-primary/40'
											: 'border-border/70 bg-background/60 hover:border-primary/40 hover:bg-accent/40',
										(!canUpdateLanguageSettings || isSaving) && 'cursor-not-allowed opacity-70'
									)}
								>
									<div className="flex items-center gap-3">
										<span className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-border/70 bg-background text-sm font-semibold text-foreground">
											{language.flag}
										</span>
										<div>
											<p className="font-semibold text-foreground">{language.name}</p>
											<p className="text-xs text-muted-foreground">{language.note}</p>
										</div>
									</div>
									{isActive ? (
										<Check className="h-5 w-5 text-primary" />
									) : isSaving ? (
										<span className="text-xs font-medium text-muted-foreground">Saving...</span>
									) : null}
								</button>
							);
						})}
					</div>
				</div>

				<div className="rounded-2xl border border-border/60 bg-card/70 p-6 shadow-sm backdrop-blur-sm">
					<h3 className="mb-2 text-lg font-semibold text-foreground">{t('settings.google_translate')}</h3>
					<p className="mb-4 text-sm text-muted-foreground">{t('settings.google_translate_desc')}</p>

					<div className="rounded-xl border border-border/70 bg-background/65 p-4">
						<div id="google_translate_element" />
					</div>
				</div>
			</motion.div>
		</AdminPageLayout>
	);
}

export default LanguageSettings;
