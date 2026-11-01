/**
 * Smoke test for agy-chat integration.
 * Tests spawning agy and verifies that agy command handling works.
 *
 * Usage: npx tsx scripts/smoke-agy-chat.ts
 */
import { spawn } from 'node:child_process';
import path from 'node:path';

async function main() {
  console.log('Testing agy binary accessibility...');
  const agyPath = process.env.AGY_BINARY_PATH || '/home/ubuntu/.local/bin/agy';

  const cp = spawn(agyPath, ['--version']);
  let out = '';
  cp.stdout.on('data', (d) => {
    out += d.toString();
  });

  cp.on('close', (code) => {
    if (code === 0) {
      console.log(`✅ agy binary found and functional: version ${out.trim()}`);
      process.exit(0);
    } else {
      console.error(`❌ agy exited with code ${code}`);
      process.exit(1);
    }
  });

  cp.on('error', (err) => {
    console.error('❌ Failed to spawn agy:', err);
    process.exit(1);
  });
}

main().catch(console.error);
