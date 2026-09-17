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
      onToggleSizePanel: (cb: () => void) => () => void
    }
  }
}
