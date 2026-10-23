/**
 * Testnet Routes backed by Prisma + PostgreSQL
 */
import { prisma } from '../lib/prisma';
declare const router: import("express-serve-static-core").Router;
declare global {
    namespace Express {
        interface Request {
            prisma?: typeof prisma;
        }
    }
}
export default router;
//# sourceMappingURL=testnet.d.ts.map