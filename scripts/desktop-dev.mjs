/**
 * Desktop development runner for JARVIS.
 * Spawns the Bridge, the Vite dev server, and Electron pointing at the dev URL.
 * Shuts down all processes cleanly when Electron closes or on Ctrl-C.
 */

import { spawn } from 'node:child_process'
import process from 'node:process'
import http from 'node:http'
import { cpSync, existsSync, mkdirSync } from 'node:fs'

function vendorWasm() {
  const from = 'node_modules/@mediapipe/tasks-vision/wasm'
  const to = 'public/mediapipe'
  if (!existsSync(from)) return
  if (existsSync(`${to}/vision_wasm_internal.wasm`)) return
  try {
    mkdirSync(to, { recursive: true })
    cpSync(from, to, { recursive: true })
    console.log('  [desktop:dev] vendored hand-tracking wasm into public/mediapipe.')
  } catch (err) {
    console.warn(`  [desktop:dev] could not vendor wasm: ${err?.message}`)
  }
}

async function waitForServer(url, timeoutMs = 20000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      const ok = await new Promise((resolve) => {
        const req = http.get(url, (res) => {
          res.resume()
          resolve(res.statusCode < 500)
        })
        req.on('error', () => resolve(false))
        req.setTimeout(500, () => {
          req.destroy()
          resolve(false)
        })
      })
      if (ok) return true
    } catch {}
    await new Promise((r) => setTimeout(r, 300))
  }
  return false
}

vendorWasm()

const children = []

function run(name, command, args, env = {}) {
  const proc = spawn(command, args, {
    stdio: 'inherit',
    shell: true,
    env: { ...process.env, ...env },
  })
  children.push(proc)
  return proc
}

function shutdown() {
  for (const child of children) {
    try {
      child.kill()
    } catch {}
  }
  process.exit(0)
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
process.on('exit', shutdown)

console.log('[desktop:dev] starting JARVIS bridge...')
run('bridge', 'node', ['bridge/server.mjs'], {
  JARVIS_BRIDGE_HOST: '127.0.0.1',
  JARVIS_BRIDGE_PORT: '8787',
})

console.log('[desktop:dev] starting Vite dev server...')
run('vite', 'npx', ['vite'], {
  PORT: '5173',
})

console.log('[desktop:dev] waiting for Vite dev server...')
const viteReady = await waitForServer('http://127.0.0.1:5173')
if (!viteReady) {
  console.warn('[desktop:dev] warning: Vite dev server did not respond in time, launching Electron anyway...')
}

console.log('[desktop:dev] launching Electron...')
const electronProc = run('electron', 'npx', ['electron', '.'], {
  VITE_DEV_SERVER_URL: 'http://127.0.0.1:5173',
})

electronProc.on('exit', (code) => {
  console.log(`[desktop:dev] Electron exited with code ${code}. Shutting down dev services...`)
  shutdown()
})
