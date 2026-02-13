
import { useState } from 'react';
import { Shield, Smartphone, Lock, CheckCircle2, AlertTriangle, Copy, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/use-toast';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useTwoFactor } from '@/hooks/useTwoFactor';

function TwoFactorSettings() {
  const { isEnabled, isLoading, setupData, startSetup, verifyAndEnable, disable2FA } = useTwoFactor();
  const { toast } = useToast();
  const [setupStep, setSetupStep] = useState(0); // 0: Idle, 1: QR, 2: Backup Codes
  const [verificationCode, setVerificationCode] = useState('');
  const [isVerifying, setIsVerifying] = useState(false);
  const [showDisableDialog, setShowDisableDialog] = useState(false);
  const [copiedCodes, setCopiedCodes] = useState(false);

  const handleStartSetup = async () => {
    const result = await startSetup();
    if (result.success) {
      setSetupStep(1);
    } else {
      toast({
        variant: "destructive",
        title: "Setup Failed",
        description: result.error
      });
    }
  };

  const handleVerify = async () => {
    if (verificationCode.length !== 6) return;

    setIsVerifying(true);
    const result = await verifyAndEnable(verificationCode);
    setIsVerifying(false);

    if (result.success) {
      setSetupStep(2); // Move to backup codes
      toast({
        title: "2FA Enabled",
        description: "Two-factor authentication is now active."
      });
    } else {
      toast({
        variant: "destructive",
        title: "Verification Failed",
        description: result.error || "Invalid code. Please try again."
      });
    }
  };

  const handleDisable = async () => {
    const result = await disable2FA();
    if (result.success) {
      setShowDisableDialog(false);
      setSetupStep(0);
      toast({
        title: "2FA Disabled",
        description: "Two-factor authentication has been turned off."
      });
    } else {
      toast({
        variant: "destructive",
        title: "Error",
        description: result.error
      });
    }
  };

  const copyBackupCodes = () => {
    if (setupData?.backupCodes) {
      navigator.clipboard.writeText(setupData.backupCodes.join('\n'));
      setCopiedCodes(true);
      setTimeout(() => setCopiedCodes(false), 2000);
      toast({ title: "Copied!", description: "Backup codes copied to clipboard." });
    }
  };

  if (isLoading) {
    return <div className="p-4 text-center text-slate-500 dark:text-slate-400">Checking 2FA status...</div>;
  }

  return (
    <div className="dashboard-surface dashboard-surface-hover overflow-hidden">
      <div className="flex items-center gap-3 border-b border-slate-200/60 bg-slate-50/70 px-6 py-5 dark:border-slate-800/70 dark:bg-slate-900/60">
        <div className={`p-2 rounded-lg ${isEnabled ? 'bg-green-100/70 text-green-600 dark:bg-green-900/30 dark:text-green-300' : 'bg-slate-100/70 text-slate-600 dark:bg-slate-800 dark:text-slate-300'}`}>
          <Shield className="w-5 h-5" />
        </div>
        <div>
          <h3 className="font-semibold text-slate-900 dark:text-white">Two-Factor Authentication</h3>
          <p className="text-xs text-slate-500 dark:text-slate-400">Add an extra layer of security to your account</p>
        </div>
        {isEnabled && (
          <div className="ml-auto px-2 py-1 bg-green-100/70 text-green-700 text-xs font-medium rounded-full flex items-center gap-1 border border-green-200/70 dark:bg-green-900/30 dark:text-green-200 dark:border-green-900/40">
            <CheckCircle2 className="w-3 h-3" /> Enabled
          </div>
        )}
      </div>

      <div className="p-6">
        {/* State: Not Enabled */}
        {!isEnabled && setupStep === 0 && (
          <div className="flex flex-col md:flex-row items-center justify-between gap-6">
            <div className="space-y-2">
              <p className="text-slate-600 text-sm dark:text-slate-300">
                Protect your account by requiring a code from your mobile device when logging in.
              </p>
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
                  <CheckCircle2 className="w-4 h-4 text-blue-500 dark:text-blue-400" /> Use Google Authenticator or Authy
                </div>
                <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
                  <CheckCircle2 className="w-4 h-4 text-blue-500 dark:text-blue-400" /> Secure your account against password theft
                </div>
              </div>
            </div>
            <Button onClick={handleStartSetup} className="shrink-0 bg-indigo-600 hover:bg-indigo-700 text-white">
              Enable 2FA
            </Button>
          </div>
        )}

        {/* State: Setup - Step 1: QR Code */}
        {!isEnabled && setupStep === 1 && setupData && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              <div className="space-y-4">
                <h4 className="font-medium text-slate-900 dark:text-slate-100 flex items-center gap-2">
                  <span className="flex items-center justify-center w-6 h-6 rounded-full bg-slate-100 text-xs border border-slate-200 text-slate-600 dark:bg-slate-800/70 dark:border-slate-700 dark:text-slate-200">1</span>
                  Scan QR Code
                </h4>
                <p className="text-sm text-slate-600 dark:text-slate-300">
                  Open your authenticator app (e.g. Google Authenticator) and scan this code.
                </p>
                <div className="bg-white p-4 border border-slate-200/70 rounded-xl inline-block shadow-sm dark:bg-slate-950/60 dark:border-slate-800/70">
                  <img src={setupData.qrCodeUrl} alt="2FA QR Code" className="w-40 h-40" />
                </div>
                <div className="text-xs text-slate-500 dark:text-slate-400">
                  <p className="mb-1">Can&apos;t scan?</p>
                  <code className="bg-slate-100/70 px-2 py-1 rounded text-slate-700 select-all block w-full break-all dark:bg-slate-800/60 dark:text-slate-200">
                    {setupData.secret}
                  </code>
                </div>
              </div>

              <div className="space-y-4">
                <h4 className="font-medium text-slate-900 dark:text-slate-100 flex items-center gap-2">
                  <span className="flex items-center justify-center w-6 h-6 rounded-full bg-slate-100 text-xs border border-slate-200 text-slate-600 dark:bg-slate-800/70 dark:border-slate-700 dark:text-slate-200">2</span>
                  Verify Code
                </h4>
                <p className="text-sm text-slate-600 dark:text-slate-300">
                  Enter the 6-digit code from your app to verify setup.
                </p>
                <div className="space-y-3">
                  <Label htmlFor="verificationCode">Authentication Code</Label>
                  <Input
                    id="verificationCode"
                    placeholder="000000"
                    value={verificationCode}
                    onChange={(e) => setVerificationCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    className="text-center text-lg tracking-widest font-mono h-11 rounded-xl border-slate-200/70 bg-white/90 shadow-sm focus:border-indigo-500/60 focus:ring-indigo-500/30 dark:border-slate-700/70 dark:bg-slate-950/60 dark:text-slate-100"
                    autoComplete="off"
                  />
                  <Button
                    onClick={handleVerify}
                    disabled={verificationCode.length !== 6 || isVerifying}
                    className="w-full bg-indigo-600 hover:bg-indigo-700"
                  >
                    {isVerifying ? 'Verifying...' : 'Verify & Enable'}
                  </Button>
                </div>
              </div>
            </div>

            <div className="pt-4 border-t border-slate-200/60 dark:border-slate-800/70">
              <Button variant="ghost" onClick={() => setSetupStep(0)} className="text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100 dark:hover:bg-slate-900/40">
                Cancel Setup
              </Button>
            </div>
          </div>
        )}

        {/* State: Setup - Step 2: Backup Codes */}
        {isEnabled && setupStep === 2 && setupData && (
          <div className="space-y-6">
            <div className="bg-green-50 border border-green-200/70 rounded-xl p-4 flex items-start gap-3 dark:bg-green-900/20 dark:border-green-900/40">
              <CheckCircle2 className="w-5 h-5 text-green-600 mt-0.5 dark:text-green-300" />
              <div>
                <h4 className="text-green-800 font-medium dark:text-green-200">2FA Successfully Enabled!</h4>
                <p className="text-green-700 text-sm mt-1 dark:text-green-200/80">
                  Your account is now more secure. Please save these backup codes in a safe place.
                </p>
              </div>
            </div>

            <div className="bg-slate-50 border border-slate-200/70 rounded-xl p-6 dark:bg-slate-950/40 dark:border-slate-800/70">
              <div className="flex items-center justify-between mb-4">
                <h4 className="font-semibold text-slate-800 dark:text-slate-100 flex items-center gap-2">
                  <Lock className="w-4 h-4 text-slate-500 dark:text-slate-400" />
                  Backup Codes
                </h4>
                <Button size="sm" variant="outline" onClick={copyBackupCodes}>
                  {copiedCodes ? <Check className="w-4 h-4 mr-2" /> : <Copy className="w-4 h-4 mr-2" />}
                  {copiedCodes ? 'Copied' : 'Copy All'}
                </Button>
              </div>
              <div className="grid grid-cols-2 gap-3">
                {setupData.backupCodes.map((code, idx) => (
                  <div key={idx} className="font-mono text-sm bg-white border border-slate-200/70 px-3 py-2 rounded text-center text-slate-600 dark:bg-slate-900/70 dark:border-slate-800/70 dark:text-slate-200">
                    {code}
                  </div>
                ))}
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-4 flex items-center gap-2">
                <AlertTriangle className="w-3 h-3 text-amber-500" />
                If you lose your device, these codes are the only way to access your account.
              </p>
            </div>

            <div className="flex justify-end">
              <Button onClick={() => setSetupStep(0)}>I have saved my codes</Button>
            </div>
          </div>
        )}

        {/* State: Enabled (Idle) */}
        {isEnabled && setupStep === 0 && (
          <div className="flex flex-col gap-4">
            <div className="p-4 bg-slate-50 rounded-xl border border-slate-200/70 dark:bg-slate-950/40 dark:border-slate-800/70">
              <div className="flex items-start gap-4">
                <div className="p-3 bg-white rounded-full border border-slate-200/70 shadow-sm dark:bg-slate-900/70 dark:border-slate-800/70">
                  <Smartphone className="w-6 h-6 text-slate-400 dark:text-slate-300" />
                </div>
                <div className="flex-1">
                  <h4 className="font-medium text-slate-900 dark:text-slate-100">Authenticator App</h4>
                  <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                    Use an app like Google Authenticator or Authy to generate verification codes.
                  </p>
                </div>
                <Button
                  variant="outline"
                  className="text-red-600 border-red-200 hover:bg-red-50 dark:text-red-300 dark:border-red-900/60 dark:hover:bg-red-900/30"
                  onClick={() => setShowDisableDialog(true)}
                >
                  Disable
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Disable Confirmation Dialog */}
      <Dialog open={showDisableDialog} onOpenChange={setShowDisableDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Disable Two-Factor Authentication?</DialogTitle>
            <DialogDescription>
              This will remove the extra layer of security from your account. You will need to re-configure 2FA if you want to use it again.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDisableDialog(false)}>Cancel</Button>
            <Button variant="destructive" onClick={handleDisable}>Yes, Disable 2FA</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default TwoFactorSettings;
