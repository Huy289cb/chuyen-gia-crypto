/**
 * Base URL for Express `/api` routes.
 * Browser: same-origin `/api` (Vercel/nginx rewrite) — avoids mixed-content when
 * NEXT_PUBLIC_API_URL points at http://VPS.
 * Dev server: direct backend on :3000 (same as useTrends / useTestnet).
 */
export function getApiBase(): string {
  if (typeof window !== 'undefined') {
    return '/api';
  }

  const fromEnv = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, '');
  if (fromEnv) {
    return fromEnv.endsWith('/api') ? fromEnv : `${fromEnv}/api`;
  }

  if (process.env.NODE_ENV === 'development') {
    return 'http://localhost:3000/api';
  }

  return '/api';
}
