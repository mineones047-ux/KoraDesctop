const { spawn } = require('child_process')
const http = require('http')
const path = require('path')

const VITE_URL = 'http://localhost:5173'
const MAX_RETRIES = 30
const RETRY_DELAY = 1000
const PROJECT_ROOT = path.join(__dirname, '..')
const TSC_CLI = path.join(PROJECT_ROOT, 'node_modules', 'typescript', 'bin', 'tsc')
const ELECTRON_CLI = path.join(PROJECT_ROOT, 'node_modules', 'electron', 'cli.js')
const GPU_FAILURE_EXIT_CODES = new Set([2147483651])

function checkServer(url) {
  return new Promise((resolve) => {
    let settled = false
    const finish = (ready) => {
      if (settled) return
      settled = true
      resolve(ready)
    }
    const request = http.get(url, (response) => {
      response.resume()
      finish(response.statusCode === 200)
    })
    request.setTimeout(1500, () => {
      request.destroy()
      finish(false)
    })
    request.on('error', () => finish(false))
  })
}

async function waitForVite() {
  for (let i = 0; i < MAX_RETRIES; i++) {
    if (await checkServer(VITE_URL)) return true
    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY))
  }
  return false
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { shell: false, stdio: 'inherit', ...options })
    child.once('close', (code) => resolve(code ?? 1))
    child.once('error', reject)
  })
}

async function launchElectron(disableGpu) {
  const args = ['electron', '.']
  if (disableGpu) args.push('--disable-gpu', '--disable-software-rasterizer')
  return run(process.execPath, [ELECTRON_CLI, ...args.slice(1)], {
    cwd: PROJECT_ROOT,
    env: {
      ...process.env,
      VITE_DEV_SERVER_URL: VITE_URL,
      KORA_DISABLE_GPU: disableGpu ? '1' : '0',
    },
  })
}

async function main() {
  console.log('[1/3] Compiling Electron...')
  const tscExit = await run(process.execPath, [TSC_CLI, '--project', 'tsconfig.electron.json'], {
    cwd: PROJECT_ROOT,
  })
  if (tscExit !== 0) {
    console.error('TypeScript compilation failed')
    process.exit(1)
  }

  console.log('[2/3] Waiting for Vite dev server...')
  if (!(await waitForVite())) {
    console.error('Vite dev server failed to start')
    process.exit(1)
  }

  console.log('[3/3] Starting Electron...')
  let code = await launchElectron(process.env.KORA_DISABLE_GPU === '1')
  if (GPU_FAILURE_EXIT_CODES.has(code) && process.env.KORA_DISABLE_GPU !== '1') {
    console.warn('[KORA] Electron GPU process failed. Restarting once with GPU acceleration disabled...')
    code = await launchElectron(true)
  }
  process.exit(code || 0)
}

main().catch((error) => {
  console.error('[KORA] Electron development launch failed:', error)
  process.exit(1)
})
