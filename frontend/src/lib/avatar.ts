const BASE = 'http://127.0.0.1:8765'

export interface AvatarStatus {
  avatars: string[]
  active: string | null
}

export async function fetchAvatarStatus(): Promise<AvatarStatus> {
  const res = await fetch(`${BASE}/api/avatar/list`)
  return res.json()
}

export async function uploadAvatar(file: File): Promise<{ filename: string }> {
  const form = new FormData()
  form.append('file', file)
  const res = await fetch(`${BASE}/api/avatar/upload`, { method: 'POST', body: form })
  if (!res.ok) throw new Error('upload failed')
  return res.json()
}

export async function selectAvatar(filename: string | null): Promise<void> {
  await fetch(`${BASE}/api/avatar/select`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filename }),
  })
}

export function avatarFileUrl(filename: string): string {
  return `${BASE}/api/avatar/file/${encodeURIComponent(filename)}`
}
