import { useEffect, useRef, useState, useCallback } from 'react'
import { ChatPanel } from './components/chat/ChatPanel'
import { NovaAvatar } from './components/avatar/NovaAvatar'
import { NovaVRMAvatar } from './components/avatar/NovaVRMAvatar'
import { AvatarPicker } from './components/avatar/AvatarPicker'
import { connect, clearConversation } from './lib/ws'
import { fetchAvatarStatus, avatarFileUrl, type AvatarStatus } from './lib/avatar'
import { useNovaStore } from './store/nova-store'
import './App.css'

function App() {
  const connected = useNovaStore((s) => s.connected)
  const avatarState = useNovaStore((s) => s.avatarState)
  const hasMessages = useNovaStore((s) => s.messages.length > 0)
  const [avatarStatus, setAvatarStatus] = useState<AvatarStatus | null>(null)
  const [companionOpen, setCompanionOpen] = useState(false)
  const interactRef = useRef<(() => void) | null>(null)

  const refreshAvatarStatus = useCallback(() => {
    fetchAvatarStatus()
      .then(setAvatarStatus)
      .catch(() => {})
  }, [])

  useEffect(() => {
    connect()
    refreshAvatarStatus()
  }, [refreshAvatarStatus])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === 'e' && !e.repeat) interactRef.current?.()
    }
    // Window-level (not a React onContextMenu on the div) — same proven
    // pattern as the desktop companion window. Fires anywhere in the main
    // window, not just over the avatar: restricting it to the avatar column
    // meant right-clicking the chat panel or header silently fell through to
    // Chromium's empty default menu, which looked like right-click was
    // broken entirely.
    const onContextMenu = (e: MouseEvent) => {
      if (!window.novaElectron) return
      e.preventDefault()
      window.novaElectron.showCompanionMenu()
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('contextmenu', onContextMenu)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('contextmenu', onContextMenu)
    }
  }, [])

  return (
    <div className="nova-shell">
      <h1>NOVA</h1>
      <div className="status-line">
        <span className={`dot ${connected ? 'online' : 'offline'}`} />
        {connected ? `Online · ${avatarState}` : 'Connecting...'}
        <AvatarPicker status={avatarStatus} onChanged={refreshAvatarStatus} />
        {hasMessages && (
          <button className="clear-chat-btn" onClick={clearConversation}>
            Clear chat
          </button>
        )}
      </div>
      <div className="nova-main">
        <div className="avatar-column">
          {avatarStatus === null ? (
            <div className="avatar-viewport avatar-viewport-loading" />
          ) : avatarStatus.active ? (
            <NovaVRMAvatar
              key={avatarStatus.active}
              url={avatarFileUrl(avatarStatus.active)}
              state={avatarState}
              className="avatar-viewport"
              interactRef={interactRef}
            />
          ) : (
            <NovaAvatar state={avatarState} className="avatar-viewport" interactRef={interactRef} />
          )}
          {window.novaElectron && (
            <button
              className="play-desktop-btn"
              onClick={() => {
                window.novaElectron!.toggleCompanion()
                setCompanionOpen((v) => !v)
              }}
            >
              {companionOpen ? '⏸ Stop on Desktop' : '▶ Play on Desktop'}
            </button>
          )}
        </div>
        <ChatPanel />
      </div>
    </div>
  )
}

export default App
