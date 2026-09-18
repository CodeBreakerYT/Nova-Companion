import { useNovaStore } from '../store/nova-store'
import { sendUserMessage } from './ws'

const MIC_DEVICE_STORAGE_KEY = 'nova-mic-device-id'

export function getSavedMicId(): string | null {
  try {
    return localStorage.getItem(MIC_DEVICE_STORAGE_KEY)
  } catch {
    return null
  }
}

export function saveMicId(deviceId: string) {
  try {
    localStorage.setItem(MIC_DEVICE_STORAGE_KEY, deviceId)
  } catch {
    // per-viewer convenience only — fine if this silently no-ops
  }
}

// Module-level (not React state) so both the main window's mic button and
// the desktop companion's hold-E-to-talk share one recorder instance and
// can't step on each other.
let mediaRecorder: MediaRecorder | null = null
let chunks: Blob[] = []
let stream: MediaStream | null = null
let capturing = false

function stopStream() {
  stream?.getTracks().forEach((t) => t.stop())
  stream = null
}

export function isCapturingVoice() {
  return capturing
}

export async function startVoiceCapture(): Promise<void> {
  if (capturing) return
  try {
    const micId = getSavedMicId()
    const audioConstraints: MediaTrackConstraints | boolean = micId ? { deviceId: { exact: micId } } : true
    stream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints })
    chunks = []
    mediaRecorder = new MediaRecorder(stream)
    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data)
    }
    mediaRecorder.start()
    capturing = true
    useNovaStore.getState().setAvatarState('listening')
  } catch {
    useNovaStore.getState().setAvatarState('error')
    setTimeout(() => useNovaStore.getState().setAvatarState('idle'), 1200)
  }
}

export function stopVoiceCapture(): void {
  if (!capturing || !mediaRecorder) return
  capturing = false
  const recorder = mediaRecorder
  mediaRecorder = null

  recorder.onstop = async () => {
    stopStream()
    const blob = new Blob(chunks, { type: 'audio/webm' })
    if (blob.size < 1000) {
      useNovaStore.getState().setAvatarState('idle')
      return
    }
    useNovaStore.getState().setAvatarState('thinking')
    try {
      const form = new FormData()
      form.append('audio', blob, 'speech.webm')
      const res = await fetch('http://127.0.0.1:8765/api/stt', { method: 'POST', body: form })
      const data = await res.json()
      const text = (data.text || '').trim()
      if (text) {
        sendUserMessage(text)
      } else {
        useNovaStore.getState().setAvatarState('confused')
        setTimeout(() => useNovaStore.getState().setAvatarState('idle'), 1200)
      }
    } catch {
      useNovaStore.getState().setAvatarState('error')
      setTimeout(() => useNovaStore.getState().setAvatarState('idle'), 1200)
    }
  }
  recorder.stop()
}
