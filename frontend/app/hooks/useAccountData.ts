'use client';

import { useV3Dashboard } from '../contexts/V3DashboardDataContext';
import type { AccountData } from '../lib/v3DashboardFetchers';

export type { AccountData } from '../lib/v3DashboardFetchers';

interface UseAccountDataReturn {
  data: AccountData | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

export function useAccountData(): UseAccountDataReturn {
  return useV3Dashboard().account;
}
