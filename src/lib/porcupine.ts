/**
 * Picovoice Porcupine Offline Wake-Word Detection
 *
 * Runs offline in WebAssembly when `VITE_PICOVOICE_ACCESS_KEY` is provided.
 * Uses built-in keyword `BuiltInKeyword.Jarvis`.
 * Automatically unsubscribes and cleans up workers when stopped or muted.
 */

import { PorcupineWorker, BuiltInKeyword, type PorcupineModel } from '@picovoice/porcupine-web'
import { WebVoiceProcessor } from '@picovoice/web-voice-processor'
import { env, WAKE_ENGINE } from '../config'
import { isMicMuted } from './audio'

let worker: PorcupineWorker | null = null
let active = false
let lastWakeTime = 0
const WAKE_DEBOUNCE_MS = 1500

const defaultModel: PorcupineModel = {
  publicPath: 'porcupine_params.pv',
}

export async function startPorcupine(onWake: () => void): Promise<boolean> {
  if (WAKE_ENGINE !== 'porcupine' || !env.porcupineKey) {
    return false
  }

  if (active && worker) {
    return true
  }

  if (isMicMuted()) {
    console.log('[porcupine] microphone is muted — skipping Porcupine initialization')
    return false
  }

  try {
    worker = await PorcupineWorker.create(
      env.porcupineKey,
      BuiltInKeyword.Jarvis,
      (detection) => {
        if (isMicMuted()) return
        const now = Date.now()
        if (now - lastWakeTime < WAKE_DEBOUNCE_MS) return
        lastWakeTime = now

        console.log(`[porcupine] wake word detected: ${detection.label}`)
        onWake()
      },
      defaultModel,
    )

    await WebVoiceProcessor.subscribe(worker)
    active = true
    console.log('[porcupine] Porcupine wake-word engine active for "Jarvis"')
    return true
  } catch (err) {
    console.warn('[porcupine] failed to initialize Porcupine wake-word engine, falling back to VAD+STT:', err)
    stopPorcupine()
    return false
  }
}

export function stopPorcupine(): void {
  active = false
  if (worker) {
    try {
      void WebVoiceProcessor.unsubscribe(worker)
      worker.terminate()
    } catch {}
    worker = null
  }
}

export function isPorcupineActive(): boolean {
  return active
}
