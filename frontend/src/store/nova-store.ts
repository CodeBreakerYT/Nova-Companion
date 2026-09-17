import { create } from 'zustand'
import type { AssistantState, ChatMessage } from '../lib/types'

interface NovaStore {
  connected: boolean
  avatarState: AssistantState
  messages: ChatMessage[]
  ttsActive: boolean
  setConnected: (connected: boolean) => void
  setAvatarState: (state: AssistantState) => void
  setTtsActive: (active: boolean) => void
  addMessage: (message: ChatMessage) => void
  appendToken: (id: string, text: string) => void
  finishStreaming: (id: string, fullText: string) => void
  resolveConfirm: (id: string, resolved: 'approved' | 'declined') => void
  clearHistory: () => void
}

export const useNovaStore = create<NovaStore>((set) => ({
  connected: false,
  avatarState: 'idle',
  messages: [],
  ttsActive: false,
  setConnected: (connected) => set({ connected }),
  setAvatarState: (avatarState) => set({ avatarState }),
  setTtsActive: (ttsActive) => set({ ttsActive }),
  addMessage: (message) => set((s) => ({ messages: [...s.messages, message] })),
  appendToken: (id, text) =>
    set((s) => ({
      messages: s.messages.map((m) => (m.id === id && m.kind === 'text' ? { ...m, text: m.text + text } : m)),
    })),
  finishStreaming: (id, fullText) =>
    set((s) => ({
      messages: s.messages.map((m) =>
        m.id === id && m.kind === 'text' ? { ...m, text: fullText, streaming: false } : m
      ),
    })),
  resolveConfirm: (id, resolved) =>
    set((s) => ({
      messages: s.messages.map((m) =>
        m.id === id && m.kind === 'confirm' ? { ...m, confirm: { ...m.confirm, resolved } } : m
      ),
    })),
  clearHistory: () => set({ messages: [] }),
}))
