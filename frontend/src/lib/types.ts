export type AssistantState =
  | 'idle'
  | 'listening'
  | 'thinking'
  | 'speaking'
  | 'happy'
  | 'confused'
  | 'error'

export interface FileResult {
  filename: string
  path: string
  ext: string
  size: number
  modified: string
  created: string
  snippet: string
}

export interface PendingConfirm {
  tool: string
  args: Record<string, unknown>
  message: string
  resolved?: 'approved' | 'declined'
}

export type ChatMessage =
  | { id: string; role: 'user'; kind: 'text'; text: string }
  | { id: string; role: 'assistant'; kind: 'text'; text: string; streaming?: boolean }
  | { id: string; role: 'assistant'; kind: 'status'; text: string }
  | { id: string; role: 'assistant'; kind: 'file_results'; text: string; results: FileResult[] }
  | { id: string; role: 'assistant'; kind: 'confirm'; confirm: PendingConfirm }
