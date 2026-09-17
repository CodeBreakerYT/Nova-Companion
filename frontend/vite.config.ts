import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Electron loads the packaged build via file://, where an absolute base
  // ("/assets/...", Vite's default) resolves against the OS filesystem
  // root instead of index.html's own folder — the script 404s silently and
  // the window just shows its background color with nothing mounted.
  base: './',
})
