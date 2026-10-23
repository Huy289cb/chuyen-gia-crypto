import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

export class PortfolioBusyError extends Error {
  constructor() { super('Portfolio paper is processing another request'); }
}

export const backendRoot = path.resolve(__dirname, '../..');
export const repositoryRoot = path.dirname(backendRoot);
export const portfolioStoreDirectory = process.env.PORTFOLIO_PAPER_DATA_DIR || path.join(backendRoot, 'data/portfolio-paper-v1');

/** A strategy change creates an explicitly separate wallet; V1 bytes are never migrated/reset. */
export function portfolioPolicyStoreDirectory(policyId = 'momentum-v1'): string {
  return policyId === 'momentum-v1' ? portfolioStoreDirectory : path.join(portfolioStoreDirectory, policyId);
}

export async function readJson<T>(file: string): Promise<T | null> {
  try { return JSON.parse(await fs.readFile(file, 'utf8')) as T; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
}

/** One rename publishes the entire wallet, budget, dedup IDs and event ledger. */
export async function writeJsonAtomic(file: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
  const handle = await fs.open(temporary, 'wx', 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`);
    await handle.sync();
  } finally { await handle.close(); }
  try {
    await fs.rename(temporary, file);
    const directory = await fs.open(path.dirname(file), 'r');
    try { await directory.sync(); } finally { await directory.close(); }
  } catch (error) { await fs.rm(temporary, { force: true }); throw error; }
}

/** Cross-process exclusion for API and the dedicated paper worker. No lock expiry while an owner lives. */
export async function withPortfolioLock<T>(directory: string, operation: () => Promise<T>): Promise<T> {
  await fs.mkdir(directory, { recursive: true });
  const lock = path.join(directory, '.wallet-lock');
  const token = randomUUID();
  const ownerText = `${process.pid}:${token}`;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      // A symlink publishes owner identity atomically with exclusive acquisition.
      await fs.symlink(ownerText, lock);
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      if (attempt > 0) throw new PortfolioBusyError();
      const recovery = path.join(directory, '.wallet-lock-recovery');
      try { await fs.mkdir(recovery); } catch { throw new PortfolioBusyError(); }
      try {
        const owner = await fs.readlink(lock);
        const pid = Number(owner.split(':')[0]);
        if (!Number.isSafeInteger(pid) || pid < 1) throw new PortfolioBusyError();
        try { process.kill(pid, 0); throw new PortfolioBusyError(); }
        catch (pidError) { if ((pidError as NodeJS.ErrnoException).code !== 'ESRCH') throw new PortfolioBusyError(); }
        await fs.unlink(lock);
      } finally { await fs.rmdir(recovery); }
    }
  }
  try { return await operation(); }
  finally {
    const owner = await fs.readlink(lock).catch(() => null);
    if (owner === ownerText) await fs.unlink(lock);
  }
}
