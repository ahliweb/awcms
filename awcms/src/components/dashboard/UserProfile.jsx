
import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { User, Mail, Lock, Shield, Save, Key, AlertCircle, CheckCircle2, Crown, Camera } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/use-toast';
import { supabase } from '@/lib/customSupabaseClient';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { usePermissions } from '@/contexts/PermissionContext';
import TwoFactorSettings from '@/components/dashboard/TwoFactorSettings';
import { ImageUpload } from '@/components/ui/ImageUpload';

function UserProfile() {
  const { user } = useAuth();
  const { userRole, permissions } = usePermissions();
  const { toast } = useToast();

  const [loading, setLoading] = useState(false);
  const [passLoading, setPassLoading] = useState(false);

  const [profileData, setProfileData] = useState({
    full_name: '',
    email: '',
    avatar_url: ''
  });

  const [passwordData, setPasswordData] = useState({
    password: '',
    confirmPassword: ''
  });

  // Initialize data
  useEffect(() => {
    if (user) {
      const fetchProfile = async () => {
        try {
          // Explicitly specify the relationship to avoid PGRST200 error
          const { data, error } = await supabase
            .from('users')
            .select(`
              full_name, 
              email, 
              avatar_url,
              roles:roles!users_role_id_fkey (
                name,
                description
              )
            `)
            .eq('id', user.id)
            .maybeSingle();

          if (error) {
            console.error('Error fetching profile:', error);
          }

          setProfileData({
            full_name: data?.full_name || user.user_metadata?.full_name || '',
            email: user.email || '',
            avatar_url: data?.avatar_url || user.user_metadata?.avatar_url || '',
            role_name: data?.roles?.name || '',
            role_description: data?.roles?.description || ''
          });
        } catch (err) {
          console.error('Unexpected error in fetchProfile:', err);
        }
      };
      fetchProfile();
    }
  }, [user]);

  const handleProfileUpdate = async (e) => {
    e.preventDefault();
    setLoading(true);

    try {
      // 1. Update public.users table
      const { error: dbError } = await supabase
        .from('users')
        .update({
          full_name: profileData.full_name,
          avatar_url: profileData.avatar_url,
          updated_at: new Date().toISOString()
        })
        .eq('id', user.id);

      if (dbError) throw dbError;

      // 2. Update Auth Metadata
      const { error: authError } = await supabase.auth.updateUser({
        data: {
          full_name: profileData.full_name,
          avatar_url: profileData.avatar_url
        }
      });

      if (authError) throw authError;

      // 3. Handle Email Change if changed
      if (profileData.email !== user.email) {
        const { error: emailError } = await supabase.auth.updateUser({
          email: profileData.email
        });
        if (emailError) throw emailError;

        toast({
          title: "Check your email",
          description: "Confirmation link sent to your new email address."
        });
      }

      toast({
        title: "Profile Updated",
        description: "Your profile information has been saved successfully."
      });
    } catch (error) {
      console.error('Update error:', error);
      toast({
        variant: "destructive",
        title: "Update Failed",
        description: error.message || "Failed to update profile."
      });
    } finally {
      setLoading(false);
    }
  };

  const handlePasswordChange = async (e) => {
    e.preventDefault();
    if (passwordData.password !== passwordData.confirmPassword) {
      toast({
        variant: "destructive",
        title: "Passwords do not match",
        description: "Please ensure both password fields match."
      });
      return;
    }

    if (passwordData.password.length < 6) {
      toast({
        variant: "destructive",
        title: "Password too short",
        description: "Password must be at least 6 characters long."
      });
      return;
    }

    setPassLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({
        password: passwordData.password
      });

      if (error) throw error;

      toast({
        title: "Password Updated",
        description: "Your password has been changed successfully."
      });

      setPasswordData({ password: '', confirmPassword: '' });
    } catch (error) {
      console.error("Password update error:", error);

      let errorMessage = error.message || "Failed to change password.";

      // Handle specific error cases
      if (errorMessage.includes("New password should be different") || error.code === "same_password") {
        errorMessage = "Your new password cannot be the same as your old password.";
      } else if (errorMessage.includes("Gateway Timeout") || error.status === 504) {
        errorMessage = "Server is busy. Please wait a moment and try again.";
      } else if (errorMessage.includes("fetch") || errorMessage.includes("network") || error.name === "TypeError") {
        errorMessage = "Network error. Please check your connection and try again.";
      } else if (error.status === 429) {
        errorMessage = "Too many requests. Please wait a few minutes before trying again.";
      }

      toast({
        variant: "destructive",
        title: "Update Failed",
        description: errorMessage
      });
    } finally {
      setPassLoading(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6 pb-12">
      <div className="flex flex-col gap-1">
        <h2 className="text-3xl font-bold text-slate-800 dark:text-white tracking-tight">My Profile</h2>
        <p className="text-slate-500 dark:text-slate-400">Manage your account settings and security preferences</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column: Profile, Password, 2FA */}
        <div className="lg:col-span-2 space-y-6">

          {/* Personal Information Card */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-slate-200 dark:border-slate-800 overflow-hidden"
          >
            <div className="p-6 border-b border-slate-100 dark:border-slate-800/50 bg-slate-50/50 dark:bg-slate-900/50 flex items-center gap-3">
              <div className="p-2 bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 rounded-lg">
                <User className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-semibold text-slate-800 dark:text-slate-100">Personal Information</h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">Update your personal details</p>
              </div>
            </div>

            <div className="p-6">
              <form onSubmit={handleProfileUpdate} className="space-y-6">
                {/* Avatar Upload Section */}
                <div className="flex flex-col items-center pb-6 border-b border-slate-100">
                  <div className="relative group">
                    <div className="w-28 h-28 rounded-full overflow-hidden border-4 border-slate-200 shadow-md bg-slate-100">
                      {profileData.avatar_url ? (
                        <img
                          src={profileData.avatar_url}
                          alt="Profile"
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center bg-blue-100">
                          <User className="w-12 h-12 text-blue-400" />
                        </div>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => document.getElementById('avatar-upload-trigger').click()}
                      className="absolute bottom-1 right-1 p-2 bg-blue-600 rounded-full text-white shadow-lg hover:bg-blue-700 transition-colors"
                    >
                      <Camera className="w-4 h-4" />
                    </button>
                  </div>
                  <div className="mt-4 w-full max-w-xs">
                    <ImageUpload
                      id="avatar-upload-trigger"
                      value={profileData.avatar_url}
                      onChange={(url) => setProfileData({ ...profileData, avatar_url: url })}
                      className="h-auto"
                      compact={true}
                    />
                  </div>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-2">Click camera icon or use Media Library</p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="full_name" className="text-slate-700 dark:text-slate-300">Full Name</Label>
                  <div className="relative">
                    <User className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                    <Input
                      id="full_name"
                      value={profileData.full_name}
                      onChange={(e) => setProfileData({ ...profileData, full_name: e.target.value })}
                      className="pl-9"
                      placeholder="Your full name"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="email" className="text-slate-700 dark:text-slate-300">Email Address</Label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                    <Input
                      id="email"
                      type="email"
                      value={profileData.email}
                      onChange={(e) => setProfileData({ ...profileData, email: e.target.value })}
                      className="pl-9"
                      placeholder="your.email@example.com"
                    />
                  </div>
                  <p className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1">
                    <AlertCircle className="w-3 h-3" />
                    Changing email will require re-verification.
                  </p>
                </div>

                <div className="pt-2 flex justify-end">
                  <Button type="submit" disabled={loading} className="bg-blue-600 hover:bg-blue-700">
                    {loading ? (
                      <span className="flex items-center gap-2">Saving...</span>
                    ) : (
                      <span className="flex items-center gap-2"><Save className="w-4 h-4" /> Save Changes</span>
                    )}
                  </Button>
                </div>
              </form>
            </div>
          </motion.div>

          {/* 2FA Settings Component */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
          >
            <TwoFactorSettings />
          </motion.div>

          {/* Security Card (Password) */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-slate-200 dark:border-slate-800 overflow-hidden"
          >
            <div className="p-6 border-b border-slate-100 dark:border-slate-800/50 bg-slate-50/50 dark:bg-slate-900/50 flex items-center gap-3">
              <div className="p-2 bg-orange-100 dark:bg-orange-900/30 text-orange-600 dark:text-orange-400 rounded-lg">
                <Lock className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-semibold text-slate-800 dark:text-slate-100">Password</h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">Manage your password</p>
              </div>
            </div>

            <div className="p-6">
              <form onSubmit={handlePasswordChange} className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="password" className="text-slate-700 dark:text-slate-300">New Password</Label>
                    <div className="relative">
                      <Key className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                      <Input
                        id="password"
                        type="password"
                        value={passwordData.password}
                        onChange={(e) => setPasswordData({ ...passwordData, password: e.target.value })}
                        className="pl-9"
                        placeholder="••••••••"
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="confirmPassword" className="text-slate-700 dark:text-slate-300">Confirm Password</Label>
                    <div className="relative">
                      <Key className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                      <Input
                        id="confirmPassword"
                        type="password"
                        value={passwordData.confirmPassword}
                        onChange={(e) => setPasswordData({ ...passwordData, confirmPassword: e.target.value })}
                        className="pl-9"
                        placeholder="••••••••"
                      />
                    </div>
                  </div>
                </div>

                <div className="pt-2 flex justify-end">
                  <Button type="submit" variant="outline" disabled={passLoading || !passwordData.password} className="border-orange-200 text-orange-700 hover:bg-orange-50 hover:text-orange-800 dark:border-orange-800 dark:text-orange-400 dark:hover:bg-orange-900/20">
                    {passLoading ? 'Updating...' : 'Update Password'}
                  </Button>
                </div>
              </form>
            </div>
          </motion.div>
        </div>

        {/* Right Column: Roles & Permissions */}
        <div className="lg:col-span-1 space-y-6">
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.3 }}
            className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-slate-200 dark:border-slate-800 overflow-hidden h-full flex flex-col"
          >
            <div className="p-6 border-b border-slate-100 dark:border-slate-800/50 bg-slate-50/50 dark:bg-slate-900/50 flex items-center gap-3">
              <div className="p-2 bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400 rounded-lg">
                <Shield className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-semibold text-slate-800 dark:text-slate-100">Access Control</h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">Your assigned role and permissions</p>
              </div>
            </div>

            <div className="p-6 space-y-6 flex-1 flex flex-col">
              <div>
                <h4 className="text-xs font-bold text-slate-400 dark:text-slate-500 mb-3 uppercase tracking-wider">Current Role</h4>
                <div className={`inline-flex items-center px-3 py-1.5 rounded-full font-semibold text-sm border ${(profileData.role_name || userRole) === 'super_admin' || (profileData.role_name || userRole) === 'owner'
                  ? 'bg-purple-100 dark:bg-purple-900/30 text-purple-800 dark:text-purple-300 border-purple-200 dark:border-purple-800'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700'
                  }`}>
                  {(profileData.role_name || userRole) === 'super_admin' || (profileData.role_name || userRole) === 'owner' ? <Crown className="w-3.5 h-3.5 mr-2 text-purple-600 dark:text-purple-400" /> : <Shield className="w-3.5 h-3.5 mr-2" />}
                  {(profileData.role_name || userRole) ? (profileData.role_name || userRole).replace(/_/g, ' ') : 'Guest'}
                </div>
                {profileData.role_description && (
                  <p className="text-sm text-slate-500 dark:text-slate-400 mt-2 italic">
                    "{profileData.role_description}"
                  </p>
                )}
              </div>

              <div className="flex-1 flex flex-col min-h-0">
                <h4 className="text-xs font-bold text-slate-400 dark:text-slate-500 mb-3 uppercase tracking-wider flex items-center justify-between">
                  Active Permissions
                  <span className="text-xs normal-case bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded-full text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-700">
                    {permissions?.length || 0}
                  </span>
                </h4>

                {permissions && permissions.length > 0 ? (
                  <div className="overflow-y-auto pr-2 custom-scrollbar space-y-1 flex-1 max-h-[400px]">
                    {permissions.map((perm, index) => (
                      <div key={index} className="flex items-center gap-2 p-2 rounded-md hover:bg-slate-50 dark:hover:bg-slate-800/50 text-sm text-slate-600 dark:text-slate-400 transition-colors group border border-transparent hover:border-slate-100 dark:hover:border-slate-700">
                        <CheckCircle2 className="w-4 h-4 text-green-500 dark:text-green-400 shrink-0" />
                        <span className="group-hover:text-slate-900 dark:group-hover:text-slate-200">{perm.replace(/_/g, ' ')}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-sm text-slate-400 italic p-6 bg-slate-50 dark:bg-slate-800/50 rounded-lg text-center border border-slate-100 dark:border-slate-800 flex flex-col items-center gap-2">
                    <Shield className="w-8 h-8 text-slate-200 dark:text-slate-700" />
                    No specific permissions assigned.
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        </div>
      </div>
    </div>
  );
}

export default UserProfile;
