'use client';

import { useV3Dashboard } from '../contexts/V3DashboardDataContext';
import type { IntelligenceData } from '../lib/v3DashboardFetchers';

export type { SignalGateView, IntelligenceData } from '../lib/v3DashboardFetchers';

interface UseIntelligenceDataReturn {
  data: IntelligenceData | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

export function useIntelligenceData(): UseIntelligenceDataReturn {
  return useV3Dashboard().intelligence;
}
