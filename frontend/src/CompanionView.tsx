import { useEffect, useRef, useState } from 'react'
import { NovaAvatar } from './components/avatar/NovaAvatar'
import { NovaVRMAvatar } from './components/avatar/NovaVRMAvatar'
import { connect } from './lib/ws'
import { fetchAvatarStatus, avatarFileUrl, type AvatarStatus } from './lib/avatar'
import { useNovaStore } from './store/nova-store'
import './CompanionView.css'

// The Desktop-Mate-style floating companion. This window IS her — small,
// transparent, frameless, always-on-top, dragged with native OS window
// dragging (see .companion-drag's -webkit-app-region: drag below). It
// talks to the same backend session as the main chat window — main.py
// broadcasts avatar_state to every connected WebSocket, so whatever NOVA
// is doing in the chat window (or over voice) is reflected here live.
export function CompanionView() {
  const avatarState = useNovaStore((s) => s.avatarState)
  const [avatarStatus, setAvatarStatus] = useState<AvatarStatus | null>(null)
  const [showSizePanel, setShowSizePanel] = useState(false)
  const [scale, setScale] = useState(1)
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

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === 'e' && !e.repeat) {
        console.log('[companion] E pressed, interactRef set?', !!interactRef.current)
        interactRef.current?.()
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
    // whatever window had focus before the click instead of here.
    const onMouseDown = () => window.novaElectron?.focusCompanion()
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('contextmenu', onContextMenu)
    window.addEventListener('mousedown', onMouseDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('contextmenu', onContextMenu)
      window.removeEventListener('mousedown', onMouseDown)
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
      <div className="companion-hint">Click, hold E to interact · drag to move · right-click for menu</div>
    </div>
  )
}
