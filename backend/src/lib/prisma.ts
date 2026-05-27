import { PrismaClient } from '@prisma/client';

// PrismaClient is attached to the `global` object in development to prevent
// exhausting your database connection limit.
const globalForPrisma = global as unknown as { prisma: PrismaClient };

/**
 * Optionally caps Prisma engine connections per Node process (important for small
 * Postgres pools when running `crypto-api` + `crypto-worker` together).
 *
 * - If `PRISMA_CONNECTION_LIMIT` is set, it is applied (overwriting any existing
 *   `connection_limit` query param).
 * - In production, defaults to `1` per process when neither the URL nor env
 *   already specify a limit.
 */
export function resolveDatabaseUrl(raw: string | undefined): string | undefined {
  if (!raw) return undefined;

  const envLimit = process.env.PRISMA_CONNECTION_LIMIT?.trim();
  const urlHasLimit = /[?&]connection_limit=/i.test(raw);
  const defaultProdLimit =
    process.env.NODE_ENV === 'production' && !envLimit && !urlHasLimit ? '1' : '';
  const limit = envLimit || defaultProdLimit;

  if (!limit) {
    return raw;
  }

  try {
    const u = new URL(raw);
    u.searchParams.set('connection_limit', limit);
    return u.toString();
  } catch {
    if (urlHasLimit) {
      return raw;
    }
    const sep = raw.includes('?') ? '&' : '?';
    return `${raw}${sep}connection_limit=${encodeURIComponent(limit)}`;
  }
}

const resolvedUrl = resolveDatabaseUrl(process.env.DATABASE_URL);

export const prisma =
  globalForPrisma.prisma ||
  new PrismaClient({
    ...(resolvedUrl
      ? {
          datasources: {
            db: { url: resolvedUrl },
          },
        }
      : {}),
    log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

// Graceful shutdown
export async function disconnectPrisma() {
  await prisma.$disconnect();
}

// Handle process termination
process.on('beforeExit', async () => {
  await disconnectPrisma();
});

export default prisma;
