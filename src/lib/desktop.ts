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
        '.bl, .panel, .ignition, .diag, .hud-controls, .desktop-ctrls, button, a, input, video, iframe, [role="button"], kbd',
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
