import { useEffect, useRef, useState } from 'react'
import { NovaAvatar } from './components/avatar/NovaAvatar'
import { NovaVRMAvatar } from './components/avatar/NovaVRMAvatar'
import { connect } from './lib/ws'
import { fetchAvatarStatus, avatarFileUrl, type AvatarStatus } from './lib/avatar'
import { useNovaStore } from './store/nova-store'
import { startVoiceCapture, stopVoiceCapture } from './lib/voiceCapture'
import './CompanionView.css'

// The Desktop-Mate-style floating companion. This window IS her — small,
// transparent, frameless, always-on-top. Dragging is done via main-process
// mouse polling (nova:start-drag/nova:end-drag), NOT CSS
// `-webkit-app-region: drag` — that was tried first, but on Windows a
// right-click inside a drag region gets intercepted by the OS as a
// titlebar action instead of ever reaching the page, which is what was
// silently swallowing every right-click on the character. This way the
// whole window stays a normal, fully-interactive surface. Talks to the
// same backend session as the main chat window — main.py broadcasts
// avatar_state to every connected WebSocket, so whatever NOVA is doing in
// the chat window (or over voice) is reflected here live.
export function CompanionView() {
  const avatarState = useNovaStore((s) => s.avatarState)
  const [avatarStatus, setAvatarStatus] = useState<AvatarStatus | null>(null)
  const [showSizePanel, setShowSizePanel] = useState(false)
  const [scale, setScale] = useState(1)
  const [facing, setFacing] = useState<1 | -1>(1)
  const [isRoaming, setIsRoaming] = useState(false)
  const interactRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    console.log('[companion] mounted, novaElectron =', !!window.novaElectron)
    connect()
    fetchAvatarStatus()
      .then((s) => {
        console.log('[companion] avatarStatus loaded', s)
        setAvatarStatus(s)
      })
      .catch((err) => console.log('[companion] avatarStatus fetch failed', String(err)))
  }, [])

  useEffect(() => window.novaElectron?.onToggleSizePanel(() => setShowSizePanel((v) => !v)), [])

  // Main process drives the actual walk (it owns window position); this
  // just mirrors it visually — facing the direction she's headed, with a
  // brief walking bob for the same ~1.8s the move itself takes.
  useEffect(
    () =>
      window.novaElectron?.onRoamDirection((direction) => {
        setFacing(direction)
        setIsRoaming(true)
        window.setTimeout(() => setIsRoaming(false), 1800)
      }),
    []
  )

  useEffect(() => {
    // Holding E is push-to-talk, matching the mic button in the main
    // window — a quick reaction pose plays immediately on press (so it
    // still feels responsive even before she's actually listening), then
    // releasing E stops the recording and sends it the same way the mic
    // button does (STT -> chat).
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === 'e' && !e.repeat) {
        console.log('[companion] E pressed, interactRef set?', !!interactRef.current)
        interactRef.current?.()
        startVoiceCapture()
      }
    }
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === 'e') {
        console.log('[companion] E released')
        stopVoiceCapture()
      }
    }
    const onContextMenu = (e: MouseEvent) => {
      console.log('[companion] contextmenu event fired')
      e.preventDefault()
      window.novaElectron?.showCompanionMenu()
    }
    // Any click grabs real OS keyboard focus for this window explicitly —
    // a frameless always-on-top overlay isn't guaranteed to receive it just
    // from being clicked, and without it a held E key keeps going to
    // whatever window had focus before the click instead of here. A
    // left-click also starts a drag (see the module comment above for why
    // this is done via IPC/mouse-polling instead of CSS app-region), unless
    // it's on the size-panel slider.
    const onMouseDown = (e: MouseEvent) => {
      window.novaElectron?.focusCompanion()
      if (e.button !== 0) return
      if ((e.target as HTMLElement).closest('.companion-size-panel')) return
      window.novaElectron?.startDrag(e.clientX, e.clientY)
    }
    const onMouseUp = () => window.novaElectron?.endDrag()
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('contextmenu', onContextMenu)
    window.addEventListener('mousedown', onMouseDown)
    window.addEventListener('mouseup', onMouseUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('contextmenu', onContextMenu)
      window.removeEventListener('mousedown', onMouseDown)
      window.removeEventListener('mouseup', onMouseUp)
    }
  }, [])

  // Greeting: she waves/reacts shortly after appearing, instead of just
  // silently standing there.
  useEffect(() => {
    if (avatarStatus === null) return
    const t = setTimeout(() => {
      console.log('[companion] greeting fire, interactRef set?', !!interactRef.current)
      interactRef.current?.()
    }, 600)
    return () => clearTimeout(t)
  }, [avatarStatus])

  if (avatarStatus === null) return null

  return (
    <div className="companion-drag" style={{ width: '100vw', height: '100vh', background: 'transparent', position: 'relative' }}>
      <div
        className={`companion-facing ${isRoaming ? 'is-roaming' : ''}`}
        style={{ transform: `scaleX(${facing})`, width: '100%', height: '100%' }}
      >
        {avatarStatus.active ? (
          <NovaVRMAvatar
            key={avatarStatus.active}
            url={avatarFileUrl(avatarStatus.active)}
            state={avatarState}
            className="companion-avatar"
            interactRef={interactRef}
          />
        ) : (
          <NovaAvatar state={avatarState} className="companion-avatar" interactRef={interactRef} />
        )}
      </div>
      {showSizePanel && (
        <div className="companion-size-panel">
          <input
            type="range"
            min={0.5}
            max={1.6}
            step={0.05}
            value={scale}
            onChange={(e) => {
              const v = Number(e.target.value)
              setScale(v)
              window.novaElectron?.resizeCompanion(v)
            }}
          />
        </div>
      )}
      <div className="companion-hint">Click to react · hold E to talk · drag to move · right-click for menu</div>
    </div>
  )
}
