export interface JarvisDesktopApi {
  isDesktop: boolean
  platform: string
  setIgnoreMouseEvents: (ignore: boolean, options?: { forward?: boolean }) => void
  showWindow: () => Promise<void>
  hideWindow: () => Promise<void>
  minimizeWindow: () => Promise<void>
  toggleCompactMode: () => Promise<'overlay' | 'compact'>
  setAlwaysOnTop: (flag: boolean) => Promise<boolean>
  getSettings: () => Promise<{
    windowMode: 'overlay' | 'compact'
    alwaysOnTop: boolean
    clickThrough: boolean
    autoStart: boolean
  }>
  setAutoStart: (enabled: boolean) => Promise<boolean>
  quitApp: () => Promise<void>
  onSummon: (callback: () => void) => () => void
  onWindowModeChanged: (callback: (mode: 'overlay' | 'compact') => void) => () => void
}

declare global {
  interface Window {
    jarvisDesktop?: JarvisDesktopApi
  }
}
