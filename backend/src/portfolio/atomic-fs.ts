import { promises as fs } from 'node:fs';
import path from 'node:path';

/**
 * Atomically writes UTF-8 content to a file using a PID-scoped temporary file and rename.
 * Prevents truncated or corrupted JSON state if the process restarts mid-write.
 */
export async function atomicWriteFile(filePath: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.${process.pid}.tmp`;
  await fs.writeFile(tmpPath, content, 'utf8');
  await fs.rename(tmpPath, filePath);
}
