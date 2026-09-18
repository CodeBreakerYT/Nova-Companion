import { app, BrowserWindow, ipcMain, screen, Tray, Menu, nativeImage, dialog } from 'electron'
import { ChildProcessWithoutNullStreams, spawn } from 'child_process'
import path from 'path'
import fs from 'fs'

const isDev = !app.isPackaged
const VITE_DEV_SERVER_URL = 'http://localhost:5173'
const BACKEND_URL = 'http://127.0.0.1:8765'

let backendProcess: ChildProcessWithoutNullStreams | null = null
let mainWindow: BrowserWindow | null = null
let companionWindow: BrowserWindow | null = null
let tray: Tray | null = null
let isQuitting = false

// A real file-based log, because stdout from a packaged GUI-subsystem exe
// isn't reliably capturable at all (confirmed repeatedly during companion
// debugging) — this is readable afterward regardless of how the app was
// launched.
const LOG_PATH = path.join(app.getPath('userData'), 'nova-debug.log')
function logLine(msg: string) {
  try {
    fs.appendFileSync(LOG_PATH, `[${new Date().toISOString()}] ${msg}\n`)
  } catch {
    // best-effort only
  }
}
try {
  fs.writeFileSync(LOG_PATH, '')
} catch {
  // best-effort only
}

function resolveBackendCommand(): { command: string; args: string[]; cwd: string } {
  if (isDev) {
    // Dev mode: run the FastAPI app straight out of the repo's backend/
    // venv, no packaging step involved.
    const backendDir = path.join(__dirname, '..', '..', 'backend')
    const pythonExe =
      process.platform === 'win32'
        ? path.join(backendDir, '.venv', 'Scripts', 'python.exe')
        : path.join(backendDir, '.venv', 'bin', 'python')
    return { command: pythonExe, args: ['main.py'], cwd: backendDir }
  }

  // Packaged mode: a PyInstaller-built sidecar exe shipped next to the app,
  // no Python installation required on the end user's machine.
  const sidecarName = process.platform === 'win32' ? 'nova-backend.exe' : 'nova-backend'
  const sidecarPath = path.join(process.resourcesPath, 'backend', sidecarName)
  return { command: sidecarPath, args: [], cwd: path.dirname(sidecarPath) }
}

function startBackend() {
  const { command, args, cwd } = resolveBackendCommand()

  if (!fs.existsSync(command)) {
    console.error(`[nova] backend executable not found at ${command}`)
    return
  }

  backendProcess = spawn(command, args, { cwd })
  backendProcess.stdout.on('data', (data) => console.log(`[backend] ${data}`.trim()))
  backendProcess.stderr.on('data', (data) => console.error(`[backend] ${data}`.trim()))
  backendProcess.on('exit', (code) => console.log(`[nova] backend exited with code ${code}`))
}

function stopBackend() {
  if (backendProcess && !backendProcess.killed) {
    backendProcess.kill()
    backendProcess = null
  }
}

function loadRoute(win: BrowserWindow, query?: string) {
  if (isDev) {
    win.loadURL(query ? `${VITE_DEV_SERVER_URL}/?${query}` : VITE_DEV_SERVER_URL)
  } else {
    win.loadFile(path.join(process.resourcesPath, 'frontend', 'index.html'), query ? { search: query } : undefined)
  }
}

/** Pipes renderer console output (including failed-resource errors, e.g. a
 * bad asset path under file://) into this process's own stdout, so it shows
 * up in the same log as everything else instead of only being visible in a
 * DevTools window nobody has open in the packaged app. */
function forwardRendererConsole(win: BrowserWindow, label: string) {
  win.webContents.on('console-message', (event) => {
    logLine(`[renderer:${label}] ${event.message}`)
  })
  win.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    logLine(`[renderer:${label}] FAILED TO LOAD ${validatedURL}: ${errorDescription} (${errorCode})`)
  })
  win.webContents.on('did-finish-load', () => {
    logLine(`[renderer:${label}] did-finish-load`)
  })
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: '#0a0c17',
    autoHideMenuBar: true,
    icon: trayIcon,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  loadRoute(mainWindow)
  if (isDev) mainWindow.webContents.openDevTools({ mode: 'detach' })
  forwardRendererConsole(mainWindow, 'main')

  // Closing the window (the X button) just hides it — NOVA keeps running
  // in the tray with the desktop companion still up, exactly like a real
  // desktop-pet app. Only the tray's "Quit" actually exits.
  mainWindow.on('close', (event) => {
    if (isQuitting) return
    event.preventDefault()
    mainWindow?.hide()
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

function showMainWindow() {
  if (mainWindow) {
    mainWindow.show()
    mainWindow.focus()
  } else {
    createWindow()
  }
}

let companionScale = 1
const COMPANION_BASE_HEIGHT = 480
const COMPANION_ASPECT = 0.42 // width / height

function companionSize(scale: number) {
  const height = Math.round(COMPANION_BASE_HEIGHT * scale)
  return { width: Math.round(height * COMPANION_ASPECT), height }
}

/** The Desktop-Mate-style floating companion. The window itself IS her —
 * small, transparent, frameless, always-on-top. A fullscreen click-through
 * overlay with manual hit-testing was tried first and was fragile:
 * click-through state and focus stealing kept breaking "click to interact"
 * and "hold E". A small always-interactive window sidesteps all of that —
 * clicks/keys just work because it's a normal window, and since it only
 * occupies the area she actually stands on, it never blocks anything
 * elsewhere on the desktop. Dragging and idle roaming (see scheduleRoam
 * below) both move this window directly via setPosition rather than CSS
 * app-region, so right-click/keyboard input is never intercepted by the OS. */
function createCompanionWindow() {
  logLine('createCompanionWindow() called')
  const { width: screenW, height: screenH } = screen.getPrimaryDisplay().workAreaSize
  const { width, height } = companionSize(companionScale)

  companionWindow = new BrowserWindow({
    width,
    height,
    x: screenW - width - 40,
    y: screenH - height,
    transparent: true,
    frame: false,
    hasShadow: false,
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: true,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  logLine(`companion window created: ${JSON.stringify({ width, height, x: screenW - width - 40, y: screenH - height })}`)
  loadRoute(companionWindow, 'companion=1')
  forwardRendererConsole(companionWindow, 'companion')
  reassertCompanionOnTop()
  companionWindow.focus()

  // Other always-on-top windows (utility apps, some games) can grab
  // topmost z-order out from under a 2-second polling interval — when that
  // happens, right-clicks/keypresses aimed at her actually land on whatever
  // just took over, since the OS routes input to whichever window is
  // genuinely on top at that pixel, not whichever one is visually behind.
  // Reacting immediately on blur (something else just got activated) closes
  // that window much faster than polling alone.
  companionWindow.on('blur', () => {
    reassertCompanionOnTop()
    // Safety net: if a mouseup ever got missed (e.g. released over another
    // window during a very fast drag), losing focus is a reasonable signal
    // to stop polling rather than leaving her stuck following the cursor.
    endDrag()
  })

  companionWindow.on('closed', () => {
    logLine('companion window closed')
    companionWindow = null
    stopRoaming()
    rebuildTrayMenu()
  })

  scheduleNextRoam()

  rebuildTrayMenu()
}

function reassertCompanionOnTop() {
  if (!companionWindow) return
  companionWindow.setAlwaysOnTop(true, 'screen-saver')
  companionWindow.moveTop()
}

ipcMain.on('nova:focus-companion', () => {
  // A click landing in the renderer doesn't by itself guarantee Windows
  // hands this frameless overlay window OS keyboard focus — without it,
  // holding E does nothing because the keydown goes to whatever window was
  // focused before the click instead.
  reassertCompanionOnTop()
  companionWindow?.focus()
})

// Belt-and-suspenders against the same z-order problem: poll frequently
// rather than relying solely on the blur event, since some topmost windows
// (certain overlays/games) don't trigger a blur on this window at all.
setInterval(reassertCompanionOnTop, 500)

function setCompanionScale(scale: number) {
  companionScale = Math.min(1.6, Math.max(0.5, scale))
  if (!companionWindow) return
  const old = companionWindow.getBounds()
  const { width, height } = companionSize(companionScale)
  // Keep her bottom-right corner anchored so growing/shrinking doesn't
  // visually teleport her — only the top-left edge moves.
  companionWindow.setBounds({ x: old.x + old.width - width, y: old.y + old.height - height, width, height })
}

ipcMain.on('nova:resize-companion', (_event, scale: number) => setCompanionScale(scale))

// Dragging used to be a plain CSS `-webkit-app-region: drag` on the whole
// window — simple, but on Windows a right-click inside a drag region gets
// intercepted by the OS as a titlebar action (it thinks you're right-
// clicking a caption bar) instead of ever reaching the page as a normal
// 'contextmenu' event. That's what was silently swallowing every right-
// click on the character. Doing the drag ourselves in the main process
// keeps the whole window as an ordinary, fully-interactive surface — right-
// click, E-key focus, all of it — with dragging layered on top via mouse
// polling instead of the OS's native caption-drag behavior.
let dragOffset: { x: number; y: number } | null = null
let dragPollTimer: NodeJS.Timeout | null = null

ipcMain.on('nova:start-drag', (_event, offsetX: number, offsetY: number) => {
  stopRoaming()
  dragOffset = { x: offsetX, y: offsetY }
  if (dragPollTimer) clearInterval(dragPollTimer)
  dragPollTimer = setInterval(() => {
    if (!companionWindow || !dragOffset) return
    const { x, y } = screen.getCursorScreenPoint()
    companionWindow.setPosition(x - dragOffset.x, y - dragOffset.y)
  }, 16)
})

function endDrag() {
  const wasDragging = dragOffset !== null
  dragOffset = null
  if (dragPollTimer) {
    clearInterval(dragPollTimer)
    dragPollTimer = null
  }
  // Pick up roaming again from wherever the user just placed her.
  if (wasDragging) scheduleNextRoam()
}

ipcMain.on('nova:end-drag', endDrag)

// ---------------------------------------------------------------------------
// Idle roaming — she periodically walks to a new spot along the bottom of
// the screen on her own, Desktop-Mate style, instead of only ever standing
// still until dragged. Same setPosition-based approach as dragging (not CSS
// app-region), animated with a short eased tween rather than teleporting.
// ---------------------------------------------------------------------------

const ROAM_MIN_DELAY_MS = 15000
const ROAM_MAX_DELAY_MS = 35000
const ROAM_DURATION_MS = 1800
const ROAM_STEP_MS = 16

let roamDelayTimer: NodeJS.Timeout | null = null
let roamAnimTimer: NodeJS.Timeout | null = null

function stopRoaming() {
  if (roamDelayTimer) {
    clearTimeout(roamDelayTimer)
    roamDelayTimer = null
  }
  if (roamAnimTimer) {
    clearInterval(roamAnimTimer)
    roamAnimTimer = null
  }
}

function scheduleNextRoam() {
  if (roamDelayTimer) clearTimeout(roamDelayTimer)
  const delay = ROAM_MIN_DELAY_MS + Math.random() * (ROAM_MAX_DELAY_MS - ROAM_MIN_DELAY_MS)
  roamDelayTimer = setTimeout(startRoamWalk, delay)
}

function startRoamWalk() {
  if (!companionWindow || dragOffset) {
    scheduleNextRoam()
    return
  }
  const { width: screenW } = screen.getPrimaryDisplay().workAreaSize
  const bounds = companionWindow.getBounds()
  const maxX = screenW - bounds.width
  const targetX = Math.max(0, Math.min(maxX, Math.round(Math.random() * maxX)))
  const startX = bounds.x
  const dx = targetX - startX
  // Not worth walking for a few pixels — try again later instead of a
  // barely-visible twitch.
  if (Math.abs(dx) < 60) {
    scheduleNextRoam()
    return
  }

  companionWindow.webContents.send('nova:roam-direction', dx > 0 ? 1 : -1)

  const steps = Math.round(ROAM_DURATION_MS / ROAM_STEP_MS)
  let step = 0
  if (roamAnimTimer) clearInterval(roamAnimTimer)
  roamAnimTimer = setInterval(() => {
    if (!companionWindow || dragOffset) {
      stopRoaming()
      scheduleNextRoam()
      return
    }
    step += 1
    const t = Math.min(1, step / steps)
    const eased = 1 - (1 - t) * (1 - t) // ease-out
    companionWindow.setPosition(Math.round(startX + dx * eased), bounds.y)
    if (t >= 1) {
      stopRoaming()
      scheduleNextRoam()
    }
  }, ROAM_STEP_MS)
}

ipcMain.on('nova:show-companion-menu', async (event) => {
  logLine('nova:show-companion-menu received')
  // Both the main window's avatar box and the desktop companion trigger
  // this — it must work even when the companion window was never opened,
  // so pop it up anchored to whichever window's renderer actually sent the
  // request instead of requiring companionWindow to exist.
  const requestingWindow = BrowserWindow.fromWebContents(event.sender) ?? undefined
  let status: AvatarStatus | null = null
  try {
    status = await fetchAvatarStatus()
  } catch {
    // ignore — menu still shows without a populated character list
  }

  const menu = Menu.buildFromTemplate(buildFullMenuItems(status))
  menu.popup(requestingWindow ? { window: requestingWindow } : undefined)
})

function toggleCompanionWindow() {
  if (companionWindow) {
    companionWindow.close()
  } else {
    createCompanionWindow()
    rebuildTrayMenu()
  }
}

ipcMain.on('nova:toggle-companion', toggleCompanionWindow)

// ---------------------------------------------------------------------------
// System tray: lets NOVA run in the background (main window closed) while
// the desktop companion stays up, and gives a "switch character without
// opening the app" path — the character list is fetched straight from the
// backend's avatar store, same data the main window's picker uses.
// ---------------------------------------------------------------------------

interface AvatarStatus {
  avatars: string[]
  active: string | null
}

async function fetchAvatarStatus(): Promise<AvatarStatus> {
  const res = await fetch(`${BACKEND_URL}/api/avatar/list`)
  return res.json()
}

async function selectAvatar(filename: string | null) {
  await fetch(`${BACKEND_URL}/api/avatar/select`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filename }),
  })
  // The companion window only reads the active avatar once, on mount —
  // reload it so a tray-driven switch actually takes effect immediately.
  companionWindow?.webContents.reload()
  rebuildTrayMenu()
}

/** Native file picker for a .vrm model — this plus the in-app "🎭
 * Character" panel's upload button are the two ways to add a model; this
 * one is reachable from both the tray and the right-click menu without
 * needing the main window open at all. */
async function uploadVrmViaDialog() {
  const result = await dialog.showOpenDialog({
    title: 'Select a VRM model',
    properties: ['openFile'],
    filters: [{ name: 'VRM models', extensions: ['vrm'] }],
  })
  if (result.canceled || !result.filePaths[0]) return

  const filePath = result.filePaths[0]
  const buffer = fs.readFileSync(filePath)
  const form = new FormData()
  form.append('file', new Blob([buffer]), path.basename(filePath))
  await fetch(`${BACKEND_URL}/api/avatar/upload`, { method: 'POST', body: form })
  companionWindow?.webContents.reload()
  rebuildTrayMenu()
}

function buildCharacterMenuItems(status: AvatarStatus | null): Electron.MenuItemConstructorOptions[] {
  const items: Electron.MenuItemConstructorOptions[] = status
    ? [
        { label: 'Default (Shinobu)', type: 'radio', checked: !status.active, click: () => selectAvatar(null) },
        ...status.avatars.map((name) => ({
          label: name.replace(/\.vrm$/i, ''),
          type: 'radio' as const,
          checked: status.active === name,
          click: () => selectAvatar(name),
        })),
      ]
    : [{ label: 'Starting up…', enabled: false }]
  items.push({ type: 'separator' }, { label: 'Upload VRM…', click: uploadVrmViaDialog })
  return items
}

/** Single source of truth for both the tray icon's menu and the character's
 * own right-click menu — they used to be built separately and drifted out
 * of sync (right-click was missing items the tray had, and vice versa).
 * Every entry point into NOVA's controls should offer exactly the same
 * options. */
function buildFullMenuItems(status: AvatarStatus | null): Electron.MenuItemConstructorOptions[] {
  return [
    {
      label: companionWindow ? 'Hide Desktop Companion' : '▶ Play on Desktop',
      click: toggleCompanionWindow,
    },
    { type: 'separator' },
    { label: 'Change Character', submenu: buildCharacterMenuItems(status) },
    // Native Electron menus can't embed a real <input type="range"> — this
    // toggles an actual slider overlay inside the companion window itself.
    { label: 'Size…', click: () => companionWindow?.webContents.send('nova:toggle-size-panel') },
    { type: 'separator' },
    { label: 'Settings', click: showMainWindow },
    {
      label: 'Help',
      click: () =>
        dialog.showMessageBox({
          title: 'NOVA — Desktop Companion',
          message: 'Click her for a reaction. Hold E to talk to her — release to send.\nDrag her anywhere on your screen.\nRight-click for this menu.',
        }),
    },
    {
      label: 'Quit',
      click: () => {
        isQuitting = true
        app.quit()
      },
    },
  ]
}

async function rebuildTrayMenu() {
  if (!tray) return

  let status: AvatarStatus | null = null
  try {
    status = await fetchAvatarStatus()
  } catch {
    // Backend not up yet (e.g. still starting) — show a minimal menu and
    // let the user retry once it's ready.
  }

  tray.setContextMenu(Menu.buildFromTemplate(buildFullMenuItems(status)))
}

let trayIcon: Electron.NativeImage

app.on('render-process-gone', (_event, webContents, details) => {
  logLine(`RENDER PROCESS GONE: reason=${details.reason} exitCode=${details.exitCode}`)
})
app.on('child-process-gone', (_event, details) => {
  logLine(`CHILD PROCESS GONE: type=${details.type} reason=${details.reason} exitCode=${details.exitCode}`)
})
app.on('gpu-process-crashed' as never, (() => logLine('GPU PROCESS CRASHED')) as never)

app.whenReady().then(() => {
  logLine(`app ready. gpuFeatureStatus=${JSON.stringify(app.getGPUFeatureStatus())}`)

  trayIcon = nativeImage.createFromPath(path.join(__dirname, '..', 'assets', 'tray-icon.png'))

  startBackend()
  createWindow()

  tray = new Tray(trayIcon)
  tray.setToolTip('NOVA — AI Desktop Companion')
  tray.on('click', () => {
    if (mainWindow?.isVisible()) mainWindow.focus()
    else showMainWindow()
  })
  rebuildTrayMenu()
  // Backend takes a moment to boot (indexing thread etc.) — refresh once
  // more shortly after so the character list isn't stuck on "Starting up…".
  setTimeout(rebuildTrayMenu, 3000)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  // Intentionally a no-op: the main window hides instead of closing (see
  // createWindow), and the companion window has no close button, so this
  // only fires in edge cases (e.g. dev tools force-closed the window). The
  // app should keep running in the tray either way — only "Quit" exits.
})

app.on('before-quit', () => {
  isQuitting = true
  stopBackend()
})
