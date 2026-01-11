
import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/customSupabaseClient';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import * as OTPAuth from 'otpauth';
import QRCode from 'qrcode';

export function useTwoFactor() {
  const { user } = useAuth();
  const [isEnabled, setIsEnabled] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [setupData, setSetupData] = useState(null); // { secret, qrCodeUrl, backupCodes }
  const [error, setError] = useState(null);

  // Check 2FA status
  const checkStatus = useCallback(async () => {
    if (!user) return;
    
    try {
      const { data, error } = await supabase
        .from('two_factor_auth')
        .select('enabled, created_at')
        .eq('user_id', user.id)
        .is('deleted_at', null)
        .maybeSingle();

      if (error) throw error;
      
      setIsEnabled(!!data?.enabled);
    } catch (err) {
      console.error('Error checking 2FA status:', err);
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  }, [user]);

  useEffect(() => {
    checkStatus();
  }, [checkStatus]);

  // Start Setup Process: Generate Secret & QR
  const startSetup = async () => {
    setError(null);
    try {
      // 1. Generate a new secret
      const secret = new OTPAuth.Secret({ size: 20 });
      const secretStr = secret.base32;

      // 2. Generate TOTP URI
      const totp = new OTPAuth.TOTP({
        issuer: 'CMS Panel',
        label: user.email,
        algorithm: 'SHA1',
        digits: 6,
        period: 30,
        secret: secret
      });
      const uri = totp.toString();

      // 3. Generate QR Code
      const qrCodeUrl = await QRCode.toDataURL(uri);

      // 4. Generate Backup Codes
      const backupCodes = Array.from({ length: 8 }, () => 
        Math.random().toString(36).substr(2, 5).toUpperCase() + '-' + 
        Math.random().toString(36).substr(2, 5).toUpperCase()
      );

      setSetupData({
        secret: secretStr,
        qrCodeUrl,
        backupCodes,
        uri
      });

      return { success: true };
    } catch (err) {
      console.error('Error starting 2FA setup:', err);
      setError(err.message);
      return { success: false, error: err.message };
    }
  };

  // Verify and Enable 2FA
  const verifyAndEnable = async (token) => {
    if (!setupData) return { success: false, error: 'No setup in progress' };

    try {
      // 1. Verify Token
      const totp = new OTPAuth.TOTP({
        issuer: 'CMS Panel',
        label: user.email,
        algorithm: 'SHA1',
        digits: 6,
        period: 30,
        secret: OTPAuth.Secret.fromBase32(setupData.secret)
      });

      const delta = totp.validate({ token, window: 1 });

      if (delta === null) {
        throw new Error('Invalid authentication code');
      }

      // 2. Save to Database
      const { error: dbError } = await supabase
        .from('two_factor_auth')
        .upsert({
          user_id: user.id,
          secret: setupData.secret,
          backup_codes: setupData.backupCodes,
          enabled: true,
          deleted_at: null,
          updated_at: new Date().toISOString()
        }, { onConflict: 'user_id' });

      if (dbError) throw dbError;

      // 3. Log Event
      await supabase.from('two_factor_audit_logs').insert({
        user_id: user.id,
        event_type: 'enabled',
        ip_address: 'client-side' // Real IP would be better captured via edge function
      });

      setIsEnabled(true);
      setSetupData(null); // Clear setup data for security
      
      return { success: true };
    } catch (err) {
      console.error('Error verifying 2FA:', err);
      return { success: false, error: err.message };
    }
  };

  // Disable 2FA
  const disable2FA = async () => {
    try {
      const { error } = await supabase
        .from('two_factor_auth')
        .update({ enabled: false, deleted_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq('user_id', user.id);

      if (error) throw error;

      await supabase.from('two_factor_audit_logs').insert({
        user_id: user.id,
        event_type: 'disabled'
      });

      setIsEnabled(false);
      return { success: true };
    } catch (err) {
      console.error('Error disabling 2FA:', err);
      return { success: false, error: err.message };
    }
  };

  // Verify Login Code (used in login flow)
  const verifyLoginCode = async (userId, token) => {
    try {
      // Fetch secret (requires backend typically, but using client for this constraint context with RLS)
      // Note: In a strict production environment, this verification should happen server-side via Edge Function
      // to avoid exposing the secret to the client before verification.
      // However, given the constraints, we will fetch, verify locally.
      
      const { data, error } = await supabase
        .from('two_factor_auth')
        .select('secret, backup_codes')
        .eq('user_id', userId)
        .is('deleted_at', null)
        .single();

      if (error || !data) throw new Error('2FA not set up for this user');

      // Check if it's a backup code
      if (data.backup_codes.includes(token)) {
         // It's a backup code - remove it
         const newCodes = data.backup_codes.filter(c => c !== token);
         await supabase
           .from('two_factor_auth')
           .update({ backup_codes: newCodes })
           .eq('user_id', userId);
           
         await supabase.from('two_factor_audit_logs').insert({
            user_id: userId,
            event_type: 'backup_code_used'
         });
         
         return { success: true, type: 'backup_code' };
      }

      // Verify TOTP
      const totp = new OTPAuth.TOTP({
        algorithm: 'SHA1',
        digits: 6,
        period: 30,
        secret: OTPAuth.Secret.fromBase32(data.secret)
      });

      const delta = totp.validate({ token, window: 1 });

      if (delta !== null) {
        await supabase.from('two_factor_audit_logs').insert({
            user_id: userId,
            event_type: 'verified'
         });
        return { success: true, type: 'totp' };
      }

      return { success: false, error: 'Invalid code' };

    } catch (err) {
      return { success: false, error: err.message };
    }
  };

  return {
    isEnabled,
    isLoading,
    setupData,
    error,
    startSetup,
    verifyAndEnable,
    disable2FA,
    verifyLoginCode,
    checkStatus
  };
}
