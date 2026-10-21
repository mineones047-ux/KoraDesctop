/**
 * Headless Kora core entrypoint — `node core-cli.mjs` speaks kora-rpc/1 over
 * stdio (docs/CORE_RPC.md §1: kora-cli drives the same core as the desktop
 * shell). Bundled by scripts/build-core-cli.cjs to dist-electron/core-cli.mjs.
 */
import { createCoreRunner } from './index'
import { createMethodTable, FileChatsStore, defaultDataDir } from './methods'
import path from 'path'

const dataDir = defaultDataDir()
const chats = new FileChatsStore(path.join(dataDir, 'chats.json'))

const runner = createCoreRunner({
  methods: createMethodTable(chats),
  dataDir,
})

process.stderr.write(`[kora-rpc] core listening on stdio (protocol kora-rpc/1, dataDir ${dataDir})\n`)
runner.attachStdio()
