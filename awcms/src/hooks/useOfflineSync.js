import { useEffect, useState } from 'react';
import { syncEngine } from '@/lib/offline/SyncEngine';
import { SYNC_TABLES } from '@/lib/offline/schemaConverter';

/**
 * Hook to initialize the Offline Sync Engine and manage initial data pull.
 */
export function useOfflineSync() {
    const [isInitialized, setIsInitialized] = useState(false);
    const [isSyncing, setIsSyncing] = useState(false);
    const [online, setOnline] = useState(navigator.onLine);

    useEffect(() => {
        // 1. Listen for Online Status
        const updateOnline = () => setOnline(navigator.onLine);
        window.addEventListener('online', updateOnline);
        window.addEventListener('offline', updateOnline);

        // 2. Initialize Engine
        const init = async () => {
            try {
                await syncEngine.init();
                setIsInitialized(true);

                // 3. Initial Pull (Background)
                if (navigator.onLine) {
                    setIsSyncing(true);
                    // Pull all tables in sequence or parallel
                    for (const table of SYNC_TABLES) {
                        await syncEngine.pull(table);
                    }
                    setIsSyncing(false);
                }
            } catch (err) {
                console.error('[useOfflineSync] Init failed:', err);
            }
        };

        init();

        return () => {
            window.removeEventListener('online', updateOnline);
            window.removeEventListener('offline', updateOnline);
        };
    }, []);

    return { isInitialized, isSyncing, online };
}
