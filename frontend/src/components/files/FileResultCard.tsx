import type { FileResult } from '../../lib/types'
import './FileResultCard.css'

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diffMs / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

function iconFor(ext: string): string {
  if (ext === '.pdf') return '📕'
  if (ext === '.docx' || ext === '.doc') return '📄'
  if (ext === '.txt' || ext === '.md') return '📝'
  return '📁'
}

async function post(path: string, body: unknown) {
  await fetch(`http://127.0.0.1:8765${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export function FileResultCard({ result }: { result: FileResult }) {
  const folder = result.path.slice(0, result.path.length - result.filename.length - 1)
  const folderShort = folder.split('\\').slice(-2).join(' / ')

  return (
    <div className="file-card">
      <div className="file-card-icon">{iconFor(result.ext)}</div>
      <div className="file-card-body">
        <div className="file-card-name">{result.filename}</div>
        <div className="file-card-path">{folderShort}</div>
        <div className="file-card-meta">Modified {timeAgo(result.modified)}</div>
        <div className="file-card-actions">
          <button onClick={() => post('/api/files/open', { path: result.path })}>Open</button>
          <button onClick={() => post('/api/files/reveal', { path: result.path })}>Show in Folder</button>
        </div>
      </div>
    </div>
  )
}
