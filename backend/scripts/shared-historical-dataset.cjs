'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

// Certificates retain neither the parsed graph nor its source bytes.
const certifiedBundles = new WeakSet();

function resolveDatasetPath(datasetPath) {
  if (typeof datasetPath !== 'string' || !datasetPath.length) {
    throw Error('explicit_historical_dataset_path_required');
  }
  return path.resolve(datasetPath);
}

function freezeDataGraph(data) {
  const pending = [data];
  while (pending.length) {
    const value = pending.pop();
    if (value === null || typeof value !== 'object' || Object.isFrozen(value)) continue;
    for (const child of Object.values(value)) {
      if (child !== null && typeof child === 'object') pending.push(child);
    }
    Object.freeze(value);
  }
  return data;
}

function createHistoricalDatasetBundle({ datasetPath, expectedSha256 }) {
  const dataset_path = resolveDatasetPath(datasetPath);
  if (typeof expectedSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(expectedSha256)) {
    throw Error('explicit_historical_dataset_sha256_required');
  }
  const bytes = fs.readFileSync(dataset_path);
  const dataset_sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  if (dataset_sha256 !== expectedSha256) throw Error('historical_dataset_hash_mismatch');
  const data = freezeDataGraph(JSON.parse(bytes.toString('utf8')));
  const bundle = Object.freeze({ dataset_path, dataset_sha256, data });
  certifiedBundles.add(bundle);
  return bundle;
}

function assertHistoricalDatasetBundle({ datasetBundle, datasetPath, expectedSha256 }) {
  if (!certifiedBundles.has(datasetBundle)) throw Error('uncertified_historical_dataset_bundle');
  if (resolveDatasetPath(datasetPath) !== datasetBundle.dataset_path) {
    throw Error('historical_dataset_bundle_path_mismatch');
  }
  if (expectedSha256 !== undefined && expectedSha256 !== datasetBundle.dataset_sha256) {
    throw Error('historical_dataset_bundle_hash_mismatch');
  }
  return datasetBundle;
}

module.exports = { createHistoricalDatasetBundle, assertHistoricalDatasetBundle };
