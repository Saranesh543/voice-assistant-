# PHASE 1 — COMPLETE JARVIS CODEBASE AUDIT & ARCHITECTURAL BASELINE

**Project**: J.A.R.V.I.S. (Just A Rather Very Intelligent System)  
**Target Environment**: Windows 11 Desktop Application  
**Audit Date**: October 2026  
**Auditor**: Senior Software Architect & Principal Security Engineer  
**Status**: AUDIT COMPLETE — BASELINE ESTABLISHED (NO SOURCE MODIFICATIONS MADE)

---

## 1. Executive Summary

A comprehensive architectural and security audit of the JARVIS repository was performed. The existing codebase represents a sophisticated, highly responsive browser-based prototype combining:
- A high-fidelity, Iron Man-inspired holographic interface rendered in **React 19**, **Three.js (r185)**, **@react-three/fiber**, and custom GLSL vertex/fragment shaders.
- A local **Node.js bridge** (`bridge/server.mjs`) that operates the **Claude Agent SDK** (`@anthropic-ai/claude-agent-sdk`), running Claude Code headlessly with access to tools in `~/.claude.json`.
- A resilient voice pipeline with local energy-based Voice Activity Detection (**VAD**), streaming Text-to-Speech (**TTS**) through ElevenLabs or browser synthesis, and MediaPipe hand gesture tracking.

### Key Architectural Strengths
1. **Low-Latency Streaming Pipeline**: Token-by-token streaming from Claude Agent SDK with sentence-level audio playback chunking allows JARVIS to start speaking before Claude finishes generating.
2. **Instant Acoustic Barge-In**: The microphone remains open while JARVIS speaks; an energy-based VAD paired with acoustic self-echo filtering permits natural conversational interruption.
3. **Decoupled HUD Protocol**: The `display` and `blade` MCP tools allow the AI agent to author structured, sanitised UI presentations (articles, galleries, metrics, video embeds) delivered out-of-band over WebSockets.

### Critical Deficiencies & Desktop Blockers
1. **Zero Desktop Infrastructure**: The repository is currently 100% web-bound. There is no Electron shell, no frameless transparent floating window, no always-on-top mechanism, no system tray integration, and no global keyboard shortcuts.
2. **Background Audio Impossibility in Current Architecture**: In Chrome/Edge, background tabs are aggressively throttled and Web Speech / audio capture drops when the window loses focus. True background "Hey JARVIS" listening requires desktop native audio capture.
3. **Unsafe Network Binding & Missing Authentication**: The Node bridge listens on all network interfaces (`0.0.0.0`) by default without an authentication secret, exposing HTTP proxy and WebSocket agent controls to the local network.
4. **POSIX Assumptions on Windows**: File-path handling in `bridge/chrome.mjs` expects Unix domain sockets in `/tmp/claude-mcp-browser-bridge-<user>`, and `src/ui/sanitise.ts` regex only matches Unix root paths (`/Users`, `/home`, `/tmp`), breaking Windows screenshot rendering and browser automation.
5. **Missing Workspace State**: `node_modules` is not installed, no git repository is initialized, and Picovoice Porcupine is declared in `package.json` and `src/config.ts` but is completely unintegrated in `src/lib/voice.ts`.

---

## 2. Repository Inventory

### 2.1 Workspace Overview
- **Root Directory**: `c:\Users\saran\OneDrive\Desktop\PROJECTS\jarvis-main\jarvis-main`
- **Total Files**: 42 application files (plus documentation, config, and 99 agent skills in `.agents/skills`)
- **Git Status**: Untracked directory (No `.git` repository present)
- **Node Modules**: Not installed (`node_modules` does not exist)

### 2.2 Detailed File Catalog

| File Path | Type | Size | Primary Exports / Functions | Responsibilities & Architectural Role |
|:---|:---|:---|:---|:---|
| `package.json` | JSON | 1.5 KB | - | Declares scripts, dependencies (`@anthropic-ai/claude-agent-sdk`, `three`, `react`, `kokoro-js`, etc.) |
| `package-lock.json` | JSON | 178 KB | - | Dependency lockfile pinning exact versions |
| `vite.config.ts` | TS | 910 B | `defineConfig` | Vite build configuration with React plugin and dev server port bindings |
| `tsconfig.json` | JSON | 119 B | - | TypeScript base project configuration |
| `tsconfig.app.json` | JSON | 655 B | - | Client-side TypeScript compiler options |
| `tsconfig.node.json` | JSON | 558 B | - | Node-side TypeScript compiler options |
| `.oxlintrc.json` | JSON | 245 B | - | Fast linting rule configuration |
| `.env.example` | Config | 4.3 KB | - | Environment variable template (bridge & frontend) |
| `index.html` | HTML | 3.5 KB | - | HTML shell with Content-Security-Policy (CSP) and Google Fonts |
| `scripts/start.mjs` | Node MJS | 4.8 KB | `run`, `vendorWasm` | Dual-process launcher spawning bridge and Vite dev server |
| `scripts/setup.mjs` | Node MJS | 4.6 KB | Preflight checks | Advisory hardware, Node version, Claude CLI, and key diagnostic |
| `bridge/server.mjs` | Node MJS | 62.1 KB | HTTP/WS Server | Bridge hub: runs Claude Agent SDK `query()`, handles MCP servers, tool policy, `/tts`, `/stt`, `/file`, `/img` |
| `bridge/net.mjs` | Node MJS | 12.6 KB | `vetTarget`, `openRemote` | SSRF protection layer with DNS pinning, private IP filtering, and streaming HTTP proxy |
| `bridge/page.mjs` | Node MJS | 21.4 KB | `renderPage`, `probeUrl` | Article reader and live page extraction for HUD blade display |
| `bridge/panels.mjs` | Node MJS | 21.0 KB | `displayServer` | In-process MCP server exposing `display`, `blade`, and `probe_url` |
| `bridge/ui.mjs` | Node MJS | 20.0 KB | `uiServer` | In-process MCP server exposing `ui_theme`, `ui_reactor`, `ui_orbit`, `ui_effect` |
| `bridge/chrome.mjs` | Node MJS | 30.8 KB | `chromeServer` | Chrome native messaging integration via Unix domain socket |
| `bridge/vision.mjs` | Node MJS | 8.1 KB | `visionServer` | In-process MCP server exposing `look` and `watch` camera tools |
| `src/main.tsx` | TSX | 351 B | Entry Point | React 19 root bootstrap into DOM `#root` |
| `src/App.tsx` | TSX | 24.7 KB | `App` | Central orchestration component: voice event state machine, audio lifecycle, keyboard handlers, HUD layout |
| `src/config.ts` | TS | 12.1 KB | `BACKEND`, `MODEL`, etc. | Vite environment parser, model defaults, MCP remote definitions |
| `src/store.ts` | TS | 18.2 KB | `useStore`, `phaseColor` | Zustand state store for UI phase, HUD panels, blades, orbits, audio levels |
| `src/index.css` | CSS | 51.4 KB | - | Iron Man holographic HUD styling, fonts, animations, blade layouts |
| `src/lib/brain.ts` | TS | 4.9 KB | `ask`, `cancel`, `warm` | Backend router dispatching between `bridge.ts` and `anthropic.ts` |
| `src/lib/bridge.ts` | TS | 17.4 KB | `ask`, `watchServers` | Client WebSocket transport communicating with `bridge/server.mjs` |
| `src/lib/anthropic.ts` | TS | 6.6 KB | `ask`, `cancel` | Browser-direct Anthropic Messages API client (`dangerouslyAllowBrowser`) |
| `src/lib/voice.ts` | TS | 29.0 KB | `startVoice` | Continuous voice loop: SpeechRecognition / Scribe fallback, barge-in, debounce |
| `src/lib/vad.ts` | TS | 9.3 KB | `startVad` | Energy-based voice activity detector using `AnalyserNode` + `requestAnimationFrame` (NOT ScriptProcessorNode). ⚠ `rAF` pauses when Electron window is hidden. |
| `src/lib/tts.ts` | TS | 28.6 KB | `createSpeaker` | Sentence-boundary audio streaming queue; routes between native, Kokoro, ElevenLabs |
| `src/lib/kokoro.ts` | TS | 5.2 KB | `load`, `speak` | In-browser ONNX neural TTS engine (`kokoro-js`) |
| `src/lib/audio.ts` | TS | 2.1 KB | `startAnalyser`, `micLevel` | Web Audio AnalyserNode pumping mic RMS to reactor shader |
| `src/lib/camera.ts` | TS | 10.0 KB | `holdCamera`, `grabFrame` | Ref-counted `getUserMedia` camera handle with rolling frame buffer |
| `src/lib/hands.ts` | TS | 35.1 KB | `enableHands` | MediaPipe HandLandmarker skeleton tracking with 1€ filter and pinch detection |
| `src/lib/oneEuro.ts` | TS | 4.2 KB | `OneEuroFilter` | 1€ adaptive low-pass filter for jitter reduction |
| `src/lib/clap.ts` | TS | 5.5 KB | `listenForClap` | Acoustic transient clap detector for hands-free ignition |
| `src/lib/fillers.ts` | TS | 7.3 KB | `forTool`, `attention` | British English vocal fillers spoken during long-running tool operations |
| `src/lib/music.ts` | TS | 9.2 KB | `playBoot`, `startAmbient` | Background soundtrack management, ducking, and combat themes |
| `src/lib/sfx.ts` | TS | 9.9 KB | `play`, `unlockAudio` | Web Audio synthesized and sampled sound effects |
| `src/lib/capabilities.ts`| TS | 3.0 KB | `probeCapabilities` | Probes bridge `GET /health` to determine TTS/STT availability |
| `src/scene/Scene.tsx` | TSX | 9.0 KB | `Scene` | Three.js Canvas with Bloom, Chromatic Aberration, Vignette postprocessing |
| `src/scene/Core.tsx` | TSX | 12.1 KB | `Core` | Custom GLSL vertex/fragment shader rendering the holographic arc reactor |
| `src/scene/Orbits.tsx` | TSX | 9.5 KB | `Orbits` | Renders dynamic floating media cards revolving around the arc reactor |
| `src/scene/Particles.tsx`| TSX | 4.8 KB | `Particles` | Ambient drifting cybernetic dust field responding to speech amplitude |
| `src/ui/Hud.tsx` | TSX | 12.8 KB | `Hud` | Primary overlay: Systems rail, Transcript feed, Tool badges, Wordmark |
| `src/ui/Boot.tsx` | TSX | 9.0 KB | `Boot` | Four-beat Iron Man startup sequence animation and audio sync |
| `src/ui/Ignition.tsx` | TSX | 2.5 KB | `Ignition` | Offline startup screen with "INITIALISE" button and audio unlock |
| `src/ui/Blades.tsx` | TSX | 27.0 KB | `Blades` | Floating interactive cards for rich content (Reader, Live Page, Video, Gallery) |
| `src/ui/Panels.tsx` | TSX | 7.6 KB | `Panels` | Compact HUD glance cards |
| `src/ui/Diagnostics.tsx`| TSX | 4.6 KB | `Diagnostics` | Press 'D' diagnostics readout (Audio, STT, TTS, Bridge status) |
| `src/ui/sanitise.ts` | TS | 12.6 KB | `sanitise` | DOMPurify wrapper, CSS class allowlist, and URL rewriter for HUD safety |

---

## 3. Architecture & Data Flow

```
+---------------------------------------------------------------------------------------------------------+
|                                        FRONTEND (Vite / React 19)                                       |
|                                                                                                         |
|  +--------------------+        +---------------------+        +--------------------+                    |
|  |   User Utterance   | -----> |   Local Energy VAD  | -----> | SpeechRecognition/ |                    |
|  |  (Mic Audio Stream)|        |    (src/lib/vad.ts) |        | Bridge /stt Scribe |                    |
|  +--------------------+        +---------------------+        +--------------------+                    |
|                                                                          |                              |
|                                                                   Transcribed Text                      |
|                                                                          v                              |
|  +---------------------------------------------------------------------------------------------------+  |
|  |                                          App.tsx Orchestrator                                     |  |
|  |   - Turn counter & barge-in detection           - AudioContext & SFX/Music playback              |  |
|  |   - Zustand store updates (Phase, UI, Orbits)   - MediaPipe gesture cursor & pointer events      |  |
|  +---------------------------------------------------------------------------------------------------+  |
|                                           |                                                             |
|                   +-----------------------+-----------------------+                                     |
|                   |                                               |                                     |
|         Bridge Mode (Default)                           Direct Mode (Fallback)                          |
|                   v                                               v                                     |
|  +---------------------------------+             +----------------------------------+                   |
|  |    WebSocket (src/lib/bridge.ts)|             | Anthropic SDK (src/lib/anthropic)|                   |
|  +---------------------------------+             +----------------------------------+                   |
+-------------------|-----------------------------------------------|-------------------------------------+
                    |                                               |
         ws://localhost:8787                               HTTPS (api.anthropic.com)
                    |                                               |
+-------------------|---------------------------------------+       |
|                   v                                       |       |
|       BRIDGE PROCESS (Node.js 20+)                        |       |
|                                                           |       |
|  +-----------------------------------------------------+  |       |
|  |               bridge/server.mjs                     |  |       |
|  |  - Origin validation (localhost:5173-5199)          |  |       |
|  |  - In-process MCP: jarvis, jarvis_ui, jarvis_eyes   |  |       |
|  |  - External MCP: ~/.claude.json config loader       |  |       |
|  |  - Tool Authorization Gate: decideTool()            |  |       |
|  +-----------------------------------------------------+  |       |
|                            |                              |       |
|                            v                              |       |
|  +-----------------------------------------------------+  |       |
|  |            Claude Agent SDK (query())               |  |       |
|  |  - Spawns claude CLI subprocess                    |  |       |
|  |  - Stream events (content_block_delta)              |  |       |
|  |  - Permission verification callback (canUseTool)    |  |       |
|  +-----------------------------------------------------+  |       |
|                            |                              |       |
|                            v                              |       |
|  +-----------------------------------------------------+  |       |
|  |                 Tool Execution                      |  |       |
|  |  - Read-Only: WebSearch, Exa, Read, Glob            |  |       |
|  |  - Write-Gated: Bash, Write, Edit (ALLOW_WRITES=1)  |  |       |
|  |  - UI Out-of-Band: emitBlade(), uiServer()          |  |       |
|  +-----------------------------------------------------+  |       |
+-----------------------------------------------------------+       |
                                                                    v
                                                     +------------------------------+
                                                     | Anthropic API Infrastructure |
                                                     +------------------------------+
```

### 3.1 Trace of Core Data Flows

1. **Application Startup & React Rendering**:
   - `scripts/start.mjs` vendors MediaPipe WASM from `node_modules` into `public/mediapipe/`, launches `bridge/server.mjs` on port 8787, and launches Vite on port 5173.
   - User navigates to `http://localhost:5173`. `src/main.tsx` renders `<App />` **without `<StrictMode>`** — the double-invoked effects that `StrictMode` triggers would open the microphone twice and the second subscription steals the audio stream from the first. **`<StrictMode>` must NEVER be added to this application.**
   - `App.tsx` initializes in phase `'offline'`, rendering `<Ignition />`, `<Scene />`, and `<Hud />`.

2. **Microphone Initialization & Wake-Word Detection**:
   - User clicks `INITIALISE` (or claps via `src/lib/clap.ts`). `sfx.unlockAudio()` resumes the Web Audio `AudioContext`.
   - `App.tsx` calls `startVoice()` (`src/lib/voice.ts`).
   - If ElevenLabs is configured on the bridge (`GET /health`), it runs `startVad()` (`src/lib/vad.ts`), streaming audio blobs to `bridge/server.mjs` `/stt` (ElevenLabs Scribe).
   - If unconfigured, it starts browser `webkitSpeechRecognition` with continuous listening and a watchdog heartbeat timer.
   - Text is regex-matched against `WAKE` (`/\b(?:hey|hi|ok|okay|yo)?\s*(?:jarvis|jarvys|jervis|travis|java's|jarv)\b/i`).

3. **Voice Activity Detection & Barge-In**:
   - `src/lib/vad.ts` computes Root Mean Square (RMS) audio energy via `AnalyserNode.getFloatTimeDomainData()` driven by a `requestAnimationFrame(tick)` loop — NOT `ScriptProcessorNode`.
   - Thresholds are adaptive: `floor * TRIGGER_OVER_FLOOR` (where `TRIGGER_OVER_FLOOR = 2.6`) in calm mode, multiplied by `GUARD_BOOST = 2.4` while JARVIS is speaking. The floor tracks ambient noise via asymmetric smoothing (`FLOOR_UP = 0.0008`, `FLOOR_DOWN = 0.02`).
   - **⚠ CRITICAL DESKTOP IMPACT**: Both `src/lib/vad.ts` and `src/lib/clap.ts` use `requestAnimationFrame` as their tick driver. Chromium completely **pauses** `requestAnimationFrame` when an Electron window is hidden, minimized, or loses visibility. Both modules MUST be migrated off `requestAnimationFrame` to an unthrottled timer (`setInterval`) or `AudioWorkletNode` for background wake-word detection to function when the Electron window is hidden.
   - In `App.tsx`, `onSpeechStart()` checks if JARVIS is `thinking`, `tooling`, or `speaking`. If true, it immediately cancels active audio (`speaker.current?.cancel()`) and dispatches `interrupt()` to the bridge.

4. **Speech Synthesis & Lip-Sync**:
   - Text streams in via `onText(delta)`. `createSpeaker()` in `src/lib/tts.ts` buffers text and splits on sentence punctuation (`[.!?]`).
   - TTS Engine selection:
     1. `ElevenLabs`: POST `/tts` on bridge -> ElevenLabs Flash v2.5 streaming MP3 -> Web Audio decode.
     2. `Kokoro`: Local ONNX WASM model running in browser thread/WebGPU.
     3. `System`: Browser `speechSynthesis.speak(SpeechSynthesisUtterance)`.
   - While speaking, `speaker.current.level()` feeds the Zustand store `level`, which `src/scene/Core.tsx` passes to the GLSL shader to dynamically pulse the arc reactor core.

5. **AI Provider Request & Bridge Execution**:
   - In default bridge mode, `src/lib/bridge.ts` sends `{ type: 'ask', text, id }` over WebSocket to `ws://localhost:8787`.
   - In `bridge/server.mjs`, `wss.on('connection')` invokes `query()` from `@anthropic-ai/claude-agent-sdk`.
   - SDK streams partial message events (`stream_event` -> `content_block_delta` -> `text_delta`), which are pushed back to the client as `{ type: 'text', delta, ask: id }`.
   - Tool calls (`content_block_start` -> `tool_use`) trigger `canUseTool(toolName)`.
   - `decideTool(toolName)` enforces policy:
     - `READ_ONLY_BUILTINS` (`Read`, `Glob`, `Grep`, `WebSearch`, etc.) -> **Allowed**.
     - `WRITE_BUILTINS` (`Bash`, `Write`, `Edit`, `MultiEdit`) -> **Blocked** unless `JARVIS_ALLOW_WRITES=1`.
     - In-process tools (`jarvis`, `jarvis_ui`, `jarvis_chrome`, `jarvis_eyes`) -> **Allowed**.

6. **Out-of-Band UI Control & Blades**:
   - When the agent invokes `mcp__jarvis__blade` or `mcp__jarvis__display`, `bridge/panels.mjs` pushes a `{ type: 'blade' }` or `{ type: 'panel' }` message directly over the WebSocket.
   - The browser receives the message via `watchBlades()` in `src/lib/bridge.ts`, pushes it to Zustand `useStore.pushBlade()`, and renders it via `src/ui/Blades.tsx`.
   - HTML content is sanitized via `src/ui/sanitise.ts` (DOMPurify, class allowlist, media URL rewriting to `/img` or `/file`).

7. **Camera & Hand Tracking**:
   - `src/lib/camera.ts` maintains a ref-counted `navigator.mediaDevices.getUserMedia` video stream.
   - `src/lib/hands.ts` runs MediaPipe's `HandLandmarker` at 60 FPS, calculates landmark coordinates, smooths positions using `OneEuroFilter`, detects thumb-index pinches, and synthesizes `PointerEvent` (`pointerdown`, `pointermove`, `pointerup`) on DOM elements.
   - When the agent calls `look` or `watch`, `bridge/vision.mjs` sends `{ type: 'capture' }` over WebSocket. `watchCapture` in `App.tsx` grabs the frame via canvas `toDataURL('image/jpeg')` and returns it as base64.

---

## 4. Windows Desktop-Readiness Gap Analysis

The current JARVIS application runs exclusively as a web page inside a standard web browser. The following table identifies every missing architectural layer required for full Windows desktop capabilities:

| Desktop Capability | Current State | Missing Architectural Component | Required Implementation |
|:---|:---|:---|:---|
| **Frameless Transparent Window** | Fullscreen browser tab with solid `#01060c` background | Electron shell with transparent compositing | Electron `BrowserWindow` with `frame: false`, `transparent: true`, `backgroundColor: '#00000000'`, and Windows DWM acrylic/mica composition. |
| **Always-on-Top Floating UI** | Normal browser window (lost when clicking other apps) | Window Z-order management | `mainWindow.setAlwaysOnTop(true, 'screen-saver')` with level persistence across desktop workspaces. |
| **Draggable / Click-Through HUD** | Web layout fills 100vw/100vh; standard CSS events | Non-client window dragging & dynamic click-through | `-webkit-app-region: drag` for HUD headers; `mainWindow.setIgnoreMouseEvents(true, { forward: true })` over transparent canvas areas so clicks pass through to Windows apps underneath. |
| **System Tray & Global Shortcuts** | No tray icon; keyboard listeners only active when browser focused | Native Win32 Tray & OS-level Hotkeys | Electron `Tray` icon with status menu (`Wake`, `Sleep`, `Settings`, `Exit`); `globalShortcut.register('CommandOrControl+Shift+Space')` to summon JARVIS globally. |
| **Windows Startup & Process Lifecycle** | Manual `npm start` in terminal | Windows Run registry / shortcut integration | `app.setLoginItemSettings({ openAtLogin: userPreference })`; background daemon execution. |
| **Background Wake-Word Listening** | Browser tab stops listening when minimized or inactive | Independent background audio capture worker | Persistent background audio capture thread via native Node audio or headless Electron background worker with Porcupine / local VAD. |
| **Native PC Control & Automation** | Only Claude `Bash` tool (which fails on Windows cmd/powershell) | Secure Windows Automation Engine | Dedicated IPC / MCP bridge exposing safe Win32 controls: app launching (`explorer.exe shell:AppsFolder\...`), active window switching, volume control, media keys, and sandboxed PowerShell execution. |
| **Secure IPC Boundary** | Raw WebSocket on `ws://localhost:8787` | Context-isolated preload script | Electron `contextBridge.exposeInMainWorld('jarvisApi', ...)` with strictly typed IPC channels (`ipcRenderer` <-> `ipcMain`), replacing raw TCP sockets for renderer-to-desktop calls. |
| **Installer & Packaging** | Raw source files; requires git, node, npm | Windows Installer (.exe / NSIS) | `electron-builder` configuration producing code-signed NSIS installer and portable executable bundle. |

### 4.1 Electron-Specific Compatibility Issues

| Issue | Impact | Required Mitigation |
|:---|:---|:---|
| **Electron does not support `webkitSpeechRecognition`** | Upstream Electron binaries do not ship with Google's private Speech API keys. `SpeechRecognition` / `webkitSpeechRecognition` fails with `network` errors in Electron. | On desktop, wake-word detection + STT must rely on Picovoice Porcupine (local VAD) + Bridge `/stt` (ElevenLabs Scribe / Whisper / OpenAI / Gemini STT). Never use `webkitSpeechRecognition` in Electron. |
| **`requestAnimationFrame` paused when hidden** | Chromium pauses `rAF` when Electron `BrowserWindow` is hidden/minimized. `vad.ts` and `clap.ts` both use `rAF` as their tick driver, so VAD stops entirely. | Migrate both to `setInterval` or `AudioWorkletNode` before Phase 4 (background voice activation). |

---

## 5. Security Audit & Findings

Findings are categorized by CVSS severity and ranked accordingly.

```
+-------------------------------------------------------------------------------+
|                             SECURITY AUDIT SUMMARY                            |
|                                                                               |
|   CRITICAL (2) : SEC-01 (0.0.0.0 Bind), SEC-02 (Client Key Exposure)          |
|   HIGH     (3) : SEC-03 (Home Dir Traversal), SEC-04 (Ungated Shell Exec),    |
|                  SEC-05 (Unauthenticated WebSocket)                          |
|   MEDIUM   (3) : SEC-06 (Windows Path Sanitizer Bypass),                      |
|                  SEC-07 (POSIX Chrome Socket Failure), SEC-08 (Camera Policy) |
|   LOW      (2) : SEC-09 (Silent Message Drop), SEC-10 (Session Ephemerality)  |
+-------------------------------------------------------------------------------+
```

### SEC-01 [CRITICAL]: Unrestricted Network Binding (`0.0.0.0`)
- **File / Evidence**: `bridge/server.mjs:1001` (`server.listen(PORT)`)
- **Vulnerability**: In Node.js, omitting the host argument in `server.listen(port)` binds the HTTP/WebSocket server to `0.0.0.0` (all IPv4 and IPv6 network interfaces) rather than `127.0.0.1`.
- **Realistic Impact**: Anyone connected to the same local network (Wi-Fi, office LAN, VPN) can probe the server. If `JARVIS_ALLOW_NO_ORIGIN=1` is set, an attacker on the LAN can open WebSockets and drive the agent or exploit local file reads.
- **Remediation**: Explicitly bind to loopback: `server.listen(PORT, '127.0.0.1')`.

### SEC-02 [CRITICAL]: Third-Party & Anthropic API Key Exposure in Client Bundle
- **File / Evidence**: `src/config.ts:131-137, 187-269`, `src/lib/anthropic.ts:10-13`
- **Vulnerability**: In direct mode, Vite inlines `VITE_ANTHROPIC_API_KEY`, `VITE_ZAPIER_MCP_URL`, `VITE_NOTION_TOKEN`, `VITE_GITHUB_TOKEN`, and `VITE_STRIPE_TOKEN` directly into client-side JavaScript assets with `dangerouslyAllowBrowser: true`.
- **Realistic Impact**: Anyone with access to the browser devtools, network tab, or bundle files extracts all private tokens and cloud credentials.
- **Remediation**: Strip all sensitive API keys from frontend Vite environment variables. Route all AI and MCP operations exclusively through the local desktop backend process.

### SEC-03 [HIGH]: Broad Local File Disclosure via `/file` Endpoint
- **File / Evidence**: `bridge/server.mjs:482-506, 693-733`
- **Vulnerability**: `FILE_ROOTS` includes `homedir()` (`C:\Users\<user>`). The endpoint serves any file within `FILE_ROOTS` if its resolved extension matches `.png`, `.jpg`, `.jpeg`, `.webp`, `.gif`.
- **Realistic Impact**: Any local page or script that can make an HTTP GET request (or load an `<img>`) can read arbitrary files in the user's entire home directory if they have image extensions or if an attacker can write/symlink files.
- **Remediation**: Restrict `FILE_ROOTS` to dedicated application artifact and cache directories (e.g., `%APPDATA%/jarvis/media` and `%TEMP%/jarvis`). Reject general home directory traversal.

### SEC-04 [HIGH]: Shell Execution Risk in Write Mode (`ALLOW_WRITES=1`)
- **File / Evidence**: `bridge/server.mjs:139-143, 257`, `scripts/start.mjs:47`
- **Vulnerability**: Starting with `--writes` enables built-in tools (`Bash`, `Write`, `Edit`) and effectful MCP tools unconditionally. In an assistant that ingests untrusted web content via `exa` / `web_fetch`, prompt injection can coerce the model into executing destructive shell commands without user confirmation.
- **Realistic Impact**: Arbitrary code execution and system file modification triggered by malicious web content ingested during browsing.
- **Remediation**: Implement a Native Safeguard Confirmation Gate for sensitive PC actions (shell commands, file deletion, financial tools) with an interactive approval dialog in the desktop UI.

### SEC-05 [HIGH]: Unauthenticated WebSocket Connection
- **File / Evidence**: `bridge/server.mjs:985-998`
- **Vulnerability**: WebSocket connection verification relies solely on the HTTP `Origin` header matching `localhost:5173-5199`. Non-browser processes (curl, malware, Python scripts) can set arbitrary `Origin` headers. When `JARVIS_ALLOW_NO_ORIGIN=1` is toggled, verification is bypassed entirely.
- **Realistic Impact**: Local processes can hijack the agent session and execute MCP commands without user knowledge.
- **Remediation**: Generate an ephemeral session authentication token at startup, passed to the client via secure Electron preload IPC or query parameter.

### SEC-05b [HIGH]: Unauthenticated HTTP Sub-Routes Accessible Without Origin
- **File / Evidence**: `bridge/server.mjs:665-668` (`handleRequest` — `if (origin && !originAllowed(origin))`)
- **Vulnerability**: The origin check in `handleRequest` is `if (origin && !originAllowed(origin))` — it only rejects requests that **have** an `Origin` header and fail the allowlist. Any HTTP request that **omits** the `Origin` header (e.g., `curl`, scripts, native apps, or malware) bypasses the check entirely. Combined with `server.listen(PORT)` binding to `0.0.0.0`, every device on the local network can call:
  - `GET /file?path=...` — read any image file under `homedir()`
  - `GET /page?url=...` — use the bridge as an SSRF proxy to fetch arbitrary web pages
  - `POST /tts` — consume ElevenLabs TTS credits
  - `POST /stt` — consume ElevenLabs STT credits
  This is independent of `JARVIS_ALLOW_NO_ORIGIN`, which only affects WebSocket connections.
- **Remediation**: Require a `JARVIS_BRIDGE_TOKEN` header on all HTTP requests from non-localhost origins, or apply the same origin check that defaults to deny-if-absent (matching WebSocket behavior). Bind to `127.0.0.1` (SEC-01 fix) as the primary mitigation.

### SEC-06 [MEDIUM]: Windows Path Sanitization Failure in HUD Media Rewriter
- **File / Evidence**: `src/ui/sanitise.ts:21-23` (`const DISK_PATH = /^\/(Users|home|root|Volumes|Applications|System|Library|private|tmp|var|opt|mnt|media|srv|data)\//`)
- **Vulnerability**: The regex specifically matches POSIX root slashes and directory names. On Windows, absolute paths formatted as `C:\Users\...` or `C:/Users/...` fail this regex test.
- **Realistic Impact**: Local screenshots and generated images on Windows fail to be rewritten to `${BRIDGE_HTTP_URL}/file?path=...`, resulting in broken images across the holographic blades.
- **Remediation**: Update `DISK_PATH` to support Windows drive letters: `/^(?:[a-zA-Z]:[\\/]|[\/\\](?:Users|home|tmp|var|Windows|ProgramData))/i`.
- **Additional Finding**: The identical POSIX-only `DISK_PATH` regex is duplicated in THREE files, not one:
  1. `src/ui/sanitise.ts:21-22`
  2. `src/ui/Blades.tsx:45-46` (the `viaBridge()` helper)
  3. `src/scene/Orbits.tsx:33-34` (the `resolveSrc()` helper)
  All three must be updated (or consolidated into a shared `src/lib/paths.ts` helper) so Windows paths (`C:\...`, `file:///C:/...`) work across panels, blades, and 3D orbits.

### SEC-07 [MEDIUM]: Hardcoded POSIX Unix Domain Socket in Chrome Bridge
- **File / Evidence**: `bridge/chrome.mjs:56` (`const SOCKET_DIR = '/tmp/claude-mcp-browser-bridge-' + userInfo().username`)
- **Vulnerability**: Hardcoded `/tmp/...` Unix socket path does not exist on native Windows. Chrome Native Messaging on Windows uses Named Pipes (`\\.\pipe\...`).
- **Realistic Impact**: `bridge/chrome.mjs` immediately throws `ENOENT` on Windows, completely disabling Chrome browser driving.
- **Remediation**: Implement OS-aware socket resolution detecting Windows Named Pipes versus POSIX sockets.

### SEC-08 [MEDIUM]: Speculative Webcam Frame Ingestion
- **File / Evidence**: `bridge/vision.mjs:83-100`, `src/App.tsx:376-422`
- **Vulnerability**: Once camera permission is granted by the user, the model can invoke `jarvis_eyes:look` at any turn without an interactive confirmation prompt.
- **Realistic Impact**: Potential privacy leak if a compromised or misaligned prompt triggers frame captures without explicit user intent.
- **Remediation**: Enforce an unforgeable, prominent UI indicator whenever the camera is active, and enforce strict turn-based reasoning validations.

### SEC-09 [LOW]: Silent Dropping of Unknown WebSocket Frames
- **File / Evidence**: `src/lib/bridge.ts:21-38`, `bridge/server.mjs:1398-1404`
- **Vulnerability**: JSON parse failures or unrecognized frame types are silently swallowed with `catch { return }`.
- **Realistic Impact**: Complicates debugging and masks protocol desynchronization.
- **Remediation**: Add diagnostic warning logging in development mode.

### SEC-10 [LOW]: Conversation State Ephemerality on Socket Drop
- **File / Evidence**: `bridge/server.mjs:1457-1462`, `src/lib/bridge.ts:107-110`
- **Vulnerability**: Conversation state lives exclusively inside the in-memory SDK query session. A transient WebSocket disconnect wipes JARVIS's context memory while the UI transcript persists.
- **Realistic Impact**: Conversational confusion where JARVIS forgets what was previously said within the same session.
- **Remediation**: Persist recent conversation state and session IDs to disk for automatic recovery across reconnects.

---

## 6. Dependency & Compatibility Assessment

### 6.1 Current Dependencies Review

```json
{
  "dependencies": {
    "@anthropic-ai/claude-agent-sdk": "^0.3.220",
    "@anthropic-ai/sdk": "^0.115.0",
    "@mediapipe/tasks-vision": "^1.0.1",
    "@picovoice/porcupine-web": "^4.0.1",
    "@picovoice/web-voice-processor": "^4.0.10",
    "@react-three/drei": "^10.7.7",
    "@react-three/fiber": "^9.7.0",
    "@react-three/postprocessing": "^3.0.4",
    "dompurify": "^3.4.12",
    "framer-motion": "^12.43.0",
    "kokoro-js": "^1.2.1",
    "react": "^19.2.8",
    "react-dom": "^19.2.8",
    "three": "^0.185.1",
    "ws": "^8.21.1",
    "zod": "^4.4.3",
    "zustand": "^5.0.14"
  }
}
```

### 6.2 Compatibility Analysis for Electron & Windows
1. **React 19 & Three.js (r185)**: Fully compatible with Electron 34+ / 35+ / 36+ (Chromium 134+). WebGL2 and WebGPU hardware acceleration are fully supported on Windows with DirectX/Vulkan backends.
2. **Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`)**: Requires Node.js >= 20. Compatible with Electron's Node.js runtime (`v22`+ in current Electron versions) when executed in the main process or background utility process.
3. **MediaPipe Tasks Vision**: Currently vendored into `public/mediapipe`. WebAssembly execution runs smoothly in Electron renderer with appropriate CSP.
4. **Electron Integration Strategy**:
   - Install `electron` as a devDependency.
   - Introduce an Electron main process (`electron/main.ts`) and preload script (`electron/preload.ts`).
   - Run Vite in dev mode with `vite-plugin-electron` or launch Electron pointing to `http://localhost:5173`.
   - Package with `electron-builder`.

### 6.3 Flexible AI Provider Architecture
To maintain Claude Agent SDK as the default while accommodating other providers (OpenAI, Gemini, Ollama, Anthropic Direct), a unified `AiProvider` interface must be established:

```typescript
export interface AiProvider {
  id: string;
  name: string;
  isAvailable(): Promise<boolean>;
  ask(
    prompt: string,
    history: ConversationTurn[],
    handlers: ProviderStreamHandlers,
    options?: ProviderOptions
  ): Promise<ProviderResponse>;
  interrupt(): Promise<void>;
  listTools(): Promise<ToolDefinition[]>;
}
```
- **ClaudeAgentSdkProvider**: Retains existing bridge implementation, utilizing existing Claude CLI login and local MCP servers.
- **OpenAiCompatibleProvider**: Connects to OpenAI, Ollama (local), or LM Studio via standard streaming completions.
- **AnthropicDirectProvider**: Migrates `src/lib/anthropic.ts` into the provider structure.
- **GeminiProvider**: Supports Google Gemini models via `@google/genai`.

---

## 7. Baseline Verification & Test Results

All checks performed during this phase were strictly non-mutating and read-only.

| Verification Command | Execution Tool | Exit Code | Result / Output Summary | Status |
|:---|:---|:---:|:---|:---:|
| `node -v` | `run_command` | 0 | `v24.18.0` (Node 20+ requirement satisfied) | PASS |
| `npm -v` | `run_command` | 0 | `12.0.2` | PASS |
| `Test-Path node_modules` | `run_command` | 0 | `False` (`node_modules` directory does not exist) | EXPECTED / AUDIT |
| `Test-Path .git` | `run_command` | 0 | `False` (Not a git repository) | NOTED |
| `node --check scripts/start.mjs` | `run_command` | 0 | Syntax valid | PASS |
| `node --check scripts/setup.mjs` | `run_command` | 0 | Syntax valid | PASS |
| `node --check bridge/server.mjs` | `run_command` | 0 | Syntax valid | PASS |
| `node --check bridge/net.mjs` | `run_command` | 0 | Syntax valid | PASS |
| `node --check bridge/chrome.mjs`| `run_command` | 0 | Syntax valid | PASS |
| `node --check bridge/page.mjs` | `run_command` | 0 | Syntax valid | PASS |
| `node --check bridge/panels.mjs`| `run_command` | 0 | Syntax valid | PASS |
| `node --check bridge/ui.mjs` | `run_command` | 0 | Syntax valid | PASS |
| `node --check bridge/vision.mjs`| `run_command` | 0 | Syntax valid | PASS |
| `npm run lint` | `run_command` | 1 | `'oxlint' is not recognized` (needs `npm install`) | RECORDED BASELINE |
| `npm run build` | `run_command` | 1 | `'tsc' is not recognized` (needs `npm install`) | RECORDED BASELINE |

*Summary*: All 9 JavaScript/MJS scripts are syntactically valid under Node 24. Build and lint commands cannot run until dependencies are installed in Phase 2.

---

## 8. Prioritized Remediation List

1. **[Immediate / Security]**: Restrict `server.listen(PORT)` in `bridge/server.mjs` to `127.0.0.1`. Add an ephemeral session handshake token for WebSocket clients.
2. **[Immediate / Compatibility]**: Update `DISK_PATH` regex in `src/ui/sanitise.ts` to recognize Windows drive paths (`C:\...`).
3. **[Immediate / Environment]**: Initialize `git` repository and run `npm install` to establish reproducible version control and build capability.
4. **[High / Desktop]**: Scaffold the Electron main process with transparent window configuration, always-on-top mode, and click-through handling.
5. **[High / Audio]**: Implement persistent background audio capture and complete the Picovoice Porcupine wake-word integration in `src/lib/voice.ts`.
6. **[High / Automation]**: Replace Unix-only Chrome socket path with OS-aware named pipe resolution and create safe Win32 application launcher tools.
7. **[Medium / Architecture]**: Abstract AI providers into a modular interface so Claude Agent SDK remains default while supporting fallbacks.
8. **[Medium / Packaging]**: Configure `electron-builder` with Windows icon, NSIS installer, and portable targets.

---

## 9. Eight-Phase Implementation Roadmap (REVISED)

```
  Phase 1: Audit & Baseline [COMPLETED]
     │
     ▼
  Phase 2: Baseline Bootstrap, P0 Security/Path Fixes & Windows Electron Desktop Shell [CURRENT]
     │
     ▼
  Phase 3: Native Windows PC Control (bridge/windows.mjs + Confirmation UI)
     │
     ▼
  Phase 4: Background Voice Activation (Porcupine, unthrottled VAD, mic recovery, mute toggle)
     │
     ▼
  Phase 5: Flexible AI Providers (Claude Agent SDK default + OpenAI/Gemini/Ollama adapters)
     │
     ▼
  Phase 6: Deep Security Hardening (Token auth, safeStorage secrets, strict FILE_ROOTS)
     │
     ▼
  Phase 7: Integration & Automated Testing
     │
     ▼
  Phase 8: Windows Packaging & NSIS/Portable Installer (electron-builder)
```

### Phase 1 — Codebase Audit & Architectural Baseline [COMPLETE]
- **Deliverables**: Comprehensive audit report (`PHASE-1-AUDIT.md`), skill discovery, baseline test records, approval items list.
- **Acceptance Criteria**: All files inspected; data flows traced; vulnerabilities categorized; zero source files modified.

### Phase 2 — Baseline Bootstrap, P0 Security/Path Fixes & Windows Electron Desktop Shell [CURRENT]
- **Scope**:
  - Initialize local git tracking for atomic rollbacks.
  - Run `npm install` to establish `node_modules` and lockfile consistency.
  - Patch network listener to bind strictly to `127.0.0.1` with configurable `JARVIS_BRIDGE_HOST`.
  - Fix Windows path regex across all three files (`sanitise.ts`, `Blades.tsx`, `Orbits.tsx`) via shared `src/lib/paths.ts`.
  - Filter `FILE_ROOTS` for Windows compatibility.
  - Scaffold complete Electron shell: `electron/main.mjs` and `electron/preload.cjs`.
  - Implement frameless transparent always-on-top window with dynamic click-through.
  - Build System Tray with context menu and `Ctrl+Shift+Space` global shortcut.
  - Preserve holographic visuals with transparent desktop styling.
  - Add desktop window controls to HUD.
- **Acceptance Criteria**: `npm run lint` and `npm run build` pass cleanly; Electron launches as transparent overlay; click-through works; tray icon and global shortcut functional; bridge binds to `127.0.0.1:8787`.

### Phase 3 — Native Windows PC Control
- **Scope**: Build `bridge/windows.mjs` MCP server for app launching, window focus, volume/media keys, system diagnostics. Create Secure Action Gate modal in HUD for destructive actions.
- **Acceptance Criteria**: "Open Spotify" / "Turn down the volume" work natively; dangerous actions prompt confirmation.

### Phase 4 — Background Voice Activation
- **Scope**: Integrate Picovoice Porcupine, migrate VAD/clap off `requestAnimationFrame` to unthrottled timer, implement mic recovery, mute toggle. Handle Electron's lack of `webkitSpeechRecognition`.
- **Acceptance Criteria**: "Hey JARVIS" wakes from hidden/minimized state; barge-in still instant.

### Phase 5 — Flexible AI Providers
- **Scope**: `AiProvider` interface, Claude Agent SDK as default, OpenAI/Gemini/Ollama adapters.
- **Acceptance Criteria**: Default runs on Claude Agent SDK; alternate providers switchable without crashing HUD.

### Phase 6 — Deep Security Hardening
- **Scope**: Token auth across all HTTP/WS routes, `safeStorage` for secrets, strict `FILE_ROOTS`, CSP hardening.
- **Acceptance Criteria**: No unauthenticated route accessible; secrets encrypted at rest.

### Phase 7 — Integration & Automated Testing
- **Scope**: End-to-end test suite, CI pipeline, regression tests for voice/VAD/UI.
- **Acceptance Criteria**: Automated test suite passes; all phases verified.

### Phase 8 — Windows Packaging & NSIS/Portable Installer
- **Scope**: `electron-builder` config, NSIS installer, portable executable, Windows startup toggle, code signing.
- **Acceptance Criteria**: Installer installs cleanly on Windows 11; auto-start works; uninstaller cleans up.

---

## 10. Architectural Decisions (APPROVED)

1. **Git Initialization**: ✅ APPROVED. Initialize `.git` and commit the untouched baseline before modifying any source files.
2. **Package Installation**: ✅ APPROVED. Run `npm install` and run baseline `npm run lint` and `npm run build`.
3. **Window Interaction Style**: ✅ APPROVED — **Full-Desktop Transparent Click-Through Overlay (Primary) + Compact Floating Mode (Toggleable).**
   - The HUD (`src/index.css`), `SYSTEMS` rail (`left: 92px`), `SIGNAL` rail (`right: 92px`), `Blades` stack (up to `1080px` wide), and 21-joint hand tracking (`Pointer.tsx`) require full-viewport coordinates.
   - Default: frameless, transparent, always-on-top fullscreen overlay with click-through on transparent pixels and mouse capture on interactive elements.
   - Also supports Compact Mode (via Tray or hotkey): draggable `420x420` floating arc-reactor widget.
4. **Wake-Word Strategy**: ✅ APPROVED — **Dual Tier (Picovoice Porcupine + Local VAD `/stt` Bridge)** (wired in Phase 4).
5. **PC Action Security Model**: ✅ APPROVED — **Tiered Permission Model + Interactive HUD Confirmation Card** (wired in Phases 3 & 6).
6. **Phase Order**: ✅ APPROVED — Follow the revised 8-Phase sequence with Desktop Shell completed in Phase 2 before Native Windows Control (Phase 3).

---

## 11. Skill & Tool Mapping Matrix

| Implementation Phase | Assigned Primary Skills | Supporting Tools & Workflow |
|:---|:---|:---|
| **Phase 1: Codebase Audit & Baseline** | `codebase-memory`, `caveman-explore`, `investigate-first` | MCP Knowledge Graph, Ripgrep, Read, Safe baseline run |
| **Phase 2: Security Hardening & Init** | `surgical-patch`, `safe-refactor`, `gsd-code-review` | Replace tool, Git CLI, npm install, Oxlint |
| **Phase 3: Electron Desktop Foundation**| `ui-styling`, `ui-ux-pro-max`, `safe-refactor` | Electron API, Vite-Electron integration, Win32 Windowing |
| **Phase 4: Flexible AI Providers** | `codebase-memory`, `surgical-patch`, `safe-refactor` | Claude Agent SDK, Provider Interface, TypeScript |
| **Phase 5: Voice & Background Engine** | `investigate-first`, `surgical-patch` | Web Audio, Porcupine, VAD, Background Audio Worker |
| **Phase 6: Windows PC Control** | `gsd-add-tests`, `surgical-patch` | Win32 Shell API, PowerShell Sandbox, Safeguard Gate |
| **Phase 7: UI/UX & Holographic Polish**| `ui-styling`, `ui-ux-pro-max` | Three.js, GLSL, Framer Motion, MediaPipe WASM |
| **Phase 8: Packaging & Verification** | `gsd-validate-phase`, `verify-and-stop`, `gsd-code-review` | electron-builder, NSIS, Final Acceptance Suite |

---
*End of Phase 1 Audit Report. Awaiting user approval to commence Phase 2.*
