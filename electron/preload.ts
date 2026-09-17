import { contextBridge, ipcRenderer } from 'electron'

// Native-only actions the renderer needs: opening/closing the companion
// window, the right-click context menu, resizing (the actual OS window —
// the avatar reframes itself automatically when its container resizes),
// and hearing when the right-click menu's "Size…" item was clicked so the
// companion window can show its own slider overlay. Exposed narrowly via
// contextBridge rather than enabling nodeIntegration.
contextBridge.exposeInMainWorld('novaElectron', {
  toggleCompanion: () => ipcRenderer.send('nova:toggle-companion'),
  showCompanionMenu: () => ipcRenderer.send('nova:show-companion-menu'),
  focusCompanion: () => ipcRenderer.send('nova:focus-companion'),
  resizeCompanion: (scale: number) => ipcRenderer.send('nova:resize-companion', scale),
  onToggleSizePanel: (cb: () => void) => {
    const listener = () => cb()
    ipcRenderer.on('nova:toggle-size-panel', listener)
    return () => ipcRenderer.removeListener('nova:toggle-size-panel', listener)
  },
})
