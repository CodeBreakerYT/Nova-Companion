import { useEffect, useRef, useState } from 'react'
import { useNovaStore } from '../../store/nova-store'
import { getSavedMicId, saveMicId, startVoiceCapture, stopVoiceCapture } from '../../lib/voiceCapture'
import './MicButton.css'

export function MicButton() {
  const connected = useNovaStore((s) => s.connected)
  const avatarState = useNovaStore((s) => s.avatarState)
  const [recording, setRecording] = useState(false)
  const [showDeviceMenu, setShowDeviceMenu] = useState(false)
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [selectedMicId, setSelectedMicId] = useState<string | null>(getSavedMicId)
  const menuRef = useRef<HTMLDivElement>(null)

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

  const toggle = () => {
    if (!connected) return
    if (recording) {
      stopVoiceCapture()
      setRecording(false)
    } else {
      startVoiceCapture()
      setRecording(true)
    }
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
        disabled={!connected}
        title={recording ? 'Stop and send' : 'Talk to NOVA'}
      >
        🎙️
        {recording && <span className="mic-pulse" />}
        {avatarState === 'listening' && <span className="mic-label">Listening…</span>}
      </button>
      <button
        className="mic-device-caret"
        onClick={() => setShowDeviceMenu((v) => !v)}
        disabled={recording}
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
