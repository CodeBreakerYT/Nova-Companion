export {}

declare global {
  interface Window {
    /** Exposed by electron/preload.ts. Undefined when running in a plain
     * browser (e.g. `npm --prefix frontend run dev` on its own) — callers
     * must guard with `window.novaElectron?.` */
    novaElectron?: {
      toggleCompanion: () => void
      showCompanionMenu: () => void
      focusCompanion: () => void
      resizeCompanion: (scale: number) => void
      startDrag: (offsetX: number, offsetY: number) => void
      endDrag: () => void
      onToggleSizePanel: (cb: () => void) => () => void
      onRoamDirection: (cb: (direction: 1 | -1) => void) => () => void
    }
  }
}
