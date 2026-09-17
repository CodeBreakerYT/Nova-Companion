import { useEffect, useRef, useState } from 'react'
import { useNovaStore } from '../../store/nova-store'
import { sendUserMessage, respondToConfirm } from '../../lib/ws'
import { MicButton } from './MicButton'
import { FileResultCard } from '../files/FileResultCard'
import './ChatPanel.css'

export function ChatPanel() {
  const messages = useNovaStore((s) => s.messages)
  const connected = useNovaStore((s) => s.connected)
  const avatarState = useNovaStore((s) => s.avatarState)
  const [draft, setDraft] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages])

  const submit = () => {
    const text = draft.trim()
    if (!text || !connected) return
    sendUserMessage(text)
    setDraft('')
  }

  return (
    <div className="chat-panel">
      <div className="chat-messages" ref={scrollRef}>
        {messages.length === 0 && (
          <div className="chat-empty">Say hi to NOVA — try "Find my resume" or "Help me plan my evening."</div>
        )}
        {messages.map((m) => {
          if (m.kind === 'status') {
            return (
              <div key={m.id} className="chat-bubble status">
                {m.text}
              </div>
            )
          }
          if (m.kind === 'file_results') {
            return (
              <div key={m.id} className="chat-bubble assistant">
                <div>{m.text}</div>
                {m.results.map((r) => (
                  <FileResultCard key={r.path} result={r} />
                ))}
              </div>
            )
          }
          if (m.kind === 'confirm') {
            return (
              <div key={m.id} className="chat-bubble assistant confirm">
                <div>{m.confirm.message}</div>
                {m.confirm.resolved ? (
                  <div className="confirm-resolved">{m.confirm.resolved === 'approved' ? 'Confirmed' : 'Declined'}</div>
                ) : (
                  <div className="confirm-actions">
                    <button onClick={() => respondToConfirm(m.id, true)}>Yes</button>
                    <button onClick={() => respondToConfirm(m.id, false)}>No</button>
                  </div>
                )}
              </div>
            )
          }
          return (
            <div key={m.id} className={`chat-bubble ${m.role}`}>
              {m.text || (m.role === 'assistant' && m.kind === 'text' && m.streaming ? '…' : '')}
            </div>
          )
        })}
      </div>
      <div className="chat-input-row">
        <MicButton />
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit()
          }}
          placeholder={connected ? 'Talk to NOVA...' : 'Connecting to NOVA...'}
          disabled={!connected}
        />
        <button onClick={submit} disabled={!connected || avatarState === 'thinking'}>
          Send
        </button>
      </div>
    </div>
  )
}
