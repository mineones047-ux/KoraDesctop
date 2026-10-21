/**
 * Bundle the headless kora-rpc/1 core (core/cli.ts) into a single
 * self-contained ESM file: dist-electron/core-cli.mjs.
 *
 * Mirrors scripts/build-main.cjs conventions: esbuild, ESM output, node
 * platform built-ins external, production minification off (small + debuggable).
 *
 * `buildCoreCli()` is exported because `scripts/build-main.cjs` wipes
 * `dist-electron/` and then rebuilds everything that ships in it — the headless
 * core is one of those artifacts (docs/CORE_RPC.md §1), so it must be produced by
 * the same command that clears the directory. Running this file directly
 * (`npm run build:core-cli`) does the same thing on its own.
 */
const esbuild = require('esbuild')
const path = require('path')

const outdir = path.resolve(__dirname, '..', 'dist-electron')

async function buildCoreCli() {
  await esbuild.build({
    entryPoints: [path.resolve(__dirname, '..', 'core', 'cli.ts')],
    bundle: true,
    platform: 'node',
    target: 'node18',
    format: 'esm',
    outfile: path.join(outdir, 'core-cli.mjs'),
    sourcemap: false,
    logLevel: 'info',
    banner: {
      // ESM on Node: __dirname is unavailable in bundled output.
      js: `import { createRequire as __createRequire } from 'module';\nconst require = __createRequire(import.meta.url);\nconst __dirname = '.';`,
    },
  })
  return path.join(outdir, 'core-cli.mjs')
}

module.exports = { buildCoreCli }

if (require.main === module) {
  buildCoreCli().catch((err) => {
    console.error('[build-core-cli] failed:', err)
    process.exit(1)
  })
}
