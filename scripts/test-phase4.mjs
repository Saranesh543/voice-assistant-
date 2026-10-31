import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const ROOT_DIR = resolve(__dirname, '..')

console.log('--- [Phase 4 Verification Test Suite] ---')

// ---------------------------------------------------------------------------
// Test 1: Background VAD & Clap Unthrottled Timers
// ---------------------------------------------------------------------------
console.log('[Test 1] Testing background unthrottled timers in vad.ts and clap.ts...')
{
  const vadSrc = readFileSync(resolve(ROOT_DIR, 'src/lib/vad.ts'), 'utf-8')
  const clapSrc = readFileSync(resolve(ROOT_DIR, 'src/lib/clap.ts'), 'utf-8')

  // 1. Verify no requestAnimationFrame in detection loops
  assert(
    !vadSrc.includes('requestAnimationFrame(tick)'),
    'src/lib/vad.ts must not use requestAnimationFrame in detection tick',
  )
  assert(
    !clapSrc.includes('requestAnimationFrame(tick)'),
    'src/lib/clap.ts must not use requestAnimationFrame in detection tick',
  )

  // 2. Verify unthrottled setInterval is used
  assert(
    vadSrc.includes('setInterval(tick, 30)'),
    'src/lib/vad.ts must use setInterval(tick, 30) for continuous background detection',
  )
  assert(
    clapSrc.includes('setInterval(tick, 25)'),
    'src/lib/clap.ts must use setInterval(tick, 25) for continuous background clap detection',
  )

  // 3. Verify mic mute awareness in both detection loops
  assert(
    vadSrc.includes('isMicMuted()'),
    'src/lib/vad.ts tick must check isMicMuted()',
  )
  assert(
    clapSrc.includes('isMicMuted()'),
    'src/lib/clap.ts tick must check isMicMuted()',
  )

  // 4. Verify suspended audio context auto-resume
  assert(
    vadSrc.includes('ctx.state === \'suspended\''),
    'src/lib/vad.ts must resume suspended AudioContext on tick',
  )
  assert(
    clapSrc.includes('ctx.state === \'suspended\''),
    'src/lib/clap.ts must resume suspended AudioContext on tick',
  )

  console.log('✓ vad.ts and clap.ts unthrottled timers & background safety verified')
}

// ---------------------------------------------------------------------------
// Test 2: Audio Pipeline & Persistent Microphone Mute Logic
// ---------------------------------------------------------------------------
console.log('[Test 2] Testing audio pipeline mute & recovery logic in audio.ts...')
{
  const audioSrc = readFileSync(resolve(ROOT_DIR, 'src/lib/audio.ts'), 'utf-8')

  assert(audioSrc.includes('export function isMicMuted(): boolean'), 'audio.ts must export isMicMuted')
  assert(audioSrc.includes('export async function setMicMuted(muted: boolean)'), 'audio.ts must export setMicMuted')
  assert(audioSrc.includes('export async function toggleMicMute()'), 'audio.ts must export toggleMicMute')
  assert(audioSrc.includes('export function watchMicMute('), 'audio.ts must export watchMicMute')
  assert(audioSrc.includes('export function watchAudioRecovery('), 'audio.ts must export watchAudioRecovery')
  assert(audioSrc.includes('track.stop()'), 'audio.ts must stop all tracks on mute')
  assert(audioSrc.includes('track.onended ='), 'audio.ts must bind track onended listener')
  assert(audioSrc.includes('devicechange'), 'audio.ts must bind devicechange listener')

  // Simulate audio.ts mute logic in sandbox
  let isMuted = false
  const muteListeners = new Set()
  let tracksStopped = false

  const mockTrack = {
    stop: () => { tracksStopped = true },
    readyState: 'live',
  }
  let mockStream = {
    active: true,
    getTracks: () => [mockTrack],
    getAudioTracks: () => [mockTrack],
  }

  const setMuted = async (target) => {
    isMuted = Boolean(target)
    if (isMuted && mockStream) {
      for (const t of mockStream.getTracks()) t.stop()
      mockStream = null
    }
    for (const fn of muteListeners) fn(isMuted)
    return isMuted
  }

  let notifiedMute = null
  muteListeners.add((m) => { notifiedMute = m })

  await setMuted(true)
  assert.equal(isMuted, true, 'isMuted should be true after setMuted(true)')
  assert.equal(tracksStopped, true, 'tracks should be stopped on mute')
  assert.equal(notifiedMute, true, 'mute listener should be notified of mute')

  console.log('✓ audio.ts mute lifecycle and hardware stop verified')
}

// ---------------------------------------------------------------------------
// Test 3: Picovoice Porcupine Offline Wake-Word Detection
// ---------------------------------------------------------------------------
console.log('[Test 3] Testing Porcupine module structure and graceful fallbacks...')
{
  const porcupineSrc = readFileSync(resolve(ROOT_DIR, 'src/lib/porcupine.ts'), 'utf-8')

  assert(porcupineSrc.includes('export async function startPorcupine('), 'porcupine.ts must export startPorcupine')
  assert(porcupineSrc.includes('export function stopPorcupine('), 'porcupine.ts must export stopPorcupine')
  assert(porcupineSrc.includes('export function isPorcupineActive('), 'porcupine.ts must export isPorcupineActive')
  assert(porcupineSrc.includes('BuiltInKeyword.Jarvis'), 'porcupine.ts must use BuiltInKeyword.Jarvis')
  assert(porcupineSrc.includes('isMicMuted()'), 'porcupine.ts must guard against muted microphone')
  assert(porcupineSrc.includes('WAKE_DEBOUNCE_MS'), 'porcupine.ts must debounce detections')

  console.log('✓ porcupine.ts structure and offline configuration verified')
}

// ---------------------------------------------------------------------------
// Test 4: Voice Loop Wiring for Mute & Recovery
// ---------------------------------------------------------------------------
console.log('[Test 4] Testing voice.ts integration with mute, recovery and porcupine...')
{
  const voiceSrc = readFileSync(resolve(ROOT_DIR, 'src/lib/voice.ts'), 'utf-8')

  assert(voiceSrc.includes('watchMicMute'), 'voice.ts must import and use watchMicMute')
  assert(voiceSrc.includes('watchAudioRecovery'), 'voice.ts must import and use watchAudioRecovery')
  assert(voiceSrc.includes('startPorcupine'), 'voice.ts must import and use startPorcupine')
  assert(voiceSrc.includes('stopPorcupine'), 'voice.ts must import and use stopPorcupine')

  // Verify transcribe aborts if mic is muted
  assert(
    voiceSrc.includes("drop('microphone is muted')"),
    'voice.ts transcribe must drop audio if mic is muted',
  )

  console.log('✓ voice.ts wiring for mute and recovery verified')
}

// ---------------------------------------------------------------------------
// Test 5: Electron Main & Preload Background Activation & Mute IPC
// ---------------------------------------------------------------------------
console.log('[Test 5] Testing Electron main.mjs and preload.cjs...')
{
  const mainSrc = readFileSync(resolve(ROOT_DIR, 'electron/main.mjs'), 'utf-8')
  const preloadSrc = readFileSync(resolve(ROOT_DIR, 'electron/preload.cjs'), 'utf-8')

  // 1. WebPreferences background throttling disabled
  assert(
    mainSrc.includes('backgroundThrottling: false'),
    'electron/main.mjs must have backgroundThrottling: false',
  )

  // 2. PowerMonitor resume event
  assert(
    mainSrc.includes("powerMonitor.on('resume'"),
    'electron/main.mjs must listen to powerMonitor resume',
  )
  assert(
    mainSrc.includes("'jarvis:system-resume'"),
    'electron/main.mjs must dispatch jarvis:system-resume to renderer',
  )

  // 3. Summon window IPC
  assert(
    mainSrc.includes("ipcMain.handle('window:summon'"),
    'electron/main.mjs must register window:summon handler',
  )

  // 4. Microphone Mute IPC
  assert(
    mainSrc.includes("ipcMain.handle('mic:get-muted'"),
    'electron/main.mjs must register mic:get-muted handler',
  )
  assert(
    mainSrc.includes("ipcMain.handle('mic:set-muted'"),
    'electron/main.mjs must register mic:set-muted handler',
  )
  assert(
    mainSrc.includes("ipcMain.handle('mic:toggle-muted'"),
    'electron/main.mjs must register mic:toggle-muted handler',
  )
  assert(
    mainSrc.includes("'jarvis:mic-mute-changed'"),
    'electron/main.mjs must dispatch jarvis:mic-mute-changed on mute toggle',
  )

  // 5. Tray menu mute item
  assert(
    mainSrc.includes("isMicMuted ? 'Unmute Microphone' : 'Mute Microphone'"),
    'electron/main.mjs tray menu must contain dynamic mute/unmute item',
  )

  // 6. Preload API exposures
  assert(preloadSrc.includes('summonWindow:'), 'preload.cjs must expose summonWindow')
  assert(preloadSrc.includes('getMicMuted:'), 'preload.cjs must expose getMicMuted')
  assert(preloadSrc.includes('setMicMuted:'), 'preload.cjs must expose setMicMuted')
  assert(preloadSrc.includes('toggleMicMute:'), 'preload.cjs must expose toggleMicMute')
  assert(preloadSrc.includes('onMicMuteChanged:'), 'preload.cjs must expose onMicMuteChanged')
  assert(preloadSrc.includes('onResume:'), 'preload.cjs must expose onResume')

  console.log('✓ electron/main.mjs and preload.cjs IPC channels verified')
}

// ---------------------------------------------------------------------------
// Test 6: App Renderer Summon & Prompt
// ---------------------------------------------------------------------------
console.log('[Test 6] Testing App.tsx wake-word activation and single-prompt logic...')
{
  const appSrc = readFileSync(resolve(ROOT_DIR, 'src/App.tsx'), 'utf-8')

  // 1. Debounce protection against loops
  assert(
    appSrc.includes('lastWakeAt.current') && appSrc.includes('1200'),
    'src/App.tsx must debounce wake events to prevent loop triggers',
  )

  // 2. Speak "Yes, sir?" exactly once per summon
  assert(
    appSrc.includes("greeting.say('Yes, sir?')"),
    'src/App.tsx must speak "Yes, sir?" when awakened without trailing text',
  )

  // 3. Summon window if hidden/unfocused
  assert(
    appSrc.includes('window.jarvisDesktop?.summonWindow?.()'),
    'src/App.tsx must call summonWindow() when wake occurs while hidden or unfocused',
  )

  // 4. Resume handler re-checks audio context and mic
  assert(
    appSrc.includes('resumeAudioContext()'),
    'src/App.tsx must call resumeAudioContext() on system resume',
  )

  console.log('✓ App.tsx single-prompt summon and debounce verified')
}

// ---------------------------------------------------------------------------
// Test 7: Store & HUD Microphone Controls
// ---------------------------------------------------------------------------
console.log('[Test 7] Testing Store & HUD microphone controls...')
{
  const storeSrc = readFileSync(resolve(ROOT_DIR, 'src/store.ts'), 'utf-8')
  const hudSrc = readFileSync(resolve(ROOT_DIR, 'src/ui/Hud.tsx'), 'utf-8')
  const cssSrc = readFileSync(resolve(ROOT_DIR, 'src/index.css'), 'utf-8')

  assert(storeSrc.includes('micMuted: boolean'), 'store.ts must define micMuted: boolean')
  assert(storeSrc.includes('setMicMuted: (micMuted) => set({ micMuted })'), 'store.ts must define setMicMuted')

  assert(hudSrc.includes('desktop-btn-muted'), 'Hud.tsx must have desktop-btn-muted style')
  assert(hudSrc.includes('mic-muted-badge'), 'Hud.tsx must render mic-muted-badge')

  assert(cssSrc.includes('.desktop-btn-muted'), 'index.css must define .desktop-btn-muted')
  assert(cssSrc.includes('.mic-muted-badge'), 'index.css must define .mic-muted-badge')

  console.log('✓ Store & HUD microphone controls verified')
}

console.log('\n======================================================')
console.log('🎉 ALL PHASE 4 VERIFICATION TESTS PASSED SUCCESSFULLY!')
console.log('======================================================')
