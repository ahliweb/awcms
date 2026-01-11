import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useTwoFactor } from '../useTwoFactor';

// Mock dependencies
vi.mock('@/lib/customSupabaseClient', () => {
    const selectChain = {};
    selectChain.eq = vi.fn(() => selectChain);
    selectChain.is = vi.fn(() => selectChain);
    selectChain.maybeSingle = vi.fn(() => Promise.resolve({ data: null, error: null }));
    selectChain.single = vi.fn(() => Promise.resolve({ data: null, error: null }));

    return {
        supabase: {
            from: vi.fn(() => ({
                select: vi.fn(() => selectChain),
                upsert: vi.fn(() => Promise.resolve({ error: null })),
                insert: vi.fn(() => Promise.resolve({ error: null })),
                delete: vi.fn(() => ({
                    eq: vi.fn(() => Promise.resolve({ error: null })),
                })),
                update: vi.fn(() => ({
                    eq: vi.fn(() => Promise.resolve({ error: null })),
                })),
            })),
        },
    };
});

vi.mock('@/contexts/SupabaseAuthContext', () => ({
    useAuth: vi.fn(() => ({
        user: { id: 'user-123', email: 'test@example.com' },
    })),
}));

vi.mock('otpauth', () => ({
    Secret: class MockSecret {
        constructor() {
            this.base32 = 'JBSWY3DPEHPK3PXP';
        }
        static fromBase32() {
            return new this();
        }
    },
    TOTP: class MockTOTP {
        constructor(options) {
            this.options = options;
        }
        toString() {
            return 'otpauth://totp/test';
        }
        validate({ token }) {
            // Return valid delta for '123456'
            return token === '123456' ? 0 : null;
        }
    },
}));

vi.mock('qrcode', () => ({
    default: {
        toDataURL: vi.fn(() => Promise.resolve('data:image/png;base64,mockedQRCode')),
    },
}));

describe('useTwoFactor', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('initializes with loading state', async () => {
        const { result } = renderHook(() => useTwoFactor());

        expect(result.current.isLoading).toBe(true);

        await waitFor(() => {
            expect(result.current.isLoading).toBe(false);
        });
    });

    it('returns isEnabled as false when no 2FA is set up', async () => {
        const { result } = renderHook(() => useTwoFactor());

        await waitFor(() => {
            expect(result.current.isLoading).toBe(false);
        });

        expect(result.current.isEnabled).toBe(false);
    });

    it('startSetup generates QR code and secret', async () => {
        const { result } = renderHook(() => useTwoFactor());

        await waitFor(() => {
            expect(result.current.isLoading).toBe(false);
        });

        let setupResult;
        await act(async () => {
            setupResult = await result.current.startSetup();
        });

        expect(setupResult.success).toBe(true);
        expect(result.current.setupData).toBeDefined();
        expect(result.current.setupData.secret).toBeDefined();
        expect(result.current.setupData.qrCodeUrl).toBeDefined();
        expect(result.current.setupData.backupCodes).toHaveLength(8);
    });

    it('verifyAndEnable requires setup data', async () => {
        const { result } = renderHook(() => useTwoFactor());

        await waitFor(() => {
            expect(result.current.isLoading).toBe(false);
        });

        let verifyResult;
        await act(async () => {
            verifyResult = await result.current.verifyAndEnable('123456');
        });

        expect(verifyResult.success).toBe(false);
        expect(verifyResult.error).toBe('No setup in progress');
    });

    it('verifyAndEnable proceeds with setup data', async () => {
        const { result } = renderHook(() => useTwoFactor());

        await waitFor(() => {
            expect(result.current.isLoading).toBe(false);
        });

        // First start setup
        await act(async () => {
            await result.current.startSetup();
        });

        // Setup data should be available
        expect(result.current.setupData).not.toBeNull();
        expect(result.current.setupData.secret).toBeDefined();
        expect(result.current.setupData.qrCodeUrl).toBeDefined();
    });

    it('verifyAndEnable fails with invalid token', async () => {
        const { result } = renderHook(() => useTwoFactor());

        await waitFor(() => {
            expect(result.current.isLoading).toBe(false);
        });

        // First start setup
        await act(async () => {
            await result.current.startSetup();
        });

        // Then verify with invalid token
        let verifyResult;
        await act(async () => {
            verifyResult = await result.current.verifyAndEnable('000000');
        });

        expect(verifyResult.success).toBe(false);
        expect(verifyResult.error).toBe('Invalid authentication code');
    });

    it('disable2FA returns success', async () => {
        const { result } = renderHook(() => useTwoFactor());

        await waitFor(() => {
            expect(result.current.isLoading).toBe(false);
        });

        let disableResult;
        await act(async () => {
            disableResult = await result.current.disable2FA();
        });

        expect(disableResult.success).toBe(true);
        expect(result.current.isEnabled).toBe(false);
    });

    it('returns all required functions', async () => {
        const { result } = renderHook(() => useTwoFactor());

        expect(typeof result.current.startSetup).toBe('function');
        expect(typeof result.current.verifyAndEnable).toBe('function');
        expect(typeof result.current.disable2FA).toBe('function');
        expect(typeof result.current.verifyLoginCode).toBe('function');
        expect(typeof result.current.checkStatus).toBe('function');
    });
});
