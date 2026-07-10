export interface ProtectiveExposureEntryBlock {
  reason: string;
  until: number;
  updatedAt: number;
}

let entryBlock: ProtectiveExposureEntryBlock | null = null;

export function setProtectiveExposureEntryBlock(reason: string, ttlMs: number): void {
  entryBlock = {
    reason,
    until: Date.now() + Math.max(ttlMs, 1),
    updatedAt: Date.now(),
  };
}

export function clearProtectiveExposureEntryBlock(): void {
  entryBlock = null;
}

export function getProtectiveExposureEntryBlock(): ProtectiveExposureEntryBlock | null {
  if (!entryBlock) return null;
  if (Date.now() > entryBlock.until) {
    entryBlock = null;
    return null;
  }
  return entryBlock;
}
