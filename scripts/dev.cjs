const { execFile, spawn } = require('child_process')
const net = require('net')
const path = require('path')

const PROJECT_ROOT = path.join(__dirname, '..')
const VITE_PORT = 5173
const VITE_CLI = path.join(PROJECT_ROOT, 'node_modules', 'vite', 'bin', 'vite.js')

function run(command, args) {
  return new Promise((resolve) => {
    execFile(command, args, { windowsHide: true }, (_error, stdout) => resolve(stdout || ''))
  })
}

async function findPortOwner(port) {
  if (process.platform !== 'win32') return null
  const output = await run('netstat', ['-ano', '-p', 'tcp'])
  const match = output.split(/\r?\n/).find((line) =>
    line.includes(`:${port}`) && /LISTENING/i.test(line),
  )
  const pid = match?.trim().match(/\s(\d+)$/)?.[1]
  if (!pid) return null

  const task = await run('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'])
  const name = task.match(/^"([^"]+)"/)?.[1]
  return { pid, name }
}

function assertPortIsAvailable(port) {
  return new Promise((resolve, reject) => {
    const probe = net.createServer()
    probe.once('error', reject)
    probe.listen({ port, host: '::' }, () => {
      probe.close((error) => (error ? reject(error) : resolve()))
    })
  })
}

async function preflightPort() {
  const owner = await findPortOwner(VITE_PORT)
  if (owner) {
    console.error(`\n[KORA] Port ${VITE_PORT} is already in use. Process: ${owner.name || 'unknown'} (PID ${owner.pid}).`)
    console.error('[KORA] Stop the existing development server before running "npm run dev" again.')
    console.error(`[KORA] Windows command: netstat -ano | findstr :${VITE_PORT}`)
    return false
  }

  try {
    await assertPortIsAvailable(VITE_PORT)
    return true
  } catch (error) {
    if (error?.code !== 'EADDRINUSE') throw error
    console.error(`\n[KORA] Port ${VITE_PORT} became busy while starting.`)
    console.error('[KORA] Stop the other development server and run "npm run dev" again.')
    return false
  }
}

function stop(child) {
  if (child && !child.killed) child.kill()
}

async function main() {
  if (!(await preflightPort())) process.exit(1)

  const vite = spawn(process.execPath, [VITE_CLI], {
    cwd: PROJECT_ROOT,
    stdio: 'inherit',
    shell: false,
  })
  const electron = spawn(process.execPath, ['scripts/electron-dev.cjs'], {
    cwd: PROJECT_ROOT,
    stdio: 'inherit',
    shell: false,
  })
  let shuttingDown = false

  const shutdown = (code) => {
    if (shuttingDown) return
    shuttingDown = true
    stop(vite)
    stop(electron)
    process.exit(code)
  }

  vite.once('error', (error) => {
    console.error('[KORA] Failed to start Vite:', error.message)
    shutdown(1)
  })
  electron.once('error', (error) => {
    console.error('[KORA] Failed to start Electron:', error.message)
    shutdown(1)
  })
  vite.once('close', (code) => {
    if (!shuttingDown) {
      console.error(`[KORA] Vite exited unexpectedly (${code ?? 'unknown'}).`)
      shutdown(code || 1)
    }
  })
  electron.once('close', (code) => shutdown(code || 0))
  process.on('SIGINT', () => shutdown(0))
  process.on('SIGTERM', () => shutdown(0))
}

main().catch((error) => {
  console.error('[KORA] Development startup failed:', error)
  process.exit(1)
})
