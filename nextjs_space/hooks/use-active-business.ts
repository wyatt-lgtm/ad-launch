'use client';

import { useState, useEffect, useCallback } from 'react';
import { useSession } from 'next-auth/react';

export interface BusinessInfo {
  id: string;
  websiteUrl: string;
  businessName: string | null;
  businessCity: string | null;
  businessState: string | null;
  businessZip: string | null;
  createdAt: string;
  updatedAt: string;
  _count: { analyses: number };
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

export function useActiveBusiness(): UseActiveBusinessResult {
  const { data: session, status } = useSession() || {};
  const [businesses, setBusinesses] = useState<BusinessInfo[]>([]);
  const [activeBusiness, setActiveBusinessState] = useState<BusinessInfo | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchBusinesses = useCallback(async () => {
    try {
      const res = await fetch('/api/user/businesses');
      const data = await res.json().catch(() => ({}));
      const list: BusinessInfo[] = (data?.businesses ?? []).map((b: any) => ({
        id: b.id,
        websiteUrl: b.websiteUrl,
        businessName: b.businessName,
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
        try { sessionStorage.setItem(STORAGE_KEY, list[0].id); } catch {}
      } else if (list.length > 1) {
        // Try to restore previous selection
        let savedId: string | null = null;
        try { savedId = sessionStorage.getItem(STORAGE_KEY); } catch {}
        const saved = savedId ? list.find(b => b.id === savedId) : null;
        if (saved) {
          setActiveBusinessState(saved);
        }
        // else: needsSelection will be true
      }
    } catch (err) {
      console.error('useActiveBusiness fetch error:', err);
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

  const setActiveBusiness = useCallback((biz: BusinessInfo) => {
    setActiveBusinessState(biz);
    try { sessionStorage.setItem(STORAGE_KEY, biz.id); } catch {}
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
