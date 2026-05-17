/**
 * Base URL for Express `/api` routes.
 * In development, call the backend directly (same as useTrends / useTestnet).
 * In production, use same-origin `/api` (Vercel/nginx rewrite to backend).
 */
export function getApiBase(): string {
  const fromEnv = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, '');
  if (fromEnv) return fromEnv;

  if (process.env.NODE_ENV === 'development') {
    return 'http://localhost:3000/api';
  }

  return '/api';
}
