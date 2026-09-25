/**
 * Bundle the Electron main process into a single file each (ROADMAP Phase 0:
 * "bundle the main process into one file instead of 25 tsc-emitted CJS
 * modules" - fewer disk reads and `require` calls at boot).
 *
 * - `packages: 'external'` keeps node_modules packages (msedge-tts, ...) as
 *   runtime requires, exactly like the old tsc output did; only the project's
 *   own sources are inlined.
 * - `dist-electron` is wiped first so no stale per-module tsc output remains.
 * - Type checking stays with `tsc -p tsconfig.electron.json` (noEmit).
 */
const { build } = require('esbuild')
const { rmSync } = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..')
const OUT = path.join(ROOT, 'dist-electron')

async function main() {
  rmSync(OUT, { recursive: true, force: true })

  await build({
    entryPoints: [path.join(ROOT, 'electron', 'main.ts'), path.join(ROOT, 'electron', 'preload.ts')],
    outdir: OUT,
    entryNames: '[name]',
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node20',
    packages: 'external',
    external: ['electron'],
    sourcemap: false,
    logLevel: 'info',
  })

  // Self-contained bundles of the reference MCP servers. The app spawns them
  // with ELECTRON_RUN_AS_NODE, which cannot read files inside app.asar - so
  // each server must be ONE real file with no external requires (shipped via
  // the asarUnpack rule "dist-electron/mcp/**"). This replaces the old
  // `npx -y <pkg>` launches (ROADMAP Phase 0: "stop spawning npx for MCP
  // servers") and lets the packages live in devDependencies instead of
  // shipping their 131-package runtime closure inside the installer.
  const fs = require('fs')
  const MCP_PKGS = [
    '@modelcontextprotocol/server-filesystem',
    '@modelcontextprotocol/server-memory',
    '@modelcontextprotocol/server-sequential-thinking',
  ]
  const mcpEntries = {}
  for (const pkg of MCP_PKGS) {
    const segs = pkg.split('/')
    const pkgDir = path.join(ROOT, 'node_modules', ...segs)
    const meta = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf-8'))
    const base = segs[segs.length - 1]
    const bin = meta.bin
    const rel =
      typeof bin === 'string' ? bin : bin?.[base] ?? (bin && typeof bin === 'object' ? Object.values(bin)[0] : undefined)
    if (typeof rel !== 'string') throw new Error('No bin found for ' + pkg)
    mcpEntries[base] = path.join(pkgDir, rel)
  }

  await build({
    entryPoints: mcpEntries,
    outdir: path.join(OUT, 'mcp'),
    entryNames: '[name]',
    outExtension: { '.js': '.mjs' },
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node20',
    external: ['electron'],
    sourcemap: false,
    logLevel: 'info',
  })

  // server-sequential-thinking reads `package.json` next to its entry point at
  // runtime (dist/version.js candidates: <moduleDir>/package.json, then
  // <moduleDir>/../package.json) to report its version in the MCP handshake -
  // ship a copy beside the bundles (dist-electron/mcp is asarUnpacked, so the
  // file stays readable/executable for the spawned child).
  fs.copyFileSync(
    path.join(ROOT, 'node_modules', '@modelcontextprotocol', 'server-sequential-thinking', 'package.json'),
    path.join(OUT, 'mcp', 'package.json'),
  )

  console.log('[KORA] main-process bundle built -> dist-electron/ (+ mcp/ servers)')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
