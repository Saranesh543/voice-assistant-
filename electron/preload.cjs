// @ts-check
const { contextBridge, ipcRenderer } = require('electron')

/**
 * Preload script exposing a strictly isolated desktop API to the renderer.
 * Keeps contextIsolation: true and nodeIntegration: false.
 */
contextBridge.exposeInMainWorld('jarvisDesktop', {
  isDesktop: true,
  platform: process.platform,

  /**
   * Toggle mouse passthrough. In overlay mode, transparent pixels ignore
   * mouse events (passing clicks to underlying Windows apps), while interactive
   * HUD elements capture events.
   * @param {boolean} ignore
   * @param {{ forward?: boolean }} [options]
   */
  setIgnoreMouseEvents: (ignore, options) => {
    ipcRenderer.send(
      'window:set-ignore-mouse-events',
      Boolean(ignore),
      Boolean(options?.forward),
    )
  },

  showWindow: () => ipcRenderer.invoke('window:show'),
  hideWindow: () => ipcRenderer.invoke('window:hide'),
  minimizeWindow: () => ipcRenderer.invoke('window:minimize'),
  summonWindow: () => ipcRenderer.invoke('window:summon'),
  toggleCompactMode: () => ipcRenderer.invoke('window:toggle-compact'),
  setAlwaysOnTop: (flag) => ipcRenderer.invoke('window:set-always-on-top', Boolean(flag)),

  getSettings: () => ipcRenderer.invoke('settings:get'),
  setAutoStart: (enabled) => ipcRenderer.invoke('settings:set-autostart', Boolean(enabled)),
  quitApp: () => ipcRenderer.invoke('app:quit'),
  emergencyStop: () => ipcRenderer.invoke('app:emergency-stop'),

  getMicMuted: () => ipcRenderer.invoke('mic:get-muted'),
  setMicMuted: (muted) => ipcRenderer.invoke('mic:set-muted', Boolean(muted)),
  toggleMicMute: () => ipcRenderer.invoke('mic:toggle-muted'),

  /**
   * Subscribe to microphone mute state changes from tray or desktop.
   * @param {(muted: boolean) => void} callback
   * @returns {() => void} Unsubscribe function
   */
  onMicMuteChanged: (callback) => {
    /** @type {(_: unknown, muted: boolean) => void} */
    const handler = (_, muted) => {
      try {
        callback(Boolean(muted))
      } catch (err) {
        console.error('[jarvisDesktop] onMicMuteChanged error:', err)
      }
    }
    ipcRenderer.on('jarvis:mic-mute-changed', handler)
    return () => {
      ipcRenderer.removeListener('jarvis:mic-mute-changed', handler)
    }
  },

  /**
   * Subscribe to system resume from sleep.
   * @param {() => void} callback
   * @returns {() => void} Unsubscribe function
   */
  onResume: (callback) => {
    const handler = () => {
      try {
        callback()
      } catch (err) {
        console.error('[jarvisDesktop] onResume error:', err)
      }
    }
    ipcRenderer.on('jarvis:system-resume', handler)
    return () => {
      ipcRenderer.removeListener('jarvis:system-resume', handler)
    }
  },

  /**
   * Subscribe to global summon events (Ctrl+Shift+Space or Tray "Wake JARVIS").
   * @param {() => void} callback
   * @returns {() => void} Unsubscribe function
   */
  onSummon: (callback) => {
    const handler = () => {
      try {
        callback()
      } catch (err) {
        console.error('[jarvisDesktop] onSummon error:', err)
      }
    }
    ipcRenderer.on('jarvis:summon', handler)
    return () => {
      ipcRenderer.removeListener('jarvis:summon', handler)
    }
  },

  /**
   * Subscribe to global emergency stop events (Ctrl+Shift+Esc or Tray).
   * @param {() => void} callback
   * @returns {() => void} Unsubscribe function
   */
  onEmergencyStop: (callback) => {
    const handler = () => {
      try {
        callback()
      } catch (err) {
        console.error('[jarvisDesktop] onEmergencyStop error:', err)
      }
    }
    ipcRenderer.on('jarvis:emergency-stop', handler)
    return () => {
      ipcRenderer.removeListener('jarvis:emergency-stop', handler)
    }
  },

  /**
   * Subscribe to window layout mode changes ('overlay' | 'compact').
   * @param {(mode: 'overlay' | 'compact') => void} callback
   * @returns {() => void} Unsubscribe function
   */
  onWindowModeChanged: (callback) => {
    /** @type {(_: unknown, mode: 'overlay' | 'compact') => void} */
    const handler = (_, mode) => {
      try {
        callback(mode)
      } catch (err) {
        console.error('[jarvisDesktop] onWindowModeChanged error:', err)
      }
    }
    ipcRenderer.on('window:mode-changed', handler)
    return () => {
      ipcRenderer.removeListener('window:mode-changed', handler)
    }
  },
})

