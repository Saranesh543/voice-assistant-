import {
  app,
  BrowserWindow,
  Tray,
  Menu,
  nativeImage,
  globalShortcut,
  ipcMain,
  screen,
  session,
} from 'electron'
import { spawn } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  cpSync,
  createReadStream,
  statSync,
} from 'node:fs'
import { join, resolve, extname, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import http from 'node:http'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const ROOT_DIR = resolve(__dirname, '..')

// ---------------------------------------------------------------------------
// Single-Instance Lock
// ---------------------------------------------------------------------------
const gotTheLock = app.requestSingleInstanceLock()
if (!gotTheLock) {
  console.log('[desktop] another instance is already running; exiting.')
  app.quit()
  process.exit(0)
}

// ---------------------------------------------------------------------------
// Hardware & Audio Switches
// ---------------------------------------------------------------------------
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')
app.commandLine.appendSwitch('enable-features', 'Vulkan,WebGPU')

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
/** @type {'overlay' | 'compact'} */
let windowMode = 'overlay'
let alwaysOnTop = true
let clickThrough = true
let isQuitting = false

/** @type {BrowserWindow | null} */
let mainWindow = null
/** @type {Tray | null} */
let tray = null
/** @type {import('node:child_process').ChildProcess | null} */
let bridgeProcess = null
/** @type {http.Server | null} */
let staticServer = null
let staticPort = 5174

// ---------------------------------------------------------------------------
// MediaPipe WASM Vendoring (mirroring scripts/start.mjs)
// ---------------------------------------------------------------------------
function vendorWasm() {
  const from = join(ROOT_DIR, 'node_modules/@mediapipe/tasks-vision/wasm')
  const to = join(ROOT_DIR, 'public/mediapipe')
  if (!existsSync(from)) return
  if (existsSync(join(to, 'vision_wasm_internal.wasm'))) return
  try {
    mkdirSync(to, { recursive: true })
    cpSync(from, to, { recursive: true })
    console.log('[desktop] vendored mediapipe wasm to public/mediapipe')
  } catch (err) {
    console.warn('[desktop] failed to vendor mediapipe wasm:', err?.message)
  }
}

// ---------------------------------------------------------------------------
// Bridge Lifecycle Management
// ---------------------------------------------------------------------------
async function isBridgeRunning(port = 8787) {
  return new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${port}/health`, (res) => {
      res.resume()
      resolve(res.statusCode === 200)
    })
    req.on('error', () => resolve(false))
    req.setTimeout(800, () => {
      req.destroy()
      resolve(false)
    })
  })
}

async function startBridge() {
  const running = await isBridgeRunning(8787)
  if (running) {
    console.log('[desktop] existing bridge detected on 127.0.0.1:8787')
    return
  }

  vendorWasm()

  const scriptPath = join(ROOT_DIR, 'bridge/server.mjs')
  console.log('[desktop] launching managed bridge process...')

  bridgeProcess = spawn(process.execPath, [scriptPath], {
    cwd: ROOT_DIR,
    env: {
      ...process.env,
      JARVIS_BRIDGE_HOST: '127.0.0.1',
      JARVIS_BRIDGE_PORT: '8787',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  bridgeProcess.stdout.on('data', (data) => {
    process.stdout.write(`[bridge] ${data}`)
  })

  bridgeProcess.stderr.on('data', (data) => {
    process.stderr.write(`[bridge:err] ${data}`)
  })

  bridgeProcess.on('exit', (code, signal) => {
    console.log(`[desktop] bridge exited with code ${code}, signal ${signal}`)
    bridgeProcess = null
    if (!isQuitting) {
      console.log('[desktop] restarting bridge in 1.5s...')
      setTimeout(() => {
        if (!isQuitting) void startBridge()
      }, 1500)
    }
  })
}

function stopBridge() {
  if (bridgeProcess) {
    try {
      bridgeProcess.kill()
    } catch {}
    bridgeProcess = null
  }
}

// ---------------------------------------------------------------------------
// Local Static File Server (Production / Packaged)
// ---------------------------------------------------------------------------
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.mp3': 'audio/mpeg',
  '.json': 'application/json',
}

function startStaticServer() {
  return new Promise((resolve) => {
    const distDir = join(ROOT_DIR, 'dist')
    const publicDir = join(ROOT_DIR, 'public')

    staticServer = http.createServer((req, res) => {
      const urlPath = (req.url || '/').split('?')[0]
      let filePath = join(distDir, urlPath === '/' ? 'index.html' : urlPath)

      // Fallback to public/ for /mediapipe or /audio if not found in dist
      if (!existsSync(filePath)) {
        const publicFallback = join(publicDir, urlPath)
        if (existsSync(publicFallback)) filePath = publicFallback
      }

      if (!existsSync(filePath) || !statSync(filePath).isFile()) {
        filePath = join(distDir, 'index.html')
      }

      const ext = extname(filePath).toLowerCase()
      const contentType = MIME_TYPES[ext] || 'application/octet-stream'

      res.writeHead(200, {
        'content-type': contentType,
        'access-control-allow-origin': '*',
        'cross-origin-opener-policy': 'same-origin',
        'cross-origin-embedder-policy': 'require-corp',
      })
      createReadStream(filePath).pipe(res)
    })

    // Listen on 5174 (allowed by bridge's isDevPort 5173-5199)
    staticServer.listen(0, '127.0.0.1', () => {
      staticPort = staticServer.address().port
      console.log(`[desktop] static server running on http://127.0.0.1:${staticPort}`)
      resolve(staticPort)
    })
  })
}

// ---------------------------------------------------------------------------
// Tray Icon Generator
// ---------------------------------------------------------------------------
function createArcReactorIcon() {
  const size = 32
  const buf = Buffer.alloc(size * size * 4)
  const center = size / 2

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4
      const dx = x - center + 0.5
      const dy = y - center + 0.5
      const dist = Math.sqrt(dx * dx + dy * dy)

      if (dist <= 3.5) {
        // Core center: bright white/cyan
        buf[idx] = 220
        buf[idx + 1] = 250
        buf[idx + 2] = 255
        buf[idx + 3] = 255
      } else if (dist >= 6 && dist <= 8) {
        // Inner ring: intense cyan
        buf[idx] = 0
        buf[idx + 1] = 229
        buf[idx + 2] = 255
        buf[idx + 3] = 240
      } else if (dist >= 11 && dist <= 14) {
        // Outer arc segments
        buf[idx] = 0
        buf[idx + 1] = 200
        buf[idx + 2] = 245
        buf[idx + 3] = 210
      } else {
        buf[idx + 3] = 0
      }
    }
  }

  return nativeImage.createFromBuffer(buf, { width: size, height: size })
}

// ---------------------------------------------------------------------------
// Window Geometry & Modes
// ---------------------------------------------------------------------------
function getActiveDisplay() {
  const point = screen.getCursorScreenPoint()
  return screen.getDisplayNearestPoint(point) || screen.getPrimaryDisplay()
}

function applyWindowMode(mode) {
  if (!mainWindow) return
  windowMode = mode
  const display = getActiveDisplay()
  const area = display.workArea

  if (mode === 'compact') {
    const width = 440
    const height = 480
    const x = Math.round(area.x + (area.width - width) / 2)
    const y = Math.round(area.y + (area.height - height) / 2)
    mainWindow.setBounds({ x, y, width, height })
    mainWindow.setIgnoreMouseEvents(false)
    mainWindow.webContents.send('window:mode-changed', 'compact')
  } else {
    mainWindow.setBounds({
      x: area.x,
      y: area.y,
      width: area.width,
      height: area.height,
    })
    if (clickThrough) {
      mainWindow.setIgnoreMouseEvents(true, { forward: true })
    }
    mainWindow.webContents.send('window:mode-changed', 'overlay')
  }
  updateTrayMenu()
}

function summonJarvis() {
  if (!mainWindow) return
  const display = getActiveDisplay()

  if (windowMode === 'overlay') {
    const area = display.workArea
    mainWindow.setBounds({
      x: area.x,
      y: area.y,
      width: area.width,
      height: area.height,
    })
  }

  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.setAlwaysOnTop(alwaysOnTop, 'screen-saver')
  mainWindow.focus()

  mainWindow.webContents.send('jarvis:summon')
}

// ---------------------------------------------------------------------------
// Emergency Stop Handler
// ---------------------------------------------------------------------------
function triggerEmergencyStop() {
  console.warn('[desktop] EMERGENCY STOP triggered via global shortcut, tray or HUD')
  // 1. Notify bridge server to kill all active child automation processes
  try {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: 8787,
        path: '/emergency-stop',
        method: 'POST',
        timeout: 1500,
      },
      (res) => {
        res.resume()
      },
    )
    req.on('error', (err) => {
      console.warn('[desktop] emergency stop request error:', err?.message)
    })
    req.end()
  } catch (err) {
    console.warn('[desktop] failed to dispatch emergency stop:', err?.message)
  }

  // 2. Notify renderer window to silence audio and clear pending gates
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('jarvis:emergency-stop')
  }
}

// ---------------------------------------------------------------------------
// Tray Setup
// ---------------------------------------------------------------------------
function updateTrayMenu() {
  if (!tray) return

  const isHidden = !mainWindow || !mainWindow.isVisible()
  const autoStart = app.getLoginItemSettings().openAtLogin

  const contextMenu = Menu.buildFromTemplate([
    {
      label: isHidden ? 'Show JARVIS' : 'Hide JARVIS',
      click: () => {
        if (!mainWindow) return
        if (mainWindow.isVisible()) {
          mainWindow.hide()
        } else {
          summonJarvis()
        }
        updateTrayMenu()
      },
    },
    {
      label: 'Wake JARVIS (Listen Now)',
      click: () => summonJarvis(),
    },
    {
      label: 'Emergency Stop Automation (Ctrl+Shift+Esc)',
      click: () => triggerEmergencyStop(),
    },
    { type: 'separator' },
    {
      label: 'Overlay Mode',
      type: 'radio',
      checked: windowMode === 'overlay',
      click: () => applyWindowMode('overlay'),
    },
    {
      label: 'Compact Mode',
      type: 'radio',
      checked: windowMode === 'compact',
      click: () => applyWindowMode('compact'),
    },
    { type: 'separator' },
    {
      label: 'Always on Top',
      type: 'checkbox',
      checked: alwaysOnTop,
      click: (item) => {
        alwaysOnTop = item.checked
        mainWindow?.setAlwaysOnTop(alwaysOnTop, 'screen-saver')
      },
    },
    {
      label: 'Click-Through Empty Space',
      type: 'checkbox',
      checked: clickThrough,
      enabled: windowMode === 'overlay',
      click: (item) => {
        clickThrough = item.checked
        if (windowMode === 'overlay') {
          mainWindow?.setIgnoreMouseEvents(clickThrough, { forward: true })
        }
      },
    },
    {
      label: 'Start with Windows',
      type: 'checkbox',
      checked: autoStart,
      click: (item) => {
        app.setLoginItemSettings({
          openAtLogin: item.checked,
          args: ['--hidden'],
        })
      },
    },
    { type: 'separator' },
    {
      label: 'Quit JARVIS',
      click: () => {
        isQuitting = true
        app.quit()
      },
    },
  ])

  tray.setContextMenu(contextMenu)
}

function createTray() {
  const icon = createArcReactorIcon()
  tray = new Tray(icon)
  tray.setToolTip('J.A.R.V.I.S. Desktop')
  tray.on('click', () => summonJarvis())
  updateTrayMenu()
}

// ---------------------------------------------------------------------------
// Window Creation
// ---------------------------------------------------------------------------
async function createMainWindow() {
  const display = getActiveDisplay()
  const area = display.workArea
  const isHidden = process.argv.includes('--hidden')

  mainWindow = new BrowserWindow({
    x: area.x,
    y: area.y,
    width: area.width,
    height: area.height,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    alwaysOnTop: true,
    skipTaskbar: false,
    show: false, // will show after ready-to-show unless hidden
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  })

  mainWindow.setAlwaysOnTop(true, 'screen-saver')

  if (clickThrough && windowMode === 'overlay') {
    mainWindow.setIgnoreMouseEvents(true, { forward: true })
  }

  // Prevent navigation to untrusted external sites
  mainWindow.webContents.on('will-navigate', (event, targetUrl) => {
    try {
      const u = new URL(targetUrl)
      if (
        u.hostname !== 'localhost' &&
        u.hostname !== '127.0.0.1' &&
        u.protocol !== 'file:'
      ) {
        event.preventDefault()
      }
    } catch {
      event.preventDefault()
    }
  })

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

  mainWindow.once('ready-to-show', () => {
    if (!isHidden) {
      mainWindow.show()
      mainWindow.focus()
    }
    updateTrayMenu()
  })

  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault()
      mainWindow.hide()
      updateTrayMenu()
    }
  })

  // Determine URL to load:
  // 1. Dev server URL via env (VITE_DEV_SERVER_URL or check 5173)
  // 2. Otherwise start local static loopback server
  const devUrl = process.env.VITE_DEV_SERVER_URL || 'http://127.0.0.1:5173'
  let isDev = false

  try {
    await new Promise((res, rej) => {
      const req = http.get(devUrl, (r) => {
        r.resume()
        res(true)
      })
      req.on('error', rej)
      req.setTimeout(500, () => {
        req.destroy()
        rej(new Error('timeout'))
      })
    })
    isDev = true
  } catch {
    isDev = false
  }

  if (isDev) {
    console.log(`[desktop] loading Vite dev server at ${devUrl}`)
    await mainWindow.loadURL(devUrl)
  } else {
    const port = await startStaticServer()
    const prodUrl = `http://127.0.0.1:${port}`
    console.log(`[desktop] loading production build at ${prodUrl}`)
    await mainWindow.loadURL(prodUrl)
  }
}

// ---------------------------------------------------------------------------
// IPC Handlers
// ---------------------------------------------------------------------------
function registerIpc() {
  ipcMain.on('window:set-ignore-mouse-events', (_, ignore, forward) => {
    if (!mainWindow || windowMode !== 'overlay') return
    mainWindow.setIgnoreMouseEvents(Boolean(ignore), { forward: Boolean(forward) })
  })

  ipcMain.handle('window:show', () => {
    mainWindow?.show()
    updateTrayMenu()
  })

  ipcMain.handle('window:hide', () => {
    mainWindow?.hide()
    updateTrayMenu()
  })

  ipcMain.handle('window:minimize', () => {
    mainWindow?.minimize()
  })

  ipcMain.handle('window:toggle-compact', () => {
    applyWindowMode(windowMode === 'overlay' ? 'compact' : 'overlay')
    return windowMode
  })

  ipcMain.handle('window:set-always-on-top', (_, flag) => {
    alwaysOnTop = Boolean(flag)
    mainWindow?.setAlwaysOnTop(alwaysOnTop, 'screen-saver')
    updateTrayMenu()
    return alwaysOnTop
  })

  ipcMain.handle('settings:get', () => {
    return {
      windowMode,
      alwaysOnTop,
      clickThrough,
      autoStart: app.getLoginItemSettings().openAtLogin,
    }
  })

  ipcMain.handle('settings:set-autostart', (_, enabled) => {
    app.setLoginItemSettings({
      openAtLogin: Boolean(enabled),
      args: ['--hidden'],
    })
    updateTrayMenu()
    return app.getLoginItemSettings().openAtLogin
  })

  ipcMain.handle('app:quit', () => {
    isQuitting = true
    app.quit()
  })

  ipcMain.handle('app:emergency-stop', () => {
    triggerEmergencyStop()
  })
}

// ---------------------------------------------------------------------------
// Media Permissions Setup
// ---------------------------------------------------------------------------
function setupMediaPermissions() {
  session.defaultSession.setPermissionRequestHandler(
    (webContents, permission, callback) => {
      const url = webContents.getURL()
      if (permission === 'media' || permission === 'audioCapture') {
        try {
          const u = new URL(url)
          if (
            u.hostname === 'localhost' ||
            u.hostname === '127.0.0.1' ||
            u.protocol === 'file:'
          ) {
            return callback(true)
          }
        } catch {}
      }
      callback(false)
    },
  )

  session.defaultSession.setPermissionCheckHandler((webContents, permission) => {
    const url = webContents?.getURL() || ''
    if (permission === 'media' || permission === 'audioCapture') {
      try {
        const u = new URL(url)
        if (
          u.hostname === 'localhost' ||
          u.hostname === '127.0.0.1' ||
          u.protocol === 'file:'
        ) {
          return true
        }
      } catch {}
    }
    return false
  })
}

// ---------------------------------------------------------------------------
// App Lifecycle
// ---------------------------------------------------------------------------
app.on('second-instance', () => {
  summonJarvis()
})

app.whenReady().then(async () => {
  setupMediaPermissions()
  registerIpc()

  // Register Global Hotkey
  const shortcut = 'CommandOrControl+Shift+Space'
  const registered = globalShortcut.register(shortcut, () => {
    summonJarvis()
  })
  if (registered) {
    console.log(`[desktop] global hotkey registered: ${shortcut}`)
  } else {
    console.warn(`[desktop] failed to register hotkey: ${shortcut}`)
  }

  // Register Global Emergency Stop Hotkey (Ctrl+Shift+Escape)
  const stopShortcut = 'CommandOrControl+Shift+Escape'
  let stopRegistered = false
  try {
    stopRegistered = globalShortcut.register(stopShortcut, () => {
      triggerEmergencyStop()
    })
  } catch (err) {
    console.warn(`[desktop] failed registering ${stopShortcut}:`, err?.message)
  }

  if (stopRegistered) {
    console.log(`[desktop] emergency stop hotkey registered: ${stopShortcut}`)
  } else {
    // Fallback shortcut: Ctrl+Alt+Backspace
    const fallbackShortcut = 'CommandOrControl+Alt+Backspace'
    const fallbackRegistered = globalShortcut.register(fallbackShortcut, () => {
      triggerEmergencyStop()
    })
    if (fallbackRegistered) {
      console.log(`[desktop] fallback emergency stop hotkey registered: ${fallbackShortcut}`)
    }
  }

  // Start Bridge
  await startBridge()

  // Create Tray & Window
  createTray()
  await createMainWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void createMainWindow()
    } else {
      summonJarvis()
    }
  })
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
  stopBridge()
  if (staticServer) {
    try {
      staticServer.close()
    } catch {}
  }
})

app.on('window-all-closed', () => {
  // On desktop background apps, keep running in the tray
})

