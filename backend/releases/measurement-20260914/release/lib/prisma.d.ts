import { PrismaClient } from '@prisma/client';
/**
 * Optionally caps Prisma engine connections per Node process (important for small
 * Postgres pools when running `crypto-api` + `crypto-worker` together).
 *
 * - If `PRISMA_CONNECTION_LIMIT` is set, it is applied (overwriting any existing
 *   `connection_limit` query param).
 * - In production, defaults to `1` per process when neither the URL nor env
 *   already specify a limit.
 */
export declare function resolveDatabaseUrl(raw: string | undefined): string | undefined;
export declare const prisma: PrismaClient<import(".prisma/client").Prisma.PrismaClientOptions, never, import("@prisma/client/runtime/library").DefaultArgs>;
export declare function disconnectPrisma(): Promise<void>;
export default prisma;
//# sourceMappingURL=prisma.d.ts.map