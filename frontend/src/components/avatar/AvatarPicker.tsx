import { useRef, useState } from 'react'
import { uploadAvatar, selectAvatar, type AvatarStatus } from '../../lib/avatar'
import './AvatarPicker.css'

export function AvatarPicker({
  status,
  onChanged,
}: {
  status: AvatarStatus | null
  onChanged: () => void
}) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setBusy(true)
    try {
      await uploadAvatar(file)
      onChanged()
    } finally {
      setBusy(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const pick = async (filename: string | null) => {
    setBusy(true)
    try {
      await selectAvatar(filename)
      onChanged()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="avatar-picker">
      <button className="avatar-picker-toggle" onClick={() => setOpen((o) => !o)}>
        🎭 Character
      </button>
      {open && (
        <div className="avatar-picker-panel">
          <div className="avatar-picker-title">Pick your companion</div>
          <button className={!status?.active ? 'active' : ''} disabled={busy} onClick={() => pick(null)}>
            Default (Shinobu)
          </button>
          {status?.avatars.map((name) => (
            <button key={name} className={status.active === name ? 'active' : ''} disabled={busy} onClick={() => pick(name)}>
              {name.replace(/\.vrm$/i, '')}
            </button>
          ))}
          <label className="avatar-picker-upload">
            {busy ? 'Loading…' : '+ Upload a .vrm model'}
            <input ref={fileRef} type="file" accept=".vrm" onChange={handleUpload} disabled={busy} />
          </label>
        </div>
      )}
    </div>
  )
}
