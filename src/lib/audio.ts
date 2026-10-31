/**
 * A single shared microphone stream plus an analyser, so the reactor can pulse
 * with the user's voice. Opening the mic more than once causes Chrome to drop
 * the earlier stream, so everything that needs audio goes through here.
 *
 * Implements persistent microphone mute, hardware device-change recovery,
 * track-ended detection, and unthrottled audio context management.
 */

let stream: MediaStream | null = null
let ctx: AudioContext | null = null
let analyser: AnalyserNode | null = null
let buf: Uint8Array | null = null

let isMuted = false
const muteListeners = new Set<(muted: boolean) => void>()
const recoveryListeners = new Set<() => void>()

let deviceChangeListening = false

function bindTrackListeners(s: MediaStream) {
  for (const track of s.getAudioTracks()) {
    track.onended = () => {
      console.warn('[audio] microphone track ended')
      if (!isMuted) {
        stream = null
        triggerAudioRecovery()
      }
    }
  }
}

function setupDeviceChangeListener() {
  if (deviceChangeListening || typeof navigator === 'undefined' || !navigator.mediaDevices?.addEventListener) {
    return
  }
  deviceChangeListening = true
  navigator.mediaDevices.addEventListener('devicechange', async () => {
    console.log('[audio] media devices changed')
    if (isMuted) return

    // If stream exists, verify whether its tracks are still live
    if (stream) {
      const active = stream.active && stream.getAudioTracks().some((t) => t.readyState === 'live')
      if (!active) {
        stream = null
        triggerAudioRecovery()
      }
    }
  })
}

function triggerAudioRecovery() {
  if (isMuted) return
  console.log('[audio] triggering audio pipeline recovery...')
  for (const fn of recoveryListeners) {
    try {
      fn()
    } catch (err) {
      console.error('[audio] recovery listener error:', err)
    }
  }
}

export function isMicMuted(): boolean {
  return isMuted
}

export function isMicActive(): boolean {
  if (isMuted || !stream) return false
  return stream.active && stream.getAudioTracks().some((t) => t.readyState === 'live')
}

export async function setMicMuted(muted: boolean): Promise<boolean> {
  const target = Boolean(muted)
  if (isMuted === target) return isMuted

  isMuted = target
  console.log(`[audio] microphone mute set to: ${isMuted}`)

  if (isMuted) {
    // Stop all active microphone tracks immediately
    if (stream) {
      for (const track of stream.getTracks()) {
        try {
          track.stop()
        } catch {}
      }
      stream = null
    }

    if (ctx) {
      try {
        void ctx.close()
      } catch {}
      ctx = null
      analyser = null
      buf = null
    }
  }

  // Notify listeners
  for (const fn of muteListeners) {
    try {
      fn(isMuted)
    } catch (err) {
      console.error('[audio] mute listener error:', err)
    }
  }

  // If unmuting, attempt to reacquire the stream so voice loop / analyser can resume
  if (!isMuted) {
    try {
      await getMic()
      triggerAudioRecovery()
    } catch (err) {
      console.error('[audio] failed to reacquire microphone on unmute:', err)
      return false
    }
  }

  return isMuted
}

export async function toggleMicMute(): Promise<boolean> {
  return await setMicMuted(!isMuted)
}

export function watchMicMute(callback: (muted: boolean) => void): () => void {
  muteListeners.add(callback)
  return () => {
    muteListeners.delete(callback)
  }
}

export function watchAudioRecovery(callback: () => void): () => void {
  recoveryListeners.add(callback)
  return () => {
    recoveryListeners.delete(callback)
  }
}

export async function getMic(): Promise<MediaStream> {
  if (isMuted) {
    throw new Error('Microphone is muted.')
  }

  if (stream && stream.active && stream.getAudioTracks().some((t) => t.readyState === 'live')) {
    return stream
  }

  setupDeviceChangeListener()

  stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  })

  bindTrackListeners(stream)
  return stream
}

export async function startAnalyser(): Promise<void> {
  if (isMuted) return
  if (analyser && ctx && ctx.state !== 'closed') {
    if (ctx.state === 'suspended') void ctx.resume()
    return
  }

  const s = await getMic()
  ctx = new AudioContext()
  void ctx.resume()

  const src = ctx.createMediaStreamSource(s)
  analyser = ctx.createAnalyser()
  analyser.fftSize = 512
  analyser.smoothingTimeConstant = 0.75
  src.connect(analyser)
  buf = new Uint8Array(analyser.frequencyBinCount)
}

export function resumeAudioContext(): void {
  if (ctx && ctx.state === 'suspended') {
    void ctx.resume()
  }
}

/** 0..1 loudness. Returns 0 before the analyser is up or when muted. */
export function micLevel(): number {
  if (isMuted || !analyser || !buf) return 0
  analyser.getByteFrequencyData(buf as Uint8Array<ArrayBuffer>)
  let sum = 0
  // Skip the lowest bins — they're mostly rumble and mains hum.
  for (let i = 4; i < buf.length; i++) sum += buf[i]
  const avg = sum / (buf.length - 4) / 255
  // Voice sits low in this range; stretch it so the visuals actually move.
  return Math.min(1, avg * 3.2)
}

/** Analyser fed from an <audio> element, so the orb reacts while JARVIS talks. */
export function attachOutputAnalyser(el: HTMLAudioElement): () => number {
  const c = new AudioContext()
  const src = c.createMediaElementSource(el)
  const a = c.createAnalyser()
  a.fftSize = 512
  a.smoothingTimeConstant = 0.7
  src.connect(a)
  a.connect(c.destination)
  const b = new Uint8Array(a.frequencyBinCount)
  return () => {
    a.getByteFrequencyData(b as Uint8Array<ArrayBuffer>)
    let sum = 0
    for (let i = 2; i < b.length; i++) sum += b[i]
    return Math.min(1, (sum / (b.length - 2) / 255) * 3)
  }
}
