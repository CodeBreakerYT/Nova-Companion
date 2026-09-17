import { useEffect, useRef, useState } from 'react'
import { useNovaStore } from '../../store/nova-store'
import { sendUserMessage } from '../../lib/ws'
import './MicButton.css'

const MIC_DEVICE_STORAGE_KEY = 'nova-mic-device-id'

function getSavedMicId(): string | null {
  try {
    return localStorage.getItem(MIC_DEVICE_STORAGE_KEY)
  } catch {
    return null
  }
}

function saveMicId(deviceId: string) {
  try {
    localStorage.setItem(MIC_DEVICE_STORAGE_KEY, deviceId)
  } catch {
    // per-viewer convenience only — fine if this silently no-ops
  }
}

export function MicButton() {
  const connected = useNovaStore((s) => s.connected)
  const avatarState = useNovaStore((s) => s.avatarState)
  const setAvatarState = useNovaStore((s) => s.setAvatarState)
  const [recording, setRecording] = useState(false)
  const [busy, setBusy] = useState(false)
  const [showDeviceMenu, setShowDeviceMenu] = useState(false)
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [selectedMicId, setSelectedMicId] = useState<string | null>(getSavedMicId)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const streamRef = useRef<MediaStream | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  const stopStream = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
  }

  const loadDevices = async () => {
    try {
      // Labels are blank until a getUserMedia permission has been granted at
      // least once — harmless if this is the very first time, the picker
      // will just show generic "Microphone 1" style labels until then.
      const list = await navigator.mediaDevices.enumerateDevices()
      setDevices(list.filter((d) => d.kind === 'audioinput'))
    } catch {
      setDevices([])
    }
  }

  useEffect(() => {
    if (!showDeviceMenu) return
    loadDevices()
    const onClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setShowDeviceMenu(false)
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [showDeviceMenu])

  const startRecording = async () => {
    try {
      const audioConstraints: MediaTrackConstraints | boolean = selectedMicId
        ? { deviceId: { exact: selectedMicId } }
        : true
      const stream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints })
      streamRef.current = stream
      chunksRef.current = []

      const recorder = new MediaRecorder(stream)
      mediaRecorderRef.current = recorder

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data)
      }

      recorder.onstop = async () => {
        stopStream()
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' })
        if (blob.size < 1000) {
          setAvatarState('idle')
          setBusy(false)
          return
        }

        setBusy(true)
        setAvatarState('thinking')
        try {
          const form = new FormData()
          form.append('audio', blob, 'speech.webm')
          const res = await fetch('http://127.0.0.1:8765/api/stt', { method: 'POST', body: form })
          const data = await res.json()
          const text = (data.text || '').trim()
          if (text) {
            sendUserMessage(text)
          } else {
            setAvatarState('confused')
            setTimeout(() => setAvatarState('idle'), 1200)
          }
        } catch {
          setAvatarState('error')
          setTimeout(() => setAvatarState('idle'), 1200)
        } finally {
          setBusy(false)
        }
      }

      recorder.start()
      setRecording(true)
      setAvatarState('listening')
    } catch {
      setAvatarState('error')
      setTimeout(() => setAvatarState('idle'), 1200)
    }
  }

  const stopRecording = () => {
    mediaRecorderRef.current?.stop()
    setRecording(false)
  }

  const toggle = () => {
    if (!connected || busy) return
    if (recording) stopRecording()
    else startRecording()
  }

  const selectDevice = (deviceId: string) => {
    setSelectedMicId(deviceId)
    saveMicId(deviceId)
    setShowDeviceMenu(false)
  }

  return (
    <div className="mic-control" ref={menuRef}>
      <button
        className={`mic-button ${recording ? 'recording' : ''}`}
        onClick={toggle}
        disabled={!connected || busy}
        title={recording ? 'Stop and send' : 'Talk to NOVA'}
      >
        🎙️
        {recording && <span className="mic-pulse" />}
        {avatarState === 'listening' && <span className="mic-label">Listening…</span>}
      </button>
      <button
        className="mic-device-caret"
        onClick={() => setShowDeviceMenu((v) => !v)}
        disabled={recording || busy}
        title="Choose microphone"
      >
        ˅
      </button>
      {showDeviceMenu && (
        <div className="mic-device-menu">
          <div className="mic-device-menu-title">Microphone</div>
          {devices.length === 0 && <div className="mic-device-item mic-device-empty">No microphones found</div>}
          {devices.map((d, i) => (
            <button
              key={d.deviceId || i}
              className={`mic-device-item ${(selectedMicId ?? devices[0]?.deviceId) === d.deviceId ? 'active' : ''}`}
              onClick={() => selectDevice(d.deviceId)}
            >
              {d.label || `Microphone ${i + 1}`}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
