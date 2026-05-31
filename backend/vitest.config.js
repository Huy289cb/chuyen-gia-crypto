import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const backendRoot = path.dirname(fileURLToPath(import.meta.url));

/** Legacy tests use `import '.../foo.js'`; map to `foo.ts` when present. */
function resolveJsImportsAsTs() {
  return {
    name: 'resolve-js-imports-as-ts',
    enforce: 'pre',
    resolveId(source, importer) {
      if (!importer || !source.endsWith('.js')) {
        return null;
      }
      const tsPath = path.resolve(path.dirname(importer), `${source.slice(0, -3)}.ts`);
      if (fs.existsSync(tsPath)) {
        return tsPath;
      }
      return null;
    },
  };
}

export default defineConfig({
  plugins: [resolveJsImportsAsTs()],
  resolve: {
    extensionAlias: {
      '.js': ['.ts', '.js'],
      '.mjs': ['.mts', '.mjs'],
    },
  },
  test: {
    globals: true,
    environment: 'node',
    pool: 'forks',
    root: backendRoot,
    include: ['tests/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts}'],
    exclude: ['node_modules'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: ['node_modules/', 'tests/'],
    },
  },
});
