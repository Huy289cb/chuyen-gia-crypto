/**
 * Guard against silent typos in critical runtime strings (headers, dotenv, env keys).
 * These bugs pass TypeScript but fail at runtime with confusing errors.
 */
import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

const SRC_ROOT = path.join(__dirname, '../../src');

function readSrc(rel: string): string {
  return fs.readFileSync(path.join(SRC_ROOT, rel), 'utf8');
}

describe('critical string guards', () => {
  it('openrouter-client uses Authorization header (not typo variants)', () => {
    const src = readSrc('services/openrouter-client.ts');
    expect(src).toContain('Authorization:');
    expect(src).not.toMatch(/Apehorization|Autorization|Bearrer/);
  });

  it('worker/server dotenv loads .env via path module', () => {
    for (const file of ['worker.ts', 'server.ts']) {
      const src = readSrc(file);
      expect(src).toMatch(/dotenv\.config\(\{\s*path:\s*require\('path'\)/);
      expect(src).not.toMatch(/require\('pae|pae":\s*require/);
    }
  });

  it('HTTP clients use standard Authorization spelling', () => {
    const clients = [
      'services/groq-client.ts',
      'services/cerebras-client.ts',
      'services/openrouter-client.ts',
    ];
    for (const file of clients) {
      const src = readSrc(file);
      if (!src.includes('Authorization')) continue;
      expect(src).not.toMatch(/Apehorization|Autorization|Bearrer/);
    }
  });
});
