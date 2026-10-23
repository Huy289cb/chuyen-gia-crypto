'use strict';
const cp = require('node:child_process');

// A month-sized run must not use the small volatile mount used by unit probes.
function inspectPortfolioStorage(container = 'roi-close-atomic-test-20261003') {
  const state = JSON.parse(cp.execFileSync('docker', ['inspect', container], { encoding: 'utf8' }))[0];
  const binding = state.NetworkSettings.Ports?.['5432/tcp'];
  if (!state.State.Running || binding?.length !== 1 || binding[0].HostIp !== '127.0.0.1' || binding[0].HostPort !== '55439') {
    throw Error('isolated_storage_endpoint_required');
  }
  const mount = state.Mounts.find(item => item.Destination === '/var/lib/postgresql/data');
  if (!mount || !['volume', 'bind'].includes(mount.Type) || !mount.RW || state.HostConfig.Tmpfs?.['/var/lib/postgresql/data'] !== undefined) {
    throw Error('month_run_requires_persistent_disk_storage');
  }
  const lines = cp.execFileSync('docker', ['exec', container, 'df', '-Pk', '/var/lib/postgresql/data'], { encoding: 'utf8' }).trim().split('\n');
  const fields = lines.at(-1).trim().split(/\s+/);
  const freeBytes = Number(fields[3]) * 1024;
  if (!Number.isFinite(freeBytes) || freeBytes < 2 * 1024 ** 3 || fields[0] === 'tmpfs') {
    throw Error('isolated_disk_free_below_2gib_or_volatile');
  }
  return { container, mount_type: mount.Type, volume: mount.Name ?? null, free_bytes: freeBytes, minimum_free_bytes: 2 * 1024 ** 3, filesystem: fields[0], checked_at: Date.now() };
}
module.exports = { inspectPortfolioStorage };
