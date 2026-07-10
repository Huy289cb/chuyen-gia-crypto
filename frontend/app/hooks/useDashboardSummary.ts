'use client';

import { useV3Dashboard } from '../contexts/V3DashboardDataContext';
import type { DashboardSummaryData } from '../lib/v3DashboardFetchers';

export type { DashboardSummaryData } from '../lib/v3DashboardFetchers';

interface UseDashboardSummaryReturn {
  data: DashboardSummaryData | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

export function useDashboardSummary(): UseDashboardSummaryReturn {
  return useV3Dashboard().summary;
}
