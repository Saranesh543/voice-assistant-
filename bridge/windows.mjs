/**
 * JARVIS Native Windows 11 PC Control MCP Server (`jarvis_windows`)
 *
 * Implements safe, modular Win32 operations across 6 categories:
 *   1. win_app: Launch, focus, close, list visible open windows
 *   2. win_files: Search, read, create, copy, move, rename, recycle-bin delete
 *   3. win_input: Virtual keystrokes, shortcuts, click, scroll, media keys
 *   4. win_system: CPU/RAM/disk telemetry, volume, brightness, ms-settings, screenshots, power
 *   5. win_browser: Safe URL navigation and web search
 *   6. win_dev: VS Code launcher, git status/diff, whitelisted project test/build commands
 *
 * Enforces Tier 0-3 security policies via reverse-RPC confirmation before effectful mutations.
 */

import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'
import { spawn, execFile } from 'node:child_process'
import { homedir, tmpdir, cpus, totalmem, freemem, networkInterfaces } from 'node:os'
import { statfs, readFile, writeFile, mkdir, copyFile, rename, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, resolve as resolvePath, relative, isAbsolute, basename } from 'node:path'
import { TIERS, checkPermission } from './permissions.mjs'

// ---------------------------------------------------------------------------
// Helpers & Confinement
// ---------------------------------------------------------------------------

const HOME = homedir()
const PROJECTS_DIR = 'c:\\Users\\saran\\OneDrive\\Desktop\\PROJECTS'

const ALLOWED_ROOTS = [
  HOME,
  join(HOME, 'Desktop'),
  join(HOME, 'Documents'),
  join(HOME, 'Downloads'),
  join(HOME, 'Pictures'),
  join(HOME, 'Music'),
  join(HOME, 'Videos'),
  PROJECTS_DIR,
  tmpdir(),
  ...(process.env.JARVIS_FILE_ROOTS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
].map((r) => resolvePath(r).toLowerCase())

const BLOCKED_DIRS = [
  'c:\\windows',
  'c:\\program files',
  'c:\\program files (x86)',
  'c:\\programdata',
]

const BLOCKED_FILE_PATTERN = /\.(env|env\.local|pem|key|crt|id_rsa|id_ed25519)$|(\.ssh[\\/])|(\.claude\.json$)|([\\/]Cookies$)|([\\/]Login Data$)/i

/**
 * Validates whether a file/folder path is within permitted user roots
 * and not in a sensitive system directory or credential store.
 */
function isPathAllowed(targetPath) {
  if (!targetPath) return false
  const resolved = resolvePath(targetPath)
  const norm = resolved.toLowerCase()

  // Check blocked directories
  if (BLOCKED_DIRS.some((b) => norm === b || norm.startsWith(b + '\\'))) {
    return false
  }

  // Check sensitive file patterns
  if (BLOCKED_FILE_PATTERN.test(norm)) {
    return false
  }

  // Must sit within at least one allowed root
  return ALLOWED_ROOTS.some((root) => {
    const rel = relative(root, norm)
    return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
  })
}

/**
 * Executes a PowerShell snippet safely by writing the script to stdin
 * of `powershell.exe -NoProfile -NonInteractive -Command -`.
 * Passes dynamic variables via environment variables to prevent string injection.
 */
function runPowerShell(script, envVars = {}, timeoutMs = 25000, abortControllers = null) {
  return new Promise((resolve, reject) => {
    const controller = new AbortController()
    if (abortControllers) abortControllers.add(controller)

    const child = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', '-'],
      {
        env: { ...process.env, ...envVars },
        signal: controller.signal,
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    )

    let stdout = ''
    let stderr = ''
    let timer = null

    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        controller.abort()
        reject(new Error(`PowerShell operation timed out after ${timeoutMs}ms`))
      }, timeoutMs)
    }

    child.stdout.on('data', (d) => {
      stdout += d.toString()
    })

    child.stderr.on('data', (d) => {
      stderr += d.toString()
    })

    child.on('error', (err) => {
      if (timer) clearTimeout(timer)
      if (abortControllers) abortControllers.delete(controller)
      reject(err)
    })

    child.on('close', (code) => {
      if (timer) clearTimeout(timer)
      if (abortControllers) abortControllers.delete(controller)
      if (code === 0) {
        resolve(stdout.trim())
      } else {
        reject(new Error(stderr.trim() || `PowerShell exited with code ${code}`))
      }
    })

    try {
      child.stdin.write(script)
      child.stdin.end()
    } catch (err) {
      if (timer) clearTimeout(timer)
      if (abortControllers) abortControllers.delete(controller)
      reject(err)
    }
  })
}

// ---------------------------------------------------------------------------
// Built-In Windows 11 App Aliases
// ---------------------------------------------------------------------------
const APP_ALIASES = {
  chrome: 'start chrome',
  'google chrome': 'start chrome',
  edge: 'start msedge',
  'microsoft edge': 'start msedge',
  code: 'code',
  vscode: 'code',
  'visual studio code': 'code',
  notepad: 'notepad.exe',
  calc: 'calc.exe',
  calculator: 'calc.exe',
  explorer: 'explorer.exe',
  'file explorer': 'explorer.exe',
  files: 'explorer.exe',
  terminal: 'wt.exe',
  wt: 'wt.exe',
  'windows terminal': 'wt.exe',
  powershell: 'powershell.exe',
  paint: 'mspaint.exe',
  mspaint: 'mspaint.exe',
  settings: 'start ms-settings:',
  'task manager': 'taskmgr.exe',
  taskmgr: 'taskmgr.exe',
  spotify: 'start spotify:',
  discord: 'start discord:',
  slack: 'start slack:',
}

// ---------------------------------------------------------------------------
// Server Construction
// ---------------------------------------------------------------------------

export function windowsServer(ask, abortControllers = new Set()) {
  return createSdkMcpServer({
    name: 'jarvis_windows',
    version: '1.0.0',
    tools: [
      // ---------------------------------------------------------------------
      // 1. win_app: Application Lifecycle & Window Switching
      // ---------------------------------------------------------------------
      tool(
        'win_app',
        `Manage Windows applications and windows on this machine.
Actions:
  - 'list_open': Lists all visible running application windows with Process IDs and titles. (Tier 0)
  - 'launch': Launches an application by alias or command (e.g. 'chrome', 'code', 'calc', 'notepad', 'spotify'). (Tier 1)
  - 'focus': Brings a window to the foreground by application name or title. (Tier 1)
  - 'close': Closes a running window/process by app name or process ID. (Tier 3 - Confirmation Required)`,
        {
          action: z.enum(['list_open', 'launch', 'focus', 'close']),
          app: z.string().optional().describe('Application name, alias, or window title substring.'),
          pid: z.number().optional().describe('Process ID when targeting a specific process to close.'),
        },
        async ({ action, app: targetApp, pid }) => {
          if (action === 'list_open') {
            const script = `
Get-Process | Where-Object MainWindowTitle |
  Select-Object Id, ProcessName, MainWindowTitle |
  ConvertTo-Json -Compress
`
            try {
              const out = await runPowerShell(script, {}, 10000, abortControllers)
              const list = JSON.parse(out || '[]')
              const arr = Array.isArray(list) ? list : [list]
              return { content: [{ type: 'text', text: JSON.stringify(arr, null, 2) }] }
            } catch (err) {
              return { isError: true, content: [{ type: 'text', text: `Failed to list windows: ${err.message}` }] }
            }
          }

          if (action === 'launch') {
            if (!targetApp) {
              return { isError: true, content: [{ type: 'text', text: 'App name required for launch.' }] }
            }
            const key = targetApp.toLowerCase().trim()
            const cmd = APP_ALIASES[key] ?? targetApp

            const gate = await checkPermission(ask, {
              tool: 'win_app',
              action: 'launch',
              tier: TIERS.TIER_1_SAFE_ACTION,
              title: `Launch Application: ${targetApp}`,
              detail: cmd,
            })
            if (!gate.approved) {
              return { isError: true, content: [{ type: 'text', text: gate.reason ?? 'Denied by user.' }] }
            }

            try {
              const script = `Start-Process -FilePath $env:TARGET_APP`
              await runPowerShell(script, { TARGET_APP: cmd }, 8000, abortControllers)
              return { content: [{ type: 'text', text: `Launched "${targetApp}".` }] }
            } catch (err) {
              return { isError: true, content: [{ type: 'text', text: `Failed to launch "${targetApp}": ${err.message}` }] }
            }
          }

          if (action === 'focus') {
            if (!targetApp) {
              return { isError: true, content: [{ type: 'text', text: 'App name or title required for focus.' }] }
            }
            const gate = await checkPermission(ask, {
              tool: 'win_app',
              action: 'focus',
              tier: TIERS.TIER_1_SAFE_ACTION,
              title: `Focus Window: ${targetApp}`,
              detail: targetApp,
            })
            if (!gate.approved) {
              return { isError: true, content: [{ type: 'text', text: gate.reason ?? 'Denied by user.' }] }
            }

            const script = `
$target = $env:TARGET_APP.ToLower()
$proc = Get-Process | Where-Object { ($_.ProcessName.ToLower().Contains($target) -or $_.MainWindowTitle.ToLower().Contains($target)) -and $_.MainWindowHandle -ne 0 } | Select-Object -First 1

if ($proc) {
  $sig = '[DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd); [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);'
  $type = Add-Type -MemberDefinition $sig -Name WindowUtil -Namespace Win32 -PassThru -ErrorAction SilentlyContinue
  $type::ShowWindow($proc.MainWindowHandle, 9)
  $type::SetForegroundWindow($proc.MainWindowHandle)
  Write-Output "SUCCESS: $($proc.ProcessName) - $($proc.MainWindowTitle)"
} else {
  Write-Error "No matching window found for '$($env:TARGET_APP)'"
}
`
            try {
              const res = await runPowerShell(script, { TARGET_APP: targetApp }, 8000, abortControllers)
              return { content: [{ type: 'text', text: res || `Focused "${targetApp}".` }] }
            } catch (err) {
              return { isError: true, content: [{ type: 'text', text: `Failed to focus "${targetApp}": ${err.message}` }] }
            }
          }

          if (action === 'close') {
            const detailStr = pid ? `PID ${pid}` : (targetApp || 'unknown')
            const gate = await checkPermission(ask, {
              tool: 'win_app',
              action: 'close',
              tier: TIERS.TIER_3_DESTRUCTIVE,
              title: `Close Application / Process: ${detailStr}`,
              detail: `Will terminate process ${detailStr}. Unsaved work may be lost.`,
            })
            if (!gate.approved) {
              return { isError: true, content: [{ type: 'text', text: gate.reason ?? 'Action denied by user.' }] }
            }

            const script = pid
              ? `Stop-Process -Id ${pid} -Force`
              : `Stop-Process -Name $env:TARGET_APP -Force`

            try {
              await runPowerShell(script, { TARGET_APP: targetApp ?? '' }, 8000, abortControllers)
              return { content: [{ type: 'text', text: `Closed application ${detailStr}.` }] }
            } catch (err) {
              return { isError: true, content: [{ type: 'text', text: `Failed to close: ${err.message}` }] }
            }
          }

          return { isError: true, content: [{ type: 'text', text: `Unknown action: ${action}` }] }
        },
      ),

      // ---------------------------------------------------------------------
      // 2. win_files: Confined File Management & Recycle-Bin Deletion
      // ---------------------------------------------------------------------
      tool(
        'win_files',
        `Perform safe file and folder operations on Windows.
Confinement: Restricted to user workspace, projects, and personal folders. System roots and credentials blocked.
Actions:
  - 'read': Read text/code/json/markdown document (up to 128 KB). (Tier 0)
  - 'search': Search for files matching a pattern inside a directory. (Tier 0)
  - 'open': Open file or folder in Windows Explorer. (Tier 1)
  - 'create': Create or write text to a file. (Tier 2 / Tier 3 if overwriting)
  - 'copy': Copy file or directory. (Tier 2)
  - 'move': Move file or directory. (Tier 2)
  - 'rename': Rename file or directory. (Tier 2)
  - 'delete': Safely send file or directory to the Windows Recycle Bin. (Tier 3)`,
        {
          action: z.enum(['read', 'search', 'open', 'create', 'copy', 'move', 'rename', 'delete']),
          path: z.string().describe('File or directory path.'),
          target: z.string().optional().describe('Destination path for copy, move, or rename.'),
          query: z.string().optional().describe('Filename or wildcard search query (for search).'),
          content: z.string().optional().describe('File content to write (for create).'),
        },
        async ({ action, path: rawPath, target: rawTarget, query: searchQuery, content }) => {
          const filePath = resolvePath(rawPath)

          // Enforce confinement
          if (!isPathAllowed(filePath)) {
            return {
              isError: true,
              content: [
                {
                  type: 'text',
                  text: `Access denied: "${filePath}" is outside permitted user folders or contains restricted files.`,
                },
              ],
            }
          }

          if (rawTarget && !isPathAllowed(rawTarget)) {
            return {
              isError: true,
              content: [{ type: 'text', text: `Target path "${rawTarget}" is outside permitted folders.` }],
            }
          }

          if (action === 'read') {
            try {
              const s = await stat(filePath)
              if (!s.isFile()) {
                return { isError: true, content: [{ type: 'text', text: `"${filePath}" is not a file.` }] }
              }
              if (s.size > 128 * 1024) {
                return { isError: true, content: [{ type: 'text', text: `File is too large to read inline (${(s.size / 1024).toFixed(1)} KB > 128 KB limit).` }] }
              }
              const data = await readFile(filePath, 'utf8')
              return { content: [{ type: 'text', text: data }] }
            } catch (err) {
              return { isError: true, content: [{ type: 'text', text: `Failed to read file: ${err.message}` }] }
            }
          }

          if (action === 'search') {
            const q = (searchQuery || '*').toLowerCase()
            const script = `
$root = $env:SEARCH_ROOT
$q = $env:SEARCH_Q
Get-ChildItem -Path $root -Recurse -File -ErrorAction SilentlyContinue |
  Where-Object {
    $_.FullName -notmatch '[\\\\/](node_modules|\\.git|dist|release)[\\\\/]' -and
    ($_.Name.ToLower() -like "*$q*")
  } |
  Select-Object -First 50 -Property FullName, Length, LastWriteTime |
  ConvertTo-Json -Compress
`
            try {
              const res = await runPowerShell(script, { SEARCH_ROOT: filePath, SEARCH_Q: q }, 15000, abortControllers)
              const parsed = JSON.parse(res || '[]')
              const items = Array.isArray(parsed) ? parsed : [parsed]
              return { content: [{ type: 'text', text: JSON.stringify(items, null, 2) }] }
            } catch (err) {
              return { isError: true, content: [{ type: 'text', text: `Search failed: ${err.message}` }] }
            }
          }

          if (action === 'open') {
            const gate = await checkPermission(ask, {
              tool: 'win_files',
              action: 'open',
              tier: TIERS.TIER_1_SAFE_ACTION,
              title: `Open in Explorer: ${basename(filePath)}`,
              detail: filePath,
            })
            if (!gate.approved) {
              return { isError: true, content: [{ type: 'text', text: gate.reason ?? 'Denied by user.' }] }
            }

            try {
              await runPowerShell(`Start-Process -FilePath 'explorer.exe' -ArgumentList "/select,\`"$env:TARGET_PATH\`""`, { TARGET_PATH: filePath }, 8000, abortControllers)
              return { content: [{ type: 'text', text: `Opened "${filePath}" in Explorer.` }] }
            } catch (err) {
              return { isError: true, content: [{ type: 'text', text: `Failed to open: ${err.message}` }] }
            }
          }

          if (action === 'create') {
            const exists = existsSync(filePath)
            const tier = exists ? TIERS.TIER_3_DESTRUCTIVE : TIERS.TIER_2_MUTATION
            const gate = await checkPermission(ask, {
              tool: 'win_files',
              action: 'create',
              tier,
              title: exists ? `Overwrite File: ${basename(filePath)}` : `Create File: ${basename(filePath)}`,
              detail: `${filePath} (${(content ?? '').length} characters)`,
            })
            if (!gate.approved) {
              return { isError: true, content: [{ type: 'text', text: gate.reason ?? 'Denied by user.' }] }
            }

            try {
              await writeFile(filePath, content ?? '', 'utf8')
              return { content: [{ type: 'text', text: `File "${filePath}" saved successfully.` }] }
            } catch (err) {
              return { isError: true, content: [{ type: 'text', text: `Failed to create file: ${err.message}` }] }
            }
          }

          if (action === 'copy' || action === 'move' || action === 'rename') {
            if (!rawTarget) {
              return { isError: true, content: [{ type: 'text', text: 'Target path required.' }] }
            }
            const destPath = resolvePath(rawTarget)
            const exists = existsSync(destPath)
            const tier = exists ? TIERS.TIER_3_DESTRUCTIVE : TIERS.TIER_2_MUTATION

            const gate = await checkPermission(ask, {
              tool: 'win_files',
              action,
              tier,
              title: `${action.toUpperCase()}: ${basename(filePath)} -> ${basename(destPath)}`,
              detail: `From: ${filePath}\nTo: ${destPath}${exists ? ' (DESTINATION WILL BE OVERWRITTEN)' : ''}`,
            })
            if (!gate.approved) {
              return { isError: true, content: [{ type: 'text', text: gate.reason ?? 'Denied by user.' }] }
            }

            try {
              if (action === 'copy') await copyFile(filePath, destPath)
              else await rename(filePath, destPath)
              return { content: [{ type: 'text', text: `Successfully ${action}d "${filePath}" to "${destPath}".` }] }
            } catch (err) {
              return { isError: true, content: [{ type: 'text', text: `Operation failed: ${err.message}` }] }
            }
          }

          if (action === 'delete') {
            const gate = await checkPermission(ask, {
              tool: 'win_files',
              action: 'delete',
              tier: TIERS.TIER_3_DESTRUCTIVE,
              title: `RECYCLE BIN: Delete "${basename(filePath)}"`,
              detail: `Will move "${filePath}" to the Windows Recycle Bin (recoverable).`,
            })
            if (!gate.approved) {
              return { isError: true, content: [{ type: 'text', text: gate.reason ?? 'Denied by user.' }] }
            }

            const script = `
Add-Type -AssemblyName Microsoft.VisualBasic
$path = $env:TARGET_PATH
if (Test-Path -PathType Leaf $path) {
  [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile($path, 'OnlyErrorDialogs', 'SendToRecycleBin')
  Write-Output "File moved to Recycle Bin."
} elseif (Test-Path -PathType Container $path) {
  [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory($path, 'OnlyErrorDialogs', 'SendToRecycleBin')
  Write-Output "Directory moved to Recycle Bin."
} else {
  Write-Error "Path does not exist."
}
`
            try {
              const res = await runPowerShell(script, { TARGET_PATH: filePath }, 10000, abortControllers)
              return { content: [{ type: 'text', text: res || `Moved "${filePath}" to Recycle Bin.` }] }
            } catch (err) {
              return { isError: true, content: [{ type: 'text', text: `Delete failed: ${err.message}` }] }
            }
          }

          return { isError: true, content: [{ type: 'text', text: `Unknown file action: ${action}` }] }
        },
      ),

      // ---------------------------------------------------------------------
      // 3. win_input: Keyboard & Mouse Automation
      // ---------------------------------------------------------------------
      tool(
        'win_input',
        `Send keyboard keystrokes, shortcuts, mouse clicks, or media key controls.
Actions:
  - 'media_key': Play/pause, track next/prev, volume mute/up/down. (Tier 1)
  - 'type_text': Types text into the active or targeted window via SendKeys. (Tier 2)
  - 'shortcut': Sends key combination (e.g. 'ctrl+c', 'ctrl+v', 'alt+tab', 'enter', 'escape'). (Tier 2)
  - 'click': Left or right click at current or specified cursor position. (Tier 2)
  - 'scroll': Scrolls vertically by delta pixels. (Tier 1)`,
        {
          action: z.enum(['type_text', 'shortcut', 'click', 'scroll', 'media_key']),
          text: z.string().optional().describe('Text to type.'),
          shortcut: z.string().optional().describe('Key combination (e.g. "ctrl+v", "enter").'),
          key: z
            .enum(['play_pause', 'next_track', 'prev_track', 'volume_up', 'volume_down', 'volume_mute'])
            .optional()
            .describe('Media key name.'),
          targetWindow: z.string().optional().describe('Target window name to focus before sending input.'),
          x: z.number().optional(),
          y: z.number().optional(),
          delta: z.number().optional(),
        },
        async ({ action, text, shortcut, key, targetWindow, x, y, delta }) => {
          // Focus target window if specified
          if (targetWindow) {
            const focusScript = `
$target = $env:TARGET_APP.ToLower()
$proc = Get-Process | Where-Object { ($_.ProcessName.ToLower().Contains($target) -or $_.MainWindowTitle.ToLower().Contains($target)) -and $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if ($proc) {
  $sig = '[DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd); [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);'
  $type = Add-Type -MemberDefinition $sig -Name FocusWin -Namespace Win32 -PassThru -ErrorAction SilentlyContinue
  $type::ShowWindow($proc.MainWindowHandle, 9)
  $type::SetForegroundWindow($proc.MainWindowHandle)
} else {
  Write-Error "Target window '$($env:TARGET_APP)' not found."
}
`
            try {
              await runPowerShell(focusScript, { TARGET_APP: targetWindow }, 6000, abortControllers)
              await new Promise((r) => setTimeout(r, 150)) // settle focus
            } catch (err) {
              return { isError: true, content: [{ type: 'text', text: `Could not focus target window: ${err.message}` }] }
            }
          }

          if (action === 'media_key') {
            if (!key) return { isError: true, content: [{ type: 'text', text: 'Media key required.' }] }

            const MEDIA_VK = {
              volume_mute: 173,
              volume_down: 174,
              volume_up: 175,
              next_track: 176,
              prev_track: 177,
              play_pause: 179,
            }
            const vk = MEDIA_VK[key]
            if (!vk) return { isError: true, content: [{ type: 'text', text: `Unsupported media key: ${key}` }] }

            const script = `
$sig = '[DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);'
$type = Add-Type -MemberDefinition $sig -Name MediaUtil -Namespace Win32 -PassThru -ErrorAction SilentlyContinue
$type::keybd_event(${vk}, 0, 0, [UIntPtr]::Zero)
$type::keybd_event(${vk}, 0, 2, [UIntPtr]::Zero)
`
            try {
              await runPowerShell(script, {}, 5000, abortControllers)
              return { content: [{ type: 'text', text: `Sent media key: ${key}.` }] }
            } catch (err) {
              return { isError: true, content: [{ type: 'text', text: `Failed to send media key: ${err.message}` }] }
            }
          }

          if (action === 'type_text') {
            if (!text) return { isError: true, content: [{ type: 'text', text: 'Text required.' }] }

            const gate = await checkPermission(ask, {
              tool: 'win_input',
              action: 'type_text',
              tier: TIERS.TIER_2_MUTATION,
              title: `Type Text (${text.length} chars)`,
              detail: `Text: "${text.length > 50 ? text.slice(0, 47) + '...' : text}"${targetWindow ? ` -> [${targetWindow}]` : ''}`,
            })
            if (!gate.approved) {
              return { isError: true, content: [{ type: 'text', text: gate.reason ?? 'Denied by user.' }] }
            }

            const script = `
Add-Type -AssemblyName System.Windows.Forms
$raw = $env:JARVIS_INPUT_TEXT
# Escape SendKeys special characters: + ^ % ~ ( ) { } [ ]
$escaped = $raw -replace '([+^%~(){}\\[\\]])', '{$1}'
[System.Windows.Forms.SendKeys]::SendWait($escaped)
`
            try {
              await runPowerShell(script, { JARVIS_INPUT_TEXT: text }, 8000, abortControllers)
              return { content: [{ type: 'text', text: `Typed ${text.length} characters.` }] }
            } catch (err) {
              return { isError: true, content: [{ type: 'text', text: `Type failed: ${err.message}` }] }
            }
          }

          if (action === 'shortcut') {
            if (!shortcut) return { isError: true, content: [{ type: 'text', text: 'Shortcut required.' }] }

            const gate = await checkPermission(ask, {
              tool: 'win_input',
              action: 'shortcut',
              tier: TIERS.TIER_2_MUTATION,
              title: `Send Shortcut: ${shortcut.toUpperCase()}`,
              detail: `Shortcut: ${shortcut}${targetWindow ? ` in ${targetWindow}` : ''}`,
            })
            if (!gate.approved) {
              return { isError: true, content: [{ type: 'text', text: gate.reason ?? 'Denied by user.' }] }
            }

            // Map common shortcuts to SendKeys syntax
            const s = shortcut.toLowerCase().trim()
            let sendKeysPattern = ''
            if (s === 'ctrl+c') sendKeysPattern = '^c'
            else if (s === 'ctrl+v') sendKeysPattern = '^v'
            else if (s === 'ctrl+a') sendKeysPattern = '^a'
            else if (s === 'ctrl+s') sendKeysPattern = '^s'
            else if (s === 'ctrl+z') sendKeysPattern = '^z'
            else if (s === 'enter') sendKeysPattern = '{ENTER}'
            else if (s === 'escape' || s === 'esc') sendKeysPattern = '{ESC}'
            else if (s === 'tab') sendKeysPattern = '{TAB}'
            else if (s === 'backspace') sendKeysPattern = '{BKSP}'
            else sendKeysPattern = s

            const script = `
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.SendKeys]::SendWait($env:SHORTCUT_PATTERN)
`
            try {
              await runPowerShell(script, { SHORTCUT_PATTERN: sendKeysPattern }, 6000, abortControllers)
              return { content: [{ type: 'text', text: `Sent shortcut "${shortcut}".` }] }
            } catch (err) {
              return { isError: true, content: [{ type: 'text', text: `Shortcut failed: ${err.message}` }] }
            }
          }

          if (action === 'click') {
            const gate = await checkPermission(ask, {
              tool: 'win_input',
              action: 'click',
              tier: TIERS.TIER_2_MUTATION,
              title: 'Mouse Click',
              detail: x && y ? `Click at (${x}, ${y})` : 'Click at current cursor position',
            })
            if (!gate.approved) {
              return { isError: true, content: [{ type: 'text', text: gate.reason ?? 'Denied by user.' }] }
            }

            const script = `
$sig = @'
[DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
[DllImport("user32.dll")] public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, UIntPtr dwExtraInfo);
'@
$type = Add-Type -MemberDefinition $sig -Name MouseClick -Namespace Win32 -PassThru -ErrorAction SilentlyContinue
${x != null && y != null ? `$type::SetCursorPos(${Math.round(x)}, ${Math.round(y)})` : ''}
$type::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero) # MOUSEEVENTF_LEFTDOWN
Start-Sleep -Milliseconds 50
$type::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero) # MOUSEEVENTF_LEFTUP
`
            try {
              await runPowerShell(script, {}, 5000, abortControllers)
              return { content: [{ type: 'text', text: `Clicked ${x && y ? `at (${x}, ${y})` : 'at cursor'}.` }] }
            } catch (err) {
              return { isError: true, content: [{ type: 'text', text: `Click failed: ${err.message}` }] }
            }
          }

          if (action === 'scroll') {
            const script = `
$sig = '[DllImport("user32.dll")] public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, UIntPtr dwExtraInfo);'
$type = Add-Type -MemberDefinition $sig -Name MouseScroll -Namespace Win32 -PassThru -ErrorAction SilentlyContinue
$type::mouse_event(0x0800, 0, 0, ${Math.round(delta ?? -120)}, [UIntPtr]::Zero)
`
            try {
              await runPowerShell(script, {}, 5000, abortControllers)
              return { content: [{ type: 'text', text: `Scrolled delta ${delta ?? -120}.` }] }
            } catch (err) {
              return { isError: true, content: [{ type: 'text', text: `Scroll failed: ${err.message}` }] }
            }
          }

          return { isError: true, content: [{ type: 'text', text: `Unknown input action: ${action}` }] }
        },
      ),

      // ---------------------------------------------------------------------
      // 4. win_system: Telemetry, Volume, Brightness, Screenshots, Power
      // ---------------------------------------------------------------------
      tool(
        'win_system',
        `Windows system operations and diagnostics.
Actions:
  - 'status': Returns real-time CPU %, RAM usage, Disk C: space, and network telemetry. (Tier 0)
  - 'screenshot': Captures full desktop screenshot to a temporary PNG and returns the file path. (Tier 0)
  - 'volume': Sets master volume (0-100) or toggle mute. (Tier 1)
  - 'brightness': Sets display brightness (0-100). (Tier 1)
  - 'open_settings': Opens a safe Windows Settings page (e.g. 'display', 'sound', 'wifi', 'apps', 'power'). (Tier 1)
  - 'power': System power commands ('lock', 'sleep', 'restart', 'shutdown'). (Tier 1 for lock; Tier 3 Confirmation for others)`,
        {
          action: z.enum(['status', 'screenshot', 'volume', 'brightness', 'open_settings', 'power']),
          value: z.union([z.number(), z.string()]).optional().describe('Value for volume or brightness (0-100).'),
          setting: z
            .enum(['display', 'sound', 'bluetooth', 'network-wifi', 'windowsupdate', 'appsfeatures', 'powersleep', 'taskbar'])
            .optional()
            .describe('Specific ms-settings page.'),
          powerAction: z.enum(['lock', 'sleep', 'restart', 'shutdown']).optional(),
        },
        async ({ action, value, setting, powerAction }) => {
          if (action === 'status') {
            try {
              // Rapid native Node telemetry
              const totalRamGb = Number((totalmem() / 1024 ** 3).toFixed(1))
              const freeRamGb = Number((freemem() / 1024 ** 3).toFixed(1))
              const usedRamGb = Number((totalRamGb - freeRamGb).toFixed(1))
              const ramPct = Math.round((usedRamGb / totalRamGb) * 100)

              // Disk C:
              let diskInfo = null
              try {
                const fsInfo = await statfs('C:\\')
                const totalDiskGb = Number(((fsInfo.blocks * fsInfo.bsize) / 1024 ** 3).toFixed(1))
                const freeDiskGb = Number(((fsInfo.bavail * fsInfo.bsize) / 1024 ** 3).toFixed(1))
                const diskPct = Math.round(((totalDiskGb - freeDiskGb) / totalDiskGb) * 100)
                diskInfo = {
                  drive: 'C:',
                  total_gb: totalDiskGb,
                  free_gb: freeDiskGb,
                  used_percent: diskPct,
                }
              } catch {}

              // Sample CPU usage across 150ms
              const cpus1 = cpus()
              await new Promise((r) => setTimeout(r, 150))
              const cpus2 = cpus()

              let totalDiff = 0
              let idleDiff = 0
              for (let i = 0; i < cpus1.length; i++) {
                const t1 = cpus1[i].times
                const t2 = cpus2[i].times
                const u1 = t1.user + t1.nice + t1.sys + t1.irq
                const u2 = t2.user + t2.nice + t2.sys + t2.irq
                totalDiff += (u2 + t2.idle) - (u1 + t1.idle)
                idleDiff += t2.idle - t1.idle
              }
              const cpuPct = totalDiff > 0 ? Math.round(((totalDiff - idleDiff) / totalDiff) * 100) : 0

              // Active Network
              const nets = networkInterfaces()
              let activeNet = 'none'
              for (const [name, addrs] of Object.entries(nets)) {
                if (addrs?.some((a) => !a.internal && a.family === 'IPv4')) {
                  activeNet = name
                  break
                }
              }

              const statusData = {
                cpu_load_percent: cpuPct,
                cpu_cores: cpus1.length,
                ram_total_gb: totalRamGb,
                ram_used_gb: usedRamGb,
                ram_free_gb: freeRamGb,
                ram_percent: ramPct,
                disk: diskInfo,
                active_network: activeNet,
              }

              return { content: [{ type: 'text', text: JSON.stringify(statusData, null, 2) }] }
            } catch (err) {
              return { isError: true, content: [{ type: 'text', text: `Failed to read status: ${err.message}` }] }
            }
          }

          if (action === 'screenshot') {
            const tempDir = join(tmpdir(), 'jarvis-media')
            if (!existsSync(tempDir)) {
              await mkdir(tempDir, { recursive: true })
            }
            const filename = `screenshot-${Date.now()}.png`
            const outPath = join(tempDir, filename)

            const script = `
Add-Type -AssemblyName System.Drawing, System.Windows.Forms
$screen = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$bitmap = New-Object System.Drawing.Bitmap $screen.Width, $screen.Height
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.CopyFromScreen($screen.Location, [System.Drawing.Point]::Empty, $screen.Size)
$bitmap.Save($env:OUT_PATH, [System.Drawing.Imaging.ImageFormat]::Png)
$graphics.Dispose()
$bitmap.Dispose()
Write-Output $env:OUT_PATH
`
            try {
              await runPowerShell(script, { OUT_PATH: outPath }, 10000, abortControllers)
              return {
                content: [
                  {
                    type: 'text',
                    text: `Screenshot captured: ${outPath}\n(To display on HUD: use mcp__jarvis__blade with kind: "image" and url: "${outPath}")`,
                  },
                ],
              }
            } catch (err) {
              return { isError: true, content: [{ type: 'text', text: `Screenshot failed: ${err.message}` }] }
            }
          }

          if (action === 'volume') {
            const vol = Number(value ?? 50)
            const gate = await checkPermission(ask, {
              tool: 'win_system',
              action: 'volume',
              tier: TIERS.TIER_1_SAFE_ACTION,
              title: `Set Volume to ${vol}%`,
              detail: `Master volume: ${vol}%`,
            })
            if (!gate.approved) {
              return { isError: true, content: [{ type: 'text', text: gate.reason ?? 'Denied by user.' }] }
            }

            // Adjust master volume using CoreAudio WASAPI in PowerShell
            const script = `
$sig = @'
[DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
'@
$type = Add-Type -MemberDefinition $sig -Name AudioVolume -Namespace Win32 -PassThru -ErrorAction SilentlyContinue
# Normalize: 50 taps down, then target / 2 taps up
for ($i = 0; $i -lt 50; $i++) {
  $type::keybd_event(174, 0, 0, [UIntPtr]::Zero)
  $type::keybd_event(174, 0, 2, [UIntPtr]::Zero)
}
$upTaps = [math]::Round(${Math.min(100, Math.max(0, vol))} / 2)
for ($i = 0; $i -lt $upTaps; $i++) {
  $type::keybd_event(175, 0, 0, [UIntPtr]::Zero)
  $type::keybd_event(175, 0, 2, [UIntPtr]::Zero)
}
`
            try {
              await runPowerShell(script, {}, 10000, abortControllers)
              return { content: [{ type: 'text', text: `Volume set to ~${vol}%.` }] }
            } catch (err) {
              return { isError: true, content: [{ type: 'text', text: `Failed to set volume: ${err.message}` }] }
            }
          }

          if (action === 'brightness') {
            const b = Math.min(100, Math.max(0, Number(value ?? 70)))
            const gate = await checkPermission(ask, {
              tool: 'win_system',
              action: 'brightness',
              tier: TIERS.TIER_1_SAFE_ACTION,
              title: `Set Brightness to ${b}%`,
              detail: `Display brightness: ${b}%`,
            })
            if (!gate.approved) {
              return { isError: true, content: [{ type: 'text', text: gate.reason ?? 'Denied by user.' }] }
            }

            const script = `
try {
  (Get-WmiObject -Namespace root/wmi -Class WmiMonitorBrightnessMethods).WmiSetBrightness(1, ${b})
  Write-Output "Brightness set to ${b}%."
} catch {
  Write-Output "Display does not support software brightness controls via WMI."
}
`
            try {
              const res = await runPowerShell(script, {}, 8000, abortControllers)
              return { content: [{ type: 'text', text: res || `Brightness set to ${b}%.` }] }
            } catch (err) {
              return { isError: true, content: [{ type: 'text', text: `Brightness adjustment failed: ${err.message}` }] }
            }
          }

          if (action === 'open_settings') {
            const page = setting || 'display'
            const uri = `ms-settings:${page}`
            const gate = await checkPermission(ask, {
              tool: 'win_system',
              action: 'open_settings',
              tier: TIERS.TIER_1_SAFE_ACTION,
              title: `Open Settings: ${page}`,
              detail: uri,
            })
            if (!gate.approved) {
              return { isError: true, content: [{ type: 'text', text: gate.reason ?? 'Denied by user.' }] }
            }

            try {
              await runPowerShell(`Start-Process -FilePath $env:SETTINGS_URI`, { SETTINGS_URI: uri }, 6000, abortControllers)
              return { content: [{ type: 'text', text: `Opened Windows Settings page: ${page}.` }] }
            } catch (err) {
              return { isError: true, content: [{ type: 'text', text: `Failed to open settings: ${err.message}` }] }
            }
          }

          if (action === 'power') {
            const p = powerAction || 'lock'
            if (p === 'lock') {
              const gate = await checkPermission(ask, {
                tool: 'win_system',
                action: 'power:lock',
                tier: TIERS.TIER_1_SAFE_ACTION,
                title: 'Lock Workstation',
                detail: 'Locks Windows screen.',
              })
              if (!gate.approved) {
                return { isError: true, content: [{ type: 'text', text: gate.reason ?? 'Denied by user.' }] }
              }
              await runPowerShell('rundll32.exe user32.dll,LockWorkStation', {}, 5000, abortControllers)
              return { content: [{ type: 'text', text: 'Workstation locked.' }] }
            }

            // Sleep, restart, shutdown: STRICT TIER 3 CONFIRMATION
            const gate = await checkPermission(ask, {
              tool: 'win_system',
              action: `power:${p}`,
              tier: TIERS.TIER_3_DESTRUCTIVE,
              title: `SYSTEM ${p.toUpperCase()}`,
              detail: `This will ${p} the machine immediately. Confirm execution.`,
            })
            if (!gate.approved) {
              return { isError: true, content: [{ type: 'text', text: gate.reason ?? 'System action denied by user.' }] }
            }

            let cmd = ''
            if (p === 'sleep') cmd = 'rundll32.exe powrprof.dll,SetSuspendState 0,1,0'
            else if (p === 'restart') cmd = 'shutdown.exe /r /t 5 /c "JARVIS reboot requested"'
            else if (p === 'shutdown') cmd = 'shutdown.exe /s /t 5 /c "JARVIS shutdown requested"'

            await runPowerShell(cmd, {}, 5000, abortControllers)
            return { content: [{ type: 'text', text: `System ${p} initiated.` }] }
          }

          return { isError: true, content: [{ type: 'text', text: `Unknown system action: ${action}` }] }
        },
      ),

      // ---------------------------------------------------------------------
      // 5. win_browser: Safe Browser & Search Operations
      // ---------------------------------------------------------------------
      tool(
        'win_browser',
        `Open web URLs or perform web searches in the user's default browser.
Actions:
  - 'open_url': Opens an approved http/https URL. (Tier 1)
  - 'search_web': Performs a Google search for the query. (Tier 1)`,
        {
          action: z.enum(['open_url', 'search_web']),
          url: z.string().optional().describe('Full HTTP/HTTPS URL.'),
          query: z.string().optional().describe('Search terms.'),
        },
        async ({ action, url: targetUrl, query: q }) => {
          let finalUrl = ''
          if (action === 'search_web') {
            if (!q) return { isError: true, content: [{ type: 'text', text: 'Search query required.' }] }
            finalUrl = `https://www.google.com/search?q=${encodeURIComponent(q)}`
          } else {
            if (!targetUrl) return { isError: true, content: [{ type: 'text', text: 'URL required.' }] }
            try {
              const u = new URL(targetUrl)
              if (u.protocol !== 'http:' && u.protocol !== 'https:') {
                return { isError: true, content: [{ type: 'text', text: 'Only HTTP/HTTPS URLs are allowed.' }] }
              }
              finalUrl = u.toString()
            } catch {
              return { isError: true, content: [{ type: 'text', text: `Invalid URL: "${targetUrl}"` }] }
            }
          }

          const gate = await checkPermission(ask, {
            tool: 'win_browser',
            action,
            tier: TIERS.TIER_1_SAFE_ACTION,
            title: action === 'search_web' ? `Search Web: "${q}"` : `Open URL: ${finalUrl}`,
            detail: finalUrl,
          })
          if (!gate.approved) {
            return { isError: true, content: [{ type: 'text', text: gate.reason ?? 'Denied by user.' }] }
          }

          try {
            await runPowerShell(`Start-Process -FilePath $env:TARGET_URL`, { TARGET_URL: finalUrl }, 8000, abortControllers)
            return { content: [{ type: 'text', text: `Opened "${finalUrl}" in default browser.` }] }
          } catch (err) {
            return { isError: true, content: [{ type: 'text', text: `Failed to open browser: ${err.message}` }] }
          }
        },
      ),

      // ---------------------------------------------------------------------
      // 6. win_dev: Developer Workflows (VS Code & Safe Project Commands)
      // ---------------------------------------------------------------------
      tool(
        'win_dev',
        `Developer tooling and project operations.
Actions:
  - 'open_in_vscode': Opens a project or folder in Visual Studio Code. (Tier 1)
  - 'git_status': Runs 'git status --short --branch' in the target project. (Tier 0)
  - 'git_diff': Runs 'git diff --stat' in the target project. (Tier 0)
  - 'run_project_command': Runs whitelisted dev commands (e.g. 'npm test', 'npm run lint', 'npm run build', 'npx tsc --noEmit'). (Tier 2)`,
        {
          action: z.enum(['open_in_vscode', 'git_status', 'git_diff', 'run_project_command']),
          projectPath: z.string().optional().describe('Project directory path (defaults to current project).'),
          command: z.string().optional().describe('Command name (e.g. "npm", "npx", "git").'),
          args: z.array(z.string()).optional().describe('Arguments for the command.'),
        },
        async ({ action, projectPath: rawProj, command: cmdName, args: cmdArgs = [] }) => {
          const projectDir = resolvePath(rawProj || process.cwd())

          if (!isPathAllowed(projectDir)) {
            return { isError: true, content: [{ type: 'text', text: `Project path "${projectDir}" is outside allowed developer roots.` }] }
          }

          if (action === 'open_in_vscode') {
            const gate = await checkPermission(ask, {
              tool: 'win_dev',
              action: 'open_in_vscode',
              tier: TIERS.TIER_1_SAFE_ACTION,
              title: `Open in VS Code: ${basename(projectDir)}`,
              detail: projectDir,
            })
            if (!gate.approved) {
              return { isError: true, content: [{ type: 'text', text: gate.reason ?? 'Denied by user.' }] }
            }

            try {
              execFile('code', [projectDir], { shell: true })
              return { content: [{ type: 'text', text: `Opened "${projectDir}" in VS Code.` }] }
            } catch (err) {
              return { isError: true, content: [{ type: 'text', text: `Failed to launch VS Code: ${err.message}` }] }
            }
          }

          if (action === 'git_status') {
            try {
              const out = await new Promise((res, rej) => {
                execFile('git', ['status', '--short', '--branch'], { cwd: projectDir }, (err, stdout, stderr) => {
                  if (err) rej(new Error(stderr.trim() || err.message))
                  else res(stdout.trim() || 'Clean working tree.')
                })
              })
              return { content: [{ type: 'text', text: out }] }
            } catch (err) {
              return { isError: true, content: [{ type: 'text', text: `git status failed: ${err.message}` }] }
            }
          }

          if (action === 'git_diff') {
            try {
              const out = await new Promise((res, rej) => {
                execFile('git', ['diff', '--stat'], { cwd: projectDir }, (err, stdout, stderr) => {
                  if (err) rej(new Error(stderr.trim() || err.message))
                  else res(stdout.trim() || 'No unstaged changes.')
                })
              })
              return { content: [{ type: 'text', text: out }] }
            } catch (err) {
              return { isError: true, content: [{ type: 'text', text: `git diff failed: ${err.message}` }] }
            }
          }

          if (action === 'run_project_command') {
            const allowedBinaries = new Set(['npm', 'npx', 'node', 'git', 'pnpm'])
            const baseBin = (cmdName || '').toLowerCase().trim()
            if (!allowedBinaries.has(baseBin)) {
              return { isError: true, content: [{ type: 'text', text: `Binary "${baseBin}" is not in the approved developer whitelist (${[...allowedBinaries].join(', ')}).` }] }
            }

            const fullCmd = `${baseBin} ${cmdArgs.join(' ')}`
            const gate = await checkPermission(ask, {
              tool: 'win_dev',
              action: 'run_project_command',
              tier: TIERS.TIER_2_MUTATION,
              title: `Run Project Command: ${fullCmd}`,
              detail: `In directory: ${projectDir}\nCommand: ${fullCmd}`,
            })
            if (!gate.approved) {
              return { isError: true, content: [{ type: 'text', text: gate.reason ?? 'Denied by user.' }] }
            }

            try {
              const result = await new Promise((resolveResult) => {
                execFile(baseBin, cmdArgs, { cwd: projectDir, shell: true, timeout: 60000 }, (err, stdout, stderr) => {
                  resolveResult({
                    exitCode: err?.code ?? 0,
                    stdout: stdout.trim(),
                    stderr: stderr.trim(),
                  })
                })
              })
              return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
            } catch (err) {
              return { isError: true, content: [{ type: 'text', text: `Command execution failed: ${err.message}` }] }
            }
          }

          return { isError: true, content: [{ type: 'text', text: `Unknown dev action: ${action}` }] }
        },
      ),
    ],
  })
}
