import path from 'node:path';
import { readJson, writeJsonAtomic, withPortfolioLock } from './paper-store';

/** Separate from every paper checkpoint. The caller must also hand over exchange ownership. */
export const LIVE_WALLET_FILE = 'live-wallet.json';
export const liveWalletPath = (directory: string): string => path.join(directory, LIVE_WALLET_FILE);
export const readLiveWallet = <T>(directory: string): Promise<T | null> => readJson<T>(liveWalletPath(directory));
export const writeLiveWallet = (directory: string, wallet: unknown): Promise<void> => writeJsonAtomic(liveWalletPath(directory), wallet);
export const withLiveWalletLock = <T>(directory: string, operation: () => Promise<T>): Promise<T> => withPortfolioLock(directory, operation);
