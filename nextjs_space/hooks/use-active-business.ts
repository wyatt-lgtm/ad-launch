'use client';

import { useState, useEffect, useCallback, useSyncExternalStore } from 'react';
import { useSession } from 'next-auth/react';

export interface BusinessInfo {
  id: string;
  websiteUrl: string;
  businessName: string | null;
  /** Derived from websiteUrl — e.g. "blazinghog.com" */
  businessDomain: string;
  businessCity: string | null;
  businessState: string | null;
  businessZip: string | null;
  createdAt: string;
  updatedAt: string;
  _count: { analyses: number };
}

/** Extract clean domain from a URL string */
function extractDomain(url: string): string {
  try {
    return new URL(url.startsWith('http') ? url : `https://${url}`).hostname.replace(/^www\./, '');
  } catch {
    return url.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '');
  }
}

interface UseActiveBusinessResult {
  businesses: BusinessInfo[];
  activeBusiness: BusinessInfo | null;
  setActiveBusiness: (biz: BusinessInfo) => void;
  loading: boolean;
  /** True when user has multiple businesses and hasn't picked one yet */
  needsSelection: boolean;
  /** True when user has zero businesses */
  noBusiness: boolean;
  refetch: () => Promise<void>;
}

const STORAGE_KEY = 'adlaunch_active_business_id';

/** Read the saved business ID from localStorage (safe for SSR) */
function readStoredId(): string | null {
  if (typeof window === 'undefined') return null;
  try { return localStorage.getItem(STORAGE_KEY); } catch { return null; }
}

/** Write the business ID to localStorage */
function writeStoredId(id: string) {
  try { localStorage.setItem(STORAGE_KEY, id); } catch {}
  // Also keep sessionStorage for backward compat (other tabs may still read it during transition)
  try { sessionStorage.setItem(STORAGE_KEY, id); } catch {}
}

/**
 * Subscribe to cross-tab localStorage changes so switching business in one tab
 * is reflected in another tab without a manual refresh.
 */
let storageListeners: Array<() => void> = [];
function subscribeStorage(cb: () => void) {
  storageListeners.push(cb);
  const handler = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY) storageListeners.forEach(fn => fn());
  };
  if (storageListeners.length === 1) {
    window.addEventListener('storage', handler);
    // Store handler so we can remove later
    (subscribeStorage as any).__handler = handler;
  }
  return () => {
    storageListeners = storageListeners.filter(fn => fn !== cb);
    if (storageListeners.length === 0) {
      window.removeEventListener('storage', (subscribeStorage as any).__handler);
    }
  };
}
function getStorageSnapshot() { return readStoredId(); }
function getServerSnapshot() { return null; }

export function useActiveBusiness(): UseActiveBusinessResult {
  const { data: session, status } = useSession() || {};
  const [businesses, setBusinesses] = useState<BusinessInfo[]>([]);
  const [activeBusiness, setActiveBusinessState] = useState<BusinessInfo | null>(null);
  const [loading, setLoading] = useState(true);

  // Listen for cross-tab localStorage changes
  const externalStoredId = useSyncExternalStore(subscribeStorage, getStorageSnapshot, getServerSnapshot);

  const fetchBusinesses = useCallback(async () => {
    try {
      const res = await fetch('/api/user/businesses');
      const data = await res.json().catch(() => ({}));
      const list: BusinessInfo[] = (data?.businesses ?? []).map((b: any) => ({
        id: b.id,
        websiteUrl: b.websiteUrl,
        businessName: b.businessName,
        businessDomain: extractDomain(b.websiteUrl || ''),
        businessCity: b.businessCity,
        businessState: b.businessState,
        businessZip: b.businessZip,
        createdAt: b.createdAt,
        updatedAt: b.updatedAt,
        _count: b._count ?? { analyses: 0 },
      }));
      setBusinesses(list);

      // Auto-select logic
      if (list.length === 1) {
        setActiveBusinessState(list[0]);
        writeStoredId(list[0].id);
        console.log('[BusinessContext] auto-selected sole business', { selected_business_id: list[0].id, selected_business_name: list[0].businessName });
      } else if (list.length > 1) {
        // Try to restore previous selection from localStorage
        const savedId = readStoredId();
        const saved = savedId ? list.find(b => b.id === savedId) : null;
        if (saved) {
          setActiveBusinessState(saved);
          console.log('[BusinessContext] restored saved business', { selected_business_id: saved.id, selected_business_name: saved.businessName });
        }
        // else: needsSelection will be true
      }
    } catch (err) {
      console.error('[BusinessContext] fetch error:', err);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (status === 'authenticated') {
      fetchBusinesses();
    } else if (status === 'unauthenticated') {
      setLoading(false);
    }
  }, [status, fetchBusinesses]);

  // When another tab changes the stored ID, sync this tab
  useEffect(() => {
    if (!externalStoredId || businesses.length === 0) return;
    // Only react if it's different from current
    if (activeBusiness?.id === externalStoredId) return;
    const match = businesses.find(b => b.id === externalStoredId);
    if (match) {
      console.log('[BusinessContext] synced from other tab', { selected_business_id: match.id, selected_business_name: match.businessName });
      setActiveBusinessState(match);
    }
  }, [externalStoredId, businesses, activeBusiness?.id]);

  const setActiveBusiness = useCallback((biz: BusinessInfo) => {
    console.log('[BusinessContext] selected business changed', { selected_business_id: biz.id, selected_business_name: biz.businessName });
    setActiveBusinessState(biz);
    writeStoredId(biz.id);
  }, []);

  return {
    businesses,
    activeBusiness,
    setActiveBusiness,
    loading,
    needsSelection: !loading && businesses.length > 1 && !activeBusiness,
    noBusiness: !loading && businesses.length === 0,
    refetch: fetchBusinesses,
  };
}
