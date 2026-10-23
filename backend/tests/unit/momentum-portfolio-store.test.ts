import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PortfolioBusyError, readJson, withPortfolioLock, writeJsonAtomic } from '../../src/portfolio/paper-store';

const directories: string[] = [];
async function temporary(): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'portfolio-paper-test-'));
  directories.push(directory); return directory;
}
afterEach(async () => { await Promise.all(directories.splice(0).map(directory => fs.rm(directory, { recursive: true, force: true }))); });

describe('durable shared paper wallet store', () => {
  it('publishes wallet and budget together and preserves decimal strings on reload', async () => {
    const directory = await temporary(); const file = path.join(directory, 'wallet.json');
    expect(await readJson(file)).toBeNull();
    const wallet = { cash: '99.9999999999999999999', dayAnchor: '100', latched: true, funded: ['f1'] };
    await writeJsonAtomic(file, wallet);
    expect(await readJson(file)).toEqual(wallet);
    expect((await fs.readdir(directory)).filter(name => name.endsWith('.tmp'))).toHaveLength(0);
    await fs.writeFile(file, '{broken');
    await expect(readJson(file)).rejects.toThrow();
  });
  it('excludes another writer and releases the owner lock after a failed transaction', async () => {
    const directory = await temporary();
    let unlock!: () => void;
    let entered!: () => void;
    const enteredPromise = new Promise<void>(resolve => { entered = resolve; });
    const waiting = new Promise<void>(resolve => { unlock = resolve; });
    const first = withPortfolioLock(directory, async () => { entered(); await waiting; });
    await enteredPromise;
    await expect(withPortfolioLock(directory, async () => 'second')).rejects.toBeInstanceOf(PortfolioBusyError);
    unlock(); await first;
    await expect(withPortfolioLock(directory, async () => { throw new Error('aborted'); })).rejects.toThrow('aborted');
    expect(await withPortfolioLock(directory, async () => 'recovered')).toBe('recovered');
  });
  it('recovers a dead process lock while preserving its previously committed wallet', async () => {
    const directory = await temporary(); const file = path.join(directory, 'wallet.json');
    await writeJsonAtomic(file, { loss: '-9', latched: true });
    const deadPid = Number(execFileSync(process.execPath, ['-e', 'process.stdout.write(String(process.pid))'], { encoding: 'utf8' }));
    await fs.symlink(`${deadPid}:dead-owner`, path.join(directory, '.wallet-lock'));
    expect(await withPortfolioLock(directory, () => readJson(file))).toEqual({ loss: '-9', latched: true });
  });
});
