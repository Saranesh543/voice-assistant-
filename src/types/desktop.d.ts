export interface JarvisDesktopApi {
  isDesktop: boolean
  platform: string
  setIgnoreMouseEvents: (ignore: boolean, options?: { forward?: boolean }) => void
  showWindow: () => Promise<void>
  hideWindow: () => Promise<void>
  minimizeWindow: () => Promise<void>
  summonWindow: () => Promise<void>
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
  emergencyStop: () => Promise<void>
  getMicMuted: () => Promise<boolean>
  setMicMuted: (muted: boolean) => Promise<boolean>
  toggleMicMute: () => Promise<boolean>
  onSummon: (callback: () => void) => () => void
  onEmergencyStop: (callback: () => void) => () => void
  onWindowModeChanged: (callback: (mode: 'overlay' | 'compact') => void) => () => void
  onMicMuteChanged: (callback: (muted: boolean) => void) => () => void
  onResume: (callback: () => void) => () => void
}

declare global {
  interface Window {
    jarvisDesktop?: JarvisDesktopApi
  }
}

