import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { User } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import { supabase } from '@/lib/customSupabaseClient';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { usePermissions } from '@/contexts/PermissionContext';
import TwoFactorSettings from '@/components/dashboard/TwoFactorSettings';
import { AdminPageLayout, PageHeader } from '@/templates/flowbite-admin';
import ProfileSummaryCards from '@/components/dashboard/user-profile/ProfileSummaryCards';
import PersonalInformationCard from '@/components/dashboard/user-profile/PersonalInformationCard';
import ProfileDetailsCard from '@/components/dashboard/user-profile/ProfileDetailsCard';
import AdminNotesCard from '@/components/dashboard/user-profile/AdminNotesCard';
import PasswordCard from '@/components/dashboard/user-profile/PasswordCard';
import AccessControlCard from '@/components/dashboard/user-profile/AccessControlCard';

function UserProfile() {
	const { user } = useAuth();
	const { userRole, permissions, isPlatformAdmin, isFullAccess, hasPermission, tenantId } = usePermissions();
	const { toast } = useToast();

	const [loading, setLoading] = useState(false);
	const [passLoading, setPassLoading] = useState(false);
	const [detailsLoading, setDetailsLoading] = useState(false);
	const [adminLoading, setAdminLoading] = useState(false);

	const [profileData, setProfileData] = useState({
		full_name: '',
		email: '',
		avatar_url: ''
	});

	const [profileDetails, setProfileDetails] = useState({
		description: '',
		job_title: '',
		department: '',
		phone: '',
		alternate_email: '',
		location: '',
		timezone: '',
		website_url: '',
		linkedin_url: '',
		twitter_url: '',
		github_url: ''
	});

	const [adminData, setAdminData] = useState({
		admin_notes: '',
		admin_flags: ''
	});

	const [passwordData, setPasswordData] = useState({
		password: '',
		confirmPassword: ''
	});

	const canManageAdminFields = hasPermission('tenant.user.update') || isPlatformAdmin || isFullAccess;
	const effectiveRole = (profileData.role_name || userRole || 'guest').replace(/_/g, ' ');
	const permissionCount = permissions?.length || 0;
	const completedDetailFields = Object.values(profileDetails).filter(Boolean).length;
	const isPlatformScope = profileData.role_is_platform_admin || profileData.role_is_full_access || isPlatformAdmin || isFullAccess;

	useEffect(() => {
		if (!user) {
			return;
		}

		const fetchProfile = async () => {
			try {
				const [userResponse, detailsResponse] = await Promise.all([
					supabase
						.from('users')
						.select(`
							full_name,
							email,
							avatar_url,
							roles:roles!users_role_id_fkey (
								name,
								description,
								is_platform_admin,
								is_full_access
							)
						`)
						.eq('id', user.id)
						.maybeSingle(),
					supabase
						.from('user_profiles')
						.select(`
							description,
							job_title,
							department,
							phone,
							alternate_email,
							location,
							timezone,
							website_url,
							linkedin_url,
							twitter_url,
							github_url
						`)
						.eq('user_id', user.id)
						.is('deleted_at', null)
						.maybeSingle()
				]);

				if (userResponse.error) {
					console.error('Error fetching profile:', userResponse.error);
				}

				if (detailsResponse.error) {
					console.error('Error fetching profile details:', detailsResponse.error);
				}

				const data = userResponse.data;
				const details = detailsResponse.data;

				setProfileData({
					full_name: data?.full_name || user.user_metadata?.full_name || '',
					email: user.email || '',
					avatar_url: data?.avatar_url || user.user_metadata?.avatar_url || '',
					role_name: data?.roles?.name || '',
					role_description: data?.roles?.description || '',
					role_is_platform_admin: Boolean(data?.roles?.is_platform_admin),
					role_is_full_access: Boolean(data?.roles?.is_full_access)
				});

				setProfileDetails({
					description: details?.description || '',
					job_title: details?.job_title || '',
					department: details?.department || '',
					phone: details?.phone || '',
					alternate_email: details?.alternate_email || '',
					location: details?.location || '',
					timezone: details?.timezone || '',
					website_url: details?.website_url || '',
					linkedin_url: details?.linkedin_url || '',
					twitter_url: details?.twitter_url || '',
					github_url: details?.github_url || ''
				});

				if (canManageAdminFields) {
					const { data: adminFields, error: adminError } = await supabase
						.rpc('get_user_profile_admin_fields', { p_user_id: user.id });

					if (adminError) {
						console.error('Error fetching admin profile fields:', adminError);
					}

					const adminRow = Array.isArray(adminFields) ? adminFields[0] : adminFields;
					setAdminData({
						admin_notes: adminRow?.admin_notes || '',
						admin_flags: adminRow?.admin_flags || ''
					});
				}
			} catch (error) {
				console.error('Unexpected error in fetchProfile:', error);
			}
		};

		fetchProfile();
	}, [user, canManageAdminFields]);

	const handleProfileUpdate = async (event) => {
		event.preventDefault();
		setLoading(true);

		try {
			const { error: dbError } = await supabase
				.from('users')
				.update({
					full_name: profileData.full_name,
					avatar_url: profileData.avatar_url,
					updated_at: new Date().toISOString()
				})
				.eq('id', user.id);

			if (dbError) {
				throw dbError;
			}

			const { error: authError } = await supabase.auth.updateUser({
				data: {
					full_name: profileData.full_name,
					avatar_url: profileData.avatar_url
				}
			});

			if (authError) {
				throw authError;
			}

			if (profileData.email !== user.email) {
				const { error: emailError } = await supabase.auth.updateUser({ email: profileData.email });
				if (emailError) {
					throw emailError;
				}

				toast({
					title: 'Check your email',
					description: 'Confirmation link sent to your new email address.'
				});
			}

			toast({
				title: 'Profile Updated',
				description: 'Your profile information has been saved successfully.'
			});
		} catch (error) {
			console.error('Update error:', error);
			toast({
				variant: 'destructive',
				title: 'Update Failed',
				description: error.message || 'Failed to update profile.'
			});
		} finally {
			setLoading(false);
		}
	};

	const handlePasswordChange = async (event) => {
		event.preventDefault();

		if (passwordData.password !== passwordData.confirmPassword) {
			toast({
				variant: 'destructive',
				title: 'Passwords do not match',
				description: 'Please ensure both password fields match.'
			});
			return;
		}

		if (passwordData.password.length < 6) {
			toast({
				variant: 'destructive',
				title: 'Password too short',
				description: 'Password must be at least 6 characters long.'
			});
			return;
		}

		setPassLoading(true);
		try {
			const { error } = await supabase.auth.updateUser({ password: passwordData.password });
			if (error) {
				throw error;
			}

			toast({
				title: 'Password Updated',
				description: 'Your password has been changed successfully.'
			});

			setPasswordData({ password: '', confirmPassword: '' });
		} catch (error) {
			console.error('Password update error:', error);
			let errorMessage = error.message || 'Failed to change password.';

			if (errorMessage.includes('New password should be different') || error.code === 'same_password') {
				errorMessage = 'Your new password cannot be the same as your old password.';
			} else if (errorMessage.includes('Gateway Timeout') || error.status === 504) {
				errorMessage = 'Server is busy. Please wait a moment and try again.';
			} else if (errorMessage.includes('fetch') || errorMessage.includes('network') || error.name === 'TypeError') {
				errorMessage = 'Network error. Please check your connection and try again.';
			} else if (error.status === 429) {
				errorMessage = 'Too many requests. Please wait a few minutes before trying again.';
			}

			toast({
				variant: 'destructive',
				title: 'Update Failed',
				description: errorMessage
			});
		} finally {
			setPassLoading(false);
		}
	};

	const handleDetailsUpdate = async (event) => {
		event.preventDefault();
		setDetailsLoading(true);

		try {
			const profileTenantId = tenantId ?? null;
			const { error } = await supabase
				.from('user_profiles')
				.upsert({
					user_id: user.id,
					tenant_id: profileTenantId,
					description: profileDetails.description,
					job_title: profileDetails.job_title,
					department: profileDetails.department,
					phone: profileDetails.phone,
					alternate_email: profileDetails.alternate_email,
					location: profileDetails.location,
					timezone: profileDetails.timezone,
					website_url: profileDetails.website_url,
					linkedin_url: profileDetails.linkedin_url,
					twitter_url: profileDetails.twitter_url,
					github_url: profileDetails.github_url,
				}, { onConflict: 'user_id' });

			if (error) {
				throw error;
			}

			toast({
				title: 'Profile Details Saved',
				description: 'Your profile details have been updated successfully.'
			});
		} catch (error) {
			console.error('Profile details update error:', error);
			toast({
				variant: 'destructive',
				title: 'Update Failed',
				description: error.message || 'Failed to update profile details.'
			});
		} finally {
			setDetailsLoading(false);
		}
	};

	const handleAdminUpdate = async (event) => {
		event.preventDefault();
		setAdminLoading(true);

		try {
			const { error } = await supabase.rpc('set_user_profile_admin_fields', {
				p_user_id: user.id,
				p_admin_notes: adminData.admin_notes,
				p_admin_flags: adminData.admin_flags,
			});

			if (error) {
				throw error;
			}

			toast({
				title: 'Admin Fields Saved',
				description: 'Encrypted admin notes have been updated successfully.'
			});
		} catch (error) {
			console.error('Admin profile update error:', error);
			toast({
				variant: 'destructive',
				title: 'Update Failed',
				description: error.message || 'Failed to update admin fields.'
			});
		} finally {
			setAdminLoading(false);
		}
	};

	return (
		<AdminPageLayout className="space-y-6">
			<PageHeader
				title="My Profile"
				description="Manage your account settings and security preferences."
				icon={User}
				breadcrumbs={[{ label: 'Profile', icon: User }]}
			/>

			<ProfileSummaryCards
				effectiveRole={effectiveRole}
				isPlatformScope={isPlatformScope}
				permissionCount={permissionCount}
				completedDetailFields={completedDetailFields}
				primaryEmail={profileData.email || user?.email || '-'}
			/>

			<div className="w-full space-y-8 pb-4">
				<div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-stretch">
					<div className="lg:col-span-2 space-y-6">
						<motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
							<PersonalInformationCard
								profileData={profileData}
								setProfileData={setProfileData}
								loading={loading}
								onSubmit={handleProfileUpdate}
							/>
						</motion.div>

						<motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
							<ProfileDetailsCard
								profileDetails={profileDetails}
								setProfileDetails={setProfileDetails}
								detailsLoading={detailsLoading}
								onSubmit={handleDetailsUpdate}
							/>
						</motion.div>

						{canManageAdminFields && (
							<motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.12 }}>
								<AdminNotesCard
									adminData={adminData}
									setAdminData={setAdminData}
									adminLoading={adminLoading}
									onSubmit={handleAdminUpdate}
								/>
							</motion.div>
						)}

						<motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}>
							<TwoFactorSettings />
						</motion.div>

						<motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25 }}>
							<PasswordCard
								passwordData={passwordData}
								setPasswordData={setPasswordData}
								passLoading={passLoading}
								onSubmit={handlePasswordChange}
							/>
						</motion.div>
					</div>

					<div className="lg:col-span-1 flex flex-col space-y-6">
						<motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.3 }}>
							<AccessControlCard
								profileData={profileData}
								userRole={userRole}
								isPlatformAdmin={isPlatformAdmin}
								isFullAccess={isFullAccess}
								permissions={permissions}
							/>
						</motion.div>
					</div>
				</div>
			</div>
		</AdminPageLayout>
	);
}

export default UserProfile;
