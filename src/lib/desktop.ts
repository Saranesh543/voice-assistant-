/**
 * Desktop integration & dynamic click-through hit-testing.
 *
 * In fullscreen overlay mode on Windows, transparent background pixels must
 * pass mouse clicks through to underlying applications, while hovering over
 * interactive HUD elements (blades, buttons, reactor controls) must dynamically
 * capture pointer events.
 */

let isIgnoring = true
let currentMode: 'overlay' | 'compact' = 'overlay'

export function isDesktop(): boolean {
  return typeof window !== 'undefined' && Boolean(window.jarvisDesktop?.isDesktop)
}

export function initDesktopIntegration(): () => void {
  if (typeof window === 'undefined' || !window.jarvisDesktop?.isDesktop) {
    return () => {}
  }

  const desktop = window.jarvisDesktop
  document.documentElement.classList.add('is-desktop', 'mode-overlay')

  const unMode = desktop.onWindowModeChanged((mode) => {
    currentMode = mode
    document.documentElement.classList.toggle('mode-overlay', mode === 'overlay')
    document.documentElement.classList.toggle('mode-compact', mode === 'compact')
    if (mode === 'compact') {
      desktop.setIgnoreMouseEvents(false)
      isIgnoring = false
    } else {
      isIgnoring = true
      desktop.setIgnoreMouseEvents(true, { forward: true })
    }
  })

  let lastCheck = 0
  const onMouseMove = (e: MouseEvent) => {
    if (currentMode !== 'overlay') return
    const now = performance.now()
    if (now - lastCheck < 32) return // ~30fps throttle
    lastCheck = now

    const el = document.elementFromPoint(e.clientX, e.clientY)
    const isInteractive = Boolean(
      el?.closest(
        '.bl, .panel, .ignition, .diag, .hud-controls, .desktop-ctrls, .confirm-modal, .confirm-card, button, a, input, video, iframe, [role="button"], kbd',
      ),
    )

    if (isInteractive && isIgnoring) {
      isIgnoring = false
      desktop.setIgnoreMouseEvents(false)
    } else if (!isInteractive && !isIgnoring) {
      isIgnoring = true
      desktop.setIgnoreMouseEvents(true, { forward: true })
    }
  }

  window.addEventListener('mousemove', onMouseMove, { passive: true })

  return () => {
    unMode()
    window.removeEventListener('mousemove', onMouseMove)
  }
}

export async function emergencyStopDesktop(): Promise<void> {
  if (typeof window !== 'undefined' && window.jarvisDesktop?.emergencyStop) {
    try {
      await window.jarvisDesktop.emergencyStop()
    } catch (err) {
      console.error('[desktop] emergencyStopDesktop error:', err)
    }
  }
}

export async function summonDesktopWindow(): Promise<void> {
  if (typeof window !== 'undefined' && window.jarvisDesktop?.summonWindow) {
    try {
      await window.jarvisDesktop.summonWindow()
    } catch (err) {
      console.error('[desktop] summonDesktopWindow error:', err)
    }
  }
}

export async function getDesktopMicMuted(): Promise<boolean> {
  if (typeof window !== 'undefined' && window.jarvisDesktop?.getMicMuted) {
    try {
      return await window.jarvisDesktop.getMicMuted()
    } catch (err) {
      console.error('[desktop] getDesktopMicMuted error:', err)
    }
  }
  return false
}

export async function setDesktopMicMuted(muted: boolean): Promise<boolean> {
  if (typeof window !== 'undefined' && window.jarvisDesktop?.setMicMuted) {
    try {
      return await window.jarvisDesktop.setMicMuted(muted)
    } catch (err) {
      console.error('[desktop] setDesktopMicMuted error:', err)
    }
  }
  return false
}

export async function toggleDesktopMicMute(): Promise<boolean> {
  if (typeof window !== 'undefined' && window.jarvisDesktop?.toggleMicMute) {
    try {
      return await window.jarvisDesktop.toggleMicMute()
    } catch (err) {
      console.error('[desktop] toggleDesktopMicMute error:', err)
    }
  }
  return false
}

