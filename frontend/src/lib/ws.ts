import { useNovaStore } from '../store/nova-store'
import { speak } from './tts'
import type { AssistantState, FileResult } from './types'

const WS_URL = 'ws://127.0.0.1:8765/ws/session'
const RECONNECT_DELAY_MS = 1500

const TOOL_STATUS_LABEL: Record<string, string> = {
  search_files: 'Searching your files…',
  open_file: 'Opening file…',
  open_folder: 'Opening folder…',
  create_folder: 'Creating folder…',
  launch_application: 'Launching app…',
  open_url: 'Opening browser…',
  web_search: 'Searching the web…',
  create_note: 'Saving note…',
  create_task: 'Adding task…',
}

let socket: WebSocket | null = null
let currentAssistantId: string | null = null
let currentStatusId: string | null = null

function nextId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function handleMessage(event: MessageEvent) {
  const { setAvatarState, appendToken, finishStreaming, addMessage, ttsActive } = useNovaStore.getState()
  const msg = JSON.parse(event.data)

  switch (msg.type) {
    case 'avatar_state':
      if (msg.state === 'idle' && ttsActive) break // let audio.onended drive the transition instead
      setAvatarState(msg.state as AssistantState)
      break

    case 'tool_call': {
      const id = nextId()
      currentStatusId = id
      addMessage({ id, role: 'assistant', kind: 'status', text: TOOL_STATUS_LABEL[msg.tool] ?? `Running ${msg.tool}…` })
      break
    }

    case 'tool_result': {
      const results = (msg.result?.results ?? []) as FileResult[]
      if (msg.tool === 'search_files' && results.length > 0 && currentStatusId) {
        const id = currentStatusId
        useNovaStore.setState((s) => ({
          messages: s.messages.map((m) =>
            m.id === id
              ? { id, role: 'assistant', kind: 'file_results', text: `Found ${results.length} match(es):`, results }
              : m
          ),
        }))
      } else if (currentStatusId) {
        const id = currentStatusId
        const text = (msg.result?.message as string) ?? (msg.result?.status === 'ok' ? 'Done.' : 'Something went wrong.')
        useNovaStore.setState((s) => ({
          messages: s.messages.map((m) => (m.id === id && m.kind === 'status' ? { ...m, text } : m)),
        }))
      }
      currentStatusId = null
      break
    }

    case 'confirm_required':
      addMessage({
        id: nextId(),
        role: 'assistant',
        kind: 'confirm',
        confirm: { tool: msg.tool, args: msg.args, message: msg.message },
      })
      break

    case 'token':
      if (!currentAssistantId) {
        const id = nextId()
        currentAssistantId = id
        addMessage({ id, role: 'assistant', kind: 'text', text: '', streaming: true })
      }
      appendToken(currentAssistantId, msg.text)
      break

    case 'final_message':
      if (currentAssistantId) {
        finishStreaming(currentAssistantId, msg.text)
      } else if (msg.text) {
        addMessage({ id: nextId(), role: 'assistant', kind: 'text', text: msg.text })
      }
      currentAssistantId = null
      // Every reply is spoken now, not just voice-originated ones — NOVA is
      // a voice companion first. Flip ttsActive synchronously (speak() only
      // sets it internally once its fetch resolves) so the backend's "idle"
      // push, sent right after final_message with no network delay, doesn't
      // slip through and cut the SPEAKING state short.
      if (msg.text) {
        useNovaStore.getState().setTtsActive(true)
        speak(msg.text)
      }
      break

    case 'proactive_message':
      // Unprompted check-in — NOVA speaking up on her own, not replying to
      // something the user said. No currentAssistantId/streaming involved.
      if (msg.text) {
        addMessage({ id: nextId(), role: 'assistant', kind: 'text', text: msg.text })
        useNovaStore.getState().setTtsActive(true)
        speak(msg.text)
      }
      break

    default:
      break
  }
}

// Requested once per connection — the backend itself only actually replies
// to the first one across every window in the process (see HAS_GREETED in
// main.py), so both the main chat window and the desktop companion asking
// on their own connect doesn't produce two greetings.
let hasRequestedGreeting = false

export function connect() {
  if (socket && socket.readyState !== WebSocket.CLOSED) return

  socket = new WebSocket(WS_URL)

  socket.addEventListener('open', () => {
    useNovaStore.getState().setConnected(true)
    if (!hasRequestedGreeting) {
      hasRequestedGreeting = true
      socket?.send(JSON.stringify({ type: 'greet' }))
    }
  })

  socket.addEventListener('close', () => {
    useNovaStore.getState().setConnected(false)
    setTimeout(connect, RECONNECT_DELAY_MS)
  })

  socket.addEventListener('error', () => {
    socket?.close()
  })

  socket.addEventListener('message', handleMessage)
}

export function sendUserMessage(text: string) {
  const { addMessage } = useNovaStore.getState()

  addMessage({ id: nextId(), role: 'user', kind: 'text', text })
  socket?.send(JSON.stringify({ type: 'user_message', text }))
}

export function respondToConfirm(messageId: string, approved: boolean) {
  useNovaStore.getState().resolveConfirm(messageId, approved ? 'approved' : 'declined')
  socket?.send(JSON.stringify({ type: 'tool_confirm', approved }))
}

export function clearConversation() {
  currentAssistantId = null
  currentStatusId = null
  useNovaStore.getState().clearHistory()
  socket?.send(JSON.stringify({ type: 'clear_history' }))
}
